// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BRAND_KIT_CONTRACT_ID, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgDocumentDetailResponse, MktgDocumentType, MktgRevisionResponse, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgSlidesExportService } from '@services/mktg-slides-export.service';
import { brandKitTestRevision } from '@shared/testing/brand-kit-test-data';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
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
      ...overrides,
    };
  }

  const LATEST = revision(2, { latest: true });
  const OLDER = revision(1, { origin: 'legacy' });
  const RESTORED = revision(3, { latest: true, origin: 'restored', restoredFromNumber: 1 });
  const detail: MktgDocumentDetailResponse = { project: PROJECT.uid, type: BRAND_KIT, documentId: 'living', revisions: [LATEST, OLDER] };

  function revisionResponse(current: MktgRevisionSummary): MktgRevisionResponse {
    return { ...detail, revision: current, markdown: `# Revision ${current.number}\n`, sidecar: null };
  }

  let harness: RouterTestingHarness;
  let store: {
    getDocument: ReturnType<typeof vi.fn>;
    getRevision: ReturnType<typeof vi.fn>;
    restoreRevision: ReturnType<typeof vi.fn>;
  };
  let resolveBrandKit: ReturnType<typeof vi.fn>;
  let slidesExport: { last: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> };

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
      restoreRevision: vi.fn(() => of({ ...detail, revision: RESTORED })),
    };
    resolveBrandKit = vi.fn(() => of(null));
    slidesExport = {
      last: vi.fn(() => of({ last: null, latestRevision: null })),
      start: vi.fn(() => of()),
      poll: vi.fn(() => of()),
    };
    const activeContext = signal<ProjectContext | null>(PROJECT);

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'documents/:agentKey/:documentId', component: MktgDocumentViewComponent }]),
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: MktgDocumentStoreService, useValue: store },
        // The Boilerplates view says a failed copy through the app's toasts.
        MessageService,
        { provide: MktgDependencyService, useValue: { resolveBrandKit } },
        { provide: MktgSlidesExportService, useValue: slidesExport },
      ],
    }).compileComponents();
  });

  it('opens the latest revision when no revision is asked for', async () => {
    await render('/documents/brand-kit/living');

    expect(store.getDocument).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living');
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', LATEST.id);
    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Brand Kit');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 2 of 2');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('latest');
    expect(query('mktg-document-view-restore-current')).toBeNull();
  });

  it('opens the revision in ?revision= and offers to restore it', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    expect(store.getDocument).not.toHaveBeenCalled();
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1 of 2');
    expect(query('mktg-document-view-restore-current')?.textContent).toContain('Restore revision 1');
    expect(query('mktg-document-view-hash')?.textContent).toContain(OLDER.contentSha256);
  });

  it('renders a Brand Kit revision on the kit’s web view, full width, from its sidecar — the book for print only, not the Markdown, not the framework view', async () => {
    const kit = brandKitTestRevision();
    const sidecar = {
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
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), sidecar }));

    await render('/documents/brand-kit/living');

    expect(query('mktg-document-view-brand-kit')).not.toBeNull();
    expect(query('mktg-document-view-framework')).toBeNull();
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-document-view-brand-kit')?.parentElement?.className).toContain('basis-full');
    expect(query('brand-kit-web-view-title')?.textContent?.trim()).toBe('Project One Brand Kit');
    expect(query('brand-kit-web-view-version')?.textContent?.trim()).toBe(`v${LATEST.number}`);
    expect(query('brand-kit-web-view-print')?.className).toContain('lfx-brand-kit-print-only');
    // Only a framework's print reads the project's kit: the kit is its own brand.
    expect(resolveBrandKit).not.toHaveBeenCalled();
    // Export to Google Slides reads this revision of the document, and its last export is looked up.
    expect(query('brand-kit-web-view-export-slides')?.querySelector('button')?.disabled).toBe(false);
    expect(slidesExport.last).toHaveBeenCalledWith({ project: 'proj-1', agentKey: 'brand-kit', documentId: 'living' });
  });

  it('renders a Messaging Framework revision (JSON content) on the framework’s own view, full width, with the sidecar’s report', async () => {
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
    const jsonRevision = revision(2, { latest: true, format: 'json', status: '' });
    store.getDocument.mockReturnValue(of({ ...detail, type: FRAMEWORK, revisions: [jsonRevision] }));
    store.getRevision.mockReturnValue(
      of({
        ...detail,
        type: FRAMEWORK,
        revisions: [jsonRevision],
        revision: jsonRevision,
        markdown: JSON.stringify(content),
        sidecar: {
          report: { sources_read: ['https://testorbit.example.org'], sources_failed: [], gaps: ['No member count.'], notes: '' },
          checks: { findings: [] },
          mode: 'draft',
        },
      })
    );

    await render('/documents/foundation-message/living');

    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Messaging framework');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-framework-view-title')?.textContent).toContain('TestOrbit Messaging framework');
    expect(query('mktg-framework-view-version')?.textContent).toContain('v2');
    expect(query('mktg-framework-view-tagline')?.textContent).toContain('Release, open.');
    expect(query('mktg-framework-view-goal-adoption')?.textContent).toContain('End users');
    expect(harness.routeNativeElement?.querySelector('main')?.className).toContain('basis-full');

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
    expect(slidesExport.last).toHaveBeenCalledWith({ project: 'proj-1', agentKey: 'foundation-message', documentId: 'living' });
    expect(query('mktg-framework-view-print')?.className).toContain('lfx-framework-print-only');
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('lf');
    expect(query('mktg-framework-print-version')?.textContent).toContain('Version 2');
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
    expect(query('mktg-boilerplates-view-title')?.textContent).toContain('TestOrbit Boilerplates');
    expect(query('mktg-boilerplates-view-version')?.textContent).toContain('v3');
    expect(query('mktg-boilerplates-view-text-0')?.textContent).toContain('TestOrbit is the open release toolkit.');
    expect(query('mktg-boilerplates-view-count-1')?.textContent).toContain('10 / 25 words');
    expect(harness.routeNativeElement?.querySelector('main')?.className).toContain('basis-full');

    harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-boilerplates-view-tab-sources"]')?.click();
    await settle();
    expect(query('mktg-boilerplates-view-gaps')?.textContent).toContain('No launch year.');
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

  it('restores the open revision and moves to the new latest revision', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-restore-current')?.click();
    await settle();

    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(TestBed.inject(Router).url).toContain(`revision=${RESTORED.id}`);
    expect(store.getRevision).toHaveBeenLastCalledWith('proj-1', 'brand-kit', 'living', RESTORED.id);
    expect(query('mktg-document-view-notice')?.textContent).toContain('Revision 1 restored as revision 3, now the latest.');
  });

  it('keeps the revision and lets the user retry when a restore fails', async () => {
    store.restoreRevision.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-restore-current')?.click();
    await settle();

    expect(query('mktg-document-view-error')?.textContent).toContain('Revision 1 could not be restored. Nothing was changed; try again.');
    expect(TestBed.inject(Router).url).toContain(`revision=${OLDER.id}`);
    expect((query('mktg-document-view-restore-current') as HTMLButtonElement | null)?.disabled).toBe(false);
  });
});
