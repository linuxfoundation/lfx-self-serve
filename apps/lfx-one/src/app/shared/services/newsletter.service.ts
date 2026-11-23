// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateNewsletterRequest,
  GenerateNewsletterRequest,
  GenerateNewsletterResponse,
  MyNewsletterFoundationsResponse,
  MyNewslettersApiResponse,
  Newsletter,
  NewsletterAnalytics,
  NewsletterAudience,
  NewsletterCancelScheduleResult,
  NewsletterGroupJoinStatus,
  NewsletterGuestAccessRequest,
  NewsletterGuestInviteInfo,
  NewsletterGuestInviteRequest,
  NewsletterGuestIssue,
  NewsletterGuestIssueResponse,
  NewsletterInviteResult,
  NewsletterJoinResult,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterOptOutListResponse,
  NewsletterPublication,
  NewsletterPublicationListResponse,
  NewsletterPublicationRequest,
  NewsletterReaderAccess,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientEngagementResponse,
  NewsletterRecipientsResponse,
  NewsletterRenderPreviewPayload,
  NewsletterRenderPreviewResponse,
  NewsletterResolveAudiencePayload,
  NewsletterScheduleResult,
  NewsletterSendResult,
  NewsletterSharePreview,
  NewsletterStatusCounts,
  NewsletterTestSendPayload,
  SocialShareChannel,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { NEWSLETTER_PUBLICATION_MAX_PAGES } from '@lfx-one/shared/constants';
import { PlausibleService } from '@services/plausible.service';
import { catchError, EMPTY, expand, map, Observable, of, reduce, take, tap, throwError } from 'rxjs';

/**
 * Angular HTTP client for the newsletter feature.
 *
 * All endpoints are project-scoped: callers supply `projectUid` (the active
 * project context UID). The Express backend mounts the router at
 * `/api/projects/:projectUid/newsletters` and proxies to lfx-v2-newsletter-service.
 *
 * Path-segment values are passed through `encodeURIComponent` for defense in
 * depth: project / newsletter UIDs are alphanumeric today, but a future format
 * containing `/`, `?`, or `%` would otherwise corrupt routing.
 */
@Injectable({
  providedIn: 'root',
})
export class NewsletterService {
  private readonly http = inject(HttpClient);
  private readonly plausible = inject(PlausibleService);

  public getRecipientCount(projectUid: string, payload: NewsletterRecipientCountPayload): Observable<NewsletterRecipientCount> {
    return this.http.post<NewsletterRecipientCount>(`/api/projects/${this.enc(projectUid)}/newsletters/recipient-count`, payload).pipe(take(1));
  }

  /** Start the background read of a draft's committees into its audience snapshot (#4352). */
  public resolveAudience(projectUid: string, newsletterUid: string, payload: NewsletterResolveAudiencePayload): Observable<NewsletterAudience> {
    return this.http.post<NewsletterAudience>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/audience`, payload).pipe(take(1));
  }

  public getAudience(projectUid: string, newsletterUid: string): Observable<NewsletterAudience> {
    return this.http.get<NewsletterAudience>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/audience`).pipe(take(1));
  }

  public getRecipients(projectUid: string, payload: NewsletterRecipientCountPayload): Observable<NewsletterRecipientsResponse> {
    return this.http.post<NewsletterRecipientsResponse>(`/api/projects/${this.enc(projectUid)}/newsletters/recipients`, payload).pipe(take(1));
  }

  public testSend(projectUid: string, payload: NewsletterTestSendPayload): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`/api/projects/${this.enc(projectUid)}/newsletters/test-send`, payload).pipe(take(1));
  }

  /** Render a layout to its final email HTML server-side (the same output the send path dispatches). */
  public renderPreview(projectUid: string, payload: NewsletterRenderPreviewPayload): Observable<NewsletterRenderPreviewResponse> {
    return this.http.post<NewsletterRenderPreviewResponse>(`/api/projects/${this.enc(projectUid)}/newsletters/render-preview`, payload).pipe(take(1));
  }

  public generate(projectUid: string, payload: GenerateNewsletterRequest): Observable<GenerateNewsletterResponse> {
    return this.http.post<GenerateNewsletterResponse>(`/api/projects/${this.enc(projectUid)}/newsletters/generate`, payload).pipe(take(1));
  }

  public listNewsletters(projectUid: string, params: NewsletterListParams): Observable<NewsletterListResponse> {
    let httpParams = new HttpParams();
    if (params.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params.page_token) {
      httpParams = httpParams.set('page_token', params.page_token);
    }
    return this.http.get<NewsletterListResponse>(`/api/projects/${this.enc(projectUid)}/newsletters`, { params: httpParams }).pipe(take(1));
  }

  public getAnalytics(projectUid: string, newsletterUid: string): Observable<NewsletterAnalytics> {
    return this.http.get<NewsletterAnalytics>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/analytics`).pipe(take(1));
  }

  /**
   * Per-recipient engagement: who the newsletter went to, delivery outcome,
   * and every recorded open. PII-gated upstream (requires the `auditor`
   * relation) — callers should handle 403 distinctly from getAnalytics, which
   * a broader set of users can reach.
   */
  public getRecipientEngagement(projectUid: string, newsletterUid: string): Observable<NewsletterRecipientEngagementResponse> {
    return this.http
      .get<NewsletterRecipientEngagementResponse>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/analytics/recipients`)
      .pipe(take(1));
  }

  public getStatusCounts(projectUid: string): Observable<NewsletterStatusCounts> {
    return this.http.get<NewsletterStatusCounts>(`/api/projects/${this.enc(projectUid)}/newsletters/status-counts`).pipe(take(1));
  }

  public listOptOuts(projectUid: string): Observable<NewsletterOptOutListResponse> {
    return this.http.get<NewsletterOptOutListResponse>(`/api/projects/${this.enc(projectUid)}/newsletters/opt-outs`).pipe(take(1));
  }

  public deleteOptOut(projectUid: string, optOutId: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${this.enc(projectUid)}/newsletters/opt-outs/${this.enc(optOutId)}`).pipe(take(1));
  }

  public createNewsletter(projectUid: string, payload: CreateNewsletterRequest): Observable<Newsletter> {
    return this.http.post<Newsletter>(`/api/projects/${this.enc(projectUid)}/newsletters`, payload).pipe(take(1));
  }

  public getNewsletter(projectUid: string, newsletterUid: string): Observable<Newsletter> {
    return this.http.get<Newsletter>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}`).pipe(take(1));
  }

  /**
   * Me-lens feed: sent newsletters reachable through the user's current
   * committee memberships, deduped and enriched server-side. Not
   * project-scoped. HTTP errors propagate to the component's request state.
   */
  public getMyNewsletters(): Observable<MyNewslettersApiResponse> {
    return this.http.get<MyNewslettersApiResponse>('/api/newsletters/my-newsletters', { params: { include_status: 'true' } });
  }

  /**
   * Permalink reader access decision (#3469): manager, group member, eligible Linux Foundation
   * member employee (with the issue), or denied (body withheld). Errors propagate to the reader.
   */
  public getReaderAccess(projectUid: string, newsletterUid: string): Observable<NewsletterReaderAccess> {
    return this.http.get<NewsletterReaderAccess>(`/api/newsletters/${this.enc(projectUid)}/${this.enc(newsletterUid)}/reader`).pipe(take(1));
  }

  /** Member benefit: add the caller's qualifying work email to the issue's newsletter group (server re-checks eligibility). */
  public joinNewsletterGroup(projectUid: string, newsletterUid: string): Observable<NewsletterJoinResult> {
    return this.http.post<NewsletterJoinResult>(`/api/newsletters/${this.enc(projectUid)}/${this.enc(newsletterUid)}/join`, {}).pipe(take(1));
  }

  /**
   * Records an in-app share of a sent issue (#4958) and, once the server accepts it, sends the matching
   * Plausible event — so Plausible and `total_shares` count the same accepted shares. Emits `true` when
   * the server accepted the share, `false` when it did not (the 403 while impersonating, a 404 for a
   * draft, a network error). It never errors: sharing must not fail because tracking did.
   */
  public recordShare(projectUid: string, newsletterUid: string, channel: SocialShareChannel): Observable<boolean> {
    return this.http.post<void>(`/api/newsletters/${this.enc(projectUid)}/${this.enc(newsletterUid)}/share`, { channel }).pipe(
      take(1),
      tap(() => this.plausible.trackEvent('newsletter_shared', { newsletterId: newsletterUid, channel })),
      map(() => true),
      catchError((error) => {
        console.warn('[NewsletterService] Failed to record newsletter share', error);
        return of(false);
      })
    );
  }

  /**
   * Records a unique web page view of a sent issue (one per user per issue, counted server-side). Emits
   * `true` when the server accepted it and `false` otherwise (the 403 while impersonating, a 404 for a
   * draft, a network error). It never errors: reading must not fail because tracking did.
   */
  public recordPageView(projectUid: string, newsletterUid: string): Observable<boolean> {
    return this.http.post<void>(`/api/newsletters/${this.enc(projectUid)}/${this.enc(newsletterUid)}/page-view`, {}).pipe(
      take(1),
      map(() => true),
      catchError((error) => {
        console.warn('[NewsletterService] Failed to record newsletter page view', error);
        return of(false);
      })
    );
  }

  /**
   * Me-lens My Newsletters by foundation (#3483): one card per foundation plus the full feed (tagged
   * with its foundation) and whether the user may invite colleagues. Errors propagate to the page.
   */
  public getMyNewsletterFoundations(): Observable<MyNewsletterFoundationsResponse> {
    return this.http.get<MyNewsletterFoundationsResponse>('/api/newsletters/my-foundations').pipe(
      take(1),
      catchError((error) => {
        console.error('[NewsletterService] Failed to load my newsletter foundations', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Signed-out link preview of a permalink (#4940): the subject of a sent issue, nothing else. 404 for
   * an unknown or unsent issue; the caller falls back to a neutral card.
   */
  public getNewsletterSharePreview(projectSlug: string, newsletterUid: string): Observable<NewsletterSharePreview> {
    return this.http.get<NewsletterSharePreview>(`/public/api/newsletters/${this.enc(projectSlug)}/${this.enc(newsletterUid)}/preview`).pipe(take(1));
  }

  /** Signed-out invite landing (#5235): what the invite link's modal shows. Errors propagate. */
  public inspectNewsletterGuestInvite(token: string): Observable<NewsletterGuestInviteInfo> {
    return this.http.post<NewsletterGuestInviteInfo>('/public/api/newsletters/invites/inspect', { token } satisfies NewsletterGuestInviteRequest).pipe(take(1));
  }

  /** Signed-out invite landing: Continue — joins the invited address to the list and returns the latest issue. */
  public acceptNewsletterGuestInvite(token: string): Observable<NewsletterGuestIssue> {
    return this.http.post<NewsletterGuestIssue>('/public/api/newsletters/invites/accept', { token } satisfies NewsletterGuestInviteRequest).pipe(take(1));
  }

  /** Signed-out shared link: Continue with a work email — reads the issue and emails a subscription confirmation. */
  public requestNewsletterGuestAccess(projectSlug: string, newsletterUid: string, email: string): Observable<NewsletterGuestIssue> {
    return this.http
      .post<NewsletterGuestIssue>(`/public/api/newsletters/${this.enc(projectSlug)}/${this.enc(newsletterUid)}/guest-access`, {
        email,
      } satisfies NewsletterGuestAccessRequest)
      .pipe(take(1));
  }

  /** Signed-out invite landing: the guest session's latest issue (`issue: null` without a session). Errors propagate. */
  public getNewsletterGuestLatestIssue(): Observable<NewsletterGuestIssueResponse> {
    return this.http.get<NewsletterGuestIssueResponse>('/public/api/newsletters/guest/latest').pipe(
      take(1),
      catchError((error) => {
        console.error('[NewsletterService] Failed to load the newsletter guest session', error);
        return throwError(() => error);
      })
    );
  }

  /** Signed-out shared link: the issue when the guest session covers it, else the foundation the email prompt names. */
  public getNewsletterGuestSharedIssue(projectSlug: string, newsletterUid: string): Observable<NewsletterGuestIssueResponse> {
    return this.http.get<NewsletterGuestIssueResponse>(`/public/api/newsletters/guest/${this.enc(projectSlug)}/${this.enc(newsletterUid)}`).pipe(
      take(1),
      catchError((error) => {
        console.error('[NewsletterService] Failed to load the shared newsletter for a guest', error);
        return throwError(() => error);
      })
    );
  }

  /** Emails a colleague an invitation to a foundation's newsletter (server checks sender and invitee eligibility). */
  public sendNewsletterInvite(foundationUid: string, email: string): Observable<NewsletterInviteResult> {
    return this.http.post<NewsletterInviteResult>(`/api/newsletters/foundations/${this.enc(foundationUid)}/invites`, { email }).pipe(take(1));
  }

  /** Invite landing: whether the signed-in user can join the invite's newsletter group (side-effect free). */
  public getNewsletterGroupJoinStatus(committeeUid: string): Observable<NewsletterGroupJoinStatus> {
    return this.http.get<NewsletterGroupJoinStatus>(`/api/newsletters/groups/${this.enc(committeeUid)}/join-status`).pipe(
      take(1),
      catchError((error) => {
        console.error('[NewsletterService] Failed to check newsletter group join status', error);
        return throwError(() => error);
      })
    );
  }

  /** Invite landing: confirm — adds the caller's qualifying work email to the newsletter group. */
  public joinNewsletterGroupByInvite(committeeUid: string): Observable<NewsletterJoinResult> {
    return this.http.post<NewsletterJoinResult>(`/api/newsletters/groups/${this.enc(committeeUid)}/join`, {}).pipe(take(1));
  }

  public updateNewsletter(projectUid: string, newsletterUid: string, version: number, payload: UpdateNewsletterRequest): Observable<Newsletter> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http.put<Newsletter>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}`, payload, { headers }).pipe(take(1));
  }

  public deleteNewsletter(projectUid: string, newsletterUid: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}`).pipe(take(1));
  }

  public sendNewsletter(projectUid: string, newsletterUid: string, version: number): Observable<NewsletterSendResult> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http
      .post<NewsletterSendResult>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/send`, {}, { headers })
      .pipe(take(1));
  }

  /**
   * Arm a saved (or overridden) `scheduled_at` at the send provider. Omit
   * `scheduledAt` to arm the value already saved on the draft.
   */
  public scheduleNewsletter(projectUid: string, newsletterUid: string, version: number, scheduledAt?: string): Observable<NewsletterScheduleResult> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    const body = scheduledAt ? { scheduled_at: scheduledAt } : {};
    return this.http
      .post<NewsletterScheduleResult>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/schedule`, body, { headers })
      .pipe(take(1));
  }

  /**
   * Revert an armed newsletter to `draft`. Upstream retains `scheduled_at` so
   * re-arming doesn't require re-entering the time.
   */
  public cancelSchedule(projectUid: string, newsletterUid: string, version: number): Observable<NewsletterCancelScheduleResult> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http
      .post<NewsletterCancelScheduleResult>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/cancel-schedule`, {}, { headers })
      .pipe(take(1));
  }

  public createPublication(projectUid: string, payload: NewsletterPublicationRequest): Observable<NewsletterPublication> {
    return this.http.post<NewsletterPublication>(this.publicationsUrl(projectUid), payload).pipe(take(1));
  }

  public listPublications(projectUid: string, pageToken?: string): Observable<NewsletterPublicationListResponse> {
    const params = pageToken ? new HttpParams().set('page_token', pageToken) : undefined;
    return this.http.get<NewsletterPublicationListResponse>(this.publicationsUrl(projectUid), { params }).pipe(take(1));
  }

  /** Every named publication in the project, following the service's pages. */
  public listAllPublications(projectUid: string): Observable<NewsletterPublication[]> {
    return this.listPublications(projectUid).pipe(
      expand((page) => (page.next_page_token ? this.listPublications(projectUid, page.next_page_token) : EMPTY)),
      take(NEWSLETTER_PUBLICATION_MAX_PAGES),
      reduce((all: NewsletterPublication[], page) => [...all, ...(page.publications ?? [])], [])
    );
  }

  public getPublication(projectUid: string, publicationUid: string): Observable<NewsletterPublication> {
    return this.http.get<NewsletterPublication>(`${this.publicationsUrl(projectUid)}/${this.enc(publicationUid)}`).pipe(take(1));
  }

  public updatePublication(
    projectUid: string,
    publicationUid: string,
    version: number,
    payload: NewsletterPublicationRequest
  ): Observable<NewsletterPublication> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http.put<NewsletterPublication>(`${this.publicationsUrl(projectUid)}/${this.enc(publicationUid)}`, payload, { headers }).pipe(take(1));
  }

  public listEditions(projectUid: string, publicationUid: string, params: NewsletterListParams = {}): Observable<NewsletterListResponse> {
    let httpParams = new HttpParams();
    if (params.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params.page_token) {
      httpParams = httpParams.set('page_token', params.page_token);
    }
    return this.http
      .get<NewsletterListResponse>(`${this.publicationsUrl(projectUid)}/${this.enc(publicationUid)}/editions`, { params: httpParams })
      .pipe(take(1));
  }

  public createEdition(projectUid: string, publicationUid: string, payload: Partial<CreateNewsletterRequest>): Observable<Newsletter> {
    return this.http.post<Newsletter>(`${this.publicationsUrl(projectUid)}/${this.enc(publicationUid)}/editions`, payload).pipe(take(1));
  }

  private publicationsUrl(projectUid: string): string {
    return `/api/projects/${this.enc(projectUid)}/newsletter-publications`;
  }

  private enc(value: string): string {
    return encodeURIComponent(value);
  }
}
