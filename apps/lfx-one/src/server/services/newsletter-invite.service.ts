// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMAIL_REGEX,
  MEMBER_BENEFIT_FOUNDATION_NAME,
  MEMBER_BENEFIT_FOUNDATION_SLUG,
  MEMBER_BENEFIT_INTERNAL_ALLOCATION_ENTITY_TYPE,
  MEMBER_BENEFIT_MEMBERSHIP_FUNDING_MODEL,
  NEWSLETTER_COMMITTEE_CATEGORY,
  NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE,
  NEWSLETTER_INVITE_INVALID_ERROR_CODE,
  NEWSLETTER_INVITE_EMAIL_PATTERN,
  NEWSLETTER_INVITE_INVITER_NAME_MAX_LENGTH,
  NEWSLETTER_INVITE_NOT_MEMBER_ERROR_CODE,
  NEWSLETTER_INVITE_PERSONAL_EMAIL_ERROR_CODE,
  NEWSLETTER_INVITE_RECIPIENT_COOLDOWN_MS,
  NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE_ERROR_CODE,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE,
} from '@lfx-one/shared/constants';
import {
  Committee,
  FoundationNewsletterGroup,
  MyNewsletter,
  MyNewsletterFoundation,
  MyNewsletterFoundationsResponse,
  MyNewsletterInviteDeniedReason,
  MyNewsletterInviter,
  NewsletterFoundationSummary,
  NewsletterGroupJoinEvaluation,
  NewsletterGroupJoinStatus,
  NewsletterInviteResult,
  NewsletterJoinResult,
  NewsletterMemberBenefitEligibility,
  NewsletterMemberBenefitGroup,
  NewsletterMembershipScope,
  Project,
  QueryServiceResponse,
  ResolvedNewsletterFoundation,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation, emailDomain, isFilterSafeIdentifier, isPersonalEmailDomain } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { buildNewsletterInviteAcceptUrl, renderNewsletterInviteEmail } from '../helpers/newsletter-invite-email.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { collapseRootParentUid, resolveRootProjectUid } from '../helpers/root-project.helper';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveName, getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { CommitteeService } from './committee.service';
import { EmailVerificationService } from './email-verification.service';
import { EmailService } from './email.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';
import { NewsletterService } from './newsletter.service';
import { ProjectService } from './project.service';

/**
 * Me-lens My Newsletters by foundation, and the member-benefit coworker invite (#3483).
 *
 * - Cards: the user's newsletter feed grouped by owning foundation, plus their own
 *   Newsletter-category groups (so a group that has not sent yet still shows).
 * - Invite: an employee of a member of the card's foundation, in that foundation's newsletter
 *   group, emails a coworker whose domain is also that foundation's member. A foundation without a
 *   membership roster of its own (an internal LF project) uses The Linux Foundation's. The email
 *   links to the foundation drill-down — the link carries no credential.
 * - Landing: whoever signs in is checked from scratch against the same foundation's members on
 *   their own verified emails, then confirms; the add is the same M2M group add the reader page uses.
 */
export class NewsletterInviteService {
  /**
   * `<group uid>|<email>` → last invite time. Per pod and in memory, like the route's rate limiter:
   * it bounds how often one address is emailed about one list, not an exact cluster-wide quota.
   */
  private static readonly recentInvites = new Map<string, number>();
  private static lastCooldownSweepAt = 0;

  private readonly memberBenefitService: NewsletterMemberBenefitService;
  private readonly newsletterService: NewsletterService;
  private readonly committeeService: CommitteeService;
  private readonly projectService: ProjectService;
  private readonly emailVerificationService: EmailVerificationService;
  private readonly emailService: EmailService;
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly natsService: NatsService;

  public constructor(
    deps: {
      memberBenefitService?: NewsletterMemberBenefitService;
      newsletterService?: NewsletterService;
      committeeService?: CommitteeService;
      projectService?: ProjectService;
      emailVerificationService?: EmailVerificationService;
      emailService?: EmailService;
      microserviceProxy?: MicroserviceProxyService;
      natsService?: NatsService;
    } = {}
  ) {
    this.memberBenefitService = deps.memberBenefitService ?? new NewsletterMemberBenefitService();
    this.newsletterService = deps.newsletterService ?? new NewsletterService();
    this.committeeService = deps.committeeService ?? new CommitteeService();
    this.projectService = deps.projectService ?? new ProjectService();
    this.emailVerificationService = deps.emailVerificationService ?? new EmailVerificationService();
    this.emailService = deps.emailService ?? new EmailService();
    this.microserviceProxy = deps.microserviceProxy ?? new MicroserviceProxyService();
    this.natsService = deps.natsService ?? new NatsService();
  }

  /** Test seam: forget recent invites. */
  public static resetRecentInvites(): void {
    NewsletterInviteService.recentInvites.clear();
    NewsletterInviteService.lastCooldownSweepAt = 0;
  }

  /** GET /api/newsletters/my-foundations — the card grid and every drill-down's rows in one fan-out. */
  public async getMyNewsletterFoundations(req: Request): Promise<MyNewsletterFoundationsResponse> {
    const committeeUids = await this.committeeService.getMyCommitteeUids(req, undefined, { failOnPartial: true });
    const [feed, { groups, complete: groupsComplete }] = await Promise.all([
      this.newsletterService.getMyNewsletters(req, committeeUids),
      this.getMyNewsletterGroupsSafe(req, committeeUids),
    ]);
    const { inviter, eligibilityBySlug } = await this.resolveInviter(req, groups);

    const foundations = this.groupByFoundation(feed.newsletters, groups, groupsComplete, inviter, eligibilityBySlug);
    logger.debug(req, 'get_my_newsletter_foundations', 'Grouped newsletters by foundation', {
      foundation_count: foundations.length,
      newsletter_count: feed.newsletters.length,
      newsletter_group_count: groups.size,
      inviter_eligible: inviter.eligible,
    });
    return { foundations, newsletters: feed.newsletters, complete: feed.complete, inviter };
  }

  /**
   * POST /api/newsletters/foundations/:foundationUid/invites. The sender must be in the
   * foundation's newsletter group and work at a member of its membership scope (its own roster, or
   * The Linux Foundation's); the invitee's domain must belong to a member of the same scope.
   * Someone already on the list is not emailed again, but gets the same answer, so the endpoint
   * does not reveal the roster.
   */
  public async sendInvite(req: Request, foundationUid: string, rawEmail: string): Promise<NewsletterInviteResult> {
    const operation = 'send_newsletter_invite';
    const email = this.normalizeInviteEmail(rawEmail, operation);

    const committeeUids = await this.committeeService.getMyCommitteeUids(req, undefined, { failOnPartial: true });
    const { groups, unresolvedProjectUids } = await this.getMyNewsletterGroups(req, committeeUids);
    const entry = groups.get(foundationUid);
    // When this card's group resolved, other groups' unresolved projects do not matter. When it is
    // missing and anything was unresolved, it may be that one: answer a retryable 503, not a 403.
    if (!entry && unresolvedProjectUids.length > 0) this.throwFoundationUnavailable(unresolvedProjectUids[0]);
    if (!entry) {
      throw new AuthorizationError("Join this foundation's newsletter group to invite others", {
        operation,
        service: 'newsletter_invite',
        code: NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE,
      });
    }

    const m2mToken = await generateM2MToken(req);
    const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
    const { membership } = entry;
    const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails, membership.slug);
    if (!eligibility.match) {
      throw new AuthorizationError(`Invites are available to employees of ${membership.name} member companies`, {
        operation,
        service: 'newsletter_invite',
        code: NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE,
      });
    }

    const inviteeCompany = await this.memberBenefitService.findMemberCompanyForEmail(req, m2mToken, email, membership.slug);
    if (!inviteeCompany) {
      throw new ServiceValidationError(
        [
          {
            field: 'email',
            message: `${emailDomain(email)} isn't a member company of ${membership.name}`,
            code: NEWSLETTER_INVITE_NOT_MEMBER_ERROR_CODE,
          },
        ],
        'Validation failed for email',
        { operation, service: 'newsletter_invite' }
      );
    }

    const result: NewsletterInviteResult = { email, foundation_name: entry.foundation.name };
    const cooldownKey = `${entry.group.uid}|${email}`;
    if (this.invitedRecently(cooldownKey)) {
      logger.info(req, operation, 'Invitee was already emailed about this list recently — not emailed again', { committee_uid: entry.group.uid });
      return result;
    }
    // Claim the cooldown before any await so a double-click or retry cannot send twice; released
    // again if the send fails, so the sender can retry.
    NewsletterInviteService.recentInvites.set(cooldownKey, Date.now());
    if (await this.memberBenefitService.isEmailInGroup(req, m2mToken, entry.group.uid, email)) {
      logger.info(req, operation, 'Invitee is already on the newsletter list — not emailed', { committee_uid: entry.group.uid });
      return result;
    }

    const rendered = renderNewsletterInviteEmail({
      inviter_name: this.inviterName(getEffectiveName(req) || getEffectiveUsername(req) || ''),
      company_name: this.singleLine(inviteeCompany.company_name || eligibility.match.company_name || 'your company'),
      foundation_name: this.singleLine(entry.foundation.name),
      accept_url: buildNewsletterInviteAcceptUrl(this.appBaseUrl(), entry.foundation.slug, entry.group.uid),
    });
    try {
      await this.emailService.sendEmail(req, { to: email, ...rendered });
    } catch (error) {
      NewsletterInviteService.recentInvites.delete(cooldownKey);
      throw error;
    }

    logger.info(req, operation, 'Newsletter invite sent', {
      foundation_uid: foundationUid,
      membership_slug: membership.slug,
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
        code: NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE_ERROR_CODE,
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
    const resolved = committee ? await this.resolveFoundation(req, committee.project_uid) : null;
    if (!committee || !resolved) {
      throw new ResourceNotFoundError('Newsletter invite', committeeUid, {
        operation: 'evaluate_newsletter_invite',
        service: 'newsletter_invite',
        code: NEWSLETTER_INVITE_INVALID_ERROR_CODE,
      });
    }

    const { foundation, membership } = resolved;
    const membershipName = membership.name;
    const group: NewsletterMemberBenefitGroup = { uid: committeeUid, name: committee.name };
    const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
    if (await this.memberBenefitService.isGroupMember(req, m2mToken, [committeeUid], verifiedEmails)) {
      return { state: 'already_member', status: { state: 'already_member', group, foundation, membership_name: membershipName } };
    }

    const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails, membership.slug);
    if (!eligibility.match) {
      return {
        state: 'denied',
        status: { state: 'denied', group, foundation, membership_name: membershipName, denied_reason: eligibility.denied_reason ?? 'not_member_company' },
      };
    }
    return {
      state: 'eligible',
      status: {
        state: 'eligible',
        group,
        foundation,
        membership_name: membershipName,
        email: eligibility.match.email,
        company_name: eligibility.match.company_name,
      },
      match: eligibility.match,
    };
  }

  /** One card per foundation: from the feed, plus any newsletter group that has not sent yet. */
  private groupByFoundation(
    newsletters: MyNewsletter[],
    groups: Map<string, FoundationNewsletterGroup>,
    groupsComplete: boolean,
    inviter: MyNewsletterInviter,
    eligibilityBySlug: Map<string, NewsletterMemberBenefitEligibility | null>
  ): MyNewsletterFoundation[] {
    const cards = new Map<string, MyNewsletterFoundation>();
    const card = (summary: NewsletterFoundationSummary): MyNewsletterFoundation => {
      let existing = cards.get(summary.uid);
      if (!existing) {
        const entry = groups.get(summary.uid);
        const deniedReason = this.inviteDeniedReason(entry, groupsComplete, inviter, eligibilityBySlug);
        existing = {
          ...summary,
          received_count: 0,
          last_sent_at: null,
          newsletter_group: entry?.group ?? null,
          membership_name: entry?.membership.name ?? null,
          can_invite: !deniedReason,
          ...(deniedReason && { invite_denied_reason: deniedReason }),
        };
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

  /**
   * Why one card cannot invite, or undefined when it can. A lookup that did not complete reads as
   * `unavailable` — never as "join the list" or "not a member".
   */
  private inviteDeniedReason(
    entry: FoundationNewsletterGroup | undefined,
    groupsComplete: boolean,
    inviter: MyNewsletterInviter,
    eligibilityBySlug: Map<string, NewsletterMemberBenefitEligibility | null>
  ): MyNewsletterInviteDeniedReason | undefined {
    if (!entry) return groupsComplete ? 'no_newsletter_group' : 'unavailable';
    const eligibility = eligibilityBySlug.get(entry.membership.slug);
    if (!eligibility) return 'unavailable';
    if (eligibility.match) return undefined;
    return eligibility.denied_reason ?? 'not_member_company';
  }

  /**
   * Whether the signed-in user may invite, checked once per membership roster the user's groups
   * use (a card decides with its own foundation's). With no group the TLF check still runs, so the
   * page copy can name the user's company. Fail-soft per roster: a roster that cannot be checked
   * maps to null, so only the cards that use it read `unavailable`.
   */
  private async resolveInviter(
    req: Request,
    groups: Map<string, FoundationNewsletterGroup>
  ): Promise<{ inviter: MyNewsletterInviter; eligibilityBySlug: Map<string, NewsletterMemberBenefitEligibility | null> }> {
    const eligibilityBySlug = new Map<string, NewsletterMemberBenefitEligibility | null>();
    const slugs = [...new Set([MEMBER_BENEFIT_FOUNDATION_SLUG, ...[...groups.values()].map((entry) => entry.membership.slug)])];
    const unavailable: MyNewsletterInviter = { eligible: false, company_name: null, denied_reason: 'unavailable' };
    let m2mToken: string;
    let verifiedEmails: string[];
    try {
      m2mToken = await generateM2MToken(req);
      verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
    } catch (error) {
      logger.warning(req, 'get_my_newsletter_foundations', 'Inviter eligibility check failed — invites hidden', { err: error });
      slugs.forEach((slug) => eligibilityBySlug.set(slug, null));
      return { inviter: unavailable, eligibilityBySlug };
    }

    // One call for every roster: the b2b_org domain lookup is shared, and a roster that cannot be
    // checked maps to null so only its cards read `unavailable`.
    for (const [slug, eligibility] of await this.memberBenefitService.resolveEligibilityByRoster(req, m2mToken, verifiedEmails, slugs)) {
      eligibilityBySlug.set(slug, eligibility);
    }

    const groupSlugs = new Set([...groups.values()].map((entry) => entry.membership.slug));
    const match = [...eligibilityBySlug.entries()].find(([slug, eligibility]) => groupSlugs.has(slug) && eligibility?.match)?.[1]?.match;
    if (match) return { inviter: { eligible: true, company_name: match.company_name || null }, eligibilityBySlug };
    const tlf = eligibilityBySlug.get(MEMBER_BENEFIT_FOUNDATION_SLUG);
    if (!tlf) return { inviter: unavailable, eligibilityBySlug };
    return {
      inviter: tlf.match
        ? { eligible: false, company_name: tlf.match.company_name || null, denied_reason: 'not_member_company' }
        : { eligible: false, company_name: null, denied_reason: tlf.denied_reason ?? 'not_member_company' },
      eligibilityBySlug,
    };
  }

  /** The grid's groups; `complete` is false when the lookup failed or a group's project could not be resolved. */
  private async getMyNewsletterGroupsSafe(
    req: Request,
    committeeUids: Set<string>
  ): Promise<{ groups: Map<string, FoundationNewsletterGroup>; complete: boolean }> {
    try {
      const { groups, unresolvedProjectUids } = await this.getMyNewsletterGroups(req, committeeUids);
      if (unresolvedProjectUids.length > 0) {
        logger.warning(req, 'get_my_newsletter_foundations', 'Some newsletter groups could not be placed under a foundation', {
          unresolved_project_count: unresolvedProjectUids.length,
        });
      }
      return { groups, complete: unresolvedProjectUids.length === 0 };
    } catch (error) {
      logger.warning(req, 'get_my_newsletter_foundations', 'Newsletter group lookup failed — invites hidden', { err: error });
      return { groups: new Map(), complete: false };
    }
  }

  /**
   * The user's Newsletter-category groups keyed by foundation uid. Read with the user's token:
   * these are committees the user is a member of. When a foundation has several, the
   * alphabetically first is used. Groups whose project could not be resolved are left out and
   * reported, so a caller that needs one specific foundation can tell "absent" from "unknown".
   */
  private async getMyNewsletterGroups(
    req: Request,
    committeeUids: Set<string>
  ): Promise<{ groups: Map<string, FoundationNewsletterGroup>; unresolvedProjectUids: string[] }> {
    const uids = [...committeeUids].filter(isFilterSafeIdentifier);
    const batches: string[][] = [];
    for (let i = 0; i < uids.length; i += QUERY_SERVICE_FILTERS_OR_BATCH_SIZE) batches.push(uids.slice(i, i + QUERY_SERVICE_FILTERS_OR_BATCH_SIZE));
    const pages = await Promise.all(
      batches.map((batch) =>
        fetchAllQueryResources<Committee>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              type: 'committee',
              tags: batch.map((uid) => `committee_uid:${uid}`),
              page_size: batch.length,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        )
      )
    );

    const newsletterGroups = pages
      .flat()
      .filter((committee) => committee?.category === NEWSLETTER_COMMITTEE_CATEGORY && committee.uid && committee.project_uid)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (newsletterGroups.length === 0) return { groups: new Map(), unresolvedProjectUids: [] };

    const { resolved, unresolvedProjectUids } = await this.resolveFoundations(
      req,
      newsletterGroups.map((committee) => committee.project_uid)
    );
    const byFoundation = new Map<string, FoundationNewsletterGroup>();
    for (const committee of newsletterGroups) {
      const entry = resolved.get(committee.project_uid);
      if (entry && !byFoundation.has(entry.foundation.uid)) {
        byFoundation.set(entry.foundation.uid, { ...entry, group: { uid: committee.uid, name: committee.name } });
      }
    }
    return { groups: byFoundation, unresolvedProjectUids };
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

  /** The invite landing's foundation — strict: an unresolved project is a retryable 503, never an "invalid invite". */
  private async resolveFoundation(req: Request, projectUid: string | undefined): Promise<ResolvedNewsletterFoundation | null> {
    if (!projectUid) return null;
    const { resolved, unresolvedProjectUids } = await this.resolveFoundations(req, [projectUid]);
    if (unresolvedProjectUids.length > 0) this.throwFoundationUnavailable(unresolvedProjectUids[0]);
    return resolved.get(projectUid) ?? null;
  }

  /**
   * project uid → owning foundation: the project itself when it is a foundation or has no parent,
   * else its parent when that parent is a confirmed foundation, else the project itself — the same
   * roll-up as the feed's `foundation_*` tags. A parent that is the hidden ROOT project counts as
   * no parent (`getProjectsByIds` never returns ROOT).
   *
   * `getProjectsByIds` is fail-soft (an outage reads as "no such project"), so a project or parent
   * that does not come back is reported in `unresolvedProjectUids` rather than guessed at.
   */
  private async resolveFoundations(
    req: Request,
    projectUids: string[]
  ): Promise<{ resolved: Map<string, ResolvedNewsletterFoundation>; unresolvedProjectUids: string[] }> {
    const [owners, rootUid] = await Promise.all([
      this.projectService.getProjectsByIds(req, new Set(projectUids)),
      resolveRootProjectUid(req, this.natsService),
    ]);
    const parentOf = (project: Project): string | undefined => collapseRootParentUid(project.parent_uid, rootUid) || undefined;

    const parentUids = new Set<string>();
    for (const owner of owners.values()) {
      const parentUid = parentOf(owner);
      if (!computeIsFoundation(owner) && parentUid && !owners.has(parentUid)) parentUids.add(parentUid);
    }
    const parents = parentUids.size > 0 ? await this.projectService.getProjectsByIds(req, parentUids) : new Map<string, Project>();

    const resolved = new Map<string, ResolvedNewsletterFoundation>();
    const unresolvedProjectUids: string[] = [];
    for (const projectUid of projectUids) {
      const owner = owners.get(projectUid);
      if (!owner) {
        unresolvedProjectUids.push(projectUid);
        continue;
      }
      let foundation: Project = owner;
      const parentUid = parentOf(owner);
      if (!computeIsFoundation(owner) && parentUid) {
        const parent = owners.get(parentUid) ?? parents.get(parentUid);
        if (!parent) {
          unresolvedProjectUids.push(parentUid);
          continue;
        }
        if (computeIsFoundation(parent)) foundation = parent;
      }
      resolved.set(projectUid, {
        foundation: { uid: foundation.uid, slug: foundation.slug, name: foundation.name, logo_url: foundation.logo_url || null },
        membership: this.membershipScope(foundation),
      });
    }
    return { resolved, unresolvedProjectUids };
  }

  /**
   * Whose members a foundation's newsletter invites: its own when companies join it as members
   * (membership-funded, not an internal LF cost centre), else The Linux Foundation's.
   */
  private membershipScope(foundation: Project): NewsletterMembershipScope {
    const hasOwnRoster =
      Array.isArray(foundation.funding_model) &&
      foundation.funding_model.includes(MEMBER_BENEFIT_MEMBERSHIP_FUNDING_MODEL) &&
      foundation.legal_entity_type !== MEMBER_BENEFIT_INTERNAL_ALLOCATION_ENTITY_TYPE;
    return hasOwnRoster ? { slug: foundation.slug, name: foundation.name } : { slug: MEMBER_BENEFIT_FOUNDATION_SLUG, name: MEMBER_BENEFIT_FOUNDATION_NAME };
  }

  private throwFoundationUnavailable(projectUid: string): never {
    throw new MicroserviceError('Project data is temporarily unavailable', 503, 'NEWSLETTER_FOUNDATION_UNAVAILABLE', {
      operation: 'resolve_newsletter_foundation',
      service: 'newsletter_invite',
      path: `project:${projectUid}`,
      clientMessage: 'Newsletter details could not be loaded. Please try again.',
    });
  }

  private normalizeInviteEmail(rawEmail: unknown, operation: string): string {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    // EMAIL_REGEX alone admits `,`, `"`, `<`… in the local part; the invite pattern keeps `to` a plain address.
    if (!email || email.length > 254 || !EMAIL_REGEX.test(email) || !NEWSLETTER_INVITE_EMAIL_PATTERN.test(email)) {
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

  private invitedRecently(key: string): boolean {
    const now = Date.now();
    // Expired entries are dropped at most once a minute, not on every call.
    if (now - NewsletterInviteService.lastCooldownSweepAt >= 60_000) {
      NewsletterInviteService.lastCooldownSweepAt = now;
      for (const [entry, at] of NewsletterInviteService.recentInvites) {
        if (now - at >= NEWSLETTER_INVITE_RECIPIENT_COOLDOWN_MS) NewsletterInviteService.recentInvites.delete(entry);
      }
    }
    const last = NewsletterInviteService.recentInvites.get(key);
    return last !== undefined && now - last < NEWSLETTER_INVITE_RECIPIENT_COOLDOWN_MS;
  }

  /**
   * The inviter as shown in the email body: one line, no links, capped. A profile name is free text
   * and the email goes out in LFX branding, so it must not carry a URL or a long pitch.
   */
  private inviterName(raw: string): string {
    const cleaned = this.singleLine(
      raw
        .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
        // Bare domains too (`lfx-secure.example/login`) — mail clients auto-link them.
        .replace(/\S+\.[a-z]{2,}(?:\/\S*)?/gi, '')
        .replace(/\s{2,}/g, ' ')
    );
    if (!cleaned) return 'A colleague';
    return cleaned.length > NEWSLETTER_INVITE_INVITER_NAME_MAX_LENGTH
      ? `${cleaned.slice(0, NEWSLETTER_INVITE_INVITER_NAME_MAX_LENGTH - 1).trimEnd()}…`
      : cleaned;
  }

  /** Strips line breaks so upstream text cannot fold into a header. */
  private singleLine(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }

  /** The app origin for the accept link; never guessed — a wrong origin would mail out dead links. */
  private appBaseUrl(): string {
    const baseUrl = process.env['PCC_BASE_URL'];
    if (!baseUrl) throw new Error('PCC_BASE_URL is not configured; cannot build newsletter invite links');
    return baseUrl;
  }
}
