// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { OrgLensOrgScope } from '@lfx-one/shared/interfaces';
import { catchError, distinctUntilChanged, map, Observable, of, shareReplay, switchMap } from 'rxjs';

import { AccountContextService } from './account-context.service';

/**
 * The selected account's organization scope (`GET /api/orgs/:orgUid/lens/org-scope`, lfx-self-serve-ops#1219): its LFX
 * Insights organization and related-organization count, read once per account for every Organization scope picker.
 * `null` while loading, for no account, or when the read fails — the picker then shows both options, unnamed.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensOrgScopeService {
  private readonly http = inject(HttpClient);
  private readonly accountContext = inject(AccountContextService);
  private readonly byOrg = new Map<string, Observable<OrgLensOrgScope | null>>();

  public readonly current: Signal<OrgLensOrgScope | null> = toSignal(
    toObservable(this.accountContext.selectedAccount).pipe(
      map((account) => account.uid ?? ''),
      distinctUntilChanged(),
      switchMap((orgUid) => (orgUid ? this.getOrgScope(orgUid) : of(null)))
    ),
    { initialValue: null }
  );

  public getOrgScope(orgUid: string): Observable<OrgLensOrgScope | null> {
    const cached = this.byOrg.get(orgUid);
    if (cached) return cached;
    const read = this.http.get<OrgLensOrgScope>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/org-scope`).pipe(
      catchError(() => {
        // A failed read is not kept, so the next visit asks again.
        this.byOrg.delete(orgUid);
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.byOrg.set(orgUid, read);
    return read;
  }
}
