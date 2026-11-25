// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import type {
  CdpCompanyAudienceSignal,
  CdpCompanyAvailability,
  CdpCompanyResponse,
  CdpCompanySearchResponse,
  CdpCompanySectionPayloads,
  CdpSectionKey,
} from '@lfx-one/shared/interfaces';
import { strictHttpParams } from '@shared/utils/http-params.utils';
import { catchError, map, Observable, of, shareReplay, throwError } from 'rxjs';

const BASE_URL = '/api/companies';

/**
 * HTTP client for CDP company pages and search.
 *
 * The browser learns only whether CDP pages and results are available to it: `availability()` is the one
 * audience signal, asked once per load and shared. Page and section reads propagate their errors, so a page can tell
 * `NOT_FOUND`, `ROLE_GRANTS_UNAVAILABLE` and the section refusals apart by the body's `code`.
 */
@Injectable({ providedIn: 'root' })
export class CdpCompanyService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  private availability$: Observable<CdpCompanyAudienceSignal> | null = null;

  /**
   * Whether CDP pages and search are available to the caller. Shared across callers in one load. Only an answered
   * `{ available: true | false }` is kept; when membership cannot be determined (network error, any error status, an
   * unreadable or malformed body) the answer is `unverifiable`, so a page shows "could not verify" with Retry and
   * never "no company", and the failure is not kept, so the next ask retries. Search shows CDP rows only on
   * `available`. Server-side rendering never asks: it answers `unavailable`, so no CDP row or page renders before the
   * browser has checked.
   */
  public availability(): Observable<CdpCompanyAudienceSignal> {
    if (!isPlatformBrowser(this.platformId)) return of('unavailable');
    if (!this.availability$) {
      this.availability$ = this.http.get<CdpCompanyAvailability>(`${BASE_URL}/availability`).pipe(
        map((response): CdpCompanyAudienceSignal => {
          if (typeof response?.available !== 'boolean') throw new Error('Malformed CDP availability answer');
          return response.available ? 'available' : 'unavailable';
        }),
        catchError((error: unknown) => {
          console.error('[cdp-company] availability failed', { error });
          this.availability$ = null;
          return of<CdpCompanyAudienceSignal>('unverifiable');
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.availability$;
  }

  /** The page of one CDP id: the page, or where the id now lives. Errors propagate (404 `NOT_FOUND`, 503 `ROLE_GRANTS_UNAVAILABLE`). */
  public getCompany(cdpId: string): Observable<CdpCompanyResponse> {
    return this.http
      .get<CdpCompanyResponse>(`${BASE_URL}/${encodeURIComponent(cdpId)}`)
      .pipe(catchError((error: unknown) => this.logAndRethrow('getCompany', { cdpId, error })));
  }

  /** One section's payload. Errors propagate with the refusal `code`. */
  public getSection<K extends CdpSectionKey>(cdpId: string, section: K): Observable<CdpCompanySectionPayloads[K]> {
    return this.http
      .get<CdpCompanySectionPayloads[K]>(`${BASE_URL}/${encodeURIComponent(cdpId)}/sections/${section}`)
      .pipe(catchError((error: unknown) => this.logAndRethrow('getSection', { cdpId, section, error })));
  }

  /**
   * CDP rows for one search term. Never errors: a failed request reads as "CDP search unavailable".
   * Unsubscribing cancels the request, which is how a superseded search is dropped.
   */
  public search(term: string): Observable<CdpCompanySearchResponse> {
    return this.http.get<CdpCompanySearchResponse>(`${BASE_URL}/search`, { params: strictHttpParams().set('name', term) }).pipe(
      map((response) => ({ items: Array.isArray(response?.items) ? response.items : [], ...(response?.unavailable ? { unavailable: true } : {}) })),
      catchError((error: unknown) => {
        console.error('[cdp-company] search failed', { error });
        return of<CdpCompanySearchResponse>({ items: [], unavailable: true });
      })
    );
  }

  /** Logs a failed page/section read, then rethrows it. 403/404 are expected refusals, so they log as warnings. */
  private logAndRethrow(operation: string, context: { cdpId: string; section?: CdpSectionKey; error: unknown }): Observable<never> {
    const expected = context.error instanceof HttpErrorResponse && (context.error.status === 403 || context.error.status === 404);
    (expected ? console.warn : console.error)(`[cdp-company] ${operation} failed`, context);
    return throwError(() => context.error);
  }
}
