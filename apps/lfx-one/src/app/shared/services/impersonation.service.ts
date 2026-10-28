// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { MAX_RECENT_IMPERSONATIONS, RECENT_IMPERSONATIONS_STORAGE_KEY } from '@lfx-one/shared/constants';
import {
  ImpersonationStartRequest,
  ImpersonationStartResponse,
  ImpersonationStatusResponse,
  ImpersonationTransition,
  PersonaType,
  RecentImpersonation,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ImpersonationService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * The impersonation change in flight, or null. Set when a start/switch/stop begins and left set on success,
   * because the page reloads afterwards: clearing it early would drop the loading UI for the whole reload.
   */
  public readonly transition = signal<ImpersonationTransition | null>(null);

  public startImpersonation(targetUser: string, personaContext?: PersonaType | null, switching = false): Observable<ImpersonationStartResponse> {
    const body: ImpersonationStartRequest = personaContext ? { targetUser, personaContext } : { targetUser };
    this.transition.set(switching ? 'switching' : 'starting');
    return this.http.post<ImpersonationStartResponse>('/api/impersonate', body).pipe(tap({ error: () => this.transition.set(null) }));
  }

  public stopImpersonation(): Observable<{ impersonating: false }> {
    this.transition.set('stopping');
    return this.http.post<{ impersonating: false }>('/api/impersonate/stop', {}).pipe(tap({ error: () => this.transition.set(null) }));
  }

  public getStatus(): Observable<ImpersonationStatusResponse> {
    return this.http
      .get<ImpersonationStatusResponse>('/api/impersonate/status')
      .pipe(catchError(() => of({ impersonating: false } as ImpersonationStatusResponse)));
  }

  public getRecentImpersonations(): RecentImpersonation[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((entry): entry is RecentImpersonation => this.isValidRecentImpersonation(entry)).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    } catch {
      return [];
    }
  }

  public addRecentImpersonation(entry: Omit<RecentImpersonation, 'lastUsedAt'>): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      const existing = this.getRecentImpersonations().filter((e) => e.email !== entry.email);
      const updated: RecentImpersonation[] = [{ ...entry, lastUsedAt: Date.now() }, ...existing].slice(0, MAX_RECENT_IMPERSONATIONS);
      window.localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore quota / disabled-storage errors — recent impersonations are a best-effort convenience.
    }
  }

  private isValidRecentImpersonation(entry: unknown): entry is RecentImpersonation {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const candidate = entry as Partial<RecentImpersonation>;
    return (
      typeof candidate.targetUser === 'string' &&
      typeof candidate.email === 'string' &&
      typeof candidate.username === 'string' &&
      typeof candidate.lastUsedAt === 'number' &&
      (candidate.name === undefined || typeof candidate.name === 'string') &&
      (candidate.picture === undefined || typeof candidate.picture === 'string')
    );
  }
}
