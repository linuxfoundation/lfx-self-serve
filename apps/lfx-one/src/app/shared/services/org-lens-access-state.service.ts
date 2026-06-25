// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import type { OrgAccessBadgeState, OrgAccessListResponse } from '@lfx-one/shared/interfaces';
import { EMPTY, Observable, of, shareReplay, tap } from 'rxjs';

import { OrgLensAccessService } from './org-lens-access.service';

/** Root-singleton cache for the Org Lens Access roster, shared between the Access tab (writer) and the All Employees tab (reader). */
@Injectable({ providedIn: 'root' })
export class OrgLensAccessStateService {
  private readonly dataService = inject(OrgLensAccessService);

  private readonly rosterByOrg = signal<Record<string, OrgAccessListResponse | undefined>>({});

  private readonly inFlight = new Map<string, Observable<OrgAccessListResponse>>();

  /** Full authoritative roster for the given org, or `null` when the cache is cold / source uid is falsy. */
  public rosterForOrg(orgUid: Signal<string | null | undefined>): Signal<OrgAccessListResponse | null> {
    return computed(() => this.initRosterForOrg(orgUid));
  }

  /** Lowercased email -> badge state for the given org; empty until the roster lands. */
  public accessByEmailFor(orgUid: Signal<string | null | undefined>): Signal<ReadonlyMap<string, OrgAccessBadgeState>> {
    return computed(() => this.initAccessByEmailFor(orgUid));
  }

  /** Triggers a fetch if the cache is cold; dedups concurrent callers via `shareReplay`. Fire-and-forget — consume via the cache signals. */
  public ensureLoaded(orgUid: string | null | undefined): Observable<OrgAccessListResponse> {
    if (!orgUid) return EMPTY;

    const cached = this.rosterByOrg()[orgUid];
    if (cached) return of(cached);

    const existing = this.inFlight.get(orgUid);
    if (existing) return existing;

    const request$ = this.dataService.getAccessUsers(orgUid).pipe(
      tap({
        next: (res) => this.setRoster(res.orgUid, res),
        finalize: () => this.inFlight.delete(orgUid),
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.inFlight.set(orgUid, request$);
    return request$;
  }

  /** Pushes an authoritative roster response into the cache; called by the Access tab after every successful load/invite/edit/remove. */
  public setRoster(orgUid: string, roster: OrgAccessListResponse): void {
    if (!orgUid) return;
    this.rosterByOrg.update((state) => ({ ...state, [orgUid]: roster }));
  }

  private initRosterForOrg(orgUid: Signal<string | null | undefined>): OrgAccessListResponse | null {
    const uid = orgUid();
    if (!uid) return null;
    return this.rosterByOrg()[uid] ?? null;
  }

  private initAccessByEmailFor(orgUid: Signal<string | null | undefined>): ReadonlyMap<string, OrgAccessBadgeState> {
    const uid = orgUid();
    const roster = uid ? this.rosterByOrg()[uid] : undefined;
    if (!roster) return new Map<string, OrgAccessBadgeState>();
    const map = new Map<string, OrgAccessBadgeState>();
    for (const user of roster.users) {
      map.set(user.email.toLowerCase(), user.isPending ? 'invited' : user.role);
    }
    return map;
  }
}
