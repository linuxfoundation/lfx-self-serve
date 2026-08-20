// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, Injector, PLATFORM_ID, inject } from '@angular/core';
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
import { firstValueFrom } from 'rxjs';

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

  private readonly store = new UserPreferenceStore<ReadStateData>({
    transport: {
      get: (name) => firstValueFrom(this.socialListeningService.getPreference(name)),
      put: (name, value) => firstValueFrom(this.socialListeningService.upsertPreference(name, value)),
      delete: (name) => firstValueFrom(this.socialListeningService.deletePreference(name)),
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
    },
  });

  public readonly state = this.store.state;

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
      // Targeted rollback: re-derive against current state so optimistic toggles queued after this one survive.
      rollback: () => {
        const wasReadAfterToggle = isReadInState(next, mentionId, mentionTimestamp);
        this.store.replace(computeReadToggle(this.store.state().data, mentionId, mentionTimestamp, wasReadAfterToggle));
      },
      onError: () => this.notifyFailure(),
    });
  }

  public markAllAsRead(latestMentionTs: string | null): void {
    const { loading, error } = this.store.state();
    if (loading || error) {
      if (error) this.notifyUnavailable();
      return;
    }
    this.overflowWarningShown = false;

    // No mentions loaded — nothing to mark. Never fall back to wall-clock: that would
    // silently hide delayed/backfilled mentions whose timestamps predate "now".
    if (!latestMentionTs) return;

    this.store.commit({
      // The newest loaded timestamp becomes the cutoff, so mentions published after it stay unread.
      next: { readBeforeTs: latestMentionTs, readIds: [], unreadIds: [] },
      onError: () => this.notifyFailure(),
    });
  }

  public markAllAsUnread(): void {
    const { loading, error } = this.store.state();
    if (loading || error) {
      if (error) this.notifyUnavailable();
      return;
    }
    this.overflowWarningShown = false;

    this.store.commit({
      next: emptyReadState(),
      onError: () => this.notifyFailure(),
    });
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
