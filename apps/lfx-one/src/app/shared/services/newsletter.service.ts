// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateNewsletterRequest,
  GenerateNewsletterRequest,
  GenerateNewsletterResponse,
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
import { Observable, take } from 'rxjs';

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
    return this.http.get<NewsletterListResponse>(`/api/projects/${this.enc(projectUid)}/newsletters`, { params: httpParams }).pipe(take(1));
  }

  public getAnalytics(projectUid: string, newsletterUid: string): Observable<NewsletterAnalytics> {
    return this.http.get<NewsletterAnalytics>(`/api/projects/${this.enc(projectUid)}/newsletters/${this.enc(newsletterUid)}/analytics`).pipe(take(1));
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

  private enc(value: string): string {
    return encodeURIComponent(value);
  }
}
