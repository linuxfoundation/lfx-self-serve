// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NewsletterReaderAccess, NewsletterReaderEvaluation } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { NewsletterMemberBenefitService } from '../services/newsletter-member-benefit.service';

/**
 * Newsletter permalink reader (`/newsletters/:projectSlug/:id`) and the Linux Foundation member
 * benefit (#3469). HTTP boundary only: the access ladder lives in
 * `NewsletterMemberBenefitService.evaluateReaderAccess`.
 */
export class NewsletterReaderController {
  private readonly memberBenefitService: NewsletterMemberBenefitService;

  public constructor(memberBenefitService?: NewsletterMemberBenefitService) {
    this.memberBenefitService = memberBenefitService ?? new NewsletterMemberBenefitService();
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
      const body = this.toReaderAccess(await this.memberBenefitService.evaluateReaderAccess(req, projectUid, newsletterUid));

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
   * Adds the caller's qualifying work email to the issue's newsletter group. The service re-runs
   * the whole ladder rather than trusting the reader response; blocked during impersonation by the route.
   */
  public async joinNewsletterGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'join_newsletter_group', {
      project_uid: req.params['projectUid'],
      newsletter_id: req.params['newsletterUid'],
    });

    try {
      const { projectUid, newsletterUid } = this.requireParams(req, 'join_newsletter_group');
      const result = await this.memberBenefitService.joinNewsletterGroup(req, projectUid, newsletterUid);

      logger.success(req, 'join_newsletter_group', startTime, { newsletter_id: newsletterUid, status: result.status });
      res.status(result.status === 'added' ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Wire shape of the ladder outcome — the body is withheld when denied. */
  private toReaderAccess(evaluation: NewsletterReaderEvaluation): NewsletterReaderAccess {
    if (evaluation.level === 'denied') {
      return { access: 'denied', denied_reason: evaluation.reason };
    }
    if (evaluation.level === 'eligible') {
      return {
        access: 'eligible',
        newsletter: evaluation.newsletter,
        qualifying_email: evaluation.match.email,
        company_name: evaluation.match.company_name,
        committee_name: evaluation.group.name,
      };
    }
    return { access: evaluation.level, newsletter: evaluation.newsletter };
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
