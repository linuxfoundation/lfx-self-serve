// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateNewsletterRequest,
  CreatePublicationRequest,
  GenerateNewsletterRequest,
  GenerateNewsletterResponse,
  MyNewsletter,
  Newsletter,
  NewsletterAnalytics,
  NewsletterCancelScheduleResult,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterOptOutListResponse,
  NewsletterPublication,
  NewsletterPublicationListParams,
  NewsletterPublicationListResponse,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientEngagementResponse,
  NewsletterRecipientsResponse,
  NewsletterScheduleResult,
  NewsletterSendResult,
  NewsletterTestSendPayload,
  UpdateNewsletterRequest,
  UpdatePublicationRequest,
} from '@lfx-one/shared/interfaces';
import { catchError, defer, EMPTY, expand, Observable, of, reduce, take } from 'rxjs';

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

  public getRecipientCount(projectUid: string, payload: NewsletterRecipientCountPayload): Observable<NewsletterRecipientCount> {
    return this.http.post<NewsletterRecipientCount>(`/api/projects/${this.enc(projectUid)}/newsletters/recipient-count`, payload).pipe(take(1));
  }

  public getRecipients(projectUid: string, payload: NewsletterRecipientCountPayload): Observable<NewsletterRecipientsResponse> {
    return this.http.post<NewsletterRecipientsResponse>(`/api/projects/${this.enc(projectUid)}/newsletters/recipients`, payload).pipe(take(1));
  }

  public testSend(projectUid: string, payload: NewsletterTestSendPayload): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`/api/projects/${this.enc(projectUid)}/newsletters/test-send`, payload).pipe(take(1));
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
    if (params.publication_id) {
      httpParams = httpParams.set('publication_id', params.publication_id);
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
   * project-scoped. Errors degrade to an empty list (matches getMyVotes).
   */
  public getMyNewsletters(): Observable<MyNewsletter[]> {
    return this.http.get<MyNewsletter[]>('/api/newsletters/my-newsletters').pipe(catchError(() => of([] as MyNewsletter[])));
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

  // === Publication endpoints ===
  // `listPublications` and `createPublication` back the publication-list page
  // (list + its create-publication dialog). `getPublication` and
  // `updatePublication` are still ahead of their consumers — editing an
  // existing publication's name/wrapper/etc. is a further LFXV2-2582
  // follow-up. Editions are read via `listNewsletters(..., publication_id)`.

  /**
   * Fetch one page of publications. The server caps the page size, so the
   * response can carry a `next_page_token`.
   */
  public listPublications(projectUid: string, params: NewsletterPublicationListParams = {}): Observable<NewsletterPublicationListResponse> {
    let httpParams = new HttpParams();
    if (params.page_token) {
      httpParams = httpParams.set('page_token', params.page_token);
    }
    if (params.page_size) {
      httpParams = httpParams.set('page_size', String(params.page_size));
    }
    return this.http
      .get<NewsletterPublicationListResponse>(`/api/projects/${this.enc(projectUid)}/newsletter-publications`, { params: httpParams })
      .pipe(take(1));
  }

  /**
   * Fetch every publication in the project by following `next_page_token`
   * until a response omits it. The publication list page has no paging
   * controls, so it needs the full set — a project has a handful of
   * publications, not enough to make an unbounded walk a real concern.
   *
   * `seenTokens` guards against a broken/looping server that keeps handing
   * back a token it already returned: rather than truncate every project's
   * list to an arbitrary page count, this stops only if a token repeats.
   * Scoped inside `defer` so each subscription gets its own set.
   */
  public listAllPublications(projectUid: string): Observable<NewsletterPublicationListResponse> {
    return defer(() => {
      const seenTokens = new Set<string>();
      return this.listPublications(projectUid).pipe(
        expand((page) => {
          const token = page.next_page_token;
          if (!token || seenTokens.has(token)) {
            return EMPTY;
          }
          seenTokens.add(token);
          return this.listPublications(projectUid, { page_token: token });
        }),
        reduce<NewsletterPublicationListResponse, NewsletterPublicationListResponse>(
          (acc, page) => ({ publications: [...acc.publications, ...page.publications] }),
          { publications: [] }
        )
      );
    });
  }

  public getPublication(projectUid: string, publicationUid: string): Observable<NewsletterPublication> {
    return this.http.get<NewsletterPublication>(`/api/projects/${this.enc(projectUid)}/newsletter-publications/${this.enc(publicationUid)}`).pipe(take(1));
  }

  public createPublication(projectUid: string, payload: CreatePublicationRequest): Observable<NewsletterPublication> {
    return this.http.post<NewsletterPublication>(`/api/projects/${this.enc(projectUid)}/newsletter-publications`, payload).pipe(take(1));
  }

  public updatePublication(projectUid: string, publicationUid: string, version: number, payload: UpdatePublicationRequest): Observable<NewsletterPublication> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http
      .put<NewsletterPublication>(`/api/projects/${this.enc(projectUid)}/newsletter-publications/${this.enc(publicationUid)}`, payload, { headers })
      .pipe(take(1));
  }

  private enc(value: string): string {
    return encodeURIComponent(value);
  }
}
