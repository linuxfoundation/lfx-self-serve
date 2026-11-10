// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ApiRequestOptions,
  NewsletterSharePreview,
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
  NewsletterRenderPreviewPayload,
  NewsletterRenderPreviewResponse,
  NewsletterScheduleResult,
  NewsletterSendResult,
  NewsletterShareRequest,
  NewsletterStatusCounts,
  NewsletterTemplateManifest,
  NewsletterTemplatesResponse,
  NewsletterTestSendPayload,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { isNewsletterLiveSendLocked } from '@lfx-one/shared/utils/newsletter.utils';
import { computeIsFoundation } from '@lfx-one/shared/utils/project.utils';
import { Request } from 'express';

import { AuthorizationError, isBaseApiError, PreconditionFailedError } from '../errors';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { NewsletterServiceClient } from './newsletter-service.client';
import { ProjectService } from './project.service';
import { generateM2MToken } from '../utils/m2m-token.util';

/** Upstream committee-list calls in flight at once during the my-newsletters fan-out. */
const MY_NEWSLETTERS_CONCURRENCY = 5;

/**
 * Hard cap on pages followed per committee (20 pages × 20 rows = 400
 * newsletters) — guards against an upstream bug returning a never-terminating
 * next_page_token, which would otherwise hang the request.
 */
const MAX_COMMITTEE_NEWSLETTER_PAGES = 20;

/**
 * Hard cap on pages followed when counting a project's newsletters (20 pages × 20 rows =
 * 400 newsletters) — same guard as the committee feed against a never-terminating token.
 */
const MAX_STATUS_COUNT_PAGES = 20;

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
  public async getMyNewsletters(req: Request, myCommitteeUids?: Set<string>): Promise<MyNewslettersResponse> {
    // getMyCommitteeUids, not getMyCommittees: this feed only needs membership
    // UIDs, and the lightweight variant skips the committee/mailing-list/project
    // enrichment fan-out AND never drops a membership whose committee resource
    // is missing from the index (getMyCommittees does). Callers that already
    // hold the set (the foundations view) pass it in.
    const committeeUids = [...(myCommitteeUids ?? (await this.committeeService.getMyCommitteeUids(req, undefined, { failOnPartial: true })))];
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

  /**
   * What a signed-out link preview may show of a permalink (#4940): the subject of a sent issue of the
   * slug's project, else null. The slug resolves over NATS (no token); the issue is read with an M2M
   * token scoped to that one call, because the visitor has no session. Nothing else leaves here, and an
   * unknown slug, unknown issue and unsent issue are the same null, so drafts are not revealed.
   */
  public async getSharePreview(req: Request, projectSlug: string, newsletterUid: string): Promise<NewsletterSharePreview | null> {
    const project = await this.projectService.getProjectIdBySlug(req, projectSlug, { unavailableAsMissing: false });
    if (!project.exists) {
      logger.debug(req, 'get_newsletter_share_preview', 'Project slug not found', { project_slug: projectSlug });
      return null;
    }

    const m2mToken = await generateM2MToken(req);
    let newsletter: Newsletter;
    try {
      newsletter = await this.getNewsletter(req, project.uid, newsletterUid, { bearerToken: m2mToken });
    } catch (error) {
      // Every upstream 4xx is "nothing to show", indistinguishable from a draft, so neither the upstream
      // message nor its status reaches a signed-out caller. A 403 means the M2M client lacks `viewer` on
      // the project — worth seeing, since every preview of that project then falls back to the neutral card.
      const statusCode = isBaseApiError(error) ? error.statusCode : undefined;
      if (statusCode === undefined || statusCode < 400 || statusCode >= 500) throw error;
      const metadata = { project_uid: project.uid, newsletter_uid: newsletterUid, status_code: statusCode };
      if (statusCode === 403) {
        logger.warning(req, 'get_newsletter_share_preview', 'M2M issue read refused; preview falls back to the neutral card', metadata);
      } else {
        logger.debug(req, 'get_newsletter_share_preview', 'Upstream refused the issue read', metadata);
      }
      return null;
    }
    if (newsletter.status !== 'sent' || newsletter.project_uid !== project.uid) {
      logger.debug(req, 'get_newsletter_share_preview', 'Issue is not a sent issue of this project', {
        project_uid: project.uid,
        newsletter_uid: newsletterUid,
      });
      return null;
    }
    return { subject: newsletter.subject };
  }

  /** `options.bearerToken` scopes an M2M override to this one read (the public share preview). */
  public getNewsletter(req: Request, projectUid: string, newsletterUid: string, options?: ApiRequestOptions): Promise<Newsletter> {
    return this.newsletterClient.getNewsletter(req, projectUid, newsletterUid, options);
  }

  /**
   * The editor-only release sends tests only, so a real send or schedule of a draft with a block
   * layout is refused here as well as in the UI, until NEWSLETTER_BLOCKS_LIVE_SEND_ENABLED is on.
   * The check must be on the version being sent, or an edit between this read and the send could
   * add a layout unseen, so a stale If-Match is refused here. A failed read fails closed.
   */
  public async assertLiveSendAllowed(req: Request, projectUid: string, newsletterUid: string, version: number, operation: string): Promise<void> {
    const draft = await this.getNewsletter(req, projectUid, newsletterUid);
    if (draft.version !== version) {
      throw new PreconditionFailedError(undefined, { operation, service: 'newsletter_service', path: req.path });
    }
    if (isNewsletterLiveSendLocked(draft.body_layout != null)) {
      throw new AuthorizationError("Real sends from the block editor aren't switched on yet", {
        operation,
        service: 'newsletter_service',
        path: req.path,
        code: 'NEWSLETTER_LIVE_SEND_LOCKED',
      });
    }
  }

  public getTemplates(req: Request, projectUid: string): Promise<NewsletterTemplatesResponse> {
    return this.newsletterClient.getTemplates(req, projectUid);
  }

  public renderPreview(req: Request, projectUid: string, payload: NewsletterRenderPreviewPayload): Promise<NewsletterRenderPreviewResponse> {
    return this.newsletterClient.renderPreview(req, projectUid, payload);
  }

  public getTemplateManifest(req: Request, projectUid: string, templateKey: string): Promise<NewsletterTemplateManifest> {
    return this.newsletterClient.getTemplateManifest(req, projectUid, templateKey);
  }

  public listNewsletters(req: Request, projectUid: string, params: NewsletterListParams): Promise<NewsletterListResponse> {
    return this.newsletterClient.listNewsletters(req, projectUid, params);
  }

  /**
   * The newest sent issue addressed to a newsletter group, or null when it has sent none. The
   * committee-scoped upstream list is sent-only and ordered by `sent_at` descending, so the first row
   * of the first page is the latest. Only the signed-out guest reader calls this, with an M2M token
   * (`options.bearerToken`), after it has verified the reader in-app.
   */
  public async getLatestCommitteeNewsletter(req: Request, committeeUid: string, options?: ApiRequestOptions): Promise<CommitteeNewsletter | null> {
    const page = await this.newsletterClient.listCommitteeNewsletters(req, committeeUid, undefined, options);
    return page.newsletters?.[0] ?? null;
  }

  /**
   * Tab counts for the project newsletter list. The upstream list has no totals, so this walks
   * the unfiltered list (cursor-chained, so sequential) while reading opt-outs in parallel.
   * A failed opt-out read only drops that count; a failed list read fails the request.
   */
  public async getNewsletterStatusCounts(req: Request, projectUid: string): Promise<NewsletterStatusCounts> {
    const optOutCount = this.newsletterClient
      .listOptOuts(req, projectUid)
      .then((response) => response.opt_outs.length)
      .catch((error: unknown) => {
        const statusCode = isBaseApiError(error) ? error.statusCode : undefined;
        if (statusCode === 401) throw error;
        return null;
      });
    // Attach a handler now: a 401 can reject this while the page walk is still awaiting upstream, and an
    // unhandled rejection there would be logged as a spurious error. The final await still sees the rejection.
    optOutCount.catch(() => undefined);

    const counts = { draft: 0, scheduled: 0, sent: 0 };
    let pageToken: string | undefined;
    let pages = 0;
    try {
      do {
        const page = await this.newsletterClient.listNewsletters(req, projectUid, { page_token: pageToken });
        for (const row of page.newsletters ?? []) {
          if (row.status === 'draft') counts.draft += 1;
          else if (row.status === 'scheduled' || (row.status === 'sending' && row.scheduled_at)) counts.scheduled += 1;
          else counts.sent += 1;
        }
        pageToken = page.next_page_token;
        pages += 1;
      } while (pageToken && pages < MAX_STATUS_COUNT_PAGES);
    } catch (error) {
      // Let the opt-out read settle so a late rejection never races the response.
      await optOutCount.catch(() => undefined);
      throw error;
    }

    if (pageToken) {
      logger.warning(req, 'newsletter_status_counts', 'Stopped following page tokens at the page cap', {
        project_uid: projectUid,
        page_cap: MAX_STATUS_COUNT_PAGES,
      });
    }

    return { ...counts, optout: await optOutCount, truncated: !!pageToken };
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

  public recordShare(req: Request, projectUid: string, newsletterUid: string, payload: NewsletterShareRequest): Promise<void> {
    return this.newsletterClient.recordShare(req, projectUid, newsletterUid, payload);
  }

  public recordPageView(req: Request, projectUid: string, newsletterUid: string): Promise<void> {
    return this.newsletterClient.recordPageView(req, projectUid, newsletterUid);
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
      // Same roll-up as the invite service: the owner when it is a foundation (or has no parent), else
      // its parent only when that parent is a confirmed foundation. Otherwise untagged — the row then
      // groups under its own project.
      const confirmedParent = parent && computeIsFoundation(parent) ? parent : undefined;
      const foundation = isFoundation || !owner.parent_uid ? owner : confirmedParent;
      return {
        ...row,
        project_name: owner.name,
        project_slug: owner.slug,
        is_foundation: isFoundation,
        parent_project_uid: owner.parent_uid,
        ...(parent && { parent_project_name: parent.name, parent_is_foundation: computeIsFoundation(parent) }),
        ...(foundation && {
          foundation_uid: foundation.uid,
          foundation_slug: foundation.slug,
          foundation_name: foundation.name,
          foundation_logo_url: foundation.logo_url || null,
        }),
      };
    });
  }
}
