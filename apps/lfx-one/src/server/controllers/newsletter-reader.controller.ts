// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_NOT_SENT_ERROR_CODE } from '@lfx-one/shared/constants';
import { NewsletterJoinResult, NewsletterReaderAccess, NewsletterReaderEvaluation } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils/string.utils';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { NewsletterMemberBenefitService } from '../services/newsletter-member-benefit.service';
import { NewsletterService } from '../services/newsletter.service';
import { generateM2MToken } from '../utils/m2m-token.util';

/**
 * Newsletter permalink reader (`/newsletters/:projectSlug/:id`) — the newsletter member benefit
 * (#3469). Access ladder, evaluated server-side on every call:
 * 1. project writer → `manager` (drafts included; unchanged manager experience)
 * 2. any other caller only ever sees SENT issues (drafts 404)
 * 3. already in one of the issue's audience committees → `group_member`
 * 4. verified email at an active Linux Foundation member company, and the issue has a
 *    Newsletter-category group → `eligible` (the page then calls `join`)
 * 5. otherwise → `denied`, with the body withheld
 *
 * The newsletter itself is read with the user's token. Membership facts the user cannot read
 * (TLF memberships, member domains, the group roster) and the single group add use M2M, scoped
 * per call, only after the user's identity and the issue were resolved in-app.
 */
export class NewsletterReaderController {
  private readonly newsletterService: NewsletterService;
  private readonly memberBenefitService: NewsletterMemberBenefitService;
  private readonly accessCheckService: AccessCheckService;

  public constructor(newsletterService?: NewsletterService, memberBenefitService?: NewsletterMemberBenefitService, accessCheckService?: AccessCheckService) {
    this.newsletterService = newsletterService ?? new NewsletterService();
    this.memberBenefitService = memberBenefitService ?? new NewsletterMemberBenefitService();
    this.accessCheckService = accessCheckService ?? new AccessCheckService();
  }

  /**
   * GET /api/newsletters/:projectUid/:newsletterUid/reader
   * Side-effect free (safe during SSR): decides access and returns the issue when allowed.
   */
  public async getReaderAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_newsletter_reader_access', {
      project_uid: req.params['projectUid'],
      newsletter_id: req.params['newsletterUid'],
    });

    try {
      const { projectUid, newsletterUid } = this.requireParams(req, 'get_newsletter_reader_access');
      const evaluation = await this.evaluate(req, projectUid, newsletterUid);

      let body: NewsletterReaderAccess;
      if (evaluation.level === 'denied') {
        body = { access: 'denied', denied_reason: evaluation.reason };
      } else if (evaluation.level === 'eligible') {
        body = {
          access: 'eligible',
          newsletter: evaluation.newsletter,
          qualifying_email: evaluation.match.email,
          company_name: evaluation.match.company_name,
          committee_name: evaluation.group.name,
        };
      } else {
        body = { access: evaluation.level, newsletter: evaluation.newsletter };
      }

      res.set('Cache-Control', 'private, no-store');
      logger.success(req, 'get_newsletter_reader_access', startTime, {
        newsletter_id: newsletterUid,
        access: body.access,
        ...(body.denied_reason && { denied_reason: body.denied_reason }),
      });
      res.json(body);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/:projectUid/:newsletterUid/join
   * Adds the caller's qualifying work email to the issue's newsletter group. Re-runs the whole
   * ladder rather than trusting the reader response; blocked during impersonation by the route.
   */
  public async joinNewsletterGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'join_newsletter_group', {
      project_uid: req.params['projectUid'],
      newsletter_id: req.params['newsletterUid'],
    });

    try {
      const { projectUid, newsletterUid } = this.requireParams(req, 'join_newsletter_group');
      const evaluation = await this.evaluate(req, projectUid, newsletterUid);

      // A second tab (or a retry after the add was indexed) finds the reader already in the group:
      // that is the outcome the caller wanted, not an error. The page keeps the names it showed.
      if (evaluation.level === 'group_member') {
        const result: NewsletterJoinResult = { status: 'already_member', email: '', committee_name: '', company_name: '' };
        logger.success(req, 'join_newsletter_group', startTime, { newsletter_id: newsletterUid, status: result.status });
        res.status(200).json(result);
        return;
      }

      if (evaluation.level !== 'eligible') {
        throw new AuthorizationError('Not eligible to join this newsletter', {
          operation: 'join_newsletter_group',
          service: 'newsletter_reader',
          path: req.path,
          code: 'NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE',
        });
      }

      const m2mToken = await generateM2MToken(req);
      const status = await this.memberBenefitService.addToNewsletterGroup(req, m2mToken, evaluation.group, evaluation.match);
      const result: NewsletterJoinResult = {
        status,
        email: evaluation.match.email,
        committee_name: evaluation.group.name,
        company_name: evaluation.match.company_name,
      };

      logger.success(req, 'join_newsletter_group', startTime, {
        newsletter_id: newsletterUid,
        committee_uid: evaluation.group.uid,
        b2b_org_uid: evaluation.match.b2b_org_uid,
        status,
      });
      res.status(status === 'added' ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  }

  private async evaluate(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterReaderEvaluation> {
    const [newsletter, isWriter] = await Promise.all([
      this.newsletterService.getNewsletter(req, projectUid, newsletterUid),
      this.accessCheckService.checkSingleAccessStrict(req, { resource: 'project', id: projectUid, access: 'writer' }),
    ]);

    if (isWriter) return { level: 'manager', newsletter };

    if (newsletter.status !== 'sent') {
      throw new ResourceNotFoundError('Newsletter', newsletterUid, {
        operation: 'get_newsletter_reader_access',
        service: 'newsletter_reader',
        path: req.path,
        code: NEWSLETTER_NOT_SENT_ERROR_CODE,
      });
    }

    const m2mToken = await generateM2MToken(req);
    const verifiedEmails = await this.memberBenefitService.getVerifiedEmails(req);

    if (await this.memberBenefitService.isGroupMember(req, m2mToken, newsletter.committee_uids ?? [], verifiedEmails)) {
      return { level: 'group_member', newsletter };
    }

    const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails);
    if (!eligibility.match) {
      return { level: 'denied', newsletter, reason: eligibility.denied_reason ?? 'not_member_company' };
    }

    const group = await this.memberBenefitService.resolveNewsletterGroup(req, m2mToken, newsletter);
    if (!group) {
      return { level: 'denied', newsletter, reason: 'no_newsletter_group' };
    }

    return { level: 'eligible', newsletter, match: eligibility.match, group };
  }

  private requireParams(req: Request, operation: string): { projectUid: string; newsletterUid: string } {
    const projectUid = req.params['projectUid'];
    const newsletterUid = req.params['newsletterUid'];
    if (!projectUid || !isUuid(projectUid)) {
      throw ServiceValidationError.forField('projectUid', 'Invalid project ID', { operation, path: req.path });
    }
    if (!newsletterUid || !isUuid(newsletterUid)) {
      throw ServiceValidationError.forField('newsletterUid', 'Invalid newsletter ID', { operation, path: req.path });
    }
    return { projectUid, newsletterUid };
  }
}
