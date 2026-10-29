// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgDocumentListItem, ProjectContext } from '@lfx-one/shared/interfaces';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectContextService } from './project-context.service';
import { MktgKitService } from './mktg-kit.service';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';

describe('MktgKitService project-scoped reads', () => {
  const context = signal<ProjectContext | null>(null);
  let reads: Subject<MktgDocumentsResponse>[];
  let listDocuments: ReturnType<typeof vi.fn>;
  const empty = (project: string): MktgDocumentsResponse => ({ project, groups: MKTG_DOCUMENT_TYPES.map((type) => ({ type, documents: [] })) });
  beforeEach(() => {
    context.set(null);
    reads = [];
    listDocuments = vi.fn(() => {
      const read = new Subject<MktgDocumentsResponse>();
      reads.push(read);
      return read;
    });
    TestBed.configureTestingModule({
      providers: [
        MktgKitService,
        { provide: ProjectContextService, useValue: { activeContext: context } },
        { provide: MktgDocumentStoreService, useValue: { listDocuments } },
      ],
    });
  });
  it('reads only after context resolves and clears/cancels old data on project switches and deselection', () => {
    const kit = TestBed.inject(MktgKitService);
    TestBed.tick();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(kit.loading()).toBe(true);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    expect(kit.loading()).toBe(true);
    expect(kit.projectQueryParams()).toEqual({ project: 'one' });
    context.set({ uid: 'two', slug: 'two', name: 'Synthetic Two' });
    TestBed.tick();
    expect(kit.projectQueryParams()).toEqual({ project: 'two' });
    reads[0].next(empty('one'));
    expect(kit.documents()).toBeNull();
    reads[1].next(empty('two'));
    expect(kit.documents()?.project).toBe('two');
    expect(kit.loading()).toBe(false);
    expect(kit.families()).toHaveLength(9);
    context.set(null);
    TestBed.tick();
    expect(kit.documents()).toBeNull();
    expect(kit.families()).toEqual([]);
    expect(kit.projectQueryParams()).toEqual({ project: null });
    expect(kit.loading()).toBe(false);
  });
  it('keeps failures distinct from absence, permits retries and distinguishes 403', () => {
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    reads[0].error(new HttpErrorResponse({ status: 500 }));
    expect(kit.error()).toContain('could not be loaded');
    expect(kit.accessDenied()).toBe(false);
    expect(kit.documents()).toBeNull();
    kit.retry();
    TestBed.tick();
    expect(kit.error()).toBe('');
    reads[1].error(new HttpErrorResponse({ status: 403 }));
    expect(kit.error()).toContain('write access');
    expect(kit.accessDenied()).toBe(true);
    expect(kit.families()).toEqual([]);
    kit.retry();
    TestBed.tick();
    expect(kit.accessDenied()).toBe(false);
    reads[2].next(empty('one'));
    expect(kit.error()).toBe('');
    expect(kit.summary().inKit).toBe(0);
  });
  it('passes listing approval metadata through unchanged without casts or manufacturing approval', () => {
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    const document: MktgDocumentListItem = {
      agentKey: 'foundation-message',
      documentId: 'living',
      revisionCount: 3,
      latestRevisionId: '000003-' + 'a'.repeat(64),
      updatedAt: null,
      createdAt: null,
      approvedCurrent: { revisionId: 'approved-v2', number: 2 },
    };
    const listing = empty('one');
    listing.groups = listing.groups.map((group) => ({ ...group, documents: group.type.agentKey === document.agentKey ? [document] : [] }));
    reads[0].next(listing);
    expect(kit.documents()).toBe(listing);
    expect(kit.families()[0].rows[0].document).toBe(document);
    expect(kit.families()[0].rows[0].state).toBe('approved');
    expect(kit.summary()).toEqual({ level: null, coreFloor: 1, inKit: 1 });
  });
  function loadedKit() {
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    const listing = empty('one');
    reads[0].next(listing);
    reads[0].complete();
    return { kit, listing };
  }

  it('keeps the mounted listing and loading state until a silent refresh succeeds', () => {
    const { kit, listing } = loadedKit();
    const families = kit.families();
    kit.refresh().subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(kit.documents()).toBe(listing);
    expect(kit.families()).toBe(families);
    expect(kit.loading()).toBe(false);
    expect(kit.error()).toBe('');
    const next = empty('one');
    reads[1].next(next);
    reads[1].complete();
    expect(kit.documents()).toBe(next);
    expect(kit.loading()).toBe(false);
  });

  it('keeps the last good listing without a notice on refresh error and can re-read later', () => {
    const { kit, listing } = loadedKit();
    kit.refresh().subscribe();
    reads[1].error(new HttpErrorResponse({ status: 503 }));
    expect(kit.documents()).toBe(listing);
    expect(kit.error()).toBe('');
    expect(kit.loading()).toBe(false);
    kit.refresh().subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight request across refresh callers and the initial reader', () => {
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    const first = kit.refresh();
    const second = kit.refresh();
    expect(listDocuments).toHaveBeenCalledTimes(1);
    const seen = vi.fn();
    first.subscribe(seen);
    second.subscribe(seen);
    expect(listDocuments).toHaveBeenCalledTimes(1);
    const listing = empty('one');
    reads[0].next(listing);
    reads[0].complete();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(kit.documents()).toBe(listing);
    kit.refresh().subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after retry cancels an in-flight refresh without needing a focus event', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { kit } = loadedKit();
    const poll = createVisibilityPoll(document, () => kit.refresh(), {
      intervalMs: MKTG_RUN_POLL.intervalMs,
      backoffBaseMs: MKTG_RUN_POLL.intervalMs,
      backoffMaxMs: MKTG_RUN_POLL.intervalMs,
      shouldContinue: () => !kit.accessDenied() && !kit.refreshDenied(),
    }).subscribe();
    try {
      expect(listDocuments).toHaveBeenCalledTimes(2);
      expect(reads[1].observed).toBe(true);
      kit.retry();
      TestBed.tick();
      expect(reads[1].observed).toBe(false);
      expect(listDocuments).toHaveBeenCalledTimes(3);
      const reloaded = empty('one');
      reads[2].next(reloaded);
      reads[2].complete();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(listDocuments).toHaveBeenCalledTimes(4);
      expect(kit.documents()).toBe(reloaded);
      expect(kit.loading()).toBe(false);
      const next = empty('one');
      reads[3].next(next);
      reads[3].complete();
      expect(kit.documents()).toBe(next);
    } finally {
      poll.unsubscribe();
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('chooses the current project at subscription, not when a refresh observable was obtained', () => {
    const { kit } = loadedKit();
    const delayed = kit.refresh();
    expect(listDocuments).toHaveBeenCalledTimes(1);
    context.set({ uid: 'two', slug: 'two', name: 'Synthetic Two' });
    TestBed.tick();
    delayed.subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(listDocuments).toHaveBeenLastCalledWith('two');
    reads[1].next(empty('two'));
    reads[1].complete();
    expect(kit.documents()?.project).toBe('two');
  });

  it('cancels a shared background read on project change and ignores its late result', () => {
    const { kit } = loadedKit();
    kit.refresh().subscribe();
    expect(reads[1].observed).toBe(true);
    context.set({ uid: 'two', slug: 'two', name: 'Synthetic Two' });
    TestBed.tick();
    expect(reads[1].observed).toBe(false);
    reads[1].next(empty('one'));
    expect(kit.documents()).toBeNull();
    reads[2].next(empty('two'));
    reads[2].complete();
    expect(kit.documents()?.project).toBe('two');
  });

  it('stops after a refresh 403 without changing the last good UI, and resets on a new project', () => {
    const { kit, listing } = loadedKit();
    kit.refresh().subscribe();
    reads[1].error(new HttpErrorResponse({ status: 403 }));
    expect(kit.documents()).toBe(listing);
    expect(kit.error()).toBe('');
    expect(kit.loading()).toBe(false);
    expect(kit.accessDenied()).toBe(false);
    expect(kit.refreshDenied()).toBe(true);
    kit.refresh().subscribe();
    kit.refresh().subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(2);
    context.set({ uid: 'two', slug: 'two', name: 'Synthetic Two' });
    TestBed.tick();
    expect(kit.refreshDenied()).toBe(false);
    expect(listDocuments).toHaveBeenCalledTimes(3);
  });

  it('does not read without a project, including explicit refresh', () => {
    const kit = TestBed.inject(MktgKitService);
    TestBed.tick();
    kit.refresh().subscribe();
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('does not read the store during SSR', () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    kit.refresh().subscribe();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(kit.documents()).toBeNull();
    expect(kit.loading()).toBe(true);
  });
});
