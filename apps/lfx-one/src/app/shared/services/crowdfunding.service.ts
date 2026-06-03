// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

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
  RecurringDonationsResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CrowdfundingService {
  private readonly http = inject(HttpClient);

  public getMyInitiatives(): Observable<InitiativesResponse> {
    return this.http.get<InitiativesResponse>('/api/crowdfunding/initiatives').pipe(
      catchError((err) => {
        console.error('[CrowdfundingService] getMyInitiatives failed', err);
        return of(EMPTY_INITIATIVES_RESPONSE);
      })
    );
  }

  public getMyInitiativesStats(): Observable<CrowdfundingInitiativesStats> {
    return this.http.get<CrowdfundingInitiativesStats>('/api/crowdfunding/initiatives-stats').pipe(
      catchError((err) => {
        console.error('[CrowdfundingService] getMyInitiativesStats failed', err);
        return of(EMPTY_CROWDFUNDING_STATS);
      })
    );
  }

  public getInitiativeBySlug(slug: string): Observable<InitiativeDetail | null> {
    return this.http.get<InitiativeDetail>(`/api/crowdfunding/initiatives/${slug}`).pipe(
      catchError((err) => {
        console.error('[CrowdfundingService] getInitiativeBySlug failed', err);
        return of(null);
      })
    );
  }

  public getMyPaymentMethod(): Observable<PaymentMethod | null> {
    return this.http.get<PaymentMethod>('/api/crowdfunding/payment-method').pipe(catchError(() => of(null)));
  }

  // POST /api/crowdfunding/payment-method — mirrors the crowdfunding-app BFF payload: { paymentMethodId }.
  public savePaymentMethod(paymentMethodId: string): Observable<PaymentMethod> {
    return this.http.post<PaymentMethod>('/api/crowdfunding/payment-method', { paymentMethodId });
  }

  public getMyDonationStats(): Observable<DonationStats> {
    return this.http.get<DonationStats>('/api/crowdfunding/donation-stats').pipe(catchError(() => of(EMPTY_DONATION_STATS)));
  }

  public getMyRecurringDonations(): Observable<RecurringDonationsResponse> {
    return this.http.get<RecurringDonationsResponse>('/api/crowdfunding/recurring-donations').pipe(catchError(() => of(EMPTY_RECURRING_DONATIONS)));
  }

  public getMyDonations(params?: { pageSize?: number; offset?: number }): Observable<MyDonationsResponse> {
    let httpParams = new HttpParams();
    if (params?.pageSize != null) httpParams = httpParams.set('pageSize', String(params.pageSize));
    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http.get<MyDonationsResponse>('/api/crowdfunding/my-donations', { params: httpParams }).pipe(catchError(() => of(EMPTY_MY_DONATIONS)));
  }

  public getInitiativeTransactions(
    slug: string,
    params?: { type?: 'donations' | 'expenses'; size?: number; from?: number }
  ): Observable<CrowdfundingTransactionList> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.size != null) httpParams = httpParams.set('size', String(params.size));
    if (params?.from != null) httpParams = httpParams.set('from', String(params.from));

    return this.http.get<CrowdfundingTransactionList>(`/api/crowdfunding/initiatives/${slug}/transactions`, { params: httpParams }).pipe(
      catchError((err) => {
        console.error('[CrowdfundingService] getInitiativeTransactions failed', err);
        return of(EMPTY_TRANSACTION_LIST);
      })
    );
  }
}
