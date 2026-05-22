// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateNewsletterDraftRequest,
  GenerateNewsletterRequest,
  GenerateNewsletterResponse,
  Newsletter,
  NewsletterAnalytics,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientsResponse,
  NewsletterSendPayload,
  NewsletterSendResult,
  NewsletterTestSendPayload,
  UpdateNewsletterDraftRequest,
} from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class NewsletterService {
  private readonly http = inject(HttpClient);

  public getRecipientCount(payload: NewsletterRecipientCountPayload): Observable<NewsletterRecipientCount> {
    return this.http.post<NewsletterRecipientCount>('/api/newsletters/recipient-count', payload).pipe(take(1));
  }

  public getRecipients(payload: NewsletterRecipientCountPayload): Observable<NewsletterRecipientsResponse> {
    return this.http.post<NewsletterRecipientsResponse>('/api/newsletters/recipients', payload).pipe(take(1));
  }

  public testSend(payload: NewsletterTestSendPayload): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>('/api/newsletters/test-send', payload).pipe(take(1));
  }

  public send(payload: NewsletterSendPayload): Observable<NewsletterSendResult> {
    return this.http.post<NewsletterSendResult>('/api/newsletters/send', payload).pipe(take(1));
  }

  public generate(payload: GenerateNewsletterRequest): Observable<GenerateNewsletterResponse> {
    return this.http.post<GenerateNewsletterResponse>('/api/newsletters/generate', payload).pipe(take(1));
  }

  public listNewsletters(params: NewsletterListParams): Observable<NewsletterListResponse> {
    let httpParams = new HttpParams().set('contextType', params.contextType).set('contextUid', params.contextUid);
    if (params.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params.pageToken) {
      httpParams = httpParams.set('pageToken', params.pageToken);
    }
    return this.http.get<NewsletterListResponse>('/api/newsletters', { params: httpParams }).pipe(take(1));
  }

  public getAnalytics(id: string): Observable<NewsletterAnalytics> {
    return this.http.get<NewsletterAnalytics>(`/api/newsletters/${id}/analytics`).pipe(take(1));
  }

  public createDraft(payload: CreateNewsletterDraftRequest): Observable<Newsletter> {
    return this.http.post<Newsletter>('/api/newsletters/drafts', payload).pipe(take(1));
  }

  public getDraft(id: string): Observable<Newsletter> {
    return this.http.get<Newsletter>(`/api/newsletters/drafts/${id}`).pipe(take(1));
  }

  public updateDraft(id: string, version: number, payload: UpdateNewsletterDraftRequest): Observable<Newsletter> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http.put<Newsletter>(`/api/newsletters/drafts/${id}`, payload, { headers }).pipe(take(1));
  }

  public deleteDraft(id: string): Observable<void> {
    return this.http.delete<void>(`/api/newsletters/drafts/${id}`).pipe(take(1));
  }

  public sendDraft(id: string, version: number): Observable<NewsletterSendResult> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return this.http.post<NewsletterSendResult>(`/api/newsletters/drafts/${id}/send`, {}, { headers }).pipe(take(1));
  }
}
