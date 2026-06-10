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
  CrowdfundingInitiativesStats,
  CrowdfundingTransactionList,
  DonationStats,
  InitiativeDetail,
  InitiativesResponse,
  MyDonationsResponse,
  PaymentMethod,
  PresignedURLResult,
  RecurringDonationsResponse,
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

  public getMyInitiatives(): Observable<InitiativesResponse> {
    return this.http
      .get<InitiativesResponse>('/api/crowdfunding/initiatives')
      .pipe(catchError(this.handleCfError(EMPTY_INITIATIVES_RESPONSE, 'getMyInitiatives')));
  }

  public getMyInitiativesStats(): Observable<CrowdfundingInitiativesStats> {
    return this.http
      .get<CrowdfundingInitiativesStats>('/api/crowdfunding/initiatives-stats')
      .pipe(catchError(this.handleCfError(EMPTY_CROWDFUNDING_STATS, 'getMyInitiativesStats')));
  }

  public getInitiativeBySlug(slug: string): Observable<InitiativeDetail | null> {
    return this.http.get<InitiativeDetail>(`/api/crowdfunding/initiatives/${slug}`).pipe(catchError(this.handleCfError(null, 'getInitiativeBySlug')));
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

  public deletePaymentMethod(): Observable<void> {
    return this.http.delete<void>('/api/crowdfunding/payment-method').pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public cancelSubscription(id: string): Observable<void> {
    return this.http.delete<void>(`/api/crowdfunding/subscriptions/${encodeURIComponent(id)}`).pipe(catchError(this.redirectIfCfUnauthenticated()));
  }

  public getInitiativeTransactions(
    slug: string,
    params?: { type?: 'donations' | 'expenses'; size?: number; from?: number }
  ): Observable<CrowdfundingTransactionList> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.size != null) httpParams = httpParams.set('size', String(params.size));
    if (params?.from != null) httpParams = httpParams.set('from', String(params.from));

    return this.http
      .get<CrowdfundingTransactionList>(`/api/crowdfunding/initiatives/${slug}/transactions`, { params: httpParams })
      .pipe(catchError(this.handleCfError(EMPTY_TRANSACTION_LIST, 'getInitiativeTransactions')));
  }

  private handleCfError<T>(fallback: T, label: string) {
    return (err: HttpErrorResponse): Observable<T> => {
      if (err.status === 401 && (err.error as Record<string, unknown>)?.['code'] === 'CF_UNAUTHENTICATED') {
        if (isPlatformBrowser(this.platformId)) {
          const returnTo = encodeURIComponent(this.document.location.pathname + this.document.location.search);
          this.document.location.href = `/api/crowdfunding/auth/start?returnTo=${returnTo}`;
        }
        return of(fallback);
      }
      console.error(`[CrowdfundingService] ${label} failed`, err);
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
          const returnTo = encodeURIComponent(this.document.location.pathname + this.document.location.search);
          this.document.location.href = `/api/crowdfunding/auth/start?returnTo=${returnTo}`;
        }
        return EMPTY; // navigating away — don't surface a toast
      }
      return throwError(() => err);
    };
  }
}
