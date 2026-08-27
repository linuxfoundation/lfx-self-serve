// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, Injector, PLATFORM_ID, Signal, inject, signal } from '@angular/core';
import { MAX_SAVED_FILTERS_PER_PROJECT, SAVED_FILTERS_DOC_VERSION, SOCIAL_LISTENING_SAVED_FILTERS_PREFERENCE_PREFIX } from '@lfx-one/shared/constants';
import {
  getDefaultMarketingImpactPeriod,
  normalizePredicate,
  normalizeViewScope,
  parseSavedFilters,
  socialListeningPreferenceName,
} from '@lfx-one/shared/utils';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';
import { UserPreferenceStore } from './user-preference-store';

import type { FilterPredicate, PreferenceContext, SavedFilter, SavedFiltersDoc, SavedViewScope } from '@lfx-one/shared/interfaces';

/**
 * Per-user saved filter views (LFXV2-3002 Block 3, PCC port): a thin wrapper over the Block 0 `UserPreferenceStore<SavedFilter[]>`.
 * No `providedIn` — the page provides it so the store's `destroyRef`/`injector` scope to the page.
 */
@Injectable()
export class SavedFilterService {
  private readonly messageService = inject(MessageService);
  private readonly socialListeningService = inject(SocialListeningService);
  private readonly defaultPeriod = getDefaultMarketingImpactPeriod();
  private readonly deletingViewIdsSignal = signal<ReadonlySet<string>>(new Set());

  private readonly store = new UserPreferenceStore<SavedFilter[]>({
    transport: {
      get: (name) => this.socialListeningService.getPreference(name),
      put: (name, value) => this.socialListeningService.upsertPreference(name, value),
      delete: (name) => this.socialListeningService.deletePreference(name),
    },
    destroyRef: inject(DestroyRef),
    injector: inject(Injector),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
    preferenceName: (projectId) => socialListeningPreferenceName(SOCIAL_LISTENING_SAVED_FILTERS_PREFERENCE_PREFIX, projectId),
    initial: () => [],
    parse: (raw) => parseSavedFilters(raw),
    serialize: (filters) => JSON.stringify({ version: SAVED_FILTERS_DOC_VERSION, filters } satisfies SavedFiltersDoc),
    // Deleting the last view drops the preference row rather than persisting an empty doc.
    shouldDeleteOnEmpty: (filters) => filters.length === 0,
    onLoaded: (result) => {
      if (result?.readOnly) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Views temporarily unavailable',
          detail: 'Your saved views are temporarily unavailable. Saving is paused until they can be loaded safely.',
          sticky: true,
        });
      }
    },
    onLoadError: () => {
      this.messageService.add({
        severity: 'info',
        summary: 'Views temporarily unavailable',
        detail: "We couldn't load your saved views. Please try again later.",
      });
    },
    onContextChange: () => this.deletingViewIdsSignal.set(new Set()),
  });

  public readonly state = this.store.state;
  public readonly deletingViewIds: Signal<ReadonlySet<string>> = this.deletingViewIdsSignal.asReadonly();

  public setContext(ctx: PreferenceContext | null): void {
    this.store.setContext(ctx);
  }

  public addSavedFilter(name: string, predicate: FilterPredicate, scope: SavedViewScope, onPersistError?: () => void): SavedFilter | null {
    const { data: current, loading, readOnly, error } = this.store.state();
    if (loading) return null;

    // A failed load leaves an empty fallback list — writing from it would clobber the persisted views.
    if (error) {
      this.notifyUnavailable();
      return null;
    }

    if (readOnly) {
      this.warnReadOnly('Saving');
      return null;
    }

    if (current.length >= MAX_SAVED_FILTERS_PER_PROJECT) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Saved view limit reached',
        detail: `You can save up to ${MAX_SAVED_FILTERS_PER_PROJECT} views per project.`,
      });
      return null;
    }

    const trimmed = name.trim();
    if (!trimmed) return null;

    if (current.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Duplicate name',
        detail: `A view named "${trimmed}" already exists.`,
      });
      return null;
    }

    const newFilter: SavedFilter = {
      id: crypto.randomUUID(),
      name: trimmed,
      predicate: normalizePredicate(predicate),
      scope: normalizeViewScope(scope, this.defaultPeriod),
      createdAt: new Date().toISOString(),
    };

    this.store.commit({
      next: [...current, newFilter],
      // Re-derive at dequeue time: if an earlier queued save failed and rolled back, the eager snapshot would resurrect it.
      rebase: (latest) => [...latest.filter((f) => f.id !== newFilter.id), newFilter],
      // Targeted rollback: remove only this view so saves queued after this one survive.
      rollback: () => this.store.replace(this.store.state().data.filter((f) => f.id !== newFilter.id)),
      onSuccess: () => this.messageService.add({ severity: 'success', summary: 'View saved', detail: `Saved "${newFilter.name}"` }),
      onError: () => {
        onPersistError?.();
        this.messageService.add({ severity: 'error', summary: 'Failed to save view', detail: `Could not save "${newFilter.name}". Please try again.` });
      },
    });

    return newFilter;
  }

  public removeSavedFilter(id: string, onRemoved?: () => void): void {
    const { data: current, loading, readOnly, error } = this.store.state();
    if (loading) return;

    if (error) {
      this.notifyUnavailable();
      return;
    }

    if (readOnly) {
      this.warnReadOnly('Removing');
      return;
    }

    const removed = current.find((f) => f.id === id);
    if (!removed || this.deletingViewIdsSignal().has(id)) return;

    this.setDeletingViewId(id, true);
    this.store.commit({
      next: current.filter((f) => f.id !== id),
      // Re-derive at dequeue time: a queued delete computed before a sibling's success would resurrect that view.
      rebase: (latest) => latest.filter((f) => f.id !== id),
      // Non-optimistic: the row stays visible (with a spinner) until the write round-trips.
      optimistic: false,
      onSuccess: () => {
        this.setDeletingViewId(id, false);
        onRemoved?.();
        this.messageService.add({ severity: 'success', summary: 'View removed', detail: `Removed "${removed.name}"` });
      },
      onError: () => {
        this.setDeletingViewId(id, false);
        this.messageService.add({ severity: 'error', summary: 'Failed to remove view', detail: `Could not remove "${removed.name}". Please try again.` });
      },
    });
  }

  private setDeletingViewId(id: string, deleting: boolean): void {
    this.deletingViewIdsSignal.update((ids) => {
      const next = new Set(ids);
      if (deleting) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private notifyUnavailable(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Saved views unavailable',
      detail: 'Your saved views could not be loaded. Refresh the page and try again.',
    });
  }

  private warnReadOnly(verb: 'Saving' | 'Removing'): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Saved views are read-only',
      detail: `We could not load your saved views safely. ${verb} is disabled until reload.`,
    });
  }
}
