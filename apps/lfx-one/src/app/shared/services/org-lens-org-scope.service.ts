// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { OrgLensOrgScope } from '@lfx-one/shared/interfaces';
import { catchError, combineLatest, distinctUntilChanged, map, Observable, of, shareReplay, startWith, switchMap } from 'rxjs';

import { AccountContextService } from './account-context.service';

/**
 * The selected account's organization scope (`GET /api/orgs/:orgUid/lens/org-scope`, lfx-self-serve-ops#1219): its LFX
 * Insights organization and related-organization count, read once per account for every Organization scope picker.
 * `null` while loading (including right after an account switch), for no account, or when the read fails — the picker
 * then shows both options, unnamed.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensOrgScopeService {
  private readonly http = inject(HttpClient);
  private readonly accountContext = inject(AccountContextService);
  private readonly byOrg = new Map<string, Observable<OrgLensOrgScope | null>>();
  /** Accounts whose last read failed; `retryFailedRead` asks again for the selected one. */
  private readonly failedOrgUids = new Set<string>();
  private readonly retryCount = signal(0);
  private selectedOrgUid = '';

  public readonly current: Signal<OrgLensOrgScope | null> = this.initCurrent();

  public getOrgScope(orgUid: string): Observable<OrgLensOrgScope | null> {
    const cached = this.byOrg.get(orgUid);
    if (cached) return cached;
    const read = this.http.get<OrgLensOrgScope>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/org-scope`).pipe(
      catchError((error: unknown) => {
        console.error('[OrgLensOrgScopeService] failed to load the organization scope; offering both scopes, unnamed', error);
        // A failed read is not kept, so the next visit asks again.
        this.byOrg.delete(orgUid);
        this.failedOrgUids.add(orgUid);
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.byOrg.set(orgUid, read);
    return read;
  }

  /**
   * Reads the selected account's scope again when its last read failed; a no-op otherwise. Every Organization scope
   * picker calls it when it is created, so a page visit after a failure recovers `current` without an account switch.
   */
  public retryFailedRead(): void {
    const orgUid = this.selectedOrgUid;
    if (!orgUid || !this.failedOrgUids.delete(orgUid)) return;
    this.retryCount.update((count) => count + 1);
  }

  private initCurrent(): Signal<OrgLensOrgScope | null> {
    const orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
      map((account) => account.uid ?? ''),
      distinctUntilChanged()
    );
    return toSignal(
      combineLatest([orgUid$, toObservable(this.retryCount)]).pipe(
        switchMap(([orgUid]) => {
          this.selectedOrgUid = orgUid;
          // `null` first, so the previous account's name, count and availability never show while this one loads.
          return orgUid ? this.getOrgScope(orgUid).pipe(startWith(null)) : of(null);
        })
      ),
      { initialValue: null }
    );
  }
}
