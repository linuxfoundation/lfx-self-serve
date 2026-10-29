// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgDocumentListItem, MktgDocumentRunProgress, ProjectContext } from '@lfx-one/shared/interfaces';
import { resolveMktgFamilyRun } from '@lfx-one/shared/utils';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectContextService } from './project-context.service';
import { MktgKitService } from './mktg-kit.service';
import { UserService } from './user.service';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';

describe('MktgKitService project-scoped reads', () => {
  const context = signal<ProjectContext | null>(null);
  const user = signal({ sub: 'synthetic-writer' });
  let reads: Subject<MktgDocumentsResponse>[];
  let listDocuments: ReturnType<typeof vi.fn>;
  const empty = (project: string): MktgDocumentsResponse => ({ project, groups: MKTG_DOCUMENT_TYPES.map((type) => ({ type, documents: [] })) });
  beforeEach(() => {
    context.set(null);
    user.set({ sub: 'synthetic-writer' });
    reads = [];
    listDocuments = vi.fn(() => {
      const read = new Subject<MktgDocumentsResponse>();
      reads.push(read);
      return read;
    });
    TestBed.configureTestingModule({
      providers: [
        MktgKitService,
        { provide: UserService, useValue: { user } },
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
  it('keeps same-scope documents during retry and transient failure, but clears them on denied access or subject change', () => {
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    const known = empty('one');
    reads[0].next(known);
    kit.retry();
    TestBed.tick();
    expect(kit.loading()).toBe(true);
    expect(kit.documents()).toBe(known);
    reads[1].error(new HttpErrorResponse({ status: 503 }));
    expect(kit.documents()).toBe(known);
    expect(kit.error()).toContain('could not be loaded');
    kit.retry();
    TestBed.tick();
    reads[2].error(new HttpErrorResponse({ status: 403 }));
    expect(kit.documents()).toBeNull();
    kit.retry();
    TestBed.tick();
    reads[3].next(known);
    user.set({ sub: 'other-synthetic-writer' });
    TestBed.tick();
    expect(kit.documents()).toBeNull();
    expect(kit.loading()).toBe(true);
    reads[3].next(known);
    expect(kit.documents()).toBeNull();
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

  it.each(['writing', 'questions'] as const)('keeps missing same-project %s overlays on partial responses until a complete listing replaces them', (state) => {
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    const run: MktgDocumentRunProgress = {
      project: 'one',
      agentKey: 'foundation-message',
      documentId: 'living',
      runId: 'a'.repeat(64),
      state,
      startedAt: '2026-10-29T10:00:00Z',
    };
    reads[0].next({ ...empty('one'), runs: [run] });
    reads[0].complete();
    const overlay = resolveMktgFamilyRun(run.agentKey, kit.documents()?.runs, []);
    expect(overlay).not.toBeNull();
    kit.refresh(true).subscribe();
    reads[1].next({ ...empty('one'), progressUnavailable: true });
    reads[1].complete();
    expect(kit.documents()?.runs).toEqual([run]);
    expect(resolveMktgFamilyRun(run.agentKey, kit.documents()?.runs, [])).toEqual(overlay);
    expect(kit.loading()).toBe(false);
    const updated = { ...run, state: 'failed' as const };
    kit.refresh(true).subscribe();
    reads[2].next({ ...empty('one'), progressUnavailable: true, runs: [updated] });
    reads[2].complete();
    expect(kit.documents()?.runs).toEqual([updated]); // Returned rows win by run ID.
    kit.refresh(true).subscribe();
    const complete = empty('one');
    reads[3].next(complete);
    reads[3].complete();
    expect(kit.documents()).toBe(complete);
    expect(resolveMktgFamilyRun(run.agentKey, kit.documents()?.runs, [])).toBeNull();
  });

  it('does not carry retained run rows into a partial response for another project', () => {
    const { kit } = loadedKit();
    kit.documents.set({
      ...empty('one'),
      runs: [
        { project: 'one', agentKey: 'foundation-message', documentId: 'living', runId: 'a'.repeat(64), state: 'writing', startedAt: '2026-10-29T10:00:00Z' },
      ],
    });
    context.set({ uid: 'two', slug: 'two', name: 'Synthetic Two' });
    TestBed.tick();
    const partial = { ...empty('two'), progressUnavailable: true, runs: [] };
    reads[1].next(partial);
    reads[1].complete();
    expect(kit.documents()).toBe(partial);
    expect(kit.documents()?.runs).toEqual([]);
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

  it('shares in-flight reads only within the same project and poll mode', () => {
    const { kit } = loadedKit();
    kit.refresh(true).subscribe();
    kit.refresh(true).subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(listDocuments).toHaveBeenLastCalledWith('one', true);
    kit.refresh(false).subscribe();
    kit.refresh(false).subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(3);
    expect(listDocuments).toHaveBeenLastCalledWith('one', false);
    expect(reads[1].observed).toBe(true);
    expect(reads[2].observed).toBe(true);
    reads[1].next(empty('one'));
    reads[1].complete();
    kit.refresh(false).subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(3); // Completing poll=true cannot release the discovery key.
    reads[2].next(empty('one'));
    reads[2].complete();
    kit.refresh(true).subscribe();
    expect(listDocuments).toHaveBeenCalledTimes(4);
  });

  it('keeps polling after retry cancels an in-flight refresh without needing a focus event', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { kit } = loadedKit();
    const poll = createVisibilityPoll(document, (poll) => kit.refresh(poll), {
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
    expect(listDocuments).toHaveBeenLastCalledWith('two', false);
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
