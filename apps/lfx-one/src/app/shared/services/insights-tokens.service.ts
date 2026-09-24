// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE } from '@lfx-one/shared/constants';
import { CreateInsightsTokenResponse, InsightsToken, InsightsTokenEligibility } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

/** LFX Insights API tokens (IN-1233) — thin client over `/api/profile/insights-tokens`. */
@Injectable({
  providedIn: 'root',
})
export class InsightsTokensService {
  private readonly http = inject(HttpClient);

  /** Logs and rethrows so the caller can render a retryable error state rather than a false "no tokens" empty state. */
  public getTokens(): Observable<InsightsToken[]> {
    return this.http.get<InsightsToken[]>('/api/profile/insights-tokens').pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to load LFX Insights API tokens:', error);
        return throwError(() => error);
      })
    );
  }

  /** Fails closed: any error resolves to "cannot create" with `checkFailed`, matching the BFF's own fail-closed check. */
  public getEligibility(): Observable<InsightsTokenEligibility> {
    return this.http.get<InsightsTokenEligibility>('/api/profile/insights-tokens/eligibility').pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to load LFX Insights API token eligibility:', error);
        return of<InsightsTokenEligibility>(INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE);
      })
    );
  }

  public createToken(name: string): Observable<CreateInsightsTokenResponse> {
    return this.http.post<CreateInsightsTokenResponse>('/api/profile/insights-tokens', { name }).pipe(take(1));
  }

  public revokeToken(uid: string): Observable<void> {
    return this.http.delete<void>(`/api/profile/insights-tokens/${encodeURIComponent(uid)}`).pipe(take(1));
  }
}
