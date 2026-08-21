// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, Injector, PLATFORM_ID, inject } from '@angular/core';
import { MENTION_IDS_MAX_VALUES, SOCIAL_LISTENING_BOOKMARKS_PREFERENCE_PREFIX } from '@lfx-one/shared/constants';
import { parseBookmarkIds, socialListeningPreferenceName } from '@lfx-one/shared/utils';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';

import { UserPreferenceStore } from './user-preference-store';

import type { PreferenceContext } from '@lfx-one/shared/interfaces';

/**
 * Per-user mention bookmarks (LFXV2-3002 Block 1, PCC port): a thin wrapper over the Block 0 `UserPreferenceStore<Set<string>>`.
 * No `providedIn` — the page provides it so the store's `destroyRef`/`injector` scope to the page.
 */
@Injectable()
export class MentionBookmarkService {
  private readonly messageService = inject(MessageService);
  private readonly socialListeningService = inject(SocialListeningService);

  private readonly store = new UserPreferenceStore<Set<string>>({
    transport: {
      get: (name) => firstValueFrom(this.socialListeningService.getPreference(name)),
      put: (name, value) => firstValueFrom(this.socialListeningService.upsertPreference(name, value)),
      delete: (name) => firstValueFrom(this.socialListeningService.deletePreference(name)),
    },
    destroyRef: inject(DestroyRef),
    injector: inject(Injector),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
    preferenceName: (projectId) => socialListeningPreferenceName(SOCIAL_LISTENING_BOOKMARKS_PREFERENCE_PREFIX, projectId),
    initial: () => new Set<string>(),
    parse: (raw) => ({ data: new Set(parseBookmarkIds(raw)) }),
    serialize: (ids) => JSON.stringify([...ids]),
    // PCC parity: emptying the set deletes the row rather than persisting '[]'.
    shouldDeleteOnEmpty: (ids) => ids.size === 0,
  });

  public readonly state = this.store.state;

  public setContext(ctx: PreferenceContext | null): void {
    this.store.setContext(ctx);
  }

  public toggleBookmark(mentionId: string): void {
    const { data: ids, loading, error } = this.store.state();
    // A failed load leaves an empty fallback set — writing from it would clobber the persisted bookmarks.
    if (loading || error) {
      if (error) {
        this.messageService.add({
          severity: 'error',
          summary: 'Bookmarks unavailable',
          detail: 'Your bookmarks could not be loaded. Refresh the page and try again.',
        });
      }
      return;
    }

    const adding = !ids.has(mentionId);
    if (adding && ids.size >= MENTION_IDS_MAX_VALUES) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Bookmark limit reached',
        detail: `You can bookmark up to ${MENTION_IDS_MAX_VALUES} mentions per project.`,
      });
      return;
    }

    const next = new Set(ids);
    if (adding) next.add(mentionId);
    else next.delete(mentionId);

    this.store.commit({
      next,
      // Re-derive at dequeue time: if an earlier queued commit failed and rolled back, the eager snapshot would resurrect it.
      rebase: (current) => {
        const ids = new Set(current);
        if (adding) ids.add(mentionId);
        else ids.delete(mentionId);
        return ids;
      },
      // Targeted rollback: invert this toggle against current state so bookmarks queued after this one survive.
      rollback: () => {
        const ids = new Set(this.store.state().data);
        if (adding) ids.delete(mentionId);
        else ids.add(mentionId);
        this.store.replace(ids);
      },
      onSuccess: () =>
        this.messageService.add(
          adding
            ? { severity: 'success', summary: 'Bookmarked', detail: 'Mention added to your bookmarks.' }
            : { severity: 'success', summary: 'Bookmark removed', detail: 'Mention removed from your bookmarks.' }
        ),
      onError: () =>
        this.messageService.add({
          severity: 'error',
          summary: adding ? 'Could not save bookmark' : 'Could not remove bookmark',
          detail: 'Please try again.',
        }),
    });
  }
}
