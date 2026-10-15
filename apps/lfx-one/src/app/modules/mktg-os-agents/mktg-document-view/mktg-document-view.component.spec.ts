// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BRAND_KIT_CONTRACT_ID, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgDocumentDetailResponse, MktgDocumentType, MktgRevisionResponse, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { brandKitTestRevision } from '@shared/testing/brand-kit-test-data';
import { MessageService } from 'primeng/api';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { Member360Service } from '@services/member-360.service';
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
      format: 'markdown',
      commentCount: 0,
      latest: false,
      author: null,
      approval: null,
      ...overrides,
    };
  }

  const LATEST = revision(2, { latest: true });
  const OLDER = revision(1, { origin: 'legacy' });
  const RESTORED = { ...OLDER, latest: true };
  const detail: MktgDocumentDetailResponse = { project: PROJECT.uid, type: BRAND_KIT, documentId: 'living', revisions: [LATEST, OLDER], approvedCurrent: null };

  function revisionResponse(current: MktgRevisionSummary): MktgRevisionResponse {
    return { ...detail, revision: current, approval: current.approval, markdown: `# Revision ${current.number}\n`, sidecar: null };
  }

  const projectLookup = vi.fn();
  const impersonating = signal(false);
  const viewer = signal<{ sub: string } | undefined>({ sub: 'synthetic-writer' });
  let harness: RouterTestingHarness;
  let resolveBrandKit: ReturnType<typeof vi.fn>;
  let activeContext: ReturnType<typeof signal<ProjectContext | null>>;
  let slidesExport: { last: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> };
  const run = { isPending: vi.fn(() => false), waitForStored: vi.fn(() => of({ status: 'ready', stored: true })) };
  let store: {
    listDocuments: ReturnType<typeof vi.fn>;
    getDocument: ReturnType<typeof vi.fn>;
    getRevision: ReturnType<typeof vi.fn>;
    getApprovedRevision: ReturnType<typeof vi.fn>;
    restoreRevision: ReturnType<typeof vi.fn>;
    approveRevision: ReturnType<typeof vi.fn>;
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

  /** A Brand Kit revision's sidecar, as the store serves it: the kit's envelope without its Markdown. */
  function kitSidecar(kit = brandKitTestRevision()): Record<string, unknown> {
    return {
      contract: BRAND_KIT_CONTRACT_ID,
      project_name: kit.projectName,
      project: kit.project,
      version: kit.version,
      mode: kit.mode,
      kit: kit.kit,
      chapters: kit.chapters,
      report: kit.report,
      inputs: { website_url: kit.websiteUrl },
      generated_at: kit.generatedAt,
      agent: { agent_version: kit.agentVersion },
    };
  }

  /** A Messaging Framework document whose latest revision is the framework's JSON, as the store serves it. */
  function useFrameworkRevision(): void {
    const FRAMEWORK = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message') as MktgDocumentType;
    const content = {
      mf: {
        vision: 'A vision.',
        mission: 'A mission.',
        positioning: 'For platform teams.',
        tagline: 'Release, open.',
        goals: [
          { id: 'adoption', n: 1, t: 'Adoption', vp: 'VP.', key: 'Key.', proof: [['1,200 members', 'Website']], bite: 'Adoption in the open', icps: ['users'] },
        ],
        crosscut: 'Every column grows the audience.',
        say: ['open'],
        avoid: [['synergy', 'working together']],
        anchor: ['Which goal does this serve?'],
        notes: '',
      },
      icp: [
        {
          id: 'users',
          name: 'End users',
          kind: 'Individual',
          who: 'Engineers.',
          goals: ['adoption'],
          need: 'Need.',
          value: 'Value.',
          lead: 'Lead for users.',
          proof: [['A fact', 'Docs']],
          cta: 'Try it.',
          channels: ['Docs'],
          objection: ['Too early?', null],
          personas: [['SRE', 'uptime']],
          basis: 'Website',
        },
      ],
      mh: {
        umbrella: 'Umbrella.',
        line: 'Release, open.',
        pillars: [{ t: 'Open', m: 'Open message.', p: [['Fact', 'Web']] }],
        found: 'A Linux Foundation project.',
        aud: [['End users', 'Lead for users.']],
      },
      nums: [['1,200', 'members']],
    };
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
    const jsonRevision = revision(2, { latest: true, format: 'json', status: '', approval });
    const approvedCurrent = { revisionId: jsonRevision.id, number: jsonRevision.number };
    store.getDocument.mockReturnValue(of({ ...detail, type: FRAMEWORK, revisions: [jsonRevision], approvedCurrent }));
    store.getRevision.mockReturnValue(
      of({
        ...detail,
        type: FRAMEWORK,
        revisions: [jsonRevision],
        revision: jsonRevision,
        approval,
        approvedCurrent,
        markdown: JSON.stringify(content),
        sidecar: {
          report: { sources_read: ['https://testorbit.example.org'], sources_failed: [], gaps: ['No member count.'], notes: '' },
          checks: { findings: [] },
          mode: 'draft',
        },
      })
    );
  }

  function mockNineRevisionHistory(currentNumber = 2): MktgDocumentDetailResponse {
    const revisions = Array.from({ length: 9 }, (_, index) =>
      revision(9 - index, {
        latest: 9 - index === currentNumber,
        author: { name: 'The writer' },
      })
    );
    const current = revisions.find((entry) => entry.latest);
    if (!current) throw new Error('Synthetic history requires a current revision');
    const history: MktgDocumentDetailResponse = {
      ...detail,
      revisions,
      current: {
        revisionId: current.id,
        changedAt: '2026-10-14T12:00:00.000Z',
        changedBy: { name: 'The selector' },
      },
    };
    store.getDocument.mockImplementation((project: string) => of({ ...history, project }));
    store.getRevision.mockImplementation((project: string, _agent: string, _document: string, id: string) => {
      const selected = revisions.find((entry) => entry.id === id);
      if (!selected) return throwError(() => new HttpErrorResponse({ status: 404 }));
      return of({ ...history, project, revision: selected, markdown: `# Revision ${selected.number}\n`, sidecar: null });
    });
    return history;
  }

  beforeEach(async () => {
    run.isPending.mockReturnValue(false);
    store = {
      listDocuments: vi.fn(() => of({ groups: [] })),
      getDocument: vi.fn(() => of(detail)),
      getRevision: vi.fn((_project: string, _agentKey: string, _documentId: string, revisionId: string) =>
        of(revisionResponse([LATEST, OLDER, RESTORED].find((candidate) => candidate.id === revisionId) ?? LATEST))
      ),
      restoreRevision: vi.fn(() =>
        of({
          ...detail,
          revisions: [{ ...LATEST, latest: false }, RESTORED],
          revision: RESTORED,
          current: { revisionId: RESTORED.id, changedAt: '2026-10-15T13:00:00.000Z', changedBy: { name: 'The selector' } },
        })
      ),
      approveRevision: vi.fn(),
      getApprovedRevision: vi.fn((detail: MktgDocumentDetailResponse, viewed?: MktgRevisionResponse) =>
        of(detail.approvedCurrent && viewed?.revision.id === detail.approvedCurrent.revisionId ? viewed : null)
      ),
    };
    resolveBrandKit = vi.fn(() => of(null));
    slidesExport = { last: vi.fn(() => of({ last: null, latestRevision: null })), start: vi.fn(() => of()), poll: vi.fn(() => of()) };
    activeContext = signal<ProjectContext | null>(PROJECT);
    projectLookup.mockReturnValue(of({ writer: true }));
    impersonating.set(false);
    viewer.set({ sub: 'synthetic-writer' });

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
        MessageService,
        { provide: MktgDependencyService, useValue: { resolveBrandKit, notifyDocumentsChanged: vi.fn() } },
        provideMktgSlidesExportStub(slidesExport),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: MktgDocumentStoreService, useValue: store },
        { provide: ProjectService, useValue: { getProject: projectLookup } },
        { provide: UserService, useValue: { impersonating, user: viewer } },
        { provide: Member360Service, useValue: run },
      ],
    }).compileComponents();
  });

  it('opens the latest revision when no revision is asked for', async () => {
    TestBed.inject(Title).setTitle('Baseline document · LFX');
    await render('/documents/brand-kit/living');

    expect(TestBed.inject(Title).getTitle()).toBe('Baseline document · LFX');
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
    expect(query('mktg-document-view-history-bar')).toBeNull();
    expect(query('mktg-document-view-current-since-2')).toBeNull();
    expect(query('mktg-document-view-back-link')?.getAttribute('href')).toMatch(/^\/documents\?/);
  });

  it('requests an explicit current pointer even when its revision is missing from the summaries', async () => {
    const missing = `000003-${'3'.repeat(64)}`;
    store.getDocument.mockReturnValue(of({ ...detail, current: { revisionId: missing, changedAt: '2026-10-15T13:00:00.000Z', changedBy: { name: null } } }));
    store.getRevision.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render('/documents/brand-kit/living');
    expect(store.getRevision).toHaveBeenCalledExactlyOnceWith('proj-1', 'brand-kit', 'living', missing);
    expect(query('mktg-document-view-error')?.textContent).toContain('This document has no such revision.');
    expect(query('mktg-document-view-document')).toBeNull();
  });

  it('can repair a missing current target from the surviving revision without inventing a date or back link', async () => {
    const survivor = { ...OLDER, createdAt: null };
    const current = { revisionId: `000003-${'3'.repeat(64)}`, changedAt: '2026-10-19T11:00:00.000Z', changedBy: { name: 'The selector' } };
    const survivingDetail = { ...detail, revisions: [survivor], current };
    store.getRevision.mockReturnValue(of({ ...survivingDetail, revision: survivor, markdown: '# Surviving revision' }));
    store.restoreRevision.mockReturnValue(
      of({
        ...survivingDetail,
        current: { ...current, revisionId: survivor.id },
        revisions: [{ ...survivor, latest: true }],
        revision: { ...survivor, latest: true },
      })
    );
    await render(`/documents/brand-kit/living?revision=${survivor.id}`);
    expect(query('mktg-document-view-history-bar-make-current')?.textContent).toContain('Make v1 current');
    expect(query('mktg-document-view-history-bar-summary')?.textContent).toBe("You're viewing v1 · no name (stored before names were recorded)");
    expect(query('mktg-document-view-history-bar-back')).toBeNull();
    query('mktg-document-view-history-bar-make-current')?.click();
    await settle();
    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', survivor.id);
    expect(query('mktg-document-view-history-bar')).toBeNull();
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Current');
    expect(query('mktg-document-view-notice')?.textContent).toContain('Revision 1 is now current.');
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
    const current = { ...LATEST, latest, origin: 'revised' as const, commentCount: 1, author: { name: name || null } };
    store.getRevision.mockReturnValue(of({ ...detail, revisions: [current, { ...OLDER, latest: !latest }], revision: current, markdown: '# Current' }));
    await render('/documents/brand-kit/living');
    const row = query('mktg-document-view-revision-label-2')?.textContent;
    expect(row).toBe(`v2 · Draft · 13 Oct${latest ? ' · Current' : ''} · revised from 1 comment · ${name || 'name unavailable'}`);
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
          changedBy: { name: name || null },
        },
      })
    );
    await render(`/documents/brand-kit/living?revision=${opened.id}`);
    const since = query('mktg-document-view-current-since-2')?.textContent;
    expect(since).toMatch(/^Current since 14 Oct 2026, \d{2}:\d{2} · /);
    expect(since).toContain(name || 'name unavailable');
    expect(query('mktg-document-view-current-since-1')).toBeNull();
  });

  it('offers the open non-current revision in a subtle bar with a link back to current', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    expect(store.getDocument).not.toHaveBeenCalled();
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1 of 2');
    expect(query('mktg-document-view-restore-current')).toBeNull();
    expect(query('mktg-document-view-history-bar-summary')?.textContent).toBe(
      "You're viewing v1 · 13 Oct · no name (stored before names were recorded) · v2 is current"
    );
    expect(query('mktg-document-view-history-bar-make-current')?.textContent).toContain('Make v1 current');
    expect(query('mktg-document-view-history-bar-back')?.getAttribute('href')).toBe(`/documents/brand-kit/living?revision=${LATEST.id}`);
    const bar = query('mktg-document-view-history-bar');
    for (const token of ['sticky', 'h-[34px]', 'text-[13px]', 'bg-gray-50']) expect(bar?.classList.contains(token)).toBe(true);
    expect(query('mktg-document-view-hash')?.classList.contains('relative')).toBe(true);
    expect(query('mktg-document-view-hash')?.textContent).toContain(OLDER.contentSha256);
  });

  it('renders a Messaging Framework revision (JSON content) on the framework’s own view, full width, with the sidecar’s report', async () => {
    useFrameworkRevision();

    await render('/documents/foundation-message/living');

    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Messaging framework');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-framework-view-title')).toBeNull();
    expect(query('mktg-document-view-version')?.textContent).toContain('v2');
    expect(query('mktg-framework-view-tagline')?.textContent).toContain('Release, open.');
    expect(query('mktg-framework-view-goal-adoption')?.textContent).toContain('End users');
    expect(harness.routeNativeElement?.querySelector('[aria-label="Document content"]')?.className).toContain('@[800px]:col-span-2');

    harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-framework-view-tab-sources"]')?.click();
    await settle();
    expect(query('mktg-framework-view-gaps')?.textContent).toContain('No member count.');
    expect(query('mktg-framework-view-sources-read')?.textContent).toContain('testorbit.example.org');
    // The revisions panel is as built: open and restore any other revision.
    expect(query('mktg-document-view-revisions')).not.toBeNull();
    // Download PDF prints the framework in the LF look: the project has no Brand Kit.
    expect(resolveBrandKit).toHaveBeenCalledWith('proj-1');
    expect(query('mktg-framework-view-download-pdf')?.querySelector('button')?.disabled).toBe(false);
    expect(query('mktg-framework-view-export-slides')?.querySelector('button')?.disabled).toBe(false);
    expect(slidesExport.last).toHaveBeenCalledExactlyOnceWith({ project: 'proj-1', agentKey: 'foundation-message', documentId: 'living' });
    expect(query('mktg-framework-view-print')?.className).toContain('lfx-framework-print-only');
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('lf');
    expect(query('mktg-framework-print-version')?.textContent).toContain('Version 2');
  });

  it('makes the full truncated history summary available on keyboard focus rather than title', async () => {
    const name = 'The writer responsible for the synthetic revision and its detailed review notes';
    const selected = { ...OLDER, author: { name } };
    store.getRevision.mockReturnValue(of({ ...detail, revisions: [LATEST, selected], revision: selected, markdown: '# Older' }));
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);
    const summary = query('mktg-document-view-history-bar-summary');
    if (!summary) throw new Error('The history summary must be rendered');
    expect(summary.getAttribute('tabindex')).toBe('0');
    expect(summary.hasAttribute('title')).toBe(false);
    expect(summary.getAttribute('aria-label')).toBe(`You're viewing v1 · 13 Oct · ${name} · v2 is current`);
    summary.focus();
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(summary.textContent));
    summary.blur();
  });

  it.each([
    { author: { name: 'The writer' }, label: 'The writer' },
    { author: { name: null }, label: 'name unavailable' },
    { author: null, label: 'no name (stored before names were recorded)' },
  ])('uses the row attribution policy in the history bar: %j', async ({ author, label }) => {
    const selected = { ...OLDER, author };
    store.getRevision.mockReturnValue(of({ ...detail, revisions: [LATEST, selected], revision: selected, markdown: '# Older' }));
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);
    expect(query('mktg-document-view-history-bar-summary')?.textContent).toBe(`You're viewing v1 · 13 Oct · ${label} · v2 is current`);
  });

  it('never shows the history bar for a one-off run', async () => {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'run');
    if (!type) throw new Error('The catalog must have a one-off type for this test');
    const only = revision(1, { latest: true });
    const documentId = `run-${'a'.repeat(24)}`;
    store.getRevision.mockReturnValue(of({ ...detail, type, documentId, revisions: [only], revision: only, markdown: '# One run' }));
    await render(`/documents/${type.agentKey}/${documentId}?revision=${only.id}`);
    expect(query('mktg-document-view-history-bar')).toBeNull();
  });

  it('shows the newest five and pins older open/current revisions, with an in-place Show all 9 disclosure', async () => {
    const history = mockNineRevisionHistory();
    await render(`/documents/brand-kit/living?revision=${history.revisions[8].id}`);
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(7);
    for (const number of [9, 8, 7, 6, 5, 2, 1]) expect(query(`mktg-document-view-revision-${number}`)).not.toBeNull();
    expect(query('mktg-document-view-revision-3')).toBeNull();
    expect(query('mktg-document-view-revision-4')).toBeNull();
    expect(query('mktg-document-view-history-bar-summary')?.textContent).toContain('v2 is current');
    expect(query('mktg-document-view-show-all-revisions')?.textContent).toContain('Show all 9 ▾');
    query('mktg-document-view-show-all-revisions')?.click();
    await settle();
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(9);
    expect(query('mktg-document-view-show-all-revisions')?.getAttribute('aria-expanded')).toBe('true');
    expect(store.getRevision).toHaveBeenCalledTimes(1);
    query('mktg-document-view-show-all-revisions')?.click();
    await settle();
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(7);
  });

  it('shows only five rows when both the open and current revisions are among the newest five', async () => {
    const history = mockNineRevisionHistory(9);
    await render(`/documents/brand-kit/living?revision=${history.revisions[2].id}`);
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(5);
    expect(query('mktg-document-view-revision-1')).toBeNull();
    expect(query('mktg-document-view-history-bar-summary')?.textContent).toContain('v9 is current');
  });

  it('keeps expansion while opening another revision but resets it for another project', async () => {
    const history = mockNineRevisionHistory();
    await render(`/documents/brand-kit/living?revision=${history.revisions[8].id}`);
    query('mktg-document-view-show-all-revisions')?.click();
    await settle();
    await harness.navigateByUrl(`/documents/brand-kit/living?revision=${history.revisions[6].id}`);
    await settle();
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(9);
    activeContext.set({ ...PROJECT, uid: 'proj-2', name: 'OtherOrbit' });
    await settle();
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(7);
    expect(query('mktg-document-view-show-all-revisions')?.getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['faq', 'foundation-message', 'boilerplates', 'brand-kit', 'icp'] as const)(
    'shows a plain error for unreadable %s JSON, never the stored bytes',
    async (key) => {
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key);
      if (!type) throw new Error('Missing document type');
      const selected = revision(2, { format: 'json' });
      const text = '{"unexpected":"synthetic source text"}';
      store.getRevision.mockReturnValue(of({ ...revisionResponse(selected), type, markdown: text }));
      await render(`/documents/${key}/living?revision=${selected.id}`);
      expect(query('mktg-document-view-unreadable-json')?.textContent).toContain('This revision could not be displayed. Revision 2.');
      expect(harness.routeNativeElement?.textContent).not.toContain(text);
      expect(harness.routeNativeElement?.querySelector('pre, lfx-markdown-renderer')).toBeNull();
    }
  );

  function faqResponse(): MktgRevisionResponse {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'faq');
    if (!type) throw new Error('Missing FAQ type');
    const selected = revision(2, { format: 'json', latest: true });
    return { ...revisionResponse(selected), type, markdown: JSON.stringify({ faq: [['About', [['What is it?', 'Open collaboration.', 'Docs']]]] }) };
  }

  it('approves directly without confirmation and updates saving/state metadata', async () => {
    const response = faqResponse();
    const pending = new Subject<MktgRevisionResponse>();
    store.getRevision.mockReturnValue(of(response));
    store.approveRevision.mockReturnValue(pending);
    await render(`/documents/faq/living?revision=${LATEST.id}`);
    const status = query('mktg-document-view-saving-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe('');
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    expect(query('mktg-document-view-saving-status')).toBe(status);
    expect(status?.textContent).toBe('Approving revision 2…');
    expect(store.approveRevision).toHaveBeenCalledWith(PROJECT.uid, 'faq', 'living', LATEST.id);
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(true);
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: 'Project writer' } };
    pending.next({
      ...response,
      approval,
      revision: { ...response.revision, approval },
      revisions: response.revisions.map((entry) => ({ ...entry, approval: entry.id === LATEST.id ? approval : null })),
      approvedCurrent: { revisionId: LATEST.id, number: 2 },
    });
    pending.complete();
    await settle();
    expect(query('mktg-document-view-approval-state')?.textContent?.trim()).toBe('Approved');
    expect(query('mktg-document-view-approve')).toBeNull();
    expect(query('mktg-document-view-saving-status')).toBe(status);
    expect(status?.textContent).toBe('Revision 2 is approved and current.');
  });

  it.each([
    ['approve', 'complete'],
    ['approve', 'error'],
    ['restore', 'complete'],
    ['restore', 'error'],
  ] as const)('blocks both writes while %s is pending and enables them after %s finalizes', async (first, ending) => {
    const draft = revision(3, { format: 'json' });
    const response = { ...faqResponse(), revision: draft, revisions: [draft, LATEST, OLDER] };
    const pending = new Subject<MktgRevisionResponse>();
    store.getRevision.mockReturnValue(of(response));
    store[first === 'approve' ? 'approveRevision' : 'restoreRevision'].mockReturnValue(pending);
    await render(`/documents/faq/living?revision=${draft.id}`);
    const component = harness.routeDebugElement?.componentInstance as MktgDocumentViewComponent;
    const approve = query('mktg-document-view-approve')?.querySelector('button');
    const history = query('mktg-document-view-history-bar-make-current') as HTMLButtonElement | null;
    const row = query('mktg-document-view-restore-1') as HTMLButtonElement | null;
    for (const button of [approve, history, row]) expect(button?.disabled).toBe(false);
    (first === 'approve' ? approve : history)?.click();
    await settle();
    for (const button of [approve, history, row]) expect(button?.disabled).toBe(true);
    component['onApprove']();
    component['onRestore'](OLDER);
    expect(store.approveRevision).toHaveBeenCalledTimes(first === 'approve' ? 1 : 0);
    expect(store.restoreRevision).toHaveBeenCalledTimes(first === 'restore' ? 1 : 0);
    if (ending === 'error') {
      pending.error(new HttpErrorResponse({ status: 500 }));
    } else {
      pending.complete();
    }
    await settle();
    for (const button of [approve, history, row]) expect(button?.disabled).toBe(false);
  });

  it('keeps approval subscribed across an unrelated request recomputation', async () => {
    const response = faqResponse();
    const pending = new Subject<MktgRevisionResponse>();
    store.getRevision.mockReturnValue(of(response));
    store.approveRevision.mockReturnValue(pending);
    await render(`/documents/faq/living?revision=${LATEST.id}`);
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    activeContext.set({ ...PROJECT });
    await settle();
    expect(pending.observed).toBe(true);
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
    pending.next({ ...response, approval, revision: { ...response.revision, approval }, approvedCurrent: { revisionId: LATEST.id, number: 2 } });
    pending.complete();
    await settle();
    expect(query('mktg-document-view-approval-state')?.textContent?.trim()).toBe('Approved');
    expect(query('mktg-document-view-approve')).toBeNull();
  });

  it('lets approval finish after navigation without replacing the newly opened revision', async () => {
    const response = faqResponse();
    const pending = new Subject<MktgRevisionResponse>();
    store.getRevision.mockReturnValueOnce(of(response));
    store.approveRevision.mockReturnValue(pending);
    await render(`/documents/faq/living?revision=${LATEST.id}`);
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    await harness.navigateByUrl(`/documents/brand-kit/living?revision=${OLDER.id}`);
    await settle();
    expect(pending.observed).toBe(true);
    pending.next(response);
    pending.complete();
    await settle();
    expect(query('mktg-document-view-title')?.textContent).toContain('Brand Kit');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1');
    expect(TestBed.inject(MktgDependencyService).notifyDocumentsChanged).toHaveBeenCalledWith(PROJECT.uid);
  });

  it('renders the catalog Run again href for both the framework and native FAQ', async () => {
    useFrameworkRevision();
    await render('/project/mktg-os-agents/documents/foundation-message/living?project=testorbit');
    expect(query('mktg-document-view-run-again')?.getAttribute('href')).toBe('/project/mktg-os-agents/foundation-setup?project=testorbit');
    store.getRevision.mockReturnValue(of(faqResponse()));
    await harness.navigateByUrl(`/project/mktg-os-agents/documents/faq/living?project=testorbit&revision=${LATEST.id}`);
    await settle();
    expect(query('mktg-document-view-run-again')?.getAttribute('href')).toBe('/project/mktg-os-agents/faq?project=testorbit');
  });

  it('blocks a second approval after navigation until the first write finalizes', async () => {
    const first = faqResponse();
    const second = { ...first, revision: revision(3, { format: 'json' }) };
    const older = new Subject<MktgRevisionResponse>();
    const newer = new Subject<MktgRevisionResponse>();
    store.getRevision.mockImplementation((_project: string, _agent: string, _document: string, id: string) => of(id === first.revision.id ? first : second));
    store.approveRevision.mockReturnValueOnce(older).mockReturnValueOnce(newer);
    await render(`/documents/faq/living?revision=${first.revision.id}`);
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    await harness.navigateByUrl(`/documents/faq/living?revision=${second.revision.id}`);
    await settle();
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    const component = harness.routeDebugElement?.componentInstance as MktgDocumentViewComponent;
    component['onApprove']();
    expect(newer.observed).toBe(false);
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(true);
    expect(store.approveRevision).toHaveBeenCalledTimes(1);
    older.complete();
    await settle();
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(false);
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    expect(newer.observed).toBe(true);
    expect(store.approveRevision).toHaveBeenCalledTimes(2);
    newer.error(new HttpErrorResponse({ status: 500 }));
    await settle();
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(false);
  });

  it.each([0, 500])('announces an unconfirmed outcome and keeps the Draft on approval error %s', async (statusCode) => {
    store.getRevision.mockReturnValue(of(faqResponse()));
    store.approveRevision.mockReturnValue(throwError(() => new HttpErrorResponse({ status: statusCode })));
    await render(`/documents/faq/living?revision=${LATEST.id}`);
    const status = query('mktg-document-view-saving-status');
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    const message = 'The approval could not be confirmed. Reload to see the current state before trying again.';
    expect(query('mktg-document-view-approval-error')?.textContent).toContain(message);
    expect(query('mktg-document-view-saving-status')).toBe(status);
    expect(status?.textContent).toBe(message);
    expect(query('mktg-document-view-approval-state')?.textContent?.trim()).toBe('Draft');
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(false);
  });

  it.each(['reader', 'impersonation'])('omits the approval action for %s', async (mode) => {
    projectLookup.mockReturnValue(of({ writer: mode !== 'reader' }));
    impersonating.set(mode === 'impersonation');
    store.getRevision.mockReturnValue(of(faqResponse()));
    await render(`/documents/faq/living?revision=${LATEST.id}`);
    expect(query('mktg-document-view-approve')).toBeNull();
    expect(query('mktg-document-view-saving-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('omits Approve for a legacy-only pre-revision document', async () => {
    const legacy = revision(1, { id: `legacy-${'a'.repeat(64)}`, origin: 'legacy', latest: true });
    store.getRevision.mockReturnValue(of({ ...revisionResponse(legacy), revisions: [legacy] }));
    await render(`/documents/brand-kit/living?revision=${legacy.id}`);
    expect(harness.routeNativeElement?.querySelector('lfx-markdown-renderer')).not.toBeNull();
    expect(query('mktg-document-view-approve')).toBeNull();
    expect(store.approveRevision).not.toHaveBeenCalled();
  });

  it('preserves the exact pointer-contention message for inline approval retry', async () => {
    const message = 'The document changed while making a revision current. Reload and try again.';
    store.getRevision.mockReturnValue(of(faqResponse()));
    store.approveRevision.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 412, error: { error: message, code: 'PRECONDITION_FAILED' } })));
    await render(`/documents/faq/living?revision=${LATEST.id}`);
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    expect(query('mktg-document-view-approval-error')?.textContent?.trim()).toBe(message);
    expect(query('mktg-document-view-approval-state')?.textContent?.trim()).toBe('Draft');
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(false);
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

  it('preserves the opened body-derived status when Make current refreshes bounded summaries', async () => {
    const status = `Draft — ${'x'.repeat(300)}`;
    const opened = { ...LATEST, status };
    store.getRevision.mockReturnValue(of(revisionResponse(opened)));
    store.restoreRevision.mockReturnValue(
      of({
        ...detail,
        revisions: [{ ...LATEST, latest: false, status: status.slice(0, 199) + '…' }, RESTORED],
        revision: RESTORED,
      })
    );
    await render(`/documents/brand-kit/living?revision=${LATEST.id}`);
    query('mktg-document-view-restore-1')?.click();
    await settle();
    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain(status);
    expect(query('mktg-document-view-revision-chip')?.textContent).not.toContain('Current');
  });

  it('shows approved/current, approved/noncurrent and Draft states independently in the revision rows', async () => {
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: 'Project writer' } };
    const draft = revision(3);
    const current = revision(2, { latest: true, approval });
    const historical = revision(1, { approval: { ...approval, approvedBy: null } });
    store.getRevision.mockReturnValue(
      of({ ...revisionResponse(draft), revisions: [draft, current, historical], approvedCurrent: { revisionId: current.id, number: 2 } })
    );
    await render(`/documents/brand-kit/living?revision=${draft.id}`);
    expect(query('mktg-document-view-revision-label-2')?.textContent).toContain('Approved');
    expect(query('mktg-document-view-current-2')).not.toBeNull();
    expect(query('mktg-document-view-revision-label-2')?.textContent).toContain('approved by Project writer');
    expect(query('mktg-document-view-revision-label-1')?.textContent).toContain('Approved');
    expect(query('mktg-document-view-current-1')).toBeNull();
    expect(query('mktg-document-view-revision-label-1')?.textContent).toContain('approved by a project writer');
    expect(query('mktg-document-view-revision-label-3')?.textContent).toContain('Draft');
    expect(query('mktg-document-view-revision-label-3')?.textContent).not.toContain('approved by');
  });

  it('omits a missing date and its separator from the revision label', async () => {
    const opened = { ...LATEST, createdAt: null };
    store.getRevision.mockReturnValue(of({ ...revisionResponse(opened), revisions: [opened, OLDER] }));
    await render(`/documents/brand-kit/living?revision=${LATEST.id}`);
    expect(query('mktg-document-view-revision-label-2')?.textContent).toBe(
      'v2 · Draft · Current · generated from the form · no name (stored before names were recorded)'
    );
  });

  it('makes the open revision current without adding one', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-history-bar-make-current')?.click();
    await settle();

    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(TestBed.inject(MktgDependencyService).notifyDocumentsChanged).toHaveBeenCalledWith(PROJECT.uid);
    expect(TestBed.inject(Router).url).toContain(`revision=${OLDER.id}`);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1 of 2');
    expect(query('mktg-document-view-notice')?.textContent).toContain('Revision 1 is now current. No revision was added.');
    expect(query('mktg-document-view-saving-status')?.textContent).toBe('');
    expect(query('mktg-document-view-history-bar')).toBeNull();
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
    const status = query('mktg-document-view-saving-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('');
    query('mktg-document-view-history-bar-make-current')?.click();
    await settle();
    expect(status?.textContent).toBe('Saving revision 1…');
    expect(status?.closest('[aria-busy]')).toBeNull();
    expect(query('mktg-document-view-history-bar-make-current')?.textContent?.trim()).toBe('Saving…');
    expect(query('mktg-document-view-history-bar')?.getAttribute('aria-busy')).toBe('true');
    expect((query('mktg-document-view-history-bar-make-current') as HTMLButtonElement | null)?.disabled).toBe(true);
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

    query('mktg-document-view-history-bar-make-current')?.click();
    await settle();

    expect(query('mktg-document-view-error')?.textContent).toContain('The revision could not be made current. Reload to check its state, then try again.');
    expect(TestBed.inject(Router).url).toContain(`revision=${OLDER.id}`);
    expect((query('mktg-document-view-history-bar-make-current') as HTMLButtonElement | null)?.disabled).toBe(false);
    expect(query('mktg-document-view-history-bar')?.getAttribute('aria-busy')).toBe('false');
    expect(query('mktg-document-view-saving-status')?.textContent).toBe('');
  });
  it('renders a Brand Kit revision on the kit’s web view, full width, from its sidecar — the book for print only, not the Markdown, not the framework view', async () => {
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
    const approved = { ...LATEST, approval };
    store.getRevision.mockReturnValue(
      of({ ...revisionResponse(approved), approval, approvedCurrent: { revisionId: approved.id, number: approved.number }, sidecar: kitSidecar() })
    );

    await render('/documents/brand-kit/living');

    expect(query('mktg-document-view-brand-kit')).not.toBeNull();
    expect(query('mktg-document-view-framework')).toBeNull();
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-document-view-brand-kit')?.parentElement?.className).toContain('@[800px]:col-span-2');
    expect(query('brand-kit-web-view-title')).toBeNull();
    expect(query('mktg-document-view-version')?.textContent?.trim()).toBe(`v${LATEST.number}`);
    expect(query('brand-kit-web-view-print')?.className).toContain('lfx-brand-kit-print-only');
    // Only a framework's print reads the project's kit: the kit is its own brand.
    expect(resolveBrandKit).not.toHaveBeenCalled();
    // Export to Google Slides reads this revision of the document, and its last export is looked up.
    expect(query('brand-kit-web-view-export-slides')?.querySelector('button')?.disabled).toBe(false);
    expect(slidesExport.last).toHaveBeenCalledWith({ project: 'proj-1', agentKey: 'brand-kit', documentId: 'living' });
  });

  it('exports and prints approved current while the screen shows a different newer Draft', async () => {
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: 'Project writer' } };
    const approved = revision(1, { latest: true, approval });
    const draft = revision(3, { latest: false });
    const approvedCurrent = { revisionId: approved.id, number: 1 };
    const revisions = [draft, approved];
    const selected = {
      ...revisionResponse(draft),
      revisions,
      approvedCurrent,
      sidecar: kitSidecar({ ...brandKitTestRevision(), projectName: 'Synthetic draft only' }),
    };
    store.getRevision.mockReturnValue(of(selected));
    store.getApprovedRevision.mockReturnValue(of({ ...revisionResponse(approved), approval, revisions, approvedCurrent, sidecar: kitSidecar() }));
    await render(`/documents/brand-kit/living?revision=${draft.id}`);
    expect(query('mktg-document-view-version')?.textContent).toContain('v3');
    expect(query('mktg-document-view-approval-state')?.textContent?.trim()).toBe('Draft');
    expect(query('mktg-document-view-meta')?.textContent).toContain('the kit still shows v1, approved by Project writer');
    expect(query('brand-kit-web-view-print')?.textContent).toContain('V1.0');
    expect(query('brand-kit-web-view-print')?.textContent).not.toContain('Synthetic draft only');
    query('brand-kit-web-view-export-slides')?.querySelector('button')?.click();
    await settle();
    expect(slidesExport.last).toHaveBeenCalledExactlyOnceWith({ project: 'proj-1', agentKey: 'brand-kit', documentId: 'living' });
    expect(slidesExport.start).toHaveBeenCalledWith({
      project: 'proj-1',
      agentKey: 'brand-kit',
      documentId: 'living',
      revisionId: approved.id,
      mode: 'create',
    });
  });

  it.each(['loading', 'error'] as const)('keeps approved PDF/Slides disabled while the approved payload is %s', async (state) => {
    useFrameworkRevision();
    store.getApprovedRevision.mockReturnValue(state === 'loading' ? NEVER : throwError(() => new HttpErrorResponse({ status: 500 })));
    await render('/documents/foundation-message/living');
    const text = query('mktg-document-view-framework')?.textContent;
    expect(text).toContain(state === 'loading' ? 'Loading the approved current' : 'The approved current could not be loaded');
    expect(query('mktg-framework-view-download-pdf')?.querySelector('button')?.disabled).toBe(true);
    expect(query('mktg-framework-view-export-slides')?.querySelector('button')?.disabled).toBe(true);
    expect(query('mktg-framework-view-print')).toBeNull();
    expect(slidesExport.last).toHaveBeenCalledExactlyOnceWith({ project: 'proj-1', agentKey: 'foundation-message', documentId: 'living' });
  });

  it('keeps document and last-export reads alive when user context resolves before approved bytes', async () => {
    const pendingApproved = new Subject<MktgRevisionResponse>();
    const pendingLast = new Subject<{ last: null; latestRevision: null }>();
    viewer.set(undefined);
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), sidecar: kitSidecar(), approvedCurrent: { revisionId: OLDER.id, number: 1 } }));
    store.getApprovedRevision.mockReturnValue(pendingApproved);
    slidesExport.last.mockReturnValue(pendingLast);
    await render(`/documents/brand-kit/living?revision=${LATEST.id}`);
    expect(slidesExport.last).toHaveBeenCalledExactlyOnceWith({ project: PROJECT.uid, agentKey: 'brand-kit', documentId: 'living' });
    expect(pendingLast.observed).toBe(true);
    viewer.set({ sub: 'synthetic-resolved-subject' });
    impersonating.set(true);
    await settle();
    expect(store.getRevision).toHaveBeenCalledTimes(1);
    expect(slidesExport.last).toHaveBeenCalledTimes(1);
    expect(pendingApproved.observed).toBe(true);
    expect(pendingLast.observed).toBe(true);
    expect(query('brand-kit-web-view-export-slides')?.querySelector('button')?.disabled).toBe(true);
    expect(query('mktg-document-view-approve')).toBeNull();
    pendingLast.next({ last: null, latestRevision: null });
    pendingLast.complete();
  });

  it('shows an asset without approved current but disables its real PDF and Slides actions', async () => {
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), sidecar: kitSidecar() }));
    await render('/documents/brand-kit/living');
    expect(query('brand-kit-web-view-print')).toBeNull();
    expect(query('brand-kit-web-view-download-pdf')?.querySelector('button')?.disabled).toBe(true);
    expect(query('brand-kit-web-view-export-slides')?.querySelector('button')?.disabled).toBe(true);
    expect(slidesExport.last).toHaveBeenCalledExactlyOnceWith({ project: 'proj-1', agentKey: 'brand-kit', documentId: 'living' });
  });

  it('renders a Boilerplates revision (JSON content) on the Boilerplates view, full width, with the sidecar’s report and word counts', async () => {
    const BOILERPLATES = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'boilerplates') as MktgDocumentType;
    const content = {
      bp: [
        { l: 'One-liner', max: 15, t: 'TestOrbit is the open release toolkit.' },
        { l: '25 words', max: 25, t: 'TestOrbit, a Linux Foundation project, is the open release toolkit.' },
        { l: '50 words', max: 50, t: 'TestOrbit, a Linux Foundation project, is the open release toolkit for platform teams.' },
        { l: '100 words', max: 100, t: 'TestOrbit, a Linux Foundation project. Learn more at testorbit.example.org.' },
      ],
    };
    const jsonRevision = revision(3, { latest: true, format: 'json', status: '' });
    store.getDocument.mockReturnValue(of({ ...detail, type: BOILERPLATES, revisions: [jsonRevision] }));
    store.getRevision.mockReturnValue(
      of({
        ...detail,
        type: BOILERPLATES,
        revisions: [jsonRevision],
        revision: jsonRevision,
        markdown: JSON.stringify(content),
        sidecar: {
          report: { sources_read: ['https://testorbit.example.org'], sources_failed: [], gaps: ['No launch year.'], notes: '' },
          checks: { word_counts: [6, 10, 13, 9], findings: [] },
          mode: 'draft',
        },
      })
    );

    await render('/documents/boilerplates/living');

    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Boilerplates');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-framework-view')).toBeNull();
    expect(query('mktg-boilerplates-view-title')).toBeNull();
    expect(query('mktg-document-view-version')?.textContent).toContain('v3');
    expect(query('mktg-boilerplates-view-text-0')?.textContent).toContain('TestOrbit is the open release toolkit.');
    expect(query('mktg-boilerplates-view-count-1')?.textContent).toContain('10 / 25 words');
    expect(harness.routeNativeElement?.querySelector('[aria-label="Document content"]')?.className).toContain('@[800px]:col-span-2');

    harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-boilerplates-view-tab-sources"]')?.click();
    await settle();
    expect(query('mktg-boilerplates-view-gaps')?.textContent).toContain('No launch year.');
  });

  it('drops the previous project’s Brand Kit from the print the moment the project changes', async () => {
    useFrameworkRevision();
    // Project 1 has a kit; project 2's kit never resolves while the print is open.
    resolveBrandKit.mockImplementation((uid: string) => (uid === 'proj-1' ? of(brandKitTestRevision()) : NEVER));
    await render('/documents/foundation-message/living');
    await settle();
    const brand = (): string | null | undefined => query('mktg-framework-print')?.getAttribute('data-brand');
    expect(brand()).not.toBe('lf');

    activeContext.set({ uid: 'proj-2', name: 'Other', slug: 'other' });
    await settle();
    expect(resolveBrandKit).toHaveBeenCalledWith('proj-2');
    // Until project 2's kit arrives, the print is in the LF look — never project 1's brand.
    expect(brand() ?? 'lf').toBe('lf');
  });

  it('renders an FAQ revision (JSON content) on the FAQ view, full width, flagging what needs an answer', async () => {
    const FAQ = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'faq') as MktgDocumentType;
    const content = {
      faq: [
        [
          'About TestOrbit',
          [
            ['What is TestOrbit?', 'An open release toolkit.', 'Website'],
            ['How much does membership cost?', null, null],
          ],
        ],
      ],
    };
    const jsonRevision = revision(2, { latest: true, format: 'json', status: '' });
    store.getDocument.mockReturnValue(of({ ...detail, type: FAQ, revisions: [jsonRevision] }));
    store.getRevision.mockReturnValue(
      of({
        ...detail,
        type: FAQ,
        revisions: [jsonRevision],
        revision: jsonRevision,
        markdown: JSON.stringify(content),
        sidecar: {
          report: { sources_read: [], sources_failed: [], gaps: ['How much does membership cost?'], notes: '' },
          checks: { findings: [] },
          mode: 'draft',
        },
      })
    );

    await render('/documents/faq/living');

    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit FAQ');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-framework-view')).toBeNull();
    expect(query('mktg-document-view-version')?.textContent).toContain('v2');
    expect(query('mktg-faq-view-title')).toBeNull();
    expect(query('mktg-faq-view-metadata')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('lfx-mktg-slides-export')).toBeNull();
    expect(query('mktg-faq-view-question-0-0')?.textContent).toContain('An open release toolkit.');
    expect(query('mktg-faq-view-needs-answer-0-1')).not.toBeNull();
    expect(query('mktg-faq-view-unanswered-chip')?.textContent).toContain('1 question needs an answer from your team');
    expect(harness.routeNativeElement?.querySelector('[aria-label="Document content"]')?.className).toContain('@[800px]:col-span-2');
  });
});
