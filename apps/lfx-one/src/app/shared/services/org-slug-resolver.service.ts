// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, shareReplay, throwError } from 'rxjs';

import type { OrgResolveResponse } from '@lfx-one/shared/interfaces';

/**
 * Client-side proxy for `GET /api/orgs/resolve/:segment` (spec 050, contracts/bff-org-slug-transport.md §3).
 *
 * Resolves an Org Lens address segment — lowercase slug or 18-char SFID — to the organization it
 * names, for the signed-in viewer only. `404` (unknown **or** not readable, indistinguishable by
 * design — DR-002) and `409` (a same-slug tie the viewer's selection could not break — DR-007 §4)
 * both surface as `null`; every other failure is rethrown so the guard can apply FR-020 (let an
 * SFID through, treat a slug as not found).
 */
@Injectable({
  providedIn: 'root',
})
export class OrgSlugResolverService {
  private readonly http = inject(HttpClient);
  /** In-flight/settled resolutions memoized per (segment, prefer) for the page lifetime — the guard re-runs on every child navigation. */
  private readonly inFlight = new Map<string, Observable<OrgResolveResponse | null>>();

  /**
   * @param segment already-lowercased address segment
   * @param prefer  the viewer's current selection (uid) — breaks a same-slug tie, never widens access
   */
  public resolve(segment: string, prefer?: string | null): Observable<OrgResolveResponse | null> {
    const key = prefer ? `${segment}\u0000${prefer}` : segment;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    let params = new HttpParams();
    if (prefer) params = params.set('prefer', prefer);

    const request$ = this.http.get<OrgResolveResponse>(`/api/orgs/resolve/${encodeURIComponent(segment)}`, { params }).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 409)) {
          return of(null);
        }
        this.inFlight.delete(key);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.inFlight.set(key, request$);
    return request$;
  }
}
