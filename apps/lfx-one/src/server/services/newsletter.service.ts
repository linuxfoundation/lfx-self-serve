// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CommitteeNewsletter,
  CreateNewsletterRequest,
  MyNewsletter,
  Newsletter,
  NewsletterAnalytics,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterOptOutListResponse,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientsResponse,
  NewsletterSendResult,
  NewsletterTestSendPayload,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { NewsletterServiceClient } from './newsletter-service.client';
import { ProjectService } from './project.service';

/** Upstream committee-list calls in flight at once during the my-newsletters fan-out. */
const MY_NEWSLETTERS_CONCURRENCY = 5;

/**
 * Thin pass-through layer in front of NewsletterServiceClient.
 *
 * Express no longer owns any newsletter business logic — the Go service
 * (`lfx-v2-newsletter-service`) handles recipient resolution, email-chrome
 * rendering, per-recipient fan-out via NATS to lfx-v2-email-service, and
 * analytics aggregation. This service exists to give the controller a single
 * collaborator type and to leave room for any UI-side normalization that
 * doesn't belong on the wire (none currently).
 */
export class NewsletterService {
  private readonly newsletterClient: NewsletterServiceClient;
  private readonly committeeService: CommitteeService;
  private readonly projectService: ProjectService;

  public constructor(newsletterClient?: NewsletterServiceClient, committeeService?: CommitteeService, projectService?: ProjectService) {
    this.newsletterClient = newsletterClient ?? new NewsletterServiceClient();
    this.committeeService = committeeService ?? new CommitteeService();
    this.projectService = projectService ?? new ProjectService();
  }

  /**
   * Sent newsletters reachable through the user's current committee
   * memberships (Me lens "My Newsletters").
   *
   * Discovery is driven from the membership side: enumerate the user's
   * committees (the same query-service lookup My Groups uses), then fan out
   * the committee-scoped upstream list per committee with the user's bearer
   * token — the gateway FGA-checks `committee:{uid}#member` on every call, so
   * access tracks live membership and committees never used for a newsletter
   * simply return empty. There is deliberately no "did I receive it" record:
   * leaving a group hides its newsletters, joining reveals past ones.
   */
  public async getMyNewsletters(req: Request): Promise<MyNewsletter[]> {
    const committees = await this.committeeService.getMyCommittees(req);
    if (committees.length === 0) {
      return [];
    }

    const committeeUids = [...new Set(committees.map((c) => c.uid))];
    logger.debug(req, 'get_my_newsletters', 'Fetching newsletters for user committees', {
      committee_count: committeeUids.length,
    });

    // Bounded fan-out: a newsletter sent to several of the user's committees
    // comes back once per committee, so dedupe by id.
    const byId = new Map<string, CommitteeNewsletter>();
    for (let i = 0; i < committeeUids.length; i += MY_NEWSLETTERS_CONCURRENCY) {
      const chunk = committeeUids.slice(i, i + MY_NEWSLETTERS_CONCURRENCY);
      const pages = await Promise.all(chunk.map((uid) => this.listAllCommitteeNewsletters(req, uid)));
      for (const newsletters of pages) {
        for (const newsletter of newsletters) {
          if (!byId.has(newsletter.id)) {
            byId.set(newsletter.id, newsletter);
          }
        }
      }
    }

    const sorted = [...byId.values()].sort((a, b) => new Date(b.sent_at ?? 0).getTime() - new Date(a.sent_at ?? 0).getTime());

    logger.debug(req, 'get_my_newsletters', 'Completed my-newsletters fan-out', {
      committee_count: committeeUids.length,
      newsletter_count: sorted.length,
    });

    return this.projectService.enrichWithProjectData(req, sorted);
  }

  public createNewsletter(req: Request, projectUid: string, payload: CreateNewsletterRequest): Promise<Newsletter> {
    return this.newsletterClient.createNewsletter(req, projectUid, payload);
  }

  public getNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<Newsletter> {
    return this.newsletterClient.getNewsletter(req, projectUid, newsletterUid);
  }

  public listNewsletters(req: Request, projectUid: string, params: NewsletterListParams): Promise<NewsletterListResponse> {
    return this.newsletterClient.listNewsletters(req, projectUid, params);
  }

  public updateNewsletter(
    req: Request,
    projectUid: string,
    newsletterUid: string,
    ifMatchVersion: number,
    payload: UpdateNewsletterRequest
  ): Promise<Newsletter> {
    return this.newsletterClient.updateNewsletter(req, projectUid, newsletterUid, ifMatchVersion, payload);
  }

  public deleteNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<void> {
    return this.newsletterClient.deleteNewsletter(req, projectUid, newsletterUid);
  }

  public sendNewsletter(req: Request, projectUid: string, newsletterUid: string, ifMatchVersion: number): Promise<NewsletterSendResult> {
    return this.newsletterClient.sendNewsletter(req, projectUid, newsletterUid, ifMatchVersion);
  }

  public recipientCount(req: Request, projectUid: string, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientCount> {
    return this.newsletterClient.recipientCount(req, projectUid, payload);
  }

  public recipients(req: Request, projectUid: string, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientsResponse> {
    return this.newsletterClient.recipients(req, projectUid, payload);
  }

  public testSend(req: Request, projectUid: string, payload: NewsletterTestSendPayload): Promise<{ ok: boolean }> {
    return this.newsletterClient.testSend(req, projectUid, payload);
  }

  public getAnalytics(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterAnalytics> {
    return this.newsletterClient.getAnalytics(req, projectUid, newsletterUid);
  }

  public listOptOuts(req: Request, projectUid: string): Promise<NewsletterOptOutListResponse> {
    return this.newsletterClient.listOptOuts(req, projectUid);
  }

  public deleteOptOut(req: Request, projectUid: string, optOutId: string): Promise<void> {
    return this.newsletterClient.deleteOptOut(req, projectUid, optOutId);
  }

  /**
   * All pages of the committee-scoped upstream list for one committee.
   * Failures degrade to an empty list (warning-logged) instead of failing the
   * whole feed — membership can change mid-flight, in which case the gateway
   * starts returning 403 for that committee.
   */
  private async listAllCommitteeNewsletters(req: Request, committeeUid: string): Promise<CommitteeNewsletter[]> {
    const all: CommitteeNewsletter[] = [];
    try {
      let pageToken: string | undefined;
      do {
        const page = await this.newsletterClient.listCommitteeNewsletters(req, committeeUid, pageToken);
        all.push(...(page.newsletters ?? []));
        pageToken = page.next_page_token;
      } while (pageToken);
    } catch (error) {
      logger.warning(req, 'get_my_newsletters', 'Failed to list newsletters for committee, skipping', {
        committee_uid: committeeUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return all;
  }
}
