// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CommitteeNewsletter,
  CommitteeNewsletterFeedResult,
  CreateNewsletterRequest,
  MyNewsletter,
  MyNewslettersResponse,
  Newsletter,
  NewsletterAnalytics,
  NewsletterCancelScheduleResult,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterOptOutListResponse,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientEngagementResponse,
  NewsletterRecipientsResponse,
  NewsletterScheduleResult,
  NewsletterSendResult,
  NewsletterTestSendPayload,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils/project.utils';
import { Request } from 'express';

import { isBaseApiError } from '../errors';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { NewsletterServiceClient } from './newsletter-service.client';
import { ProjectService } from './project.service';

/** Upstream committee-list calls in flight at once during the my-newsletters fan-out. */
const MY_NEWSLETTERS_CONCURRENCY = 5;

/**
 * Hard cap on pages followed per committee (20 pages × 20 rows = 400
 * newsletters) — guards against an upstream bug returning a never-terminating
 * next_page_token, which would otherwise hang the request.
 */
const MAX_COMMITTEE_NEWSLETTER_PAGES = 20;

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
   * committee UIDs (the same query-service lookup My Groups uses), then fan out
   * the committee-scoped upstream list per committee with the user's bearer
   * token — the gateway FGA-checks `committee:{uid}#member` on every call, so
   * access tracks live membership and committees never used for a newsletter
   * simply return empty. There is deliberately no "did I receive it" record:
   * leaving a group hides its newsletters, joining reveals past ones.
   */
  public async getMyNewsletters(req: Request): Promise<MyNewslettersResponse> {
    // getMyCommitteeUids, not getMyCommittees: this feed only needs membership
    // UIDs, and the lightweight variant skips the committee/mailing-list/project
    // enrichment fan-out AND never drops a membership whose committee resource
    // is missing from the index (getMyCommittees does).
    const committeeUids = [...(await this.committeeService.getMyCommitteeUids(req, undefined, { failOnPartial: true }))];
    if (committeeUids.length === 0) {
      return { newsletters: [], complete: true };
    }

    logger.debug(req, 'get_my_newsletters', 'Fetching newsletters for user committees', {
      committee_count: committeeUids.length,
    });

    // Bounded fan-out: a newsletter sent to several of the user's committees
    // comes back once per committee, so dedupe by id.
    const byId = new Map<string, CommitteeNewsletter>();
    let complete = true;
    for (let i = 0; i < committeeUids.length; i += MY_NEWSLETTERS_CONCURRENCY) {
      const chunk = committeeUids.slice(i, i + MY_NEWSLETTERS_CONCURRENCY);
      const pages = await Promise.all(chunk.map((uid) => this.listAllCommitteeNewsletters(req, uid)));
      for (const result of pages) {
        complete = complete && result.complete;
        for (const newsletter of result.newsletters) {
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
      complete,
    });

    return { newsletters: await this.enrichMyNewsletters(req, sorted), complete };
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

  public scheduleNewsletter(
    req: Request,
    projectUid: string,
    newsletterUid: string,
    ifMatchVersion: number,
    scheduledAt: string | undefined
  ): Promise<NewsletterScheduleResult> {
    return this.newsletterClient.scheduleNewsletter(req, projectUid, newsletterUid, ifMatchVersion, scheduledAt);
  }

  public cancelScheduleNewsletter(req: Request, projectUid: string, newsletterUid: string, ifMatchVersion: number): Promise<NewsletterCancelScheduleResult> {
    return this.newsletterClient.cancelScheduleNewsletter(req, projectUid, newsletterUid, ifMatchVersion);
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

  public getRecipientEngagement(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterRecipientEngagementResponse> {
    return this.newsletterClient.getRecipientEngagement(req, projectUid, newsletterUid);
  }

  public listOptOuts(req: Request, projectUid: string): Promise<NewsletterOptOutListResponse> {
    return this.newsletterClient.listOptOuts(req, projectUid);
  }

  public deleteOptOut(req: Request, projectUid: string, optOutId: string): Promise<void> {
    return this.newsletterClient.deleteOptOut(req, projectUid, optOutId);
  }

  /**
   * All pages of the committee-scoped upstream list for one committee.
   * All-or-nothing per committee: a failure on ANY page degrades the whole
   * committee to an empty contribution. Refused/deleted committees are omitted;
   * auth expiry fails the request; other failures mark enumeration incomplete.
   */
  private async listAllCommitteeNewsletters(req: Request, committeeUid: string): Promise<CommitteeNewsletterFeedResult> {
    const all: CommitteeNewsletter[] = [];
    try {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const page = await this.newsletterClient.listCommitteeNewsletters(req, committeeUid, pageToken);
        all.push(...(page.newsletters ?? []));
        pageToken = page.next_page_token;
        pages += 1;
      } while (pageToken && pages < MAX_COMMITTEE_NEWSLETTER_PAGES);

      if (pageToken) {
        logger.warning(req, 'get_my_newsletters', 'Stopped following page tokens at the per-committee cap', {
          committee_uid: committeeUid,
          page_cap: MAX_COMMITTEE_NEWSLETTER_PAGES,
        });
      }
      return { newsletters: all, complete: !pageToken };
    } catch (error) {
      const statusCode = isBaseApiError(error) ? error.statusCode : undefined;
      if (statusCode === 401) throw error;
      if (statusCode === 403 || statusCode === 404) return { newsletters: [], complete: true };
      logger.warning(req, 'get_my_newsletters', 'Failed to list newsletters for committee, skipping', {
        committee_uid: committeeUid,
        status_code: statusCode,
      });
      return { newsletters: [], complete: false };
    }
  }

  /** Two batch stages only; metadata failures never remove authorized issues. */
  private async enrichMyNewsletters(req: Request, newsletters: CommitteeNewsletter[]): Promise<MyNewsletter[]> {
    if (newsletters.length === 0) return [];
    const owners = await this.projectService.getProjectsByIds(req, [...new Set(newsletters.map((row) => row.project_uid))]);
    const parentUids = new Set<string>();
    for (const owner of owners.values()) {
      if (!computeIsFoundation(owner) && owner.parent_uid && !owners.has(owner.parent_uid)) parentUids.add(owner.parent_uid);
    }
    const parents = parentUids.size > 0 ? await this.projectService.getProjectsByIds(req, parentUids) : new Map();
    return newsletters.map((row) => {
      const owner = owners.get(row.project_uid);
      if (!owner) return row;
      const isFoundation = computeIsFoundation(owner);
      const parent = !isFoundation && owner.parent_uid ? (owners.get(owner.parent_uid) ?? parents.get(owner.parent_uid)) : undefined;
      return {
        ...row,
        project_name: owner.name,
        project_slug: owner.slug,
        is_foundation: isFoundation,
        parent_project_uid: owner.parent_uid,
        ...(parent && { parent_project_name: parent.name, parent_is_foundation: computeIsFoundation(parent) }),
      };
    });
  }
}
