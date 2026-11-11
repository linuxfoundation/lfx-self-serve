// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ORG_ROLL_UP_SET_PATH } from '@lfx-one/shared/constants';
import { OrgLensLookupOutcome, OrgRollUpFamiliesSource, OrgRollUpFamily, OrgRollUpSetOrg, OrgRollUpSetResponse } from '@lfx-one/shared/interfaces';
import { catchError, filter, map, Observable, of, switchMap, tap } from 'rxjs';

import { OrgRoleGrantsService } from './org-role-grants.service';

/**
 * The caller's organizations grouped by Salesforce family, from `GET /api/orgs/me/roll-up-set`
 * (lfx-self-serve#4126) — the data every family roll-up is built from.
 *
 * Re-fetched whenever the role grants (re)load, including the viewer's Retry, so the two answers
 * describe the same moment: the endpoint reads the access-aware cache the grants request just
 * refreshed. A refetch keeps the previous families until the new answer lands.
 *
 * There is no client-side fallback. The BFF and the app ship in one image, so the endpoint always
 * exists; any failure, a 404 included, leaves the families unknown rather than guessed. Browser-only
 * in practice: the grants load after hydration, so SSR never issues the request.
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
  /** The grants load (`OrgRoleGrantsService.loadedAtMs`) the current answer was fetched for. */
  private readonly answeredForInternal: WritableSignal<number | null> = signal<number | null>(null);

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
   * True while roll-up eligibility cannot be judged from the families: no answer yet, an answer that
   * is a lower bound or unknown, or an answer to an earlier grants load — a refetch is owed, and the
   * previous families must not admit or demote against the grants that replaced them.
   */
  public readonly unsettled: Signal<boolean> = computed(
    () => this.sourceInternal() === 'pending' || this.lookupOutcomeInternal() !== 'ok' || this.answeredForInternal() !== this.roleGrants.loadedAtMs()
  );

  /** True once an answer has landed that is a lower bound or unknown — the switcher's incomplete-list notice and its Retry cover it. */
  public readonly incomplete: Signal<boolean> = computed(() => this.sourceInternal() === 'server' && this.lookupOutcomeInternal() !== 'ok');

  public constructor() {
    toObservable(this.roleGrants.loadedAtMs)
      .pipe(
        filter((loadedAt): loadedAt is number => loadedAt !== null),
        switchMap((loadedAt) => this.fetch(loadedAt)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private fetch(loadedAt: number): Observable<void> {
    this.loadingInternal.set(true);
    return this.http.get<OrgRollUpSetResponse>(ORG_ROLL_UP_SET_PATH).pipe(
      tap((response) => {
        this.applyResponse(response);
        this.answeredForInternal.set(loadedAt);
      }),
      map(() => undefined),
      catchError(() => {
        // Unknown, not empty: keep nothing that could read as a family having shrunk.
        this.sourceInternal.set('server');
        this.familiesInternal.set([]);
        this.orgsByUidInternal.set(new Map());
        this.lookupOutcomeInternal.set('failed');
        this.answeredForInternal.set(loadedAt);
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
    // A body that is not the documented shape is unknown, not "no families" — the same as a failed request.
    this.lookupOutcomeInternal.set(
      response && Array.isArray(response.families) ? (response.lookupOutcome ?? (response.degraded === true ? 'partial' : 'ok')) : 'failed'
    );
    this.sourceInternal.set('server');
    this.loadingInternal.set(false);
  }
}
