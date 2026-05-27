// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, tap } from 'rxjs';

// Re-export the shared persona type so existing consumers can keep importing from this service module.
export type { OrgRolePersona } from '@lfx-one/shared/interfaces';

/** Session-scoped role-grants dictionary; eager-loaded on browser hydration. No mid-session invalidation per FR-018a (token refresh happens server-side). */
@Injectable({
  providedIn: 'root',
})
export class OrgRoleGrantsService {
  private readonly http = inject(HttpClient);

  private readonly writerSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly auditorSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly loadedInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly loadingInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly errorInternal: WritableSignal<string | null> = signal<string | null>(null);
  private readonly loadedAtMsInternal: WritableSignal<number | null> = signal<number | null>(null);

  public readonly writerSet: Signal<Set<string>> = this.writerSetInternal.asReadonly();
  public readonly auditorSet: Signal<Set<string>> = this.auditorSetInternal.asReadonly();
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
        this.loadedInternal.set(true);
        this.loadingInternal.set(false);
        return of(undefined);
      }),
      map(() => undefined)
    );
  }
}
