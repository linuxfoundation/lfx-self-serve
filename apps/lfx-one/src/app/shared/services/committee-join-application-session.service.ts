// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal, WritableSignal } from '@angular/core';

const PENDING_APPLICATIONS_STORAGE_KEY = 'lfx-pending-committee-applications';

/**
 * Session-scoped pending join-application state for application-mode groups.
 *
 * Survives route navigation (root singleton) and tab reloads (`sessionStorage`). Cleared when the
 * visitor becomes a member. Server rehydration is unavailable — listing applications is writer-only.
 */
@Injectable({
  providedIn: 'root',
})
export class CommitteeJoinApplicationSessionService {
  /** Empty at construction so SSR and the hydration pass agree; call {@link hydrateFromStorage} in the browser. */
  public readonly pendingCommitteeUids: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(new Set());

  public hydrateFromStorage(): void {
    const stored = this.loadFromStorage();
    if (stored.size > 0) {
      this.pendingCommitteeUids.set(stored);
    }
  }

  public hasPending(committeeUid: string): boolean {
    return this.pendingCommitteeUids().has(committeeUid);
  }

  public markPending(committeeUid: string): void {
    this.pendingCommitteeUids.update((uids) => {
      if (uids.has(committeeUid)) {
        return uids;
      }
      const next = new Set(uids);
      next.add(committeeUid);
      this.persist(next);
      return next;
    });
  }

  public clearPending(committeeUid: string): void {
    this.pendingCommitteeUids.update((uids) => {
      if (!uids.has(committeeUid)) {
        return uids;
      }
      const next = new Set(uids);
      next.delete(committeeUid);
      this.persist(next);
      return next;
    });
  }

  private loadFromStorage(): ReadonlySet<string> {
    if (typeof sessionStorage === 'undefined') {
      return new Set();
    }

    try {
      const raw = sessionStorage.getItem(PENDING_APPLICATIONS_STORAGE_KEY);
      if (!raw) {
        return new Set();
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return new Set();
      }
      return new Set(parsed.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0));
    } catch {
      return new Set();
    }
  }

  private persist(uids: ReadonlySet<string>): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    try {
      if (uids.size === 0) {
        sessionStorage.removeItem(PENDING_APPLICATIONS_STORAGE_KEY);
        return;
      }
      sessionStorage.setItem(PENDING_APPLICATIONS_STORAGE_KEY, JSON.stringify([...uids]));
    } catch {
      // Ignore quota / private-mode storage failures — in-memory state still applies this session.
    }
  }
}
