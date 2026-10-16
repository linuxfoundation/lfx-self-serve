// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgDocumentDetailResponse, MktgDocumentsResponse, MktgDocumentType, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDocumentsComponent } from './mktg-documents.component';

describe('MktgDocumentsComponent', () => {
  const PROJECT: ProjectContext = { uid: 'proj-1', name: 'TestOrbit', slug: 'testorbit' };
  const BRAND_KIT = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'brand-kit') as MktgDocumentType;

  function revision(number: number, overrides: Partial<MktgRevisionSummary> = {}): MktgRevisionSummary {
    return {
      id: `00000${number}-${String(number).repeat(64)}`,
      number,
      createdAt: '2026-10-13T12:02:00.000Z',
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: 'Draft — for review',
      contentSha256: 'a'.repeat(64),
      format: 'markdown',
      commentCount: 0,
      latest: false,
      author: null,
      ...overrides,
    };
  }

  const detail: MktgDocumentDetailResponse = {
    project: PROJECT.uid,
    type: BRAND_KIT,
    documentId: 'living',
    revisions: [revision(2, { latest: true }), revision(1, { origin: 'legacy' })],
  };

  function documentsResponse(): MktgDocumentsResponse {
    return {
      project: PROJECT.uid,
      groups: MKTG_DOCUMENT_TYPES.map((type) => ({
        type,
        documents:
          type.agentKey === 'brand-kit'
            ? [{ agentKey: 'brand-kit', documentId: 'living', revisionCount: 2, latestRevisionId: detail.revisions[0].id, updatedAt: null, createdAt: null }]
            : [],
      })),
    };
  }

  let fixture: ComponentFixture<MktgDocumentsComponent>;
  let activeContext: ReturnType<typeof signal<ProjectContext | null>>;
  let store: { listDocuments: ReturnType<typeof vi.fn>; getDocument: ReturnType<typeof vi.fn>; restoreRevision: ReturnType<typeof vi.fn> };

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function render(url = '/'): Promise<void> {
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(MktgDocumentsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    store = {
      listDocuments: vi.fn(() => of(documentsResponse())),
      getDocument: vi.fn(() => of(detail)),
      restoreRevision: vi.fn(() => of({ ...detail, revisions: [revision(2), revision(1, { latest: true })], revision: revision(1, { latest: true }) })),
    };
    activeContext = signal<ProjectContext | null>(PROJECT);

    await TestBed.configureTestingModule({
      imports: [MktgDocumentsComponent],
      providers: [
        { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } },
        provideRouter([{ path: '**', children: [] }]),
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: MktgDocumentStoreService, useValue: store },
      ],
    }).compileComponents();
  });

  it('lists the living documents in run order with their revision state, and the runs', async () => {
    await render();

    expect(query('mktg-documents-nav-brand-kit')?.textContent).toContain('1 · Brand Kit');
    expect(query('mktg-documents-nav-brand-kit')?.textContent).toContain('v2 · current');
    expect(query('mktg-documents-nav-foundation-message')?.textContent).toContain('Not generated yet');
    expect(query('mktg-documents-nav-linkedin-post')?.textContent).toContain('No runs yet');
  });

  it('asserts no absence in the nav while the documents list is still loading', async () => {
    store.listDocuments.mockReturnValue(NEVER);
    await render();

    expect(query('mktg-documents-nav')?.textContent).not.toContain('Not generated yet');
    expect(query('mktg-documents-nav')?.textContent).not.toContain('No runs yet');
    expect(query('mktg-documents-nav')?.textContent).not.toContain('current');
  });

  it('hides the previous project’s documents and badges while the next project’s list loads', async () => {
    await render();
    expect(query('mktg-documents-nav-brand-kit')?.textContent).toContain('v2 · current');

    store.listDocuments.mockReturnValue(NEVER);
    activeContext.set({ uid: 'proj-2', name: 'OtherOrbit', slug: 'otherorbit' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.listDocuments).toHaveBeenLastCalledWith('proj-2');
    expect(query('mktg-documents-nav')?.textContent).not.toContain('current');
    expect(query('mktg-documents-nav')?.textContent).not.toContain('Not generated yet');
    expect(query('mktg-documents-nav')?.textContent).not.toContain('No runs yet');
    expect(query('mktg-documents-loading')).not.toBeNull();
    expect(query('mktg-documents-document-subtitle')).toBeNull();
    expect(query('mktg-documents-revision-2')).toBeNull();
  });

  it('shows the selected document’s Revisions table: latest first, View and Restore on older revisions', async () => {
    await render();

    expect(store.getDocument).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living');
    expect(query('mktg-documents-document-subtitle')?.textContent).toContain('Brand Kit Agent · revision 2 of 2');
    const table = query('mktg-documents-revisions');
    const scroller = query('mktg-documents-revisions-scroll');
    expect(scroller?.classList.contains('relative')).toBe(true);
    expect(scroller?.contains(table)).toBe(true);
    expect(table?.textContent).toContain('Actions');
    for (const token of ['min-w-[640px]', '@[800px]:min-w-0', '@[800px]:table-fixed']) {
      expect(table?.classList.contains(token)).toBe(true);
    }
    expect(query('mktg-documents-revision-2')?.textContent).toContain('Current');
    expect(query('mktg-documents-revision-when-2')?.textContent).not.toContain('Current');
    expect(query('mktg-documents-revision-how-2')?.textContent).toContain('generated from the form');
    expect(query('mktg-documents-revision-actions-2')?.querySelector('[data-testid="mktg-documents-current-2"]')?.textContent).toBe('Current');
    const currentBadge = query('mktg-documents-current-2');
    for (const token of ['bg-blue-700', 'text-white', 'font-bold', 'rounded-full', 'text-[12px]']) {
      expect(currentBadge?.classList.contains(token)).toBe(true);
    }
    expect(query('mktg-documents-restore-2')).toBeNull();
    expect(query('mktg-documents-revision-1')?.textContent).toContain('generated by the Brand Kit Agent (stored before revisions existed)');
    expect(query('mktg-documents-view-1')).not.toBeNull();
  });

  it('makes an older revision current without changing the revision count', async () => {
    await render();

    query('mktg-documents-restore-1')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', detail.revisions[1].id);
    expect(store.listDocuments).toHaveBeenCalledTimes(1);
    expect(query('mktg-documents-notice')?.textContent).toContain('Revision 1 is now current. No revision was added.');
    expect(query('mktg-documents-nav-brand-kit')?.textContent).toContain('v1 · current');
    expect(query('mktg-documents-document-subtitle')?.textContent).toContain('revision 1 of 2');
  });

  it.each(['The writer', ''])('shows stored name %j or its LFID, without labelling an existing author as historical', async (name) => {
    store.getDocument.mockReturnValue(
      of({
        ...detail,
        revisions: [
          revision(3, { latest: true, origin: 'revised', commentCount: 4, basedOnNumber: 1, author: { username: 'synthetic-writer', name } }),
          ...detail.revisions.map((entry) => ({ ...entry, latest: false })),
        ],
      })
    );
    await render();
    expect(query('mktg-documents-revision-when-3')?.textContent).not.toMatch(/ {2}/);
    expect(query('mktg-documents-revision-how-3')?.textContent).toBe(`revised from 4 comments · based on v1 · ${name || 'synthetic-writer'}`);
    const row = query('mktg-documents-revision-3')?.textContent?.replace(/\s+/g, ' ');
    expect(row).toMatch(/v3.*13 Oct.*revised from 4 comments · based on v1.*Current/);
    expect(row).toContain(`revised from 4 comments · based on v1 · ${name || 'synthetic-writer'}`);
    expect(row).not.toContain('stored before names were recorded');
    expect(query('mktg-documents-revision-1')?.textContent).toContain('no name (stored before names were recorded)');
  });

  it('clears the success notice when another project is opened', async () => {
    await render();
    query('mktg-documents-restore-1')?.click();
    await fixture.whenStable();
    activeContext.set({ uid: 'proj-2', name: 'OtherOrbit', slug: 'otherorbit' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(query('mktg-documents-notice')).toBeNull();
  });

  it('shows a run type’s runs, or says there are none yet', async () => {
    await render('/?type=linkedin-post');

    expect(query('mktg-documents-empty-runs')?.textContent).toContain('a new run is a new document');
  });

  it('shows only the error when the documents list cannot be read, never an empty state', async () => {
    store.listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render();

    expect(query('mktg-documents-error')?.textContent).toContain('The documents could not be loaded');
    expect(query('mktg-documents-list-failed')).not.toBeNull();
    expect(query('mktg-documents-empty-living')).toBeNull();
    expect(query('mktg-documents-empty-runs')).toBeNull();
    expect(query('mktg-documents-nav')?.textContent).not.toContain('Not generated yet');
    expect(query('mktg-documents-nav')?.textContent).not.toContain('No runs yet');
    expect(store.getDocument).not.toHaveBeenCalled();
  });

  it('shows only the access error on a 403 list read, never an empty state', async () => {
    store.listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await render('/?type=linkedin-post');

    expect(query('mktg-documents-error')?.textContent).toContain('You need write access');
    expect(query('mktg-documents-empty-runs')).toBeNull();
    expect(query('mktg-documents-nav')?.textContent).not.toContain('No runs yet');
  });
});
