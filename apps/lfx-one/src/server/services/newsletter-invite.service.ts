// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMAIL_REGEX,
  NEWSLETTER_COMMITTEE_CATEGORY,
  NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE,
  NEWSLETTER_INVITE_INVALID_ERROR_CODE,
  NEWSLETTER_INVITE_NOT_MEMBER_ERROR_CODE,
  NEWSLETTER_INVITE_PERSONAL_EMAIL_ERROR_CODE,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE,
} from '@lfx-one/shared/constants';
import {
  Committee,
  FoundationNewsletterGroup,
  MyNewsletter,
  MyNewsletterFoundation,
  MyNewsletterFoundationsResponse,
  MyNewsletterInviter,
  NewsletterFoundationSummary,
  NewsletterGroupJoinEvaluation,
  NewsletterGroupJoinStatus,
  NewsletterInviteResult,
  NewsletterJoinResult,
  NewsletterMemberBenefitGroup,
  Project,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { emailDomain, isFilterSafeIdentifier, isPersonalEmailDomain } from '@lfx-one/shared/utils';
import { computeIsFoundation } from '@lfx-one/shared/utils/project.utils';
import { Request } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { buildNewsletterInviteAcceptUrl, renderNewsletterInviteEmail } from '../helpers/newsletter-invite-email.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveName, getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { CommitteeService } from './committee.service';
import { EmailVerificationService } from './email-verification.service';
import { EmailService } from './email.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';
import { NewsletterService } from './newsletter.service';
import { ProjectService } from './project.service';

/**
 * Me-lens My Newsletters by foundation, and the member-benefit coworker invite (#3483).
 *
 * - Cards: the user's newsletter feed grouped by owning foundation, plus their own
 *   Newsletter-category groups (so a group that has not sent yet still shows).
 * - Invite: an eligible member-company employee in a foundation's newsletter group emails a
 *   coworker whose domain is also a Linux Foundation member. The email links to the foundation
 *   drill-down — the link carries no credential.
 * - Landing: whoever signs in is checked from scratch with the #3469 member-benefit rules on their
 *   own verified emails, then confirms; the add is the same M2M group add the reader page uses.
 */
export class NewsletterInviteService {
  private readonly memberBenefitService: NewsletterMemberBenefitService;
  private readonly newsletterService: NewsletterService;
  private readonly committeeService: CommitteeService;
  private readonly projectService: ProjectService;
  private readonly emailVerificationService: EmailVerificationService;
  private readonly emailService: EmailService;
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor(
    deps: {
      memberBenefitService?: NewsletterMemberBenefitService;
      newsletterService?: NewsletterService;
      committeeService?: CommitteeService;
      projectService?: ProjectService;
      emailVerificationService?: EmailVerificationService;
      emailService?: EmailService;
      microserviceProxy?: MicroserviceProxyService;
    } = {}
  ) {
    this.memberBenefitService = deps.memberBenefitService ?? new NewsletterMemberBenefitService();
    this.newsletterService = deps.newsletterService ?? new NewsletterService();
    this.committeeService = deps.committeeService ?? new CommitteeService();
    this.projectService = deps.projectService ?? new ProjectService();
    this.emailVerificationService = deps.emailVerificationService ?? new EmailVerificationService();
    this.emailService = deps.emailService ?? new EmailService();
    this.microserviceProxy = deps.microserviceProxy ?? new MicroserviceProxyService();
  }

  /** GET /api/newsletters/my-foundations — the card grid and every drill-down's rows in one fan-out. */
  public async getMyNewsletterFoundations(req: Request): Promise<MyNewsletterFoundationsResponse> {
    const committeeUids = await this.committeeService.getMyCommitteeUids(req, undefined, { failOnPartial: true });
    const [feed, groups, inviter] = await Promise.all([
      this.newsletterService.getMyNewsletters(req, committeeUids),
      this.getMyNewsletterGroupsSafe(req, committeeUids),
      this.resolveInviter(req),
    ]);

    const foundations = this.groupByFoundation(feed.newsletters, groups, inviter.eligible);
    logger.debug(req, 'get_my_newsletter_foundations', 'Grouped newsletters by foundation', {
      foundation_count: foundations.length,
      newsletter_count: feed.newsletters.length,
      newsletter_group_count: groups.size,
      inviter_eligible: inviter.eligible,
    });
    return { foundations, newsletters: feed.newsletters, complete: feed.complete, inviter };
  }

  /**
   * POST /api/newsletters/foundations/:foundationUid/invites. The sender must be eligible and in
   * the foundation's newsletter group; the invitee's domain must be a Linux Foundation member's.
   * Someone already on the list is not emailed again, but gets the same answer, so the endpoint
   * does not reveal the roster.
   */
  public async sendInvite(req: Request, foundationUid: string, rawEmail: string): Promise<NewsletterInviteResult> {
    const operation = 'send_newsletter_invite';
    const email = this.normalizeInviteEmail(rawEmail, operation);

    const committeeUids = await this.committeeService.getMyCommitteeUids(req, undefined, { failOnPartial: true });
    const groups = await this.getMyNewsletterGroups(req, committeeUids);
    const entry = groups.get(foundationUid);
    if (!entry) {
      throw new AuthorizationError("Join this foundation's newsletter group to invite others", {
        operation,
        service: 'newsletter_invite',
        code: NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE,
      });
    }

    const m2mToken = await generateM2MToken(req);
    const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
    const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails);
    if (!eligibility.match) {
      throw new AuthorizationError('Invites are available to employees of Linux Foundation member companies', {
        operation,
        service: 'newsletter_invite',
        code: NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE,
      });
    }

    const inviteeCompany = await this.memberBenefitService.findMemberCompanyForEmail(req, m2mToken, email);
    if (!inviteeCompany) {
      throw new ServiceValidationError(
        [
          {
            field: 'email',
            message: `${emailDomain(email)} isn't a Linux Foundation member company`,
            code: NEWSLETTER_INVITE_NOT_MEMBER_ERROR_CODE,
          },
        ],
        'Validation failed for email',
        { operation, service: 'newsletter_invite' }
      );
    }

    const result: NewsletterInviteResult = { email, foundation_name: entry.foundation.name };
    if (await this.memberBenefitService.isEmailInGroup(req, m2mToken, entry.group.uid, email)) {
      logger.info(req, operation, 'Invitee is already on the newsletter list — not emailed', { committee_uid: entry.group.uid });
      return result;
    }

    const rendered = renderNewsletterInviteEmail({
      inviter_name: this.singleLine(getEffectiveName(req) || getEffectiveUsername(req) || 'A colleague'),
      company_name: this.singleLine(inviteeCompany.company_name || eligibility.match.company_name || 'your company'),
      foundation_name: this.singleLine(entry.foundation.name),
      accept_url: buildNewsletterInviteAcceptUrl(this.appBaseUrl(), entry.foundation.slug, entry.group.uid),
    });
    await this.emailService.sendEmail(req, { to: email, ...rendered });

    logger.info(req, operation, 'Newsletter invite sent', {
      foundation_uid: foundationUid,
      committee_uid: entry.group.uid,
      invitee_b2b_org_uid: inviteeCompany.b2b_org_uid,
    });
    return result;
  }

  /** GET /api/newsletters/groups/:committeeUid/join-status — side-effect free. */
  public async getJoinStatus(req: Request, committeeUid: string): Promise<NewsletterGroupJoinStatus> {
    return (await this.evaluateJoin(req, committeeUid)).status;
  }

  /** POST /api/newsletters/groups/:committeeUid/join — re-runs the landing check, then adds the qualifying email. */
  public async joinGroup(req: Request, committeeUid: string): Promise<NewsletterJoinResult> {
    const evaluation = await this.evaluateJoin(req, committeeUid);
    const { group } = evaluation.status;

    if (evaluation.state === 'already_member') {
      return { status: 'already_member', email: '', committee_name: group.name, company_name: '' };
    }
    if (evaluation.state === 'denied') {
      throw new AuthorizationError('Not eligible to join this newsletter', {
        operation: 'join_newsletter_group_by_invite',
        service: 'newsletter_invite',
        code: 'NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE',
      });
    }

    const status = await this.memberBenefitService.addToNewsletterGroup(req, await generateM2MToken(req), group, evaluation.match);
    logger.info(req, 'join_newsletter_group_by_invite', 'Invite join completed', {
      committee_uid: group.uid,
      b2b_org_uid: evaluation.match.b2b_org_uid,
      status,
    });
    return { status, email: evaluation.match.email, committee_name: group.name, company_name: evaluation.match.company_name };
  }

  /**
   * The invite landing check. The group uid in the link is only a hint: it must still be a
   * Newsletter-category group (never another committee — those carry real permissions) under a
   * resolvable foundation, else the invite is invalid.
   */
  private async evaluateJoin(req: Request, committeeUid: string): Promise<NewsletterGroupJoinEvaluation> {
    const m2mToken = await generateM2MToken(req);
    const committee = await this.getNewsletterCommittee(req, m2mToken, committeeUid);
    const foundation = committee ? await this.resolveFoundation(req, committee.project_uid) : null;
    if (!committee || !foundation) {
      throw new ResourceNotFoundError('Newsletter invite', committeeUid, {
        operation: 'evaluate_newsletter_invite',
        service: 'newsletter_invite',
        code: NEWSLETTER_INVITE_INVALID_ERROR_CODE,
      });
    }

    const group: NewsletterMemberBenefitGroup = { uid: committeeUid, name: committee.name };
    const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
    if (await this.memberBenefitService.isGroupMember(req, m2mToken, [committeeUid], verifiedEmails)) {
      return { state: 'already_member', status: { state: 'already_member', group, foundation } };
    }

    const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails);
    if (!eligibility.match) {
      return {
        state: 'denied',
        status: { state: 'denied', group, foundation, denied_reason: eligibility.denied_reason ?? 'not_member_company' },
      };
    }
    return {
      state: 'eligible',
      status: { state: 'eligible', group, foundation, email: eligibility.match.email, company_name: eligibility.match.company_name },
      match: eligibility.match,
    };
  }

  /** One card per foundation: from the feed, plus any newsletter group that has not sent yet. */
  private groupByFoundation(newsletters: MyNewsletter[], groups: Map<string, FoundationNewsletterGroup>, inviterEligible: boolean): MyNewsletterFoundation[] {
    const cards = new Map<string, MyNewsletterFoundation>();
    const card = (summary: NewsletterFoundationSummary): MyNewsletterFoundation => {
      let existing = cards.get(summary.uid);
      if (!existing) {
        const group = groups.get(summary.uid)?.group ?? null;
        existing = { ...summary, received_count: 0, last_sent_at: null, newsletter_group: group, can_invite: inviterEligible && !!group };
        cards.set(summary.uid, existing);
      }
      return existing;
    };

    // The feed is sorted newest first, so the first row of a foundation carries its last send.
    for (const row of newsletters) {
      const uid = row.foundation_uid ?? row.project_uid;
      const entry = card({
        uid,
        slug: row.foundation_slug ?? row.project_slug ?? uid,
        name: row.foundation_name ?? row.project_name ?? 'Unknown foundation',
        logo_url: row.foundation_logo_url ?? null,
      });
      entry.received_count += 1;
      entry.last_sent_at ??= row.sent_at ?? null;
    }
    for (const { foundation } of groups.values()) card(foundation);

    return [...cards.values()].sort((a, b) => {
      const byRecency = (b.last_sent_at ?? '').localeCompare(a.last_sent_at ?? '');
      return byRecency !== 0 ? byRecency : a.name.localeCompare(b.name);
    });
  }

  /** Whether the signed-in user may invite. Fail-soft: the cards still render when the check cannot run. */
  private async resolveInviter(req: Request): Promise<MyNewsletterInviter> {
    try {
      const m2mToken = await generateM2MToken(req);
      const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
      const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails);
      if (eligibility.match) return { eligible: true, company_name: eligibility.match.company_name || null };
      return { eligible: false, company_name: null, denied_reason: eligibility.denied_reason ?? 'not_member_company' };
    } catch (error) {
      logger.warning(req, 'get_my_newsletter_foundations', 'Inviter eligibility check failed — invites hidden', { err: error });
      return { eligible: false, company_name: null, denied_reason: 'unavailable' };
    }
  }

  private async getMyNewsletterGroupsSafe(req: Request, committeeUids: Set<string>): Promise<Map<string, FoundationNewsletterGroup>> {
    try {
      return await this.getMyNewsletterGroups(req, committeeUids);
    } catch (error) {
      logger.warning(req, 'get_my_newsletter_foundations', 'Newsletter group lookup failed — invites hidden', { err: error });
      return new Map();
    }
  }

  /**
   * The user's Newsletter-category groups keyed by foundation uid. Read with the user's token:
   * these are committees the user is a member of. When a foundation has several, the
   * alphabetically first is used.
   */
  private async getMyNewsletterGroups(req: Request, committeeUids: Set<string>): Promise<Map<string, FoundationNewsletterGroup>> {
    const uids = [...committeeUids].filter(isFilterSafeIdentifier);
    const committees: Committee[] = [];
    for (let i = 0; i < uids.length; i += QUERY_SERVICE_FILTERS_OR_BATCH_SIZE) {
      const batch = uids.slice(i, i + QUERY_SERVICE_FILTERS_OR_BATCH_SIZE);
      const page = await fetchAllQueryResources<Committee>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'committee',
            tags: batch.map((uid) => `committee_uid:${uid}`),
            page_size: batch.length,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      );
      committees.push(...page);
    }

    const newsletterGroups = committees
      .filter((committee) => committee?.category === NEWSLETTER_COMMITTEE_CATEGORY && committee.uid && committee.project_uid)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (newsletterGroups.length === 0) return new Map();

    const foundations = await this.resolveFoundations(
      req,
      newsletterGroups.map((committee) => committee.project_uid)
    );
    const byFoundation = new Map<string, FoundationNewsletterGroup>();
    for (const committee of newsletterGroups) {
      const foundation = foundations.get(committee.project_uid);
      if (foundation && !byFoundation.has(foundation.uid)) {
        byFoundation.set(foundation.uid, { foundation, group: { uid: committee.uid, name: committee.name } });
      }
    }
    return byFoundation;
  }

  /** A committee by uid (M2M, query-service), only if it is a Newsletter-category group. */
  private async getNewsletterCommittee(req: Request, m2mToken: string, committeeUid: string): Promise<Committee | null> {
    if (!isFilterSafeIdentifier(committeeUid)) return null;
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      { type: 'committee', tags: [`committee_uid:${committeeUid}`], page_size: 1 },
      undefined,
      undefined,
      { bearerToken: m2mToken }
    );
    const committee = response?.resources?.[0]?.data;
    return committee?.uid === committeeUid && committee.category === NEWSLETTER_COMMITTEE_CATEGORY ? committee : null;
  }

  private async resolveFoundation(req: Request, projectUid: string | undefined): Promise<NewsletterFoundationSummary | null> {
    if (!projectUid) return null;
    return (await this.resolveFoundations(req, [projectUid])).get(projectUid) ?? null;
  }

  /** project uid → owning foundation (the project itself when it is one, else its parent). */
  private async resolveFoundations(req: Request, projectUids: string[]): Promise<Map<string, NewsletterFoundationSummary>> {
    const owners = await this.projectService.getProjectsByIds(req, new Set(projectUids));
    const parentUids = new Set<string>();
    for (const owner of owners.values()) {
      if (!computeIsFoundation(owner) && owner.parent_uid && !owners.has(owner.parent_uid)) parentUids.add(owner.parent_uid);
    }
    const parents = parentUids.size > 0 ? await this.projectService.getProjectsByIds(req, parentUids) : new Map<string, Project>();

    const result = new Map<string, NewsletterFoundationSummary>();
    for (const projectUid of projectUids) {
      const owner = owners.get(projectUid);
      if (!owner) continue;
      const foundation = computeIsFoundation(owner) || !owner.parent_uid ? owner : (owners.get(owner.parent_uid) ?? parents.get(owner.parent_uid));
      if (foundation) {
        result.set(projectUid, { uid: foundation.uid, slug: foundation.slug, name: foundation.name, logo_url: foundation.logo_url || null });
      }
    }
    return result;
  }

  private normalizeInviteEmail(rawEmail: unknown, operation: string): string {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
      throw ServiceValidationError.forField('email', 'Enter a valid email address', { operation, service: 'newsletter_invite' });
    }
    const domain = emailDomain(email);
    if (!domain || isPersonalEmailDomain(domain)) {
      throw new ServiceValidationError(
        [{ field: 'email', message: 'Use a company email address', code: NEWSLETTER_INVITE_PERSONAL_EMAIL_ERROR_CODE }],
        'Validation failed for email',
        { operation, service: 'newsletter_invite' }
      );
    }
    return email;
  }

  /** Strips line breaks so a profile name cannot inject into the email subject. */
  private singleLine(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }

  private appBaseUrl(): string {
    return process.env['PCC_BASE_URL'] || 'http://localhost:4000';
  }
}
