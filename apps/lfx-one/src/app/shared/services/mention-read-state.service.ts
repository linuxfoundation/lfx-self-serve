// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, Injector, PLATFORM_ID, inject, signal } from '@angular/core';
import { MAX_READ_IDS, SOCIAL_LISTENING_READ_STATE_PREFERENCE_PREFIX } from '@lfx-one/shared/constants';
import {
  computeReadToggle,
  emptyReadState,
  garbageCollectReadState,
  isReadInState,
  parseReadState,
  socialListeningPreferenceName,
} from '@lfx-one/shared/utils';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';

import { UserPreferenceStore } from './user-preference-store';

import type { PreferenceContext, ReadStateData } from '@lfx-one/shared/interfaces';

/**
 * Per-user read/unread state (LFXV2-3002 Block 2, PCC port): a thin wrapper over the Block 0 `UserPreferenceStore<ReadStateData>`.
 * No `providedIn` — the page provides it so the store's `destroyRef`/`injector` scope to the page.
 */
@Injectable()
export class MentionReadStateService {
  private readonly messageService = inject(MessageService);
  private readonly socialListeningService = inject(SocialListeningService);
  private overflowWarningShown = false;
  // Bumped on each mark-all commit so a queued toggle's rollback can tell when a bulk state superseded it.
  private bulkSeq = 0;
  // Toggle failures a bulk superseded — a later bulk rollback must not resurrect them from its pre-bulk snapshot.
  private failedToggleIds = new Set<string>();
  // Last state known persisted (load or successful write) — a bulk rollback must never restore a queued write's unpersisted optimistic doc.
  private lastPersisted: ReadStateData | null = null;

  private readonly store = new UserPreferenceStore<ReadStateData>({
    transport: {
      get: (name) => this.socialListeningService.getPreference(name),
      put: (name, value) => this.socialListeningService.upsertPreference(name, value),
      delete: (name) => this.socialListeningService.deletePreference(name),
    },
    destroyRef: inject(DestroyRef),
    injector: inject(Injector),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
    preferenceName: (projectId) => socialListeningPreferenceName(SOCIAL_LISTENING_READ_STATE_PREFERENCE_PREFIX, projectId),
    initial: emptyReadState,
    parse: (raw) => ({ data: garbageCollectReadState(parseReadState(raw)) }),
    serialize: (state) => JSON.stringify(state),
    onContextChange: () => {
      this.overflowWarningShown = false;
      this.failedToggleIds.clear();
      this.lastPersisted = null;
    },
    onLoaded: (result) => {
      this.lastPersisted = result?.data ?? emptyReadState();
    },
    onLoadError: () => {
      this.messageService.add({
        severity: 'error',
        summary: 'Read state unavailable',
        detail: 'Your read state could not be loaded. Refresh the page and try again.',
      });
    },
  });

  public readonly state = this.store.state;

  /**
   * Bumped when a bulk commit (mark-all) rolls back — `replace` restores the prior doc without a loading/error
   * transition, so consumers keying off those primitives (the unread snapshot) re-capture state off this tick.
   */
  public readonly bulkRollbackTick = signal(0);

  public setContext(ctx: PreferenceContext | null): void {
    this.store.setContext(ctx);
  }

  public isRead(mentionId: string, mentionTimestamp: string): boolean {
    return isReadInState(this.store.state().data, mentionId, mentionTimestamp);
  }

  public toggleRead(mentionId: string, mentionTimestamp: string): void {
    const { data: current, loading, error } = this.store.state();
    // A failed load leaves an empty fallback state — writing from it would clobber the persisted read state.
    if (loading || error) {
      if (error) this.notifyUnavailable();
      return;
    }

    const currentlyRead = isReadInState(current, mentionId, mentionTimestamp);
    const bulkAtCommit = this.bulkSeq;
    // A fresh toggle attempt supersedes an earlier bulk-superseded failure of the same id.
    this.failedToggleIds.delete(mentionId);

    // Warn once per context when readIds nears the cap so users switch to mark-all-as-read.
    if (!currentlyRead && !this.overflowWarningShown && current.readIds.length >= MAX_READ_IDS * 0.9) {
      this.overflowWarningShown = true;
      this.messageService.add({
        severity: 'warn',
        summary: 'Many mentions marked as read',
        detail: "You've read many mentions — use 'Mark all as read' to keep your read state accurate.",
      });
    }

    const next = computeReadToggle(current, mentionId, mentionTimestamp, currentlyRead);

    this.store.commit({
      next,
      // Re-derive at dequeue time: if an earlier queued commit failed and rolled back, the eager snapshot would resurrect it.
      rebase: (current) => computeReadToggle(current, mentionId, mentionTimestamp, currentlyRead),
      // Targeted rollback: strip this toggle's list contribution, then re-apply the pre-toggle status (`currentlyRead`) when stripping alone doesn't restore it.
      // Never key off `next` — a no-net-change toggle (mark-unread on a non-cutoff-covered id) makes `next` the broken state.
      rollback: () => {
        const current = this.store.state().data;
        const stripped: ReadStateData = {
          ...current,
          readIds: current.readIds.filter((id) => id !== mentionId),
          unreadIds: current.unreadIds.filter((id) => id !== mentionId),
        };
        // A mark-all queued after this toggle superseded it: `stripped` already matches the bulk state, and
        // restoring the pre-toggle status would undo a bulk action that may have succeeded.
        if (this.bulkSeq !== bulkAtCommit) {
          this.failedToggleIds.add(mentionId);
          this.store.replace(stripped);
          return;
        }
        // `stripped` is toggle-neutral; flip from its actual status (`readWithoutToggle`) so the result matches the pre-toggle read state.
        const readWithoutToggle = isReadInState(stripped, mentionId, mentionTimestamp);
        this.store.replace(readWithoutToggle === currentlyRead ? stripped : computeReadToggle(stripped, mentionId, mentionTimestamp, readWithoutToggle));
      },
      onSuccess: (written) => (this.lastPersisted = written),
      onError: () => this.notifyFailure(),
    });
  }

  public markAllAsRead(latestMentionTs: string | null): void {
    const { data: previous, loading, error } = this.store.state();
    if (loading || error) {
      if (error) this.notifyUnavailable();
      return;
    }
    this.overflowWarningShown = false;

    // No mentions loaded — nothing to mark. Never fall back to wall-clock: that would
    // silently hide delayed/backfilled mentions whose timestamps predate "now".
    if (!latestMentionTs) return;

    const bulkAtCommit = ++this.bulkSeq;
    this.store.commit({
      // The newest loaded timestamp becomes the cutoff, so mentions published after it stay unread.
      next: { readBeforeTs: latestMentionTs, readIds: [], unreadIds: [] },
      rollback: this.mergeRollback(previous, bulkAtCommit),
      onSuccess: (written) => (this.lastPersisted = written),
      onError: () => this.notifyFailure(),
    });
  }

  public markAllAsUnread(): void {
    const { data: previous, loading, error } = this.store.state();
    if (loading || error) {
      if (error) this.notifyUnavailable();
      return;
    }
    this.overflowWarningShown = false;

    const bulkAtCommit = ++this.bulkSeq;
    this.store.commit({
      next: emptyReadState(),
      rollback: this.mergeRollback(previous, bulkAtCommit),
      onSuccess: (written) => (this.lastPersisted = written),
      onError: () => this.notifyFailure(),
    });
  }

  // Bulk-write rollback: restore the last persisted state and merge id lists so optimistic toggles queued after the bulk commit survive.
  private mergeRollback(previous: ReadStateData, bulkAtCommit: number): () => void {
    return () => {
      // A later bulk superseded this one — its optimistic state (or its own rollback) governs.
      if (this.bulkSeq !== bulkAtCommit) return;
      // `previous` can be a queued bulk's unpersisted optimistic doc — the last persisted state is the only safe restore target.
      const base = this.lastPersisted ?? previous;
      const current = this.store.state().data;
      // A queued toggle's list wins over the restored snapshot — an id in both lists renders as read even when the persisted doc says unread.
      // The base predates any bulk-superseded toggle failure, so failedToggleIds must stay out of the restored lists.
      const toggledIds = new Set([...current.readIds, ...current.unreadIds]);
      this.store.replace({
        readBeforeTs: base.readBeforeTs,
        readIds: [...new Set([...base.readIds.filter((id) => !toggledIds.has(id) && !this.failedToggleIds.has(id)), ...current.readIds])],
        unreadIds: [...new Set([...base.unreadIds.filter((id) => !toggledIds.has(id) && !this.failedToggleIds.has(id)), ...current.unreadIds])],
      });
      this.failedToggleIds.clear();
      this.bulkRollbackTick.update((tick) => tick + 1);
    };
  }

  private notifyUnavailable(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Read state unavailable',
      detail: 'Your read state could not be loaded. Refresh the page and try again.',
    });
  }

  private notifyFailure(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Read state failed',
      detail: 'Could not save read state. Please try again.',
    });
  }
}
