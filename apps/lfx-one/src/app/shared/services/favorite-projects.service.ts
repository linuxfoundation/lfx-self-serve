// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, Injector, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FAVORITE_PROJECTS_MAX_VALUES, FAVORITE_PROJECTS_PREFERENCE_CONTEXT_ID, FAVORITE_PROJECTS_PREFERENCE_NAME } from '@lfx-one/shared/constants';
import { PreferenceReadResponse, PreferenceUpsertRequest } from '@lfx-one/shared/interfaces';
import { parseFavoriteProjectUids } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { map, Observable } from 'rxjs';

import { UserPreferenceStore } from './user-preference-store';

/**
 * Favorited foundations/projects (GH-2995): a single global per-user preference — unlike
 * `MentionBookmarkService`, this is `providedIn: 'root'` because `ProjectSelectorComponent` is
 * rendered app-wide (sidebar), not confined to one page; a page-scoped store would be destroyed
 * and recreated on every navigation. Context tracks the signed-in user via `toObservable` here
 * rather than requiring a hosting component to call `setContext`.
 *
 * Owns its own HTTP transport (GH-3453) rather than delegating to `NavigationService` — the nav
 * service reads this service's favorited uids to float them into the browse list's first page, so
 * the reverse dependency would form a circular injection.
 */
@Injectable({
  providedIn: 'root',
})
export class FavoriteProjectsService {
  private readonly http = inject(HttpClient);
  private readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);

  private readonly store = new UserPreferenceStore<Set<string>>({
    transport: {
      get: () => this.getFavoriteProjectsPreference(),
      put: (_name, value) => this.upsertFavoriteProjectsPreference(value),
      delete: () => this.deleteFavoriteProjectsPreference(),
    },
    destroyRef: inject(DestroyRef),
    injector: inject(Injector),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
    preferenceName: () => FAVORITE_PROJECTS_PREFERENCE_NAME,
    initial: () => new Set<string>(),
    parse: (raw) => ({ data: new Set(parseFavoriteProjectUids(raw)) }),
    serialize: (ids) => JSON.stringify([...ids]),
    shouldDeleteOnEmpty: (ids) => ids.size === 0,
    onLoadError: () => this.notifyUnavailable(),
  });

  public readonly state = this.store.state;

  public constructor() {
    toObservable(this.userService.user)
      .pipe(takeUntilDestroyed())
      .subscribe((user) => {
        const userId = user?.sub;
        this.store.setContext(userId ? { userId, projectId: FAVORITE_PROJECTS_PREFERENCE_CONTEXT_ID } : null);
      });
  }

  public toggleFavorite(uid: string): void {
    const { data: ids, loading, error } = this.store.state();
    // A failed load leaves an empty fallback set — writing from it would clobber the persisted favorites.
    if (loading || error) {
      if (error) this.notifyUnavailable();
      return;
    }

    const adding = !ids.has(uid);
    if (adding && ids.size >= FAVORITE_PROJECTS_MAX_VALUES) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Favorites limit reached',
        detail: `You can favorite up to ${FAVORITE_PROJECTS_MAX_VALUES} foundations/projects.`,
      });
      return;
    }

    const next = new Set(ids);
    if (adding) next.add(uid);
    else next.delete(uid);

    this.store.commit({
      next,
      // Re-derive at dequeue time: if an earlier queued commit failed and rolled back, the eager snapshot would resurrect it.
      rebase: (current) => {
        const ids = new Set(current);
        if (adding) ids.add(uid);
        else ids.delete(uid);
        return ids;
      },
      // Targeted rollback: invert this toggle against current state so favorites queued after this one survive.
      rollback: () => {
        const ids = new Set(this.store.state().data);
        if (adding) ids.delete(uid);
        else ids.add(uid);
        this.store.replace(ids);
      },
      onError: () =>
        this.messageService.add({
          severity: 'error',
          summary: adding ? 'Failed to save favorite' : 'Failed to remove favorite',
          detail: adding ? 'Could not save the favorite. Please try again.' : 'Could not remove the favorite. Please try again.',
        }),
    });
  }

  private notifyUnavailable(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Favorites unavailable',
      detail: 'Your favorites could not be loaded. Refresh the page and try again.',
    });
  }

  /** Reads the current user's favorited foundation/project uids (`null` when unset) — `UserPreferenceStore` transport (GH-2995). */
  private getFavoriteProjectsPreference(): Observable<string | null> {
    return this.http.get<PreferenceReadResponse>('/api/nav/favorite-projects').pipe(map((response) => response.value));
  }

  /** Upserts the current user's favorited uids (stringified JSON array). */
  private upsertFavoriteProjectsPreference(value: string): Observable<void> {
    const body: PreferenceUpsertRequest = { value };
    return this.http.put<PreferenceReadResponse>('/api/nav/favorite-projects', body).pipe(map(() => undefined));
  }

  /** Clears the current user's favorited uids (idempotent server-side). */
  private deleteFavoriteProjectsPreference(): Observable<void> {
    return this.http.delete<PreferenceReadResponse>('/api/nav/favorite-projects').pipe(map(() => undefined));
  }
}
