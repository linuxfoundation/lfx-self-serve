// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgDocumentListItem, ProjectContext } from '@lfx-one/shared/interfaces';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectContextService } from './project-context.service';
import { MktgKitService } from './mktg-kit.service';

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
    expect(kit.families()).toHaveLength(4);
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
  it('does not read the store during SSR', () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const kit = TestBed.inject(MktgKitService);
    context.set({ uid: 'one', slug: 'one', name: 'Synthetic One' });
    TestBed.tick();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(kit.documents()).toBeNull();
    expect(kit.loading()).toBe(true);
  });
});
