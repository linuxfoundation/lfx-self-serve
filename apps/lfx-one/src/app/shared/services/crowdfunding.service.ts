// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

import {
  EMPTY_CROWDFUNDING_STATS,
  EMPTY_INITIATIVES_RESPONSE,
  EMPTY_MY_DONATIONS,
  EMPTY_RECURRING_DONATIONS,
  EMPTY_TRANSACTION_LIST,
  EMPTY_DONATION_STATS,
} from '@lfx-one/shared/constants';
import {
  Announcement,
  AnnouncementList,
  CreateAnnouncementInput,
  CrowdfundingInitiativesStats,
  CrowdfundingTransactionList,
  DonationStats,
  InitiativeDetail,
  InitiativesResponse,
  MyDonationsResponse,
  PaymentMethod,
  PresignedURLResult,
  RecurringDonation,
  RecurringDonationsResponse,
  UpdateAnnouncementInput,
  UpdateInitiativeInput,
} from '@lfx-one/shared/interfaces';
import { catchError, EMPTY, Observable, of, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CrowdfundingService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  public getMyInitiatives(params?: { pageSize?: number; offset?: number }): Observable<InitiativesResponse> {
    let httpParams = new HttpParams();
    if (params?.pageSize != null) httpParams = httpParams.set('pageSize', String(params.pageSize));
    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http
      .get<InitiativesResponse>('/api/crowdfunding/initiatives', { params: httpParams })
      .pipe(catchError(this.handleCfError(EMPTY_INITIATIVES_RESPONSE, 'getMyInitiatives')));
  }

  public getMyInitiativesStats(): Observable<CrowdfundingInitiativesStats> {
    return this.http
      .get<CrowdfundingInitiativesStats>('/api/crowdfunding/initiatives-stats')
      .pipe(catchError(this.handleCfError(EMPTY_CROWDFUNDING_STATS, 'getMyInitiativesStats')));
  }

  public getInitiativeBySlug(slug: string): Observable<InitiativeDetail | null> {
    return this.http
      .get<InitiativeDetail>(`/api/crowdfunding/initiatives/${encodeURIComponent(slug)}`)
      .pipe(catchError(this.handleCfError(null, 'getInitiativeBySlug')));
  }

  public getMyPaymentMethod(): Observable<PaymentMethod | null> {
    return this.http.get<PaymentMethod>('/api/crowdfunding/payment-method').pipe(catchError(this.handleCfError(null, 'getMyPaymentMethod')));
  }

  // POST /api/crowdfunding/payment-method — mirrors the crowdfunding-app BFF payload: { paymentMethodId }.
  public savePaymentMethod(paymentMethodId: string): Observable<PaymentMethod> {
    return this.http.post<PaymentMethod>('/api/crowdfunding/payment-method', { paymentMethodId }).pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public getMyDonationStats(): Observable<DonationStats> {
    return this.http.get<DonationStats>('/api/crowdfunding/donation-stats').pipe(catchError(this.handleCfError(EMPTY_DONATION_STATS, 'getMyDonationStats')));
  }

  public getRecurringDonationById(id: string): Observable<RecurringDonation | null> {
    if (!id.trim()) return of(null);
    return this.http
      .get<RecurringDonation>(`/api/crowdfunding/recurring-donations/${encodeURIComponent(id.trim())}`)
      .pipe(catchError(this.handleCfError(null, 'getRecurringDonationById')));
  }

  public getMyRecurringDonations(): Observable<RecurringDonationsResponse> {
    return this.http
      .get<RecurringDonationsResponse>('/api/crowdfunding/recurring-donations')
      .pipe(catchError(this.handleCfError(EMPTY_RECURRING_DONATIONS, 'getMyRecurringDonations')));
  }

  public getMyDonations(params?: { pageSize?: number; offset?: number }): Observable<MyDonationsResponse> {
    let httpParams = new HttpParams();
    if (params?.pageSize != null) httpParams = httpParams.set('pageSize', String(params.pageSize));
    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http
      .get<MyDonationsResponse>('/api/crowdfunding/my-donations', { params: httpParams })
      .pipe(catchError(this.handleCfError(EMPTY_MY_DONATIONS, 'getMyDonations')));
  }

  public getPresignedUrl(contentType: string): Observable<PresignedURLResult> {
    return this.http.post<PresignedURLResult>('/api/crowdfunding/presigned-url', { contentType }).pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public updateInitiative(id: string, input: UpdateInitiativeInput): Observable<InitiativeDetail> {
    return this.http
      .patch<InitiativeDetail>(`/api/crowdfunding/initiatives/${encodeURIComponent(id)}`, input)
      .pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public getAnnouncements(initiativeId: string): Observable<AnnouncementList> {
    return this.http
      .get<AnnouncementList>(`/api/crowdfunding/initiatives/${encodeURIComponent(initiativeId)}/announcements`)
      .pipe(catchError(this.handleCfError({ data: [], totalCount: 0 }, 'getAnnouncements')));
  }

  public createAnnouncement(initiativeId: string, input: CreateAnnouncementInput): Observable<Announcement> {
    return this.http
      .post<Announcement>(`/api/crowdfunding/initiatives/${encodeURIComponent(initiativeId)}/announcements`, input)
      .pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public updateAnnouncement(initiativeId: string, announcementId: string, input: UpdateAnnouncementInput): Observable<Announcement> {
    return this.http
      .put<Announcement>(`/api/crowdfunding/initiatives/${encodeURIComponent(initiativeId)}/announcements/${encodeURIComponent(announcementId)}`, input)
      .pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public deleteAnnouncement(initiativeId: string, announcementId: string): Observable<void> {
    return this.http
      .delete<void>(`/api/crowdfunding/initiatives/${encodeURIComponent(initiativeId)}/announcements/${encodeURIComponent(announcementId)}`)
      .pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public deletePaymentMethod(): Observable<void> {
    return this.http.delete<void>('/api/crowdfunding/payment-method').pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public cancelSubscription(id: string): Observable<void> {
    return this.http.delete<void>(`/api/crowdfunding/subscriptions/${encodeURIComponent(id)}`).pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public getInitiativeTransactions(
    slug: string,
    params?: { type?: 'donations' | 'expenses'; size?: number; from?: number; kind?: 'one-time' | 'recurring' }
  ): Observable<CrowdfundingTransactionList> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.size != null) httpParams = httpParams.set('size', String(params.size));
    if (params?.from != null) httpParams = httpParams.set('from', String(params.from));
    if (params?.kind) httpParams = httpParams.set('kind', params.kind);

    return this.http
      .get<CrowdfundingTransactionList>(`/api/crowdfunding/initiatives/${encodeURIComponent(slug)}/transactions`, { params: httpParams })
      .pipe(catchError(this.handleCfError(EMPTY_TRANSACTION_LIST, 'getInitiativeTransactions')));
  }

  public getMyInitiativeTransactions(
    slug: string,
    params?: { type?: 'donations' | 'expenses'; size?: number; from?: number; subscriptionOnly?: boolean }
  ): Observable<CrowdfundingTransactionList> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.size != null) httpParams = httpParams.set('size', String(params.size));
    if (params?.from != null) httpParams = httpParams.set('from', String(params.from));
    if (params?.subscriptionOnly) httpParams = httpParams.set('subscriptionOnly', 'true');

    return this.http
      .get<CrowdfundingTransactionList>(`/api/crowdfunding/initiatives/${encodeURIComponent(slug)}/my-transactions`, { params: httpParams })
      .pipe(catchError(this.handleCfError(EMPTY_TRANSACTION_LIST, 'getMyInitiativeTransactions')));
  }

  private handleCfError<T>(fallback: T, label: string) {
    return (err: HttpErrorResponse): Observable<T> => {
      if (err.status === 401 && (err.error as Record<string, unknown>)?.['code'] === 'CF_UNAUTHENTICATED') {
        if (isPlatformBrowser(this.platformId)) {
          this.redirectToCfAuth();
          return EMPTY; // navigating away — don't emit fallback so loading state persists
        }
        return of(fallback);
      }
      if (err.status !== 404) {
        console.error(`[CrowdfundingService] ${label} failed`, err);
      }
      return of(fallback);
    };
  }

  /**
   * Error handler for mutation endpoints (POST / DELETE).
   * Redirects to the CF auth flow on CF_UNAUTHENTICATED (expired/missing token),
   * and rethrows all other errors so the caller's error callback can surface a toast.
   */
  private redirectIfCfUnauthenticated() {
    return (err: HttpErrorResponse): Observable<never> => {
      if (err.status === 401 && (err.error as Record<string, unknown>)?.['code'] === 'CF_UNAUTHENTICATED') {
        if (isPlatformBrowser(this.platformId)) {
          this.redirectToCfAuth();
        }
        return EMPTY; // navigating away — don't surface a toast
      }
      return throwError(() => err);
    };
  }

  /**
   * Redirects to the CF auth-start endpoint, but only if the current URL does not
   * already carry an `error` query param. An existing error param means the auth
   * flow already failed (e.g. auth not configured) and we should not loop.
   */
  private redirectToCfAuth(): void {
    const params = new URLSearchParams(this.document.location.search);
    if (params.has('error')) return; // already errored — don't loop
    const returnTo = encodeURIComponent(this.document.location.pathname + this.document.location.search);
    this.document.location.href = `/api/crowdfunding/auth/start?returnTo=${returnTo}`;
  }
}
