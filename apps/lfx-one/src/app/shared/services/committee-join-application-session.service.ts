// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { UserService } from '@services/user.service';
import { distinctUntilChanged } from 'rxjs';

const PENDING_APPLICATIONS_STORAGE_KEY = 'lfx-pending-committee-applications';

/**
 * Session-scoped pending join-application state for application-mode groups.
 *
 * Survives route navigation (root singleton) and tab reloads (`sessionStorage`, keyed by LFID
 * username). Cleared when the visitor becomes a member. Server rehydration is unavailable — listing
 * applications is writer-only.
 */
@Injectable({
  providedIn: 'root',
})
export class CommitteeJoinApplicationSessionService {
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  /** Empty at construction so SSR and the hydration pass agree. */
  public readonly pendingCommitteeUids: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(new Set());

  public constructor() {
    toObservable(this.userService.viewerUsername)
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((username) => {
        this.pendingCommitteeUids.set(new Set());
        if (username) {
          this.hydrateFromStorage();
        }
      });
  }

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

  private storageKey(): string | null {
    const username = this.userService.viewerUsername();
    return username ? `${PENDING_APPLICATIONS_STORAGE_KEY}:${username}` : null;
  }

  private loadFromStorage(): ReadonlySet<string> {
    if (typeof sessionStorage === 'undefined') {
      return new Set();
    }

    const key = this.storageKey();
    if (!key) {
      return new Set();
    }

    try {
      const raw = sessionStorage.getItem(key);
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

    const key = this.storageKey();
    if (!key) {
      return;
    }

    try {
      if (uids.size === 0) {
        sessionStorage.removeItem(key);
        return;
      }
      sessionStorage.setItem(key, JSON.stringify([...uids]));
    } catch {
      // Ignore quota / private-mode storage failures — in-memory state still applies this session.
    }
  }
}
