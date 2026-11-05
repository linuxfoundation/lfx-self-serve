// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ORG_ROLE_GRANTS_REFRESH_PARAM, ORG_ROLL_UP_SET_PATH } from '@lfx-one/shared/constants';
import { OrgLensLookupOutcome, OrgRollUpFamiliesSource, OrgRollUpFamily, OrgRollUpSetOrg, OrgRollUpSetResponse } from '@lfx-one/shared/interfaces';
import { catchError, filter, map, merge, Observable, of, Subject, switchMap, tap } from 'rxjs';

import { OrgRoleGrantsService } from './org-role-grants.service';

/**
 * The caller's organizations grouped by Salesforce family, from `GET /api/orgs/me/roll-up-set`
 * (lfx-self-serve#4126) — the data every family roll-up is built from.
 *
 * Re-fetched whenever the role grants (re)load, including the viewer's Retry, so the two answers
 * describe the same moment. A refetch keeps the previous families until the new answer lands.
 *
 * Until the BFF serves the endpoint the answer is a 404, reported as `source: 'unavailable'`;
 * `AccountContextService` then groups the grant sets itself. Browser-only in practice: the grants
 * load after hydration, so SSR never issues the request.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgRollUpFamiliesService {
  private readonly http = inject(HttpClient);
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly sourceInternal: WritableSignal<OrgRollUpFamiliesSource> = signal<OrgRollUpFamiliesSource>('pending');
  private readonly familiesInternal: WritableSignal<OrgRollUpFamily[]> = signal<OrgRollUpFamily[]>([]);
  private readonly orgsByUidInternal: WritableSignal<Map<string, OrgRollUpSetOrg>> = signal<Map<string, OrgRollUpSetOrg>>(new Map());
  private readonly lookupOutcomeInternal: WritableSignal<OrgLensLookupOutcome> = signal<OrgLensLookupOutcome>('ok');
  private readonly loadingInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly refreshRequests = new Subject<boolean>();

  public readonly source: Signal<OrgRollUpFamiliesSource> = this.sourceInternal.asReadonly();
  /** The server's families, in its order (alphabetical by family name). Empty unless `source` is `'server'`. */
  public readonly families: Signal<OrgRollUpFamily[]> = this.familiesInternal.asReadonly();
  /** Display fields for every organization the server placed in a family, keyed by uid — for grouping the switcher's rows under their family. */
  public readonly orgsByUid: Signal<Map<string, OrgRollUpSetOrg>> = this.orgsByUidInternal.asReadonly();
  /** `partial` / `failed` mean the families are a lower bound or unknown — never evidence that a family shrank. */
  public readonly lookupOutcome: Signal<OrgLensLookupOutcome> = this.lookupOutcomeInternal.asReadonly();
  public readonly loading: Signal<boolean> = this.loadingInternal.asReadonly();

  /** True when the server's families are usable as the grouping: it answered, and the walk did not fail outright. */
  public readonly hasServerFamilies: Signal<boolean> = computed(() => this.sourceInternal() === 'server' && this.lookupOutcomeInternal() !== 'failed');

  /**
   * True while roll-up eligibility cannot be judged from the families: no answer yet, or an answer
   * that is a lower bound. A missing endpoint is settled — the client-side grouping is then the
   * whole answer, and the grant sets' own outcome governs it.
   */
  public readonly unsettled: Signal<boolean> = computed(() => {
    const source = this.sourceInternal();
    return source === 'pending' || (source === 'server' && this.lookupOutcomeInternal() !== 'ok');
  });

  public constructor() {
    merge(
      toObservable(this.roleGrants.loadedAtMs).pipe(
        filter((loadedAt): loadedAt is number => loadedAt !== null),
        map(() => false)
      ),
      this.refreshRequests
    )
      .pipe(
        switchMap((bypassCache) => this.fetch(bypassCache)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /** Re-fetch the families; `bypassCache` asks the BFF to recompute rather than answer from its cache, as the grants' Retry does. */
  public refresh(bypassCache = false): void {
    this.refreshRequests.next(bypassCache);
  }

  private fetch(bypassCache: boolean): Observable<void> {
    this.loadingInternal.set(true);
    const params = bypassCache ? { [ORG_ROLE_GRANTS_REFRESH_PARAM]: '1' } : undefined;
    return this.http.get<OrgRollUpSetResponse>(ORG_ROLL_UP_SET_PATH, { params }).pipe(
      tap((response) => this.applyResponse(response)),
      map(() => undefined),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.sourceInternal.set('unavailable');
          this.familiesInternal.set([]);
          this.orgsByUidInternal.set(new Map());
          this.lookupOutcomeInternal.set('ok');
        } else {
          // Unknown, not empty: keep nothing that could read as a family having shrunk.
          this.sourceInternal.set('server');
          this.familiesInternal.set([]);
          this.orgsByUidInternal.set(new Map());
          this.lookupOutcomeInternal.set('failed');
        }
        this.loadingInternal.set(false);
        return of(undefined);
      })
    );
  }

  private applyResponse(response: OrgRollUpSetResponse | null): void {
    const orgsByUid = new Map<string, OrgRollUpSetOrg>();
    const families: OrgRollUpFamily[] = [];
    for (const family of Array.isArray(response?.families) ? response.families : []) {
      if (!family?.rootUid) {
        continue;
      }
      const orgUids: string[] = [];
      for (const org of Array.isArray(family.orgs) ? family.orgs : []) {
        // An organization belongs to exactly one family; a repeat is ignored rather than double counted.
        if (!org?.uid || orgsByUid.has(org.uid)) {
          continue;
        }
        orgsByUid.set(org.uid, org);
        orgUids.push(org.uid);
      }
      families.push({ rootUid: family.rootUid, name: family.rootName ?? null, orgUids });
    }

    this.familiesInternal.set(families);
    this.orgsByUidInternal.set(orgsByUid);
    this.lookupOutcomeInternal.set(response?.lookupOutcome ?? (response?.degraded === true ? 'partial' : 'ok'));
    this.sourceInternal.set('server');
    this.loadingInternal.set(false);
  }
}
