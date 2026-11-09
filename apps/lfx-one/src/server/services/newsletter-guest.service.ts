// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  NEWSLETTER_GUEST_NOT_ELIGIBLE_ERROR_CODE,
  NEWSLETTER_GUEST_TEASER_MAX_LENGTH,
  NEWSLETTER_GUEST_UNAVAILABLE_ERROR_CODE,
  NEWSLETTER_INVITE_EXPIRED_ERROR_CODE,
  NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN,
} from '@lfx-one/shared/constants';
import {
  Committee,
  MemberBenefitCompany,
  Newsletter,
  NewsletterFoundationSummary,
  NewsletterGuestGrant,
  NewsletterGuestInviteInfo,
  NewsletterGuestIssue,
  NewsletterGuestIssueResponse,
  NewsletterGuestNewsletter,
  NewsletterGuestSession,
  NewsletterGuestSharedTarget,
  NewsletterGuestTeaser,
  NewsletterMemberBenefitGroup,
  ResolvedNewsletterFoundation,
} from '@lfx-one/shared/interfaces';
import { maskEmailForDisplay } from '@lfx-one/shared/utils/email.utils';
import { firstHtmlImageUrl, htmlTextExcerpt } from '@lfx-one/shared/utils/html-utils';
import { isUuid } from '@lfx-one/shared/utils/string.utils';
import { Request } from 'express';

import { AuthorizationError, InvalidRequestError, isBaseApiError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { buildNewsletterInviteAcceptUrl, renderNewsletterGuestConfirmEmail, requireAppBaseUrl } from '../helpers/newsletter-invite-email.helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { createNewsletterInviteToken, readNewsletterInviteToken } from '../utils/newsletter-guest-token.util';
import { EmailService } from './email.service';
import { logger } from './logger.service';
import { NewsletterInviteService } from './newsletter-invite.service';
import { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';
import { NewsletterService } from './newsletter.service';
import { ProjectService } from './project.service';

/**
 * Signed-out newsletter reading as a member benefit (#5235). There is no LFX session, so every
 * upstream read and the group add use the app's M2M token, and the member-company check runs in-app
 * first — the same check and the same Newsletter-category-only add the signed-in flows use.
 *
 * - Invite link: the signed token proves the reader holds the invited inbox, so opening it re-checks
 *   the member company, adds that address to the newsletter group, and shows the group's latest issue.
 * - Shared link: the reader types a work email. It is trusted for reading only — that issue, and the
 *   rest of its foundation's newsletter in the same browser session — and gets a confirmation link
 *   (the same signed token); the address joins the list only once that link is opened.
 *
 * Access lasts for the browser session: the controller keeps a {@link NewsletterGuestSession} in a
 * signed session cookie.
 */
export class NewsletterGuestService {
  private readonly inviteService: NewsletterInviteService;
  private readonly memberBenefitService: NewsletterMemberBenefitService;
  private readonly newsletterService: NewsletterService;
  private readonly projectService: ProjectService;
  private readonly emailService: EmailService;

  public constructor(
    deps: {
      inviteService?: NewsletterInviteService;
      memberBenefitService?: NewsletterMemberBenefitService;
      newsletterService?: NewsletterService;
      projectService?: ProjectService;
      emailService?: EmailService;
    } = {}
  ) {
    this.inviteService = deps.inviteService ?? new NewsletterInviteService();
    this.memberBenefitService = deps.memberBenefitService ?? new NewsletterMemberBenefitService();
    this.newsletterService = deps.newsletterService ?? new NewsletterService();
    this.projectService = deps.projectService ?? new ProjectService();
    this.emailService = deps.emailService ?? new EmailService();
  }

  /** POST /public/api/newsletters/invites/inspect — what the invite landing modal shows; side-effect free. */
  public async inspectInvite(req: Request, token: string): Promise<NewsletterGuestInviteInfo> {
    const check = readNewsletterInviteToken(token);
    if (check.status !== 'valid') {
      logger.debug(req, 'inspect_newsletter_guest_invite', 'Invite token is not usable', { status: check.status });
      return { status: check.status };
    }

    const { c: committeeUid, e: email } = check.payload;
    const m2mToken = await generateM2MToken(req);
    const target = await this.resolveInviteGroup(req, m2mToken, committeeUid);
    if (!target) return { status: 'invalid' };

    const { foundation, membership } = target.resolved;
    const company = await this.memberBenefitService.findMemberCompanyForEmail(req, m2mToken, email, membership.slug);
    const base = { foundation, membership_name: membership.name, committee_uid: committeeUid, masked_email: maskEmailForDisplay(email) };
    if (!company) return { ...base, status: 'not_eligible' };

    const teaser = await this.findLatestIssueTeaser(req, m2mToken, target.committee);
    return { ...base, status: 'valid', company_name: company.company_name, ...(teaser ? { teaser } : {}) };
  }

  /**
   * POST /public/api/newsletters/invites/accept — the invitee's Continue. Re-checks everything the
   * inspect did, adds the invited address to the group (already on it is fine), and returns the
   * group's latest issue.
   */
  public async acceptInvite(req: Request, token: string): Promise<NewsletterGuestGrant> {
    const operation = 'accept_newsletter_guest_invite';
    const check = readNewsletterInviteToken(token);
    if (check.status !== 'valid') throw this.inviteUnusable(operation);

    const { c: committeeUid, e: email } = check.payload;
    const m2mToken = await generateM2MToken(req);
    const target = await this.resolveInviteGroup(req, m2mToken, committeeUid);
    if (!target) throw this.inviteUnusable(operation);

    const { committee, resolved } = target;
    const company = await this.memberBenefitService.findMemberCompanyForEmail(req, m2mToken, email, resolved.membership.slug);
    if (!company) {
      throw new AuthorizationError(`This newsletter is a member benefit of ${resolved.membership.name}`, {
        operation,
        service: 'newsletter_guest',
        code: NEWSLETTER_GUEST_NOT_ELIGIBLE_ERROR_CODE,
      });
    }

    const group: NewsletterMemberBenefitGroup = { uid: committee.uid, name: committee.name };
    const status = await this.memberBenefitService.addToNewsletterGroup(req, m2mToken, group, {
      email,
      b2b_org_uid: company.b2b_org_uid,
      company_name: company.company_name,
    });
    logger.info(req, operation, 'Signed-out invitee joined the newsletter group', {
      committee_uid: committee.uid,
      b2b_org_uid: company.b2b_org_uid,
      status,
    });

    const newsletter = await this.findLatestIssue(req, m2mToken, committee);
    return {
      issue: { foundation: resolved.foundation, masked_email: maskEmailForDisplay(email), newsletter, confirmation_sent: false },
      session: { e: email, c: committee.uid, f: resolved.foundation.uid, v: true },
    };
  }

  /**
   * POST /public/api/newsletters/:projectSlug/:newsletterUid/guest-access — a shared-link reader's
   * Continue. A typed work email at a member company reads the issue; a confirmation link goes to that
   * address, and only opening it adds the address to the list.
   */
  public async requestSharedAccess(req: Request, projectSlug: string, newsletterUid: string, rawEmail: unknown): Promise<NewsletterGuestGrant> {
    const operation = 'request_newsletter_guest_access';
    const email = this.inviteService.normalizeInviteEmail(rawEmail, operation);
    const m2mToken = await generateM2MToken(req);
    const target = await this.resolveSharedIssue(req, m2mToken, projectSlug, newsletterUid);
    if (!target) throw this.sharedUnavailable(operation);

    const { newsletter, group, resolved } = target;
    const company = await this.memberBenefitService.findMemberCompanyForEmail(req, m2mToken, email, resolved.membership.slug);
    if (!company) {
      throw new ServiceValidationError(
        [
          {
            field: 'email',
            message: `This newsletter is a member benefit of ${resolved.membership.name}. Use your work email, or sign in.`,
            code: NEWSLETTER_GUEST_NOT_ELIGIBLE_ERROR_CODE,
          },
        ],
        'Validation failed for email',
        { operation, service: 'newsletter_guest' }
      );
    }

    const confirmation = await this.sendConfirmation(req, m2mToken, group, email, company, resolved.foundation);
    logger.info(req, operation, 'Signed-out member-company reader opened a shared newsletter', {
      newsletter_uid: newsletter.id,
      committee_uid: group.uid,
      b2b_org_uid: company.b2b_org_uid,
      confirmation,
    });
    // `confirmation_sent` is constant for every member-company address: answering with the real outcome
    // would tell an anonymous caller whether any typed address is already on the list.
    return {
      issue: {
        foundation: resolved.foundation,
        masked_email: maskEmailForDisplay(email),
        newsletter: this.toGuestNewsletter(newsletter),
        confirmation_sent: true,
      },
      session: { e: email, c: group.uid, f: resolved.foundation.uid, v: false },
    };
  }

  /** GET /public/api/newsletters/guest/latest — the session's newsletter group's latest issue, or null when the session no longer applies. */
  public async getLatestIssue(req: Request, session: NewsletterGuestSession): Promise<NewsletterGuestIssue | null> {
    const m2mToken = await generateM2MToken(req);
    const target = await this.resolveInviteGroup(req, m2mToken, session.c);
    if (!target || target.resolved.foundation.uid !== session.f) return null;
    const newsletter = await this.findLatestIssue(req, m2mToken, target.committee);
    return { foundation: target.resolved.foundation, masked_email: maskEmailForDisplay(session.e), newsletter, confirmation_sent: !session.v };
  }

  /**
   * GET /public/api/newsletters/guest/:projectSlug/:newsletterUid — a shared issue when the guest session
   * covers its foundation; otherwise no issue, but the foundation the email prompt names.
   */
  public async getSharedIssue(
    req: Request,
    session: NewsletterGuestSession | null,
    projectSlug: string,
    newsletterUid: string
  ): Promise<NewsletterGuestIssueResponse> {
    const m2mToken = await generateM2MToken(req);
    const target = await this.resolveSharedIssue(req, m2mToken, projectSlug, newsletterUid);
    if (!target) return { issue: null };
    const { foundation, membership } = target.resolved;
    const prompt = { foundation, membership_name: membership.name };
    if (!session || foundation.uid !== session.f) return { issue: null, ...prompt, teaser: this.toTeaser(target.newsletter) };
    return {
      issue: {
        foundation,
        masked_email: maskEmailForDisplay(session.e),
        newsletter: this.toGuestNewsletter(target.newsletter),
        confirmation_sent: !session.v,
      },
      ...prompt,
    };
  }

  /** The invite's newsletter group and its foundation, or null when the uid is not (or no longer) a Newsletter-category group. */
  private async resolveInviteGroup(
    req: Request,
    m2mToken: string,
    committeeUid: string
  ): Promise<{ committee: Committee; resolved: ResolvedNewsletterFoundation } | null> {
    const committee = await this.inviteService.getNewsletterCommittee(req, m2mToken, committeeUid);
    const resolved = committee ? await this.inviteService.resolveFoundation(req, committee.project_uid, { bearerToken: m2mToken }) : null;
    return committee && resolved ? { committee, resolved } : null;
  }

  /**
   * A sent issue of the slug's project that went to a Newsletter-category group — the only issues the
   * member benefit opens. Malformed params, an unknown slug or issue, an unsent issue and any upstream
   * 4xx are all null, so drafts are not revealed.
   */
  private async resolveSharedIssue(req: Request, m2mToken: string, projectSlug: string, newsletterUid: string): Promise<NewsletterGuestSharedTarget | null> {
    if (!NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN.test(projectSlug ?? '') || !isUuid(newsletterUid ?? '')) return null;
    const project = await this.projectService.getProjectIdBySlug(req, projectSlug, { unavailableAsMissing: false });
    if (!project.exists) return null;

    let newsletter: Newsletter;
    try {
      newsletter = await this.newsletterService.getNewsletter(req, project.uid, newsletterUid, { bearerToken: m2mToken });
    } catch (error) {
      const statusCode = isBaseApiError(error) ? error.statusCode : undefined;
      if (statusCode === undefined || statusCode < 400 || statusCode >= 500) throw error;
      logger.debug(req, 'resolve_newsletter_guest_issue', 'Upstream refused the issue read', { newsletter_uid: newsletterUid, status_code: statusCode });
      return null;
    }
    if (newsletter.status !== 'sent' || newsletter.project_uid !== project.uid) return null;

    const group = await this.memberBenefitService.resolveNewsletterGroup(req, m2mToken, newsletter);
    if (!group) return null;
    const resolved = await this.inviteService.resolveFoundation(req, project.uid, { bearerToken: m2mToken });
    return resolved ? { newsletter, group, resolved } : null;
  }

  /** The newsletter group's most recently sent issue (sent-time ordered, group-scoped upstream list), or null when it has sent none. */
  private async findLatestIssue(req: Request, m2mToken: string, committee: Committee): Promise<NewsletterGuestNewsletter | null> {
    const latest = await this.newsletterService.getLatestCommitteeNewsletter(req, committee.uid, { bearerToken: m2mToken });
    if (!latest) {
      logger.debug(req, 'find_newsletter_guest_latest_issue', 'Newsletter group has no sent issue', { committee_uid: committee.uid });
      return null;
    }
    const newsletter = await this.newsletterService.getNewsletter(req, latest.project_uid, latest.id, { bearerToken: m2mToken });
    return this.toGuestNewsletter(newsletter);
  }

  /**
   * Emails a shared-link reader the link that subscribes them, and returns what happened — for the
   * server log only, never the response. Fail-soft: the read already succeeded, so an address already
   * on the list, a recent confirmation, or a failed send only means no new email.
   */
  private async sendConfirmation(
    req: Request,
    m2mToken: string,
    group: NewsletterMemberBenefitGroup,
    email: string,
    company: MemberBenefitCompany,
    foundation: NewsletterFoundationSummary
  ): Promise<'sent' | 'already_member' | 'recently_sent' | 'failed'> {
    const operation = 'send_newsletter_guest_confirmation';
    const cooldownKey = `${group.uid}|${email}`;
    try {
      if (await this.memberBenefitService.isEmailInGroup(req, m2mToken, group.uid, email)) {
        logger.debug(req, operation, 'Reader is already on the newsletter list — no confirmation sent', { committee_uid: group.uid });
        return 'already_member';
      }
      if (!this.inviteService.claimRecipientCooldown(cooldownKey)) {
        logger.debug(req, operation, 'Confirmation already emailed recently — not emailed again', { committee_uid: group.uid });
        return 'recently_sent';
      }
      const rendered = renderNewsletterGuestConfirmEmail({
        company_name: this.inviteService.singleLine(company.company_name || 'your company'),
        foundation_name: this.inviteService.singleLine(foundation.name),
        confirm_url: buildNewsletterInviteAcceptUrl(requireAppBaseUrl(), createNewsletterInviteToken(group.uid, email)),
      });
      try {
        await this.emailService.sendEmail(req, { to: email, ...rendered });
      } catch (error) {
        // Release only on a confirmed pre-send refusal. A lost reply or an unconfirmed outcome may
        // already have delivered, and an anonymous retry must not mail the address again today.
        if (isBaseApiError(error) && error.code === 'EMAIL_SEND_FAILED' && !error.transportFailure) {
          this.inviteService.releaseRecipientCooldown(cooldownKey);
        }
        throw error;
      }
      return 'sent';
    } catch (error) {
      logger.warning(req, operation, 'Subscription confirmation could not be sent — reading continues', { committee_uid: group.uid, err: error });
      return 'failed';
    }
  }

  /**
   * Teaser of the group's latest issue for the invite prompt. Fail-soft: the prompt works without it,
   * so an upstream failure only leaves the placeholder article behind the modal.
   */
  private async findLatestIssueTeaser(req: Request, m2mToken: string, committee: Committee): Promise<NewsletterGuestTeaser | null> {
    try {
      const latest = await this.findLatestIssue(req, m2mToken, committee);
      return latest ? this.toTeaser(latest) : null;
    } catch (error) {
      logger.warning(req, 'inspect_newsletter_guest_invite', 'Latest issue teaser unavailable — prompt continues without it', {
        committee_uid: committee.uid,
        err: error,
      });
      return null;
    }
  }

  /** What a not-yet-qualified reader may see of a sent issue: its subject, first image and a short plain-text opening — never the body. */
  private toTeaser(newsletter: Pick<Newsletter, 'subject' | 'body_html'>): NewsletterGuestTeaser {
    return {
      subject: newsletter.subject,
      image_url: firstHtmlImageUrl(newsletter.body_html),
      excerpt: htmlTextExcerpt(newsletter.body_html, NEWSLETTER_GUEST_TEASER_MAX_LENGTH),
    };
  }

  private toGuestNewsletter(newsletter: Newsletter): NewsletterGuestNewsletter {
    return { id: newsletter.id, subject: newsletter.subject, sent_at: newsletter.sent_at ?? null, body_html: newsletter.body_html };
  }

  private inviteUnusable(operation: string): InvalidRequestError {
    return new InvalidRequestError('This invite link has expired or is invalid', NEWSLETTER_INVITE_EXPIRED_ERROR_CODE, {
      operation,
      service: 'newsletter_guest',
    });
  }

  private sharedUnavailable(operation: string): ResourceNotFoundError {
    // A fixed resource id: this anonymous endpoint never echoes caller-supplied text into its error.
    return new ResourceNotFoundError('Newsletter', 'guest-access', { operation, service: 'newsletter_guest', code: NEWSLETTER_GUEST_UNAVAILABLE_ERROR_CODE });
  }
}
