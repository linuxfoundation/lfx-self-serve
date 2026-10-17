// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
      restoreRevision: vi.fn(() => of({ ...detail, revision: revision(3, { latest: true, origin: 'restored', restoredFromNumber: 1 }) })),
    };
    activeContext = signal<ProjectContext | null>(PROJECT);

    await TestBed.configureTestingModule({
      imports: [MktgDocumentsComponent],
      providers: [
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
    expect(query('mktg-documents-revision-2')?.textContent).toContain('latest');
    expect(query('mktg-documents-restore-2')).toBeNull();
    expect(query('mktg-documents-revision-1')?.textContent).toContain('Generated by the Brand Kit Agent (stored before revisions existed)');
    expect(query('mktg-documents-view-1')).not.toBeNull();
  });

  it('restores an older revision and reloads the documents', async () => {
    await render();

    query('mktg-documents-restore-1')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', detail.revisions[1].id);
    expect(store.listDocuments).toHaveBeenCalledTimes(2);
    expect(query('mktg-documents-notice')?.textContent).toContain('Revision 1 restored as revision 3');
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
