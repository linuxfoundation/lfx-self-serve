// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { CascadingRoleGrant, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, tap } from 'rxjs';

// Re-export the shared persona type so existing consumers can keep importing from this service module.
export type { OrgRolePersona } from '@lfx-one/shared/interfaces';

/** Session-scoped role-grants dictionary; eager-loaded on browser hydration. No mid-session invalidation per FR-018a (token refresh happens server-side). */
@Injectable({
  providedIn: 'root',
})
export class OrgRoleGrantsService {
  private readonly http = inject(HttpClient);

  // `writerSet` / `auditorSet` stay DIRECT-ONLY by design (FR-011a). They drive `OrgProfileComponent.canEdit`
  // and any other capability gate that requires a hard "the user can write to THIS org directly" answer.
  // Widening these to include cascading uids would silently break FR-011a — spec 022 D-009.
  private readonly writerSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly auditorSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  // Spec 022 — additive, dropdown-only surface for the inherited badge + tooltip. Disjoint from writerSet / auditorSet.
  private readonly inheritedWriterSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly inheritedAuditorSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly parentNameByUidInternal: WritableSignal<Map<string, string>> = signal<Map<string, string>>(new Map());
  private readonly loadedInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly loadingInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly errorInternal: WritableSignal<string | null> = signal<string | null>(null);
  private readonly loadedAtMsInternal: WritableSignal<number | null> = signal<number | null>(null);

  public readonly writerSet: Signal<Set<string>> = this.writerSetInternal.asReadonly();
  public readonly auditorSet: Signal<Set<string>> = this.auditorSetInternal.asReadonly();
  public readonly inheritedWriterSet: Signal<Set<string>> = this.inheritedWriterSetInternal.asReadonly();
  public readonly inheritedAuditorSet: Signal<Set<string>> = this.inheritedAuditorSetInternal.asReadonly();
  /** Child uid → parent display name; used to render the dropdown tooltip without a second lookup. */
  public readonly parentNameByUid: Signal<Map<string, string>> = this.parentNameByUidInternal.asReadonly();
  public readonly loaded: Signal<boolean> = this.loadedInternal.asReadonly();
  public readonly loading: Signal<boolean> = this.loadingInternal.asReadonly();
  public readonly error: Signal<string | null> = this.errorInternal.asReadonly();
  public readonly loadedAtMs: Signal<number | null> = this.loadedAtMsInternal.asReadonly();

  public constructor() {
    afterNextRender(() => {
      this.refresh().subscribe();
    });
  }

  /** Re-fetch role grants; idempotent. Returns Observable<void> so callers can compose (e.g. forkJoin with persona refresh). */
  public refresh(): Observable<void> {
    this.loadingInternal.set(true);
    this.errorInternal.set(null);
    return this.http.get<RoleGrantsResponse>('/api/orgs/me/role-grants').pipe(
      tap((response) => {
        this.writerSetInternal.set(new Set(response.writers));
        this.auditorSetInternal.set(new Set(response.auditors));
        this.inheritedWriterSetInternal.set(new Set((response.cascadingWriters ?? []).map((entry: CascadingRoleGrant) => entry.uid)));
        this.inheritedAuditorSetInternal.set(new Set((response.cascadingAuditors ?? []).map((entry: CascadingRoleGrant) => entry.uid)));
        this.parentNameByUidInternal.set(this.buildParentNameMap(response));
        this.loadedInternal.set(true);
        this.loadingInternal.set(false);
        this.loadedAtMsInternal.set(Date.now());
      }),
      catchError((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.errorInternal.set(message);
        // BFF downgrades upstream failures to empty 200 per contract, so reaching this branch typically means a transport-level failure.
        // Treat as empty grants → sidebar visibility gate falls back to persona seeds.
        this.writerSetInternal.set(new Set());
        this.auditorSetInternal.set(new Set());
        this.inheritedWriterSetInternal.set(new Set());
        this.inheritedAuditorSetInternal.set(new Set());
        this.parentNameByUidInternal.set(new Map());
        this.loadedInternal.set(true);
        this.loadingInternal.set(false);
        return of(undefined);
      }),
      map(() => undefined)
    );
  }

  private buildParentNameMap(response: RoleGrantsResponse): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of response.cascadingWriters ?? []) {
      if (entry.uid && entry.parentName) map.set(entry.uid, entry.parentName);
    }
    for (const entry of response.cascadingAuditors ?? []) {
      if (entry.uid && entry.parentName && !map.has(entry.uid)) map.set(entry.uid, entry.parentName);
    }
    return map;
  }
}
