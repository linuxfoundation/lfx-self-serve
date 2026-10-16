// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgDocumentDetailResponse, MktgDocumentType, MktgRevisionResponse, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDocumentViewComponent } from './mktg-document-view.component';

describe('MktgDocumentViewComponent', () => {
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
      contentSha256: String(number).repeat(64),
      commentCount: 0,
      latest: false,
      author: null,
      ...overrides,
    };
  }

  const LATEST = revision(2, { latest: true });
  const OLDER = revision(1, { origin: 'legacy' });
  const RESTORED = { ...OLDER, latest: true };
  const detail: MktgDocumentDetailResponse = { project: PROJECT.uid, type: BRAND_KIT, documentId: 'living', revisions: [LATEST, OLDER] };

  function revisionResponse(current: MktgRevisionSummary): MktgRevisionResponse {
    return { ...detail, revision: current, markdown: `# Revision ${current.number}\n` };
  }

  let harness: RouterTestingHarness;
  let store: {
    getDocument: ReturnType<typeof vi.fn>;
    getRevision: ReturnType<typeof vi.fn>;
    restoreRevision: ReturnType<typeof vi.fn>;
  };

  function query(testId: string): HTMLElement | null {
    return harness.routeNativeElement?.querySelector(`[data-testid="${testId}"]`) ?? null;
  }

  async function render(url: string): Promise<void> {
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, MktgDocumentViewComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  beforeEach(async () => {
    store = {
      getDocument: vi.fn(() => of(detail)),
      getRevision: vi.fn((_project: string, _agentKey: string, _documentId: string, revisionId: string) =>
        of(revisionResponse([LATEST, OLDER, RESTORED].find((candidate) => candidate.id === revisionId) ?? LATEST))
      ),
      restoreRevision: vi.fn(() =>
        of({
          ...detail,
          revisions: [{ ...LATEST, latest: false }, RESTORED],
          revision: RESTORED,
          current: { revisionId: RESTORED.id, changedAt: '2026-10-15T13:00:00.000Z', changedBy: { username: 'synthetic-selector', name: 'The selector' } },
        })
      ),
    };
    const activeContext = signal<ProjectContext | null>(PROJECT);

    await TestBed.configureTestingModule({
      providers: [
        { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } },
        provideRouter([
          { path: 'documents/:agentKey/:documentId', component: MktgDocumentViewComponent },
          ...['project/mktg-os-agents', 'foundation/mktg-os-agents'].map((path) => ({
            path,
            children: [{ path: 'documents/:agentKey/:documentId', component: MktgDocumentViewComponent }],
          })),
        ]),
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: MktgDocumentStoreService, useValue: store },
      ],
    }).compileComponents();
  });

  it('opens the latest revision when no revision is asked for', async () => {
    await render('/documents/brand-kit/living');

    expect(store.getDocument).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living');
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', LATEST.id);
    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Brand Kit');
    expect(harness.routeNativeElement?.querySelectorAll('h1')).toHaveLength(1);
    expect(query('mktg-document-view-document')?.querySelector('h2')?.textContent).toBe('Revision 2');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 2 of 2');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Current');
    expect(query('mktg-document-view-revision-label-2')?.textContent).toContain('generated from the form');
    const currentBadge = query('mktg-document-view-current-2');
    for (const token of ['bg-blue-700', 'text-white', 'font-bold', 'rounded-full', 'text-[12px]']) {
      expect(currentBadge?.classList.contains(token)).toBe(true);
    }
    expect(query('mktg-document-view-restore-current')).toBeNull();
    expect(query('mktg-document-view-current-since-2')).toBeNull();
    expect(query('mktg-document-view-back-link')?.getAttribute('href')).toMatch(/^\/documents\?/);
  });

  it.each(['/project/mktg-os-agents', '/foundation/mktg-os-agents'])('keeps the Documents back link in its %s host', async (host) => {
    await render(`${host}/documents/brand-kit/living`);
    expect(query('mktg-document-view-back-link')?.getAttribute('href')).toBe(`${host}/documents?type=brand-kit`);
  });

  it.each([
    { name: 'The writer', latest: true },
    { name: '', latest: true },
    { name: 'The writer', latest: false },
    { name: '', latest: false },
  ])('renders exact revision spacing and attribution for %j', async ({ name, latest }) => {
    const current = { ...LATEST, latest, origin: 'revised' as const, commentCount: 1, author: { username: 'synthetic-writer', name } };
    store.getRevision.mockReturnValue(of({ ...detail, revisions: [current, { ...OLDER, latest: !latest }], revision: current, markdown: '# Current' }));
    await render('/documents/brand-kit/living');
    const row = query('mktg-document-view-revision-label-2')?.textContent;
    expect(row).toBe(`v2 · 13 Oct${latest ? ' · Current' : ''} · revised from 1 comment · ${name || 'synthetic-writer'}`);
    expect(row).not.toContain('stored before names were recorded');
    expect(query('mktg-document-view-revision-1')?.textContent).toContain('no name (stored before names were recorded)');
  });

  it.each([
    { name: 'The selector', opened: LATEST },
    { name: '', opened: LATEST },
    { name: 'The selector', opened: OLDER },
  ])('shows current selection attribution independently of the open revision: %j', async ({ name, opened }) => {
    store.getRevision.mockReturnValue(
      of({
        ...revisionResponse(opened),
        current: {
          revisionId: LATEST.id,
          changedAt: '2026-10-14T12:00:00.000Z',
          changedBy: { username: 'synthetic-selector', name },
        },
      })
    );
    await render(`/documents/brand-kit/living?revision=${opened.id}`);
    const since = query('mktg-document-view-current-since-2')?.textContent;
    expect(since).toMatch(/^Current since 14 Oct 2026, \d{2}:\d{2} · /);
    expect(since).toContain(name || 'synthetic-selector');
    expect(query('mktg-document-view-current-since-1')).toBeNull();
  });

  it('opens the revision in ?revision= and offers to restore it', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    expect(store.getDocument).not.toHaveBeenCalled();
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1 of 2');
    expect(query('mktg-document-view-restore-current')?.textContent).toContain('Make revision 1 current');
    expect(query('mktg-document-view-restore-current')?.classList.contains('bg-white')).toBe(true);
    expect(query('mktg-document-view-restore-current')?.classList.contains('border')).toBe(true);
    expect(query('mktg-document-view-hash')?.classList.contains('relative')).toBe(true);
    expect(query('mktg-document-view-hash')?.textContent).toContain(OLDER.contentSha256);
  });

  it('says the document has no such revision on a 404', async () => {
    store.getRevision.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render('/documents/brand-kit/living?revision=legacy-' + 'f'.repeat(64));

    expect(query('mktg-document-view-error')?.textContent).toContain('This document has no such revision.');
    expect(query('mktg-document-view-document')).toBeNull();
  });

  it('asks for write access on a 403', async () => {
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    await render('/documents/icp/living');

    expect(query('mktg-document-view-error')?.textContent).toContain('You need write access to this project');
    expect(store.getRevision).not.toHaveBeenCalled();
  });

  it('makes the open revision current without adding one', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-restore-current')?.click();
    await settle();

    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(TestBed.inject(Router).url).toContain(`revision=${OLDER.id}`);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1 of 2');
    expect(query('mktg-document-view-notice')?.textContent).toContain('Revision 1 is now current. No revision was added.');
    expect(query('mktg-document-view-current-since-1')?.textContent).toMatch(/^Current since 15 Oct 2026, \d{2}:\d{2} · The selector$/);
    expect(query('mktg-document-view-current-since-2')).toBeNull();
    await harness.navigateByUrl(`/documents/brand-kit/living?revision=${LATEST.id}`);
    await settle();
    expect(query('mktg-document-view-notice')).toBeNull();
  });

  it('keeps an in-flight write subscribed when the page is destroyed', async () => {
    const pending = new Subject<unknown>();
    store.restoreRevision.mockReturnValue(pending);
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);
    query('mktg-document-view-restore-current')?.click();
    expect(pending.observed).toBe(true);
    harness.fixture.destroy();
    expect(pending.observed).toBe(true);
    pending.next({ ...detail, revision: RESTORED });
    pending.complete();
  });

  it('distinguishes a missing document from a missing revision', async () => {
    store.getDocument.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'MKTG_DOCUMENT_NOT_FOUND' } })));
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-error')?.textContent).toContain('This document could not be found.');
  });

  it('keeps the revision and lets the user retry when a restore fails', async () => {
    store.restoreRevision.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-restore-current')?.click();
    await settle();

    expect(query('mktg-document-view-error')?.textContent).toContain('The revision could not be made current. Reload to check its state, then try again.');
    expect(TestBed.inject(Router).url).toContain(`revision=${OLDER.id}`);
    expect((query('mktg-document-view-restore-current') as HTMLButtonElement | null)?.disabled).toBe(false);
  });
});
