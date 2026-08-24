// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_MENTION_PREDICATE, MAX_SAVED_FILTERS_PER_PROJECT, SAVED_FILTERS_DOC_VERSION } from '@lfx-one/shared/constants';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SavedFilterService } from './saved-filter.service';

import type { FilterPredicate, SavedFilter, SavedViewScope } from '@lfx-one/shared/interfaces';

describe('SavedFilterService', () => {
  const ctx = { userId: 'u1', projectId: 'p1' };
  const preferenceName = 'Social Listening Saved Filters - p1';

  const validScope: SavedViewScope = { period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' };

  let service: SavedFilterService;
  let socialListeningService: {
    getPreference: ReturnType<typeof vi.fn>;
    upsertPreference: ReturnType<typeof vi.fn>;
    deletePreference: ReturnType<typeof vi.fn>;
  };
  let messageService: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    socialListeningService = {
      getPreference: vi.fn().mockReturnValue(of(null)),
      upsertPreference: vi.fn().mockReturnValue(of(undefined)),
      deletePreference: vi.fn().mockReturnValue(of(undefined)),
    };
    messageService = { add: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        SavedFilterService,
        { provide: SocialListeningService, useValue: socialListeningService },
        { provide: MessageService, useValue: messageService },
      ],
    });

    service = TestBed.inject(SavedFilterService);
  });

  // Effects (toObservable) fire on tick; the promise-backed transport settles on the macrotask flush.
  async function flush(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function predicate(overrides: Partial<FilterPredicate> = {}): FilterPredicate {
    return { ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [], ...overrides };
  }

  function view(overrides: Partial<SavedFilter> = {}): SavedFilter {
    return { id: 'v1', name: 'Crisis', predicate: predicate(), scope: { ...validScope }, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
  }

  function storedDoc(filters: SavedFilter[]): string {
    return JSON.stringify({ version: SAVED_FILTERS_DOC_VERSION, filters });
  }

  it('loads the saved views under the PCC preference name for the context', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc([view()])));

    service.setContext(ctx);
    await flush();

    expect(socialListeningService.getPreference).toHaveBeenCalledWith(preferenceName);
    expect(service.state().data).toEqual([view()]);
    expect(service.state().loading).toBe(false);
    expect(service.state().readOnly).toBe(false);
  });

  it('parses a corrupt stored doc to read-only with a sticky warning', async () => {
    socialListeningService.getPreference.mockReturnValue(of('{not json'));

    service.setContext(ctx);
    await flush();

    expect(service.state().data).toEqual([]);
    expect(service.state().readOnly).toBe(true);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Views temporarily unavailable',
      detail: 'Your saved views are temporarily unavailable. Saving is paused until they can be loaded safely.',
      sticky: true,
    });
  });

  it('parses an unknown doc version to read-only so a newer doc is never clobbered', async () => {
    socialListeningService.getPreference.mockReturnValue(of(JSON.stringify({ version: SAVED_FILTERS_DOC_VERSION + 1, filters: [view()] })));

    service.setContext(ctx);
    await flush();

    expect(service.state().data).toEqual([]);
    expect(service.state().readOnly).toBe(true);
  });

  it('surfaces a load failure as an info toast and keeps the store empty', async () => {
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('boom')));

    service.setContext(ctx);
    await flush();

    expect(service.state().error).toBeTruthy();
    expect(service.state().data).toEqual([]);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'info',
      summary: 'Views temporarily unavailable',
      detail: "We couldn't load your saved views. Please try again later.",
    });
  });

  it('gates save and remove while the initial load is in flight', async () => {
    socialListeningService.getPreference.mockReturnValue(NEVER);
    service.setContext(ctx);
    TestBed.inject(ApplicationRef).tick();
    expect(service.state().loading).toBe(true);

    expect(service.addSavedFilter('Crisis', predicate(), validScope)).toBeNull();
    service.removeSavedFilter('v1');
    await flush();

    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(socialListeningService.deletePreference).not.toHaveBeenCalled();
  });

  it('short-circuits save and remove with a warn toast when the doc is read-only', async () => {
    socialListeningService.getPreference.mockReturnValue(of('{not json'));
    service.setContext(ctx);
    await flush();
    messageService.add.mockClear();

    expect(service.addSavedFilter('Crisis', predicate(), validScope)).toBeNull();
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Saved views are read-only',
      detail: 'We could not load your saved views safely. Saving is disabled until reload.',
    });

    service.removeSavedFilter('v1');
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Saved views are read-only',
      detail: 'We could not load your saved views safely. Removing is disabled until reload.',
    });
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
  });

  it('rejects a save at the per-project limit with a warn toast', async () => {
    const atCap = Array.from({ length: MAX_SAVED_FILTERS_PER_PROJECT }, (_, i) => view({ id: `v${i}`, name: `View ${i}` }));
    socialListeningService.getPreference.mockReturnValue(of(storedDoc(atCap)));
    service.setContext(ctx);
    await flush();

    expect(service.addSavedFilter('One more', predicate(), validScope)).toBeNull();
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Saved view limit reached',
      detail: `You can save up to ${MAX_SAVED_FILTERS_PER_PROJECT} views per project.`,
    });
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
  });

  it('rejects a blank name without writing or toasting', async () => {
    service.setContext(ctx);
    await flush();

    expect(service.addSavedFilter('   ', predicate(), validScope)).toBeNull();
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(messageService.add).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name case-insensitively', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc([view({ name: 'Crisis' })])));
    service.setContext(ctx);
    await flush();

    expect(service.addSavedFilter('  crisis ', predicate(), validScope)).toBeNull();
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'warn', summary: 'Duplicate name', detail: 'A view named "crisis" already exists.' });
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
  });

  it('saves optimistically: state updates before the write lands, then PUTs the versioned doc', async () => {
    service.setContext(ctx);
    await flush();

    const created = service.addSavedFilter('  Crisis  ', predicate({ sentiment: 'negative' }), validScope);

    expect(created).not.toBeNull();
    expect(created?.name).toBe('Crisis');
    expect(created?.id).toBeTruthy();
    expect(created?.predicate).toEqual(predicate({ sentiment: 'negative' }));
    expect(created?.scope).toEqual(validScope);
    // Optimistic: the view is in state before the write round-trips.
    expect(service.state().data).toEqual([created]);

    await flush();
    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(
      preferenceName,
      JSON.stringify({ version: SAVED_FILTERS_DOC_VERSION, filters: [created] })
    );
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'success', summary: 'View saved', detail: 'Saved "Crisis"' });
  });

  it('rolls back an optimistic save when the write fails', async () => {
    service.setContext(ctx);
    await flush();

    // The store reconciles a failed write with a re-GET — both must fail for onError to fire.
    socialListeningService.upsertPreference.mockReturnValue(throwError(() => new Error('write lost')));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.addSavedFilter('Crisis', predicate(), validScope);
    expect(service.state().data).toHaveLength(1);

    await flush();

    expect(service.state().data).toEqual([]);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Failed to save view',
      detail: 'Could not save "Crisis". Please try again.',
    });
  });

  it('deletes non-optimistically: the row stays until the write lands, with a per-row spinner lifecycle', async () => {
    const viewA = view({ id: 'a', name: 'A' });
    const viewB = view({ id: 'b', name: 'B' });
    const write = new Subject<void>();
    socialListeningService.getPreference.mockReturnValue(of(storedDoc([viewA, viewB])));
    socialListeningService.upsertPreference.mockReturnValue(write.asObservable());
    service.setContext(ctx);
    await flush();

    let removed = false;
    service.removeSavedFilter('a', () => (removed = true));

    // Non-optimistic: the row is still in state; only the spinner set changed.
    expect(service.state().data.map((f) => f.id)).toEqual(['a', 'b']);
    expect(service.deletingViewIds().has('a')).toBe(true);

    write.next(undefined);
    await flush();

    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, storedDoc([viewB]));
    expect(service.state().data.map((f) => f.id)).toEqual(['b']);
    expect(service.deletingViewIds().has('a')).toBe(false);
    expect(removed).toBe(true);
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'success', summary: 'View removed', detail: 'Removed "A"' });
  });

  it('ignores a repeated delete for a view already being removed', async () => {
    const write = new Subject<void>();
    socialListeningService.getPreference.mockReturnValue(of(storedDoc([view({ id: 'a' }), view({ id: 'b', name: 'B' })])));
    socialListeningService.upsertPreference.mockReturnValue(write.asObservable());
    service.setContext(ctx);
    await flush();

    service.removeSavedFilter('a');
    service.removeSavedFilter('a');

    expect(socialListeningService.upsertPreference).toHaveBeenCalledTimes(1);
  });

  it('DELETEs the preference row when the last view is removed', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc([view({ id: 'a' })])));
    service.setContext(ctx);
    await flush();

    service.removeSavedFilter('a');
    await flush();

    expect(socialListeningService.deletePreference).toHaveBeenCalledWith(preferenceName);
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(service.state().data).toEqual([]);
  });

  it('clears the deleting set when the context changes', async () => {
    const write = new Subject<void>();
    socialListeningService.getPreference.mockReturnValue(of(storedDoc([view({ id: 'a' })])));
    socialListeningService.upsertPreference.mockReturnValue(write.asObservable());
    service.setContext(ctx);
    await flush();

    service.removeSavedFilter('a');
    expect(service.deletingViewIds().has('a')).toBe(true);

    service.setContext({ userId: 'u1', projectId: 'p2' });
    await flush();

    expect(service.deletingViewIds().size).toBe(0);
  });
});
