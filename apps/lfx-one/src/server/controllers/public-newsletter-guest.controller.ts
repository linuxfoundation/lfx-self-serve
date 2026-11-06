// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_GUEST_COOKIE_NAME, NEWSLETTER_GUEST_COOKIE_PATH } from '@lfx-one/shared/constants';
import { NewsletterGuestGrant, NewsletterGuestIssueResponse, NewsletterGuestSession } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { logger } from '../services/logger.service';
import { NewsletterGuestService } from '../services/newsletter-guest.service';
import { createNewsletterGuestSessionValue, readCookie, readNewsletterGuestSessionValue } from '../utils/newsletter-guest-token.util';

/**
 * Signed-out newsletter reading as a member benefit (#5235) — the invite link landing and the shared
 * issue link. A successful Continue sets a signed, httpOnly browser-session cookie (no expiry) scoped
 * to the public newsletter endpoints; the reads answer `{ issue: null }` when it is missing or does
 * not cover the requested foundation, so the page shows its modal instead of an error.
 */
export class PublicNewsletterGuestController {
  public constructor(private readonly guestService: NewsletterGuestService = new NewsletterGuestService()) {}

  /** POST /public/api/newsletters/invites/inspect */
  public async inspectInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'inspect_newsletter_guest_invite';
    const startTime = logger.startOperation(req, operation);
    try {
      const info = await this.guestService.inspectInvite(req, this.bodyString(req, 'token'));
      logger.success(req, operation, startTime, { status: info.status, committee_uid: info.committee_uid });
      this.noStore(res);
      res.json(info);
    } catch (error) {
      next(error);
    }
  }

  /** POST /public/api/newsletters/invites/accept */
  public async acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'accept_newsletter_guest_invite';
    const startTime = logger.startOperation(req, operation);
    try {
      const grant = await this.guestService.acceptInvite(req, this.bodyString(req, 'token'));
      this.grant(res, grant);
      logger.success(req, operation, startTime, { committee_uid: grant.session.c });
    } catch (error) {
      next(error);
    }
  }

  /** POST /public/api/newsletters/:projectSlug/:newsletterUid/guest-access */
  public async requestSharedAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'request_newsletter_guest_access';
    const { projectSlug, newsletterUid } = req.params;
    const startTime = logger.startOperation(req, operation, { project_slug: projectSlug, newsletter_uid: newsletterUid });
    try {
      const grant = await this.guestService.requestSharedAccess(req, projectSlug, newsletterUid, req.body?.email);
      // A reader who already proved this address for this list (an accepted invite) keeps that proof.
      const previous = this.session(req);
      if (previous?.v && previous.e === grant.session.e && previous.c === grant.session.c) {
        grant.session = { ...grant.session, v: true };
        grant.issue = { ...grant.issue, confirmation_sent: false };
      }
      this.grant(res, grant);
      logger.success(req, operation, startTime, { committee_uid: grant.session.c, confirmation_sent: grant.issue.confirmation_sent });
    } catch (error) {
      next(error);
    }
  }

  /** GET /public/api/newsletters/guest/latest */
  public async getLatestIssue(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_newsletter_guest_latest_issue';
    const startTime = logger.startOperation(req, operation);
    try {
      const session = this.session(req);
      const issue = session ? await this.guestService.getLatestIssue(req, session) : null;
      logger.success(req, operation, startTime, { has_session: !!session, found: !!issue });
      this.noStore(res);
      res.json({ issue } satisfies NewsletterGuestIssueResponse);
    } catch (error) {
      next(error);
    }
  }

  /** GET /public/api/newsletters/guest/:projectSlug/:newsletterUid */
  public async getSharedIssue(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_newsletter_guest_shared_issue';
    const { projectSlug, newsletterUid } = req.params;
    const startTime = logger.startOperation(req, operation, { project_slug: projectSlug, newsletter_uid: newsletterUid });
    try {
      const session = this.session(req);
      const response = await this.guestService.getSharedIssue(req, session, projectSlug, newsletterUid);
      logger.success(req, operation, startTime, { has_session: !!session, found: !!response.issue });
      this.noStore(res);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sets the guest session cookie and answers with the issue. No `maxAge`: it ends with the browser
   * session; the signed payload also carries its own expiry, so a restored or copied cookie still ends.
   */
  private grant(res: Response, { issue, session }: NewsletterGuestGrant): void {
    res.cookie(NEWSLETTER_GUEST_COOKIE_NAME, createNewsletterGuestSessionValue(session), {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: NEWSLETTER_GUEST_COOKIE_PATH,
    });
    this.noStore(res);
    res.json(issue);
  }

  /** Guest answers carry the reader's (masked) email and the issue body and depend on a cookie: no shared or browser cache may keep them. */
  private noStore(res: Response): void {
    res.set('Cache-Control', 'private, no-store');
  }

  private session(req: Request): NewsletterGuestSession | null {
    return readNewsletterGuestSessionValue(readCookie(req.headers.cookie, NEWSLETTER_GUEST_COOKIE_NAME));
  }

  private bodyString(req: Request, field: string): string {
    const value = req.body?.[field];
    return typeof value === 'string' ? value : '';
  }
}
