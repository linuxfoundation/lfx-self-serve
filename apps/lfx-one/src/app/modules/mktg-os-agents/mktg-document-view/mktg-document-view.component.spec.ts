// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, linkedSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MktgCommentsPanelComponent } from '../components/mktg-comments-panel/mktg-comments-panel.component';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  BRAND_KIT_CONTRACT_ID,
  BRAND_KIT_INTAKE,
  ICP_INTAKE,
  LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_RUN_POLL,
  MKTG_AGENT_INTAKES,
  MKTG_AGENTS,
} from '@lfx-one/shared/constants';
import {
  MktgDocumentDetailResponse,
  MktgDocumentRunProgress,
  MktgDocumentType,
  MktgGenerateProgress,
  MktgPendingGeneration,
  MktgRevisionResponse,
  MktgStoredAgentRun,
  MktgRevisionSummary,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import { mktgRunProgressFixture } from '@shared/testing/mktg-run-progress-test-data';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { MktgPendingDocumentService } from '@services/mktg-pending-document.service';
import { MktgPrintService } from '@services/mktg-print.service';

import { MessageService } from 'primeng/api';
import { NEVER, of, Subject, throwError, TimeoutError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDocumentViewComponent } from './mktg-document-view.component';
import { MktgSlidesExportComponent } from '../mktg-slides-export/mktg-slides-export.component';

// Typed document fixtures and providers share one seam with sibling agents.
import { Title } from '@angular/platform-browser';
import { Member360Result } from '@lfx-one/shared/interfaces';
import { Member360Service } from '@services/member-360.service';
import { member360Fixture } from '../../../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME } from '../../../../../e2e/fixtures/mock-data/synthetic-org.mock';

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
  const viewer = signal<{ sub: string } | null | undefined>({ sub: 'synthetic-writer' });
  function started(state: MktgDocumentRunProgress['state']): MktgDocumentRunProgress {
    return {
      project: PROJECT.uid,
      agentKey: BRAND_KIT.agentKey,
      documentId: 'living',
      runId: 'b'.repeat(64),
      state,
      startedAt: '2026-10-19T08:00:00Z',
      failureText: state === 'failed' ? 'Synthetic complete refusal.\nKeep this exact explanation.' : undefined,
    };
  }

  let harness: RouterTestingHarness;
  let subject: ReturnType<typeof signal<string>>;
  const pending = {};
  const print = { print: vi.fn(), clear: vi.fn(), ensureFontStylesheet: vi.fn() };

  let resolveBrandKit: ReturnType<typeof vi.fn>;
  let activeContext: ReturnType<typeof signal<ProjectContext | null>>;
  let slidesExport: { last: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> };
  const run = {
    isPending: vi.fn(() => false),
    pendingStartedAt: vi.fn(() => Date.parse('2026-10-19T10:00:00.000Z')),
    waitForStored: vi.fn<Member360Service['waitForStored']>(() => of({ status: 'ready', stored: true })),
  };
  let store: {
    listDocuments: ReturnType<typeof vi.fn>;
    getDocument: ReturnType<typeof vi.fn>;
    getRevision: ReturnType<typeof vi.fn>;
    getApprovedRevision: ReturnType<typeof vi.fn>;
    restoreRevision: ReturnType<typeof vi.fn>;
    approveRevision: ReturnType<typeof vi.fn>;
    saveLinkedinShareLink: ReturnType<typeof vi.fn>;
    retryRun: ReturnType<typeof vi.fn>;
  };

  function query(testId: string): HTMLElement | null {
    return harness.routeNativeElement?.querySelector(`[data-testid="${testId}"]`) ?? null;
  }

  function expectHeaderRunAgain(headerId: string, actionsId: string): HTMLElement {
    const action = query('mktg-document-view-run-again');
    if (!action) throw new Error('Missing Run again action');
    expect(harness.routeNativeElement?.querySelectorAll('[data-testid="mktg-document-view-run-again"]')).toHaveLength(1);
    expect(query(headerId)?.contains(action)).toBe(true);
    expect(query(actionsId)?.contains(action)).toBe(true);
    expect(action.tabIndex).toBe(0);
    for (const token of ['inline-flex', 'border', 'rounded-md', 'px-3', 'py-2']) expect(action.classList.contains(token)).toBe(true);
    return action;
  }

  function expectContentColumn(assetTestId: string): void {
    const content = harness.routeNativeElement?.querySelector('[aria-label="Document content"]');
    const details = harness.routeNativeElement?.querySelector('[aria-label="Revision details"]');
    expect(content?.parentElement?.classList.contains('@[800px]:grid-cols-[minmax(0,1fr)_20rem]')).toBe(true);
    for (const section of [content, details]) {
      expect(section).toBeTruthy();
      expect(section?.classList.contains('min-w-0')).toBe(true);
      expect(section?.className).not.toContain('col-span-2');
    }
    expect(query(assetTestId)?.className).toContain('@container/asset');
    expect(query(assetTestId)?.classList.contains('min-w-0')).toBe(true);
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
  function useFrameworkRevision(viewingDraft = false): void {
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
    const approval = viewingDraft ? null : { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
    const jsonRevision = revision(2, { latest: true, format: 'json', status: '', approval });
    const approvedCurrent = approval ? { revisionId: jsonRevision.id, number: jsonRevision.number } : null;
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
    subject = linkedSignal(() => viewer()?.sub ?? '');
    print.print.mockReset().mockResolvedValue(undefined);
    print.clear.mockClear();
    print.ensureFontStylesheet.mockClear();

    store = {
      listDocuments: vi.fn(() => of({ project: PROJECT.uid, groups: [] })),
      retryRun: vi.fn(() => of(detail)),
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
      saveLinkedinShareLink: vi.fn(() => of({ share_link: 'https://public.example/new' })),
    };
    resolveBrandKit = vi.fn(() => of(null));
    slidesExport = { last: vi.fn(() => of({ last: null, latestRevision: null })), start: vi.fn(() => of()), poll: vi.fn(() => of()) };
    activeContext = signal<ProjectContext | null>(PROJECT);
    projectLookup.mockReturnValue(of({ writer: true }));
    impersonating.set(false);
    viewer.set({ sub: 'synthetic-sub' });

    await TestBed.configureTestingModule({
      providers: [
        provideMktgCommentsStub(),
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
        { provide: MktgDependencyService, useValue: { resolveBrandKit, notifyDocumentsChanged: vi.fn(), documentsChanged$: NEVER } },
        provideMktgSlidesExportStub(slidesExport),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: MktgDocumentStoreService, useValue: store },
        { provide: ProjectService, useValue: { getProject: projectLookup } },
        { provide: UserService, useValue: { impersonating, user: computed(() => (subject() ? { sub: subject() } : undefined)) } },
        { provide: Member360Service, useValue: run },
        { provide: MktgAgentRunService, useValue: { resume: vi.fn(() => NEVER) } },
        { provide: MktgRunAttemptService, useValue: { consume: vi.fn(() => null), load: vi.fn(() => null), prepare: vi.fn() } },
        { provide: MktgPendingDocumentService, useValue: pending },
        { provide: MktgPrintService, useValue: print },
      ],
    }).compileComponents();
  });

  function expectNoKitAssetChrome(): void {
    for (const id of ['approve', 'run-again', 'revision-chip', 'about', 'revisions']) expect(query(`mktg-document-view-${id}`)).toBeNull();
    expect(harness.routeNativeElement?.querySelector('lfx-mktg-asset-meta')).toBeNull();
    expect(store.approveRevision).not.toHaveBeenCalled();
  }

  it('renders stored LinkedIn options and its saved link with the shared copy cards', async () => {
    const type = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'linkedin-post');
    if (!type) throw new Error('Missing LinkedIn test document type');
    const doc = { project: PROJECT.uid, type, documentId: 'run-0123456789abcdef01234567', revisions: [LATEST] };
    const options = [1, 2, 3].map((number) => ({
      number,
      label: `Angle ${number}`,
      text: `Example post ${number}. [LINK]`,
      word_count: 4,
      hashtags: ['#Code', '#Release', '#Community'],
      tagging_suggestions: ['Example project'],
    }));
    store.getDocument.mockReturnValueOnce(of(doc));
    store.getRevision.mockReturnValueOnce(
      of({
        ...doc,
        revision: LATEST,
        markdown: '# Original [LINK]',
        linkedinPost: { options, notes: ['Verify handles.'], answers: { share_link: 'https://public.example/shared' } },
      })
    );
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    await render(`/documents/linkedin-post/${doc.documentId}`);
    expect(harness.routeNativeElement?.querySelectorAll('[data-testid="mktg-linkedin-option"]').length).toBe(3);
    expectNoKitAssetChrome();
    expect(query('mktg-linkedin-draft-another')).not.toBeNull();
    expect(query('mktg-linkedin-post-text')?.textContent).toContain('https://public.example/shared');
    expect(query('mktg-document-view-revisions')).toBeNull();
    expect(query('mktg-linkedin-document-author')).toBeNull();
    const link = query('mktg-linkedin-share-link')?.querySelector('input');
    expect(link?.readOnly).toBe(true);
    expect(link?.value).toBe('https://public.example/shared');
    expect(store.restoreRevision).not.toHaveBeenCalled();
    const button = query('mktg-linkedin-copy-1')?.querySelector('button');
    if (!button) throw new Error('Missing stored copy button');
    button.click();
    await settle();
    expect(clipboard).toHaveBeenCalledWith('Example post 1. https://public.example/shared\n\n#Code #Release #Community');
    expect(query('mktg-linkedin-copy-1')?.textContent).toContain('Copied');
  });

  function linkedinResponse(link = '', isAuthor = true, name: string | null = 'Example author'): MktgRevisionResponse {
    const type = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'linkedin-post');
    if (!type) throw new Error('Missing LinkedIn type');
    return {
      project: PROJECT.uid,
      type,
      documentId: 'run-0123456789abcdef01234567',
      revisions: [LATEST],
      revision: LATEST,
      approval: null,
      approvedCurrent: null,
      markdown: '# Original [LINK]',
      sidecar: null,
      linkedinPost: {
        options: [1, 2, 3].map((number) => ({
          number,
          label: `Angle ${number}`,
          text: 'Original [LINK]',
          word_count: 2,
          hashtags: ['#Code', '#Release', '#Community'],
          tagging_suggestions: ['Example project'],
        })),
        notes: [],
        answers: { share_link: link },
        author: { name },
        isAuthor,
      },
    };
  }
  async function renderLinkedin(response: MktgRevisionResponse): Promise<void> {
    store.getDocument.mockReturnValueOnce(of(response));
    store.getRevision.mockReturnValueOnce(of(response));
    await render(`/documents/linkedin-post/${response.documentId}`);
  }
  it('preserves other answer keys after a share-link save without adding a nested main landmark', async () => {
    const response = linkedinResponse('https://public.example/original');
    if (!response.linkedinPost) throw new Error('Expected synthetic LinkedIn cards');
    response.linkedinPost.answers['other_answer'] = 'Retained synthetic value';
    await renderLinkedin(response);
    expect(harness.routeNativeElement?.querySelector('main')).toBeNull();
    query('mktg-linkedin-edit-link')?.querySelector('button')?.click();
    await settle();
    const input = query('mktg-linkedin-share-link')?.querySelector('input');
    if (!input) throw new Error('Expected editable link');
    input.value = 'https://public.example/new';
    input.dispatchEvent(new Event('input'));
    query('mktg-linkedin-save-link')?.querySelector('button')?.click();
    await settle();
    const component = harness.routeDebugElement?.componentInstance as MktgDocumentViewComponent;
    expect(component['view']()?.linkedinPost?.answers).toEqual({ share_link: 'https://public.example/new', other_answer: 'Retained synthetic value' });
  });

  it('hands a chip focus to the editable field, saves only on success, and can clear the link', async () => {
    await renderLinkedin(linkedinResponse());
    const input = query('mktg-linkedin-share-link')?.querySelector('input');
    if (!input) throw new Error('Missing saved link field');
    input.scrollIntoView = vi.fn();
    query('mktg-linkedin-add-link')?.click();
    await settle();
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    input.value = 'https://public.example/new';
    input.dispatchEvent(new Event('input'));
    const pending = new Subject<{ share_link: string }>();
    store.saveLinkedinShareLink.mockReturnValueOnce(pending);
    query('mktg-linkedin-save-link')?.querySelector('button')?.click();
    await settle();
    expect(input.disabled).toBe(true);
    expect(query('mktg-linkedin-post-text')?.textContent).toContain('add your link');
    pending.next({ share_link: 'https://public.example/new' });
    pending.complete();
    await settle();
    expect(query('mktg-linkedin-post-text')?.textContent).toContain('https://public.example/new');
    expect(input.readOnly).toBe(true);
    expect(store.restoreRevision).not.toHaveBeenCalled();
    query('mktg-linkedin-edit-link')?.querySelector('button')?.click();
    await settle();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    store.saveLinkedinShareLink.mockReturnValueOnce(of({ share_link: '' }));
    query('mktg-linkedin-save-link')?.querySelector('button')?.click();
    await settle();
    expect(query('mktg-linkedin-add-link')).not.toBeNull();
  });
  it('rejects invalid links, keeps the saved link after a failed save, and cancels unsaved changes', async () => {
    await renderLinkedin(linkedinResponse('https://public.example/original'));
    const input = query('mktg-linkedin-share-link')?.querySelector('input');
    if (!input) throw new Error('Missing saved link field');
    input.scrollIntoView = vi.fn();
    query('mktg-linkedin-edit-link')?.querySelector('button')?.click();
    await settle();
    input.value = 'http://public.example/unsafe';
    input.dispatchEvent(new Event('input'));
    query('mktg-linkedin-save-link')?.querySelector('button')?.click();
    await settle();
    expect(store.saveLinkedinShareLink).not.toHaveBeenCalled();
    expect(query('mktg-linkedin-share-error')?.textContent).toContain('HTTPS');
    input.value = 'https://public.example/new';
    input.dispatchEvent(new Event('input'));
    store.saveLinkedinShareLink.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    query('mktg-linkedin-save-link')?.querySelector('button')?.click();
    await settle();
    expect(query('mktg-linkedin-share-error')?.textContent).toContain('could not be saved');
    expect(query('mktg-linkedin-post-text')?.textContent).toContain('https://public.example/original');
    query('mktg-linkedin-cancel-link')?.querySelector('button')?.click();
    await settle();
    expect(input.value).toBe('https://public.example/original');
    expect(query('mktg-linkedin-share-error')).toBeNull();
  });
  it.each([
    [true, 'Example author', 'Writing as'],
    [false, 'Example author', 'Drafted by'],
    [false, null, 'Drafted by'],
  ])('renders author %s / %s at read time', async (isAuthor, name, label) => {
    await renderLinkedin(linkedinResponse('', isAuthor as boolean, name as string | null));
    expect(query('mktg-linkedin-document-author')?.textContent).toContain(`${label} ${name ?? 'name unavailable'}`);
    expect(!!query('mktg-linkedin-document-edit-profile')).toBe(isAuthor);
    expect(query('mktg-document-view-revision-chip')).toBeNull();
  });

  it('takes only the author to their LinkedIn profile edit page', async () => {
    await renderLinkedin(linkedinResponse());
    expect(query('mktg-linkedin-document-date')?.textContent).toMatch(/\d{1,2} Oct 2026/);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    query('mktg-linkedin-document-edit-profile')?.click();
    expect(navigate).toHaveBeenCalledWith(
      ['linkedin-post'],
      expect.objectContaining({
        queryParams: { profile: 'edit', revision: null, type: null },
        state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: true },
      })
    );
  });

  it('explicitly drops the profile-edit marker when drafting another post', async () => {
    await renderLinkedin(linkedinResponse());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    query('mktg-linkedin-draft-another')?.querySelector('button')?.click();
    expect(navigate).toHaveBeenCalledWith(
      ['linkedin-post'],
      expect.objectContaining({ queryParams: { profile: null, revision: null, type: null }, queryParamsHandling: 'merge' })
    );
  });

  it('keeps Markdown-only LinkedIn revisions readable without inventing structured cards', async () => {
    const type = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'linkedin-post');
    if (!type) throw new Error('Missing LinkedIn test document type');
    const doc = { project: PROJECT.uid, type, documentId: 'run-0123456789abcdef01234567', revisions: [LATEST] };
    store.getDocument.mockReturnValueOnce(of(doc));
    store.getRevision.mockReturnValueOnce(of({ ...doc, revision: LATEST, markdown: '# Older post [LINK]' }));
    await render(`/documents/linkedin-post/${doc.documentId}`);
    expect(query('mktg-document-view-document')?.textContent).toContain('Older post [LINK]');
    expect(query('mktg-linkedin-option')).toBeNull();
    expectNoKitAssetChrome();
  });

  it('keeps loading while project context is unresolved', async () => {
    activeContext.set(null);
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-loading')).not.toBeNull();
    expect(store.getDocument).not.toHaveBeenCalled();
    activeContext.set(PROJECT);
    await settle();
    expect(store.getDocument).toHaveBeenCalled();
  });

  it('keeps the document generating until the server confirms persistence', async () => {
    const completion = new Subject<Member360Result>();
    run.isPending.mockReturnValue(true);
    run.waitForStored.mockReturnValue(completion);
    await render('/documents/member-360/run-0123456789abcdef01234567');
    expect(query('mktg-run-activity-title')?.textContent?.trim()).toBe('Working on Member 360');
    expect(query('mktg-run-activity-starting')?.textContent).toContain('Starting the agent');
    expect(query('mktg-run-activity-phase-questions')).toBeNull();
    const onActivity = run.waitForStored.mock.calls.at(-1)?.[2];
    onActivity?.([{ id: 'step-1', kind: 'lfx', label: 'Checking LFX', status: 'running', startedAt: '2026-10-19T10:00:00.000Z' }]);
    await settle();
    expect(query('mktg-run-activity-steps')?.textContent).toContain('Checking LFX');
    expect(store.getDocument).not.toHaveBeenCalled();
    completion.next({ status: 'ready', stored: true });
    await settle();
    expect(store.getDocument).toHaveBeenCalled();
  });

  it.each(
    ['/project/mktg-os-agents', '/foundation/mktg-os-agents'].flatMap((host) =>
      (['no_edit_access', 'agent_stopped'] as const).map((reason) => ({ host, reason }))
    )
  )('shows a short $reason reason, collapsed Details and host-scoped Run again in $host', async ({ host, reason }) => {
    run.isPending.mockReturnValue(true);
    const message =
      reason === 'no_edit_access'
        ? 'SCOPE GUARD: no entitlement for sample-project-uid in this session.'
        : 'The internal session stopped before producing the report.';
    run.waitForStored.mockReturnValue(of({ status: 'failed', reason, message }));
    await render(`${host}/documents/member-360/run-0123456789abcdef01234567?revision=obsolete`);
    const short =
      reason === 'no_edit_access'
        ? "Member 360 couldn't run: your account doesn't have edit access to this project's member data."
        : "Member 360 couldn't finish this run.";
    expect(query('mktg-document-view-error')?.textContent).toContain(short);
    expect(query('mktg-document-view-error')?.textContent).not.toContain(message);
    const details = query('member-360-failure-details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Details');
    expect(query('member-360-failure-message')?.textContent?.trim()).toBe(message);
    details?.querySelector('summary')?.click();
    expect(details?.hasAttribute('open')).toBe(true);
    expect(query('member-360-run-again')?.textContent?.trim()).toBe('Run again');
    expect(query('member-360-run-again')?.getAttribute('href')).toBe(`${host}/member-360?project=testorbit`);
    expect(query('mktg-document-view-retry')).toBeNull();
    expect(query('mktg-document-view-loading')).toBeNull();
    expect(query('mktg-run-activity-title')).toBeNull();
    expect(store.getDocument).not.toHaveBeenCalled();
    expect(store.getRevision).not.toHaveBeenCalled();
  });

  it('shows Member360 activity after Retry of a timed-out receiver, including renewed questions', async () => {
    const completion = new Subject<Member360Result>();
    run.isPending.mockReturnValue(true);
    run.waitForStored
      .mockReset()
      .mockReturnValueOnce(throwError(() => new TimeoutError()))
      .mockReturnValueOnce(completion);
    await render('/documents/member-360/run-0123456789abcdef01234567');
    const retry = query('mktg-document-view-retry')?.querySelector('button');
    if (!retry) throw new Error('Missing synthetic timeout Retry');
    retry.click();
    await settle();
    expect(run.waitForStored).toHaveBeenCalledTimes(2);
    expect(query('mktg-run-activity-title')).not.toBeNull();
    expect(query('mktg-document-view-error')).toBeNull();
    run.waitForStored.mock.calls.at(-1)?.[2]?.([
      { id: 'synthetic-retry-step', kind: 'lfx', label: 'Checking LFX again', status: 'running', startedAt: '2026-10-19T10:00:00.000Z' },
    ]);
    await settle();
    expect(query('mktg-run-activity-steps')?.textContent).toContain('Checking LFX again');
    completion.next({ status: 'needs_input' });
    await settle();
    expect(query('member-360-needs-input')).not.toBeNull();
    expect(query('mktg-run-activity-title')).not.toBeNull();
    expect(store.getDocument).not.toHaveBeenCalled();
    expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
  });

  it('keeps a questions turn open with the feed instead of an error or stored result', async () => {
    run.isPending.mockReturnValue(true);
    run.waitForStored.mockReturnValue(of({ status: 'needs_input' }));
    await render('/documents/member-360/run-0123456789abcdef01234567');
    expect(query('member-360-needs-input')?.textContent).toContain('this version of the page cannot answer yet; the run stays open');
    expect(query('mktg-run-activity-title')).not.toBeNull();
    expect(query('mktg-document-view-error')).toBeNull();
    expect(store.getDocument).not.toHaveBeenCalled();
  });
  it('renders Member 360 as the structured type of this document, not a second viewer', async () => {
    const member360 = member360Fixture();
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), member360 }));
    await render('/documents/member-360/run-0123456789abcdef01234567');
    expect(query('member-360-result')).not.toBeNull();
    expect(query('member-360-ranking')?.textContent).toContain(SYNTHETIC_ORG_NAME);
    expect(query('mktg-document-view-document')).toBeNull();
  });

  it('opens a stored Member 360 report without a subject, including after a user-context flicker', async () => {
    run.waitForStored.mockClear();
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), member360: member360Fixture() }));
    viewer.set(undefined);
    impersonating.set(true);
    await render('/documents/member-360/run-0123456789abcdef01234567');
    expect(query('member-360-result')).not.toBeNull();
    viewer.set({ sub: 'synthetic-writer' });
    await settle();
    viewer.set(undefined);
    await settle();
    expect(query('member-360-result')).not.toBeNull();
    expect(query('mktg-document-view-loading')).toBeNull();
    expect(run.waitForStored).not.toHaveBeenCalled();
  });

  it('gates pending capabilities on the subject but leaves a failed stored read retryable', async () => {
    run.isPending.mockClear();
    run.waitForStored.mockClear();
    viewer.set(undefined);
    run.isPending.mockReturnValue(true);
    run.waitForStored.mockReturnValue(NEVER);
    store.getDocument.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render('/documents/member-360/run-0123456789abcdef01234567');
    expect(run.isPending).not.toHaveBeenCalled();
    expect(run.waitForStored).not.toHaveBeenCalled();
    expect(query('mktg-document-view-loading')).toBeNull();
    expect(query('mktg-document-view-retry')).not.toBeNull();
    viewer.set({ sub: 'synthetic-writer' });
    await settle();
    expect(run.isPending).toHaveBeenCalledWith(PROJECT.uid, 'run-0123456789abcdef01234567');
    expect(run.waitForStored).toHaveBeenCalled();
  });

  it('does not replace a prose document title with the typed document title', async () => {
    TestBed.inject(Title).setTitle('Baseline document · LFX');
    await render('/documents/brand-kit/living');
    expect(TestBed.inject(Title).getTitle()).toBe('Baseline document · LFX');
  });

  it('keeps a Started run with no stored revision in the generating state', async () => {
    const runId = 'b'.repeat(64);
    store.getDocument.mockReturnValue(
      of({
        ...detail,
        current: null,
        revisions: [],
        runs: [{ project: PROJECT.uid, agentKey: BRAND_KIT.agentKey, documentId: 'living', runId, state: 'writing', startedAt: '2026-10-22T05:00:00Z' }],
      })
    );
    await render(`/documents/${BRAND_KIT.agentKey}/living?run=${runId}`);
    expect(store.getRevision).not.toHaveBeenCalled();
    expect(query('mktg-document-view-error')).toBeNull();
    expect(query('mktg-document-view-run')).not.toBeNull();
    expect(query('mktg-document-view-run-steps')?.textContent).toContain('Writing the asset');
    store.getDocument.mockReturnValue(of(detail));
    await harness.navigateByUrl(`/documents/${BRAND_KIT.agentKey}/living?run=${runId}&revision=${LATEST.id}`, MktgDocumentViewComponent);
    await settle();
    expect(store.getRevision).toHaveBeenCalledExactlyOnceWith(PROJECT.uid, BRAND_KIT.agentKey, 'living', LATEST.id, true);
    expect(query('mktg-document-view-loading')).toBeNull();
    expect(query('mktg-document-view-error')).toBeNull();
  });

  afterEach(() => vi.useRealTimers());

  it.each([false, true])('keeps Member 360 on its own receiver without a living hand-off (pending=%s)', async (pending) => {
    run.isPending.mockReturnValue(pending);
    run.waitForStored.mockReset().mockReturnValue(of({ status: 'ready', stored: true }));
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), member360: member360Fixture() }));
    await render('/documents/member-360/run-0123456789abcdef01234567?generation=synthetic-living-handoff');
    expect(query('member-360-result')).not.toBeNull();
    expect(run.waitForStored).toHaveBeenCalledTimes(pending ? 1 : 0);
    expect(store.listDocuments).toHaveBeenCalledWith(PROJECT.uid);
    expect(TestBed.inject(MktgRunAttemptService).consume).not.toHaveBeenCalled();
    expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    expect(query('mktg-document-view-run')).toBeNull();
  });

  function writingActivity(): MktgGenerateProgress {
    return {
      type: 'activity',
      activity: [{ id: 'synthetic-writing', kind: 'writing', label: 'Writing the synthetic asset', status: 'running', startedAt: '2026-10-19T08:00:00Z' }],
    };
  }

  function preparedPending(): MktgPendingGeneration {
    const intake = MKTG_AGENT_INTAKES[BRAND_KIT.catalogAgentId ?? ''];
    if (!intake) throw new Error('Missing synthetic intake');
    return {
      request: { agentId: intake.agentId, projectUid: PROJECT.uid, intake, answers: { project_name: PROJECT.name, website_url: 'https://synthetic.example' } },
      state: 'writing',
      updatedAt: '2026-10-19T08:00:00Z',
    };
  }

  it('keeps a prepared run writing after its first metadata read fails, then resumes polling', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const pending = preparedPending();
    const events = new Subject<MktgGenerateProgress>();
    vi.mocked(TestBed.inject(MktgRunAttemptService).consume).mockReturnValue({ subject: 'synthetic-owner', pending });
    vi.mocked(TestBed.inject(MktgAgentRunService).resume).mockReturnValue(events);
    store.getDocument
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValue(of({ ...detail, revisions: [], runs: [started('writing')] }));
    await render('/documents/brand-kit/living?generation=synthetic-prepared');
    events.next(writingActivity());
    await settle();
    expect(query('mktg-document-view-run-steps')?.textContent).toContain('Writing');
    expect(query('mktg-document-view-refresh-warning')).not.toBeNull();
    expect(query('mktg-document-view-error')).toBeNull();
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(store.getDocument).toHaveBeenCalledTimes(2);
    expect(query('mktg-document-view-refresh-warning')).toBeNull();
    expect(query('mktg-document-view-run-steps')?.textContent).toContain('Writing');
  });

  it('keeps activity writing after submitted, and never regresses storing when activity arrives later', async () => {
    const pending = preparedPending();
    const events = new Subject<MktgGenerateProgress>();
    vi.mocked(TestBed.inject(MktgRunAttemptService).consume).mockReturnValue({ subject: 'synthetic-owner', pending });
    vi.mocked(TestBed.inject(MktgAgentRunService).resume).mockReturnValue(events);
    store.getDocument.mockReturnValue(of({ ...detail, revisions: [], runs: [] }));
    await render('/documents/brand-kit/living?generation=synthetic-prepared');
    events.next({ type: 'submitted' });
    events.next(writingActivity());
    await settle();
    expect(query('mktg-document-view-live-state')?.textContent).toBe('Generating the asset.');
    expect(query('mktg-document-view-run-steps')?.textContent).toContain('Writing');
    const run: MktgStoredAgentRun = {
      agentId: pending.request.agentId,
      projectUid: PROJECT.uid,
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-proof',
      answers: pending.request.answers,
      versions: [{ version: 1, document: '# Synthetic output', createdAt: '2026-10-19T08:00:00Z' }],
      savedAt: '2026-10-19T08:00:00Z',
    };
    events.next(mktgRunProgressFixture('document', run, 1));
    events.next(writingActivity());
    await settle();
    expect(query('mktg-document-view-run-steps')?.textContent).toContain('Saving');
    expect(TestBed.inject(MktgDependencyService).notifyDocumentsChanged).toHaveBeenCalledWith(PROJECT.uid);
    events.next({ type: 'failed', failureText: '' });
    await settle();
    expect(query('mktg-document-view-failure-reply')?.textContent).toContain('The agent could not complete this run');
    expect(query('mktg-document-view-live-state')?.textContent).toBe('The run did not finish.');
  });

  it('logs a sanitized resume failure instead of silently losing the run, without leaking the owner proof', async () => {
    const pending = preparedPending();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(TestBed.inject(MktgRunAttemptService).consume).mockReturnValue({ subject: 'synthetic-owner', pending });
    vi.mocked(TestBed.inject(MktgAgentRunService).resume).mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, url: '/synthetic?ownerToken=SYNTHETIC_PRIVATE_PROOF' }))
    );
    store.getDocument.mockReturnValue(of({ ...detail, revisions: [], runs: [] }));
    try {
      await render('/documents/brand-kit/living?generation=synthetic-prepared');
      expect(log).toHaveBeenCalledWith('Failed to confirm Marketing OS run', { status: 503 });
      expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_PROOF');
      expect(query('mktg-document-view-failure-reply')?.textContent).toContain('could not be confirmed');
      expect(query('mktg-document-view-intake-link')).not.toBeNull();
    } finally {
      log.mockRestore();
    }
  });

  it.each(
    MKTG_DOCUMENT_TYPES.filter((type) => type.catalogAgentId && MKTG_AGENTS.some((agent) => agent.id === type.catalogAgentId && agent.status !== 'active')).map(
      (type) => type.agentKey
    )
  )('offers no dead intake actions for inactive %s documents', async (agentKey) => {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
    if (!type) throw new Error('Missing inactive synthetic type');
    const documentId = type.kind === 'run' ? 'run-' + 'a'.repeat(24) : 'living';
    store.getDocument.mockReturnValue(
      of({ ...detail, type, documentId, revisions: [], runs: [{ ...started('failed'), agentKey: type.agentKey, documentId }] })
    );
    await render(`/documents/${agentKey}/${documentId}`);
    expect(query('mktg-document-view-run-again')).toBeNull();
    expect(query('mktg-document-view-intake-link')).toBeNull();
    expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
  });

  it.each(['writing', 'questions', 'storing', 'failed'] as const)(
    'reads a durable %s run without submitting Generate or inventing a revision',
    async (state) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      store.getDocument.mockReturnValue(of({ ...detail, revisions: [], runs: [started(state)] }));
      await render('/documents/brand-kit/living?run=' + 'b'.repeat(64) + '&type=drop&profile=drop');
      expect(query('mktg-document-view-run')).not.toBeNull();
      expect(query('mktg-document-view-revision-chip')).toBeNull();
      const action = query('mktg-document-view-run-again');
      const run = query('mktg-document-view-run');
      if (!action || !run) throw new Error('Missing first-run actions');
      expect(action.getAttribute('href')).toBe('/mktg-os-agents/brand-kit?project=testorbit&mode=new');
      expect(action.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(query('brand-kit-web-view-header')).toBeNull();
      expect(!!query('mktg-document-view-intake-link')).toBe(state === 'failed' || state === 'questions');
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
      if (state === 'questions') {
        vi.advanceTimersByTime(3 * MKTG_RUN_POLL.intervalMs);
        expect(store.getDocument).toHaveBeenCalledTimes(1);
        expect(query('mktg-document-view-live-state')?.textContent).toContain('Waiting for your answers');
      }
      if (state === 'failed') {
        expect(query('mktg-document-view-failure-reply')?.textContent).toBe(started(state).failureText);
        expect(store.getDocument).toHaveBeenLastCalledWith(PROJECT.uid, BRAND_KIT.agentKey, 'living', false, 'b'.repeat(64));
        store.getDocument.mockReturnValue(of({ ...detail, revisions: [], runs: [started('writing')] }));
        query('mktg-document-view-progress-retry')?.querySelector('button')?.click();
        await settle();
        expect(store.retryRun).toHaveBeenCalledExactlyOnceWith(PROJECT.uid, BRAND_KIT.agentKey, 'living', 'b'.repeat(64));
        expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
        expect(query('mktg-document-view-failure-reply')).toBeNull();
        expect(query('mktg-document-view-intake-link')).toBeNull();
      }
    }
  );

  it('keeps progress Retry distinct from load Retry when a recorded-run check fails', async () => {
    store.getDocument.mockReturnValue(of({ ...detail, runs: [started('failed')] }));
    store.retryRun.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await render('/documents/brand-kit/living?run=' + 'b'.repeat(64));
    query('mktg-document-view-progress-retry')?.querySelector('button')?.click();
    await settle();
    expect(store.retryRun).toHaveBeenCalledTimes(1);
    expect(harness.routeNativeElement?.querySelectorAll('[data-testid="mktg-document-view-progress-retry"]')).toHaveLength(1);
    expect(harness.routeNativeElement?.querySelectorAll('[data-testid="mktg-document-view-retry"]')).toHaveLength(1);
    expect(query('mktg-document-view-failure-reply')).not.toBeNull();
    expect(query('mktg-document-view-error')).not.toBeNull();
  });

  it('does not cancel or reconsume a prepared Generate when refresh is attempted before its ACK', async () => {
    const progress = new Subject<MktgGenerateProgress>();
    const pending: MktgPendingGeneration = {
      request: { agentId: BRAND_KIT_INTAKE.agentId, projectUid: PROJECT.uid, intake: BRAND_KIT_INTAKE, answers: {} },
      state: 'draft',
      updatedAt: '2026-10-15T12:00:00.000Z',
    };
    const attempts = TestBed.inject(MktgRunAttemptService);
    const service = TestBed.inject(MktgAgentRunService);
    vi.mocked(attempts.consume).mockReturnValueOnce({ subject: subject(), pending });
    vi.mocked(service.resume).mockReturnValue(progress);
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 }))).mockReturnValue(of(detail));
    await render('/documents/brand-kit/living?generation=synthetic-delayed-handoff');
    const component = harness.routeDebugElement?.injector.get(MktgDocumentViewComponent);
    if (!component) throw new Error('Missing document receiver');
    expect(progress.observed).toBe(true);
    expect(query('mktg-document-view-refresh-warning')?.textContent).toContain('retrying');
    expect(query('mktg-document-view-refresh-progress')?.querySelector('button')?.disabled).toBe(true);
    expect(query('mktg-document-view-error')).toBeNull();
    component['onRefreshProgress']();
    component['retryLoad']();
    await settle();
    expect(progress.observed).toBe(true);
    expect(attempts.consume).toHaveBeenCalledTimes(1);
    expect(service.resume).toHaveBeenCalledExactlyOnceWith(pending);
    expect(store.getDocument).toHaveBeenCalledTimes(1);
    vi.mocked(attempts.load).mockReturnValue({
      ...pending,
      state: 'writing',
      attempt: {
        runId: 'b'.repeat(64),
        session: { agentId: BRAND_KIT_INTAKE.agentId, sessionId: 'synthetic-delayed-session', ownerToken: 'synthetic-owner-capability' },
        priorVersion: 0,
      },
    });
    progress.next({ type: 'submitted' });
    await settle();
    expect(progress.observed).toBe(true);
    expect(TestBed.inject(Router).url).toContain('run=' + 'b'.repeat(64));
    expect(TestBed.inject(Router).url).not.toContain('generation=');
    component['onRefreshProgress']();
    await settle();
    expect(store.getDocument).toHaveBeenCalledTimes(2);
    expect(attempts.consume).toHaveBeenCalledTimes(1);
    expect(service.resume).toHaveBeenCalledTimes(1);
    expect(query('mktg-document-view-error')).toBeNull();
  });

  it.each([LATEST, OLDER])('blocks revision links and Make current before the prepared ACK while viewing v$number', async (selected) => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === ICP_INTAKE.agentId);
    if (!type) throw new Error('Missing catalog ICP fixture');
    store.getDocument.mockReturnValue(of({ ...detail, type }));
    store.getRevision.mockImplementation((_project: string, _agent: string, _document: string, id: string) =>
      of({ ...revisionResponse(id === OLDER.id ? OLDER : LATEST), type })
    );
    await render(`/documents/${type.agentKey}/living?revision=${selected.id}`);
    const progress = new Subject<MktgGenerateProgress>();
    const pending: MktgPendingGeneration = {
      request: { agentId: ICP_INTAKE.agentId, projectUid: PROJECT.uid, intake: ICP_INTAKE, answers: {} },
      state: 'draft',
      updatedAt: new Date().toISOString(),
    };
    const attempts = TestBed.inject(MktgRunAttemptService);
    const service = TestBed.inject(MktgAgentRunService);
    vi.mocked(attempts.consume).mockReturnValueOnce({ subject: subject(), pending });
    vi.mocked(service.resume).mockReturnValue(progress);
    await harness.navigateByUrl(`/documents/${type.agentKey}/living?revision=${selected.id}&generation=synthetic-held-ack`, MktgDocumentViewComponent);
    await settle();
    const component = harness.routeDebugElement?.injector.get(MktgDocumentViewComponent);
    if (!component) throw new Error('Missing prepared receiver');
    const links = [
      ...(harness.routeNativeElement?.querySelectorAll<HTMLAnchorElement>(
        '[data-testid^="mktg-document-view-open-"], [data-testid="mktg-document-view-history-bar-back"]'
      ) ?? []),
    ];
    expect(links.length).toBeGreaterThan(0);
    const url = TestBed.inject(Router).url;
    for (const link of links) {
      expect(link.getAttribute('aria-disabled')).toBe('true');
      expect(link.getAttribute('tabindex')).toBe('-1');
      expect(link.getAttribute('href')).toBeNull();
      link.click();
    }
    const writes = [
      ...(harness.routeNativeElement?.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="mktg-document-view-restore-"], [data-testid="mktg-document-view-history-bar-make-current"]'
      ) ?? []),
    ];
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((button) => button.disabled)).toBe(true);
    component['onRestore'](OLDER);
    component['onApprove']();
    await settle();
    expect(TestBed.inject(Router).url).toBe(url);
    expect(progress.observed).toBe(true);
    expect(attempts.consume).toHaveBeenCalledTimes(1);
    expect(service.resume).toHaveBeenCalledExactlyOnceWith(pending);
    expect(store.restoreRevision).not.toHaveBeenCalled();
    expect(store.approveRevision).not.toHaveBeenCalled();
    vi.mocked(attempts.load).mockReturnValue({
      ...pending,
      state: 'writing',
      attempt: {
        runId: 'b'.repeat(64),
        priorVersion: 0,
        session: { agentId: ICP_INTAKE.agentId, sessionId: 'synthetic-held-session', ownerToken: 'synthetic-owner' },
      },
    });
    progress.next({ type: 'submitted' });
    await settle();
    expect(progress.observed).toBe(true);
    expect(service.resume).toHaveBeenCalledTimes(1);
    expect(component['submittingGeneration']()).toBe(false);
  });

  it.each((['document', 'persisted'] as const).flatMap((event) => ['agent', 'project', 'document', 'valid'].map((binding) => ({ event, binding }))))(
    'binds a $event receipt to the requested catalog/project/document ($binding)',
    async ({ event, binding }) => {
      await render('/documents/brand-kit/living');
      const component = harness.routeDebugElement?.injector.get(MktgDocumentViewComponent);
      const other = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey !== BRAND_KIT.agentKey);
      if (!component || !other) throw new Error('Missing synthetic receiver binding fixtures');
      const pending: MktgPendingGeneration = {
        request: { agentId: BRAND_KIT_INTAKE.agentId, projectUid: PROJECT.uid, intake: BRAND_KIT_INTAKE, answers: {} },
        state: 'writing',
        updatedAt: new Date().toISOString(),
      };
      const run: MktgStoredAgentRun = {
        agentId: BRAND_KIT_INTAKE.agentId,
        projectUid: binding === 'project' ? 'synthetic-other-project' : PROJECT.uid,
        sessionId: 'synthetic-binding-session',
        ownerToken: 'synthetic-owner',
        answers: {},
        savedAt: new Date().toISOString(),
        versions: [
          {
            version: 1,
            document: '# Synthetic accepted asset',
            createdAt: new Date().toISOString(),
            documentLocation: {
              agentKey: binding === 'agent' ? other.agentKey : BRAND_KIT.agentKey,
              documentId: binding === 'document' ? 'run-0123456789abcdef01234567' : 'living',
              revisionId: LATEST.id,
            },
          },
        ],
      };
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
      const changed = vi.mocked(TestBed.inject(MktgDependencyService).notifyDocumentsChanged);
      changed.mockClear();
      component['onProgress'](mktgRunProgressFixture(event, run, 1), pending);
      await settle();
      if (binding === 'valid') {
        expect(navigate).toHaveBeenCalledExactlyOnceWith(
          [expect.any(String), 'documents', BRAND_KIT.agentKey, 'living'],
          expect.objectContaining({ queryParams: expect.objectContaining({ revision: LATEST.id }) })
        );
        expect(changed).toHaveBeenCalledWith(PROJECT.uid);
      } else {
        expect(navigate).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
        expect(component['errorText']()).toContain('receipt belongs to another asset');
        expect(component['submittingGeneration']()).toBe(false);
      }
    }
  );

  it.each((['document', 'persisted'] as const).flatMap((event) => [false, true].map((receipted) => ({ event, receipted }))))(
    'does not substitute a newer cached receipt for selected $event v1 (receipt=$receipted)',
    async ({ event, receipted }) => {
      await render('/documents/brand-kit/living');
      const component = harness.routeDebugElement?.injector.get(MktgDocumentViewComponent);
      if (!component) throw new Error('Missing selected outcome receiver');
      const pending: MktgPendingGeneration = {
        request: { agentId: BRAND_KIT_INTAKE.agentId, projectUid: PROJECT.uid, intake: BRAND_KIT_INTAKE, answers: {} },
        state: 'writing',
        updatedAt: new Date().toISOString(),
      };
      const location = { agentKey: BRAND_KIT.agentKey, documentId: 'living', revisionId: OLDER.id };
      const run: MktgStoredAgentRun = {
        agentId: BRAND_KIT_INTAKE.agentId,
        projectUid: PROJECT.uid,
        sessionId: 'synthetic-newer-session',
        ownerToken: 'synthetic-newer-proof',
        answers: {},
        savedAt: new Date().toISOString(),
        versions: [
          { version: 1, document: '# Older replay', createdAt: '2026-10-21T09:00:00Z', documentLocation: receipted ? location : undefined },
          { version: 2, document: '# Newer cached document', createdAt: '2026-10-21T10:00:00Z', documentLocation: { ...location, revisionId: LATEST.id } },
        ],
      };
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
      component['onProgress'](mktgRunProgressFixture(event, run, 1), pending);
      await settle();
      if (receipted) {
        expect(navigate).toHaveBeenCalledExactlyOnceWith(
          expect.anything(),
          expect.objectContaining({ queryParams: expect.objectContaining({ revision: OLDER.id }) })
        );
      } else {
        expect(navigate).not.toHaveBeenCalled();
        expect(component['localProgress']()).toBe('storing');
      }
    }
  );

  it.each(['metadata', 'body'])('bounds repeated %s failures together and manual refresh restores the loaded asset', async (failure) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    store.getDocument.mockReturnValue(of({ ...detail, runs: [started('writing')] }));
    await render('/documents/brand-kit/living');
    if (failure === 'metadata') store.getDocument.mockReturnValue(of({ ...detail, runs: [started('writing')], progressUnavailable: true }));
    else store.getRevision.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs + MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(query('mktg-document-view-refresh-warning')?.textContent).toContain('paused');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Current');
    const count = store.getDocument.mock.calls.length;
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs);
    expect(store.getDocument).toHaveBeenCalledTimes(count);
    store.getDocument.mockReturnValue(of(detail));
    store.getRevision.mockReturnValue(of(revisionResponse(LATEST)));
    query('mktg-document-view-refresh-progress')?.querySelector('button')?.click();
    await settle();
    expect(query('mktg-document-view-refresh-warning')).toBeNull();
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Current');
  });

  it('retains an acknowledged current-pointer write when a later body poll fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    store.getDocument.mockReturnValue(of({ ...detail, runs: [started('writing')] }));
    await render('/documents/brand-kit/living');
    query('mktg-document-view-restore-1')?.click();
    await settle();
    store.getRevision.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(query('mktg-document-view-current-1')).not.toBeNull();
    expect(query('mktg-document-view-current-2')).toBeNull();
    expect(query('mktg-document-view-refresh-warning')?.textContent).toContain('last loaded');
  });

  it.each(['subject', 'null-context'])('clears private presentation and cancels polling on %s changes', async (change) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    store.getDocument.mockReturnValueOnce(of({ ...detail, revisions: [], runs: [started('writing')] })).mockReturnValue(NEVER);
    await render('/documents/brand-kit/living');
    if (change === 'subject') subject.set('other-synthetic-owner');
    else activeContext.set(null);
    await settle();
    expect(query('mktg-document-view-run')).toBeNull();
    expect(query('mktg-document-view-revision-chip')).toBeNull();
    const count = store.getDocument.mock.calls.length;
    vi.advanceTimersByTime(3 * MKTG_RUN_POLL.intervalMs);
    expect(store.getDocument).toHaveBeenCalledTimes(count);
  });

  it('keeps an accepted restore write but never presents its receipt to another subject', async () => {
    const pending = new Subject<unknown>();
    store.restoreRevision.mockReturnValue(pending);
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);
    query('mktg-document-view-history-bar-make-current')?.click();
    await settle();
    store.getRevision.mockReturnValue(NEVER);
    subject.set('other-synthetic-owner');
    await settle();
    expect(pending.observed).toBe(true);
    pending.next({ ...detail, revision: RESTORED });
    pending.complete();
    await settle();
    expect(query('mktg-document-view-notice')).toBeNull();
    expect(query('mktg-document-view-revision-chip')).toBeNull();
  });

  it('retains the route project scope for Run again while active context is temporarily null', async () => {
    await render('/documents/brand-kit/living?project=route-synthetic&profile=drop');
    const instance: unknown = harness.routeDebugElement?.componentInstance;
    if (!(instance instanceof MktgDocumentViewComponent)) throw new Error('Missing routed document instance');
    activeContext.set(null);
    await settle();
    expect(instance['runAgainParams']()).toMatchObject({ project: 'route-synthetic', mode: 'new' });
  });

  it.each(['brand-kit', 'foundation-message', 'boilerplates'])('keeps malformed %s assets out of Markdown fallback without hiding history', async (key) => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === key);
    if (!type) throw new Error('Missing synthetic structured type');
    store.getDocument.mockReturnValue(of({ ...detail, type }));
    store.getRevision.mockReturnValue(
      of({ ...revisionResponse(LATEST), type, revision: { ...LATEST, format: 'json' }, markdown: '{malformed synthetic asset' })
    );
    await render(`/documents/${key}/living`);
    expect(query('mktg-document-view-unsupported-asset')).not.toBeNull();
    expect(query('mktg-document-view-run-again')?.getAttribute('href')).toBe('/mktg-os-agents/' + type.catalogAgentId + '?project=testorbit&mode=new');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-document-view-revisions')).not.toBeNull();
  });

  it('opens the latest ICP Markdown revision when no revision is asked for', async () => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'icp');
    if (!type) throw new Error('Missing synthetic ICP document type');
    store.getDocument.mockReturnValue(of({ ...detail, type }));
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), type }));
    TestBed.inject(Title).setTitle('Baseline document · LFX');
    await render('/documents/icp/living');

    expect(TestBed.inject(Title).getTitle()).toBe('Baseline document · LFX');
    expect(store.getDocument).toHaveBeenCalledWith('proj-1', 'icp', 'living', false);
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'icp', 'living', LATEST.id, true);
    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit ICP');
    expect(query('mktg-document-view-run-again')?.getAttribute('href')).toBe('/mktg-os-agents/' + type.catalogAgentId + '?project=testorbit&mode=new');
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
    expect(query('mktg-breadcrumb-link-1')?.getAttribute('href')).toContain('/families/positioning-brand?project=testorbit');
    expect(query('mktg-document-view-back-link')).toBeNull();
  });

  it('omits project query state from parent links when context is absent', async () => {
    await render('/documents/brand-kit/living');
    activeContext.set(null);
    await settle();
    expect(query('mktg-breadcrumb-link-0')?.getAttribute('href')).not.toContain('project=');
    expect(query('mktg-breadcrumb-link-1')?.getAttribute('href')).not.toContain('project=');
  });

  it('requests an explicit current pointer even when its revision is missing from the summaries', async () => {
    const missing = `000003-${'3'.repeat(64)}`;
    store.getDocument.mockReturnValue(of({ ...detail, current: { revisionId: missing, changedAt: '2026-10-15T13:00:00.000Z', changedBy: { name: null } } }));
    store.getRevision.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render('/documents/brand-kit/living');
    expect(store.getRevision).toHaveBeenCalledExactlyOnceWith('proj-1', 'brand-kit', 'living', missing, true);
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

  it.each(['/project/mktg-os-agents', '/foundation/mktg-os-agents'])('keeps legacy ICP navigation in its %s host', async (host) => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'icp');
    if (!type) throw new Error('Synthetic legacy document type missing');
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), type }));
    await render(`${host}/documents/icp/living`);
    expect(query('mktg-breadcrumb-link-1')?.getAttribute('href')).toBe(`${host}/families/positioning-brand?project=testorbit`);
    expect(query('mktg-document-view-back-link')).toBeNull();
  });

  it.each(['/project/mktg-os-agents', '/foundation/mktg-os-agents'])('keeps fixed parents in its %s host without revision/type state', async (host) => {
    await render(`${host}/documents/brand-kit/living?type=brand-kit&revision=${LATEST.id}`);
    expect(query('mktg-breadcrumb-link-0')?.getAttribute('href')).toBe(`${host}?project=testorbit`);
    expect(query('mktg-breadcrumb-link-1')?.getAttribute('href')).toBe(`${host}/families/positioning-brand?project=testorbit`);
    expect(query('mktg-breadcrumb-current')?.textContent).toContain('Brand Kit');
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

  it.each([
    ['brand-kit', 'Positioning & brand', 'positioning-brand'],
    ['linkedin-post', 'Social & community', 'social-community'],
    ['icp', 'Positioning & brand', 'positioning-brand'],
  ])('maps %s to fixed shared parents and a current asset crumb', async (key, familyName, familyId) => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === key);
    if (!type) throw new Error('Synthetic document type missing');
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), type }));
    await render(`/project/mktg-os-agents/documents/${key}/living?project=proj-1&revision=${LATEST.id}`);
    expect(query('mktg-document-view-back-link')).toBeNull();
    expect(query('mktg-breadcrumb-link-0')?.textContent).toContain('TestOrbit kit');
    expect(query('mktg-breadcrumb-link-0')?.getAttribute('href')).toBe('/project/mktg-os-agents?project=testorbit');
    expect(query('mktg-breadcrumb-link-1')?.textContent).toBe(familyName);
    expect(query('mktg-breadcrumb-link-1')?.getAttribute('href')).toBe(`/project/mktg-os-agents/families/${familyId}?project=testorbit`);
    expect(query('mktg-breadcrumb-current')?.textContent).toBe(type.itemLabel);
    expect(query('mktg-document-view-title')).not.toBeNull();
    // LinkedIn posts hide the revision chip (Joan's LinkedIn post board: no Approve, you finish by copying a post).
    expect(query('mktg-document-view-revision-chip') !== null).toBe(key !== 'linkedin-post');
  });

  it('keeps both crumbs on the current context without router navigation, clearing document-only params', async () => {
    await render(`/project/mktg-os-agents/documents/brand-kit/living?project=stale&type=brand-kit&revision=${LATEST.id}`);
    activeContext.set({ ...PROJECT, uid: 'next', slug: 'current' });
    await settle();
    expect(TestBed.inject(Router).url).toContain('project=stale');
    for (const id of ['mktg-breadcrumb-link-0', 'mktg-breadcrumb-link-1']) {
      const params = new URL(query(id)?.getAttribute('href') ?? '', 'https://synthetic.example').searchParams;
      expect(params.get('project')).toBe('current');
      expect(params.has('type')).toBe(false);
      expect(params.has('revision')).toBe(false);
    }
  });

  it.each(['writing', 'questions', 'storing', 'failed'] as const)('keeps Run again in the loaded kit header during a %s run', async (state) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const run = started(state);
    store.getDocument.mockReturnValue(of({ ...detail, runs: [run] }));
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), runs: [run], sidecar: kitSidecar() }));
    await render('/documents/brand-kit/living?run=' + run.runId);
    expect(query('mktg-document-view-run')).not.toBeNull();
    const action = expectHeaderRunAgain('brand-kit-web-view-header', 'brand-kit-web-view-actions');
    const download = query('brand-kit-web-view-download-pdf');
    if (!download) throw new Error('Missing kit download');
    expect(action.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(action.getAttribute('href')).toBe('/mktg-os-agents/brand-kit?project=testorbit&mode=new');
    expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
  });

  it('offers the open non-current revision in a subtle bar before the kit header actions without changing keyboard order', async () => {
    store.getRevision.mockReturnValue(of({ ...revisionResponse(OLDER), sidecar: kitSidecar() }));
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    expect(store.getDocument).not.toHaveBeenCalled();
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id, false);
    expect(query('mktg-document-view-version')?.textContent).toContain('v1');
    expect(query('mktg-document-view-revisions')?.querySelectorAll('ol > li')).toHaveLength(2);
    expect(query('mktg-document-view-restore-current')).toBeNull();
    expect(query('mktg-document-view-history-bar-summary')?.textContent).toBe(
      "You're viewing v1 · 13 Oct · no name (stored before names were recorded) · v2 is current"
    );
    expect(query('mktg-document-view-history-bar-make-current')?.textContent).toContain('Make v1 current');
    expect(query('mktg-document-view-history-bar-back')?.getAttribute('href')).toBe(`/documents/brand-kit/living?revision=${LATEST.id}`);
    const summary = query('mktg-document-view-history-bar-summary');
    const runAgain = expectHeaderRunAgain('brand-kit-web-view-header', 'brand-kit-web-view-actions');
    if (!summary) throw new Error('Missing history fixture');
    expect(summary.compareDocumentPosition(runAgain) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const focusable = Array.from(harness.routeNativeElement?.querySelectorAll<HTMLElement>('a[href], button, [tabindex]') ?? []).filter(
      (element) => element.tabIndex >= 0 && !element.hasAttribute('disabled')
    );
    const navigationLink = query('mktg-breadcrumb-link-1');
    if (!navigationLink) throw new Error('Missing shared parent breadcrumb');
    expect(focusable[focusable.indexOf(navigationLink) + 1]).toBe(summary);
    const bar = query('mktg-document-view-history-bar');
    for (const token of ['sticky', 'h-[34px]', 'text-[13px]', 'bg-gray-50']) expect(bar?.classList.contains(token)).toBe(true);
    expect(query('mktg-document-view-hash')?.classList.contains('relative')).toBe(true);
    expect(query('mktg-document-view-hash')?.textContent).toContain(OLDER.contentSha256);
  });

  it('lands on the exact redraft receipt without approving or selecting whichever revision is current', async () => {
    useFrameworkRevision();
    await render('/documents/foundation-message/living');
    const panel = harness.routeDebugElement?.query(By.directive(MktgCommentsPanelComponent)).componentInstance as MktgCommentsPanelComponent | undefined;
    if (!panel) throw new Error('Missing synthetic comments panel');
    const id = `000003-${'c'.repeat(64)}`;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    panel.ready.emit({ agentKey: 'foundation-message', documentId: 'living', revisionId: id });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/mktg-os-agents', 'documents', 'foundation-message', 'living'], {
      queryParams: expect.objectContaining({ revision: id }),
    });
    expect(store.approveRevision).not.toHaveBeenCalled();
    expect(store.restoreRevision).not.toHaveBeenCalled();
  });

  it.each([undefined, 'voice'])('keeps the reader tab or pinned chapter %s when a kit redraft lands', async (pinnedTab) => {
    store.getRevision.mockReturnValue(of({ ...revisionResponse(LATEST), sidecar: kitSidecar() }));
    await render('/documents/brand-kit/living?tab=color');
    const panel = harness.routeDebugElement?.query(By.directive(MktgCommentsPanelComponent)).componentInstance as MktgCommentsPanelComponent | undefined;
    if (!panel) throw new Error('Missing synthetic comments panel');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const id = `000003-${'c'.repeat(64)}`;
    panel.ready.emit({ agentKey: 'brand-kit', documentId: 'living', revisionId: id, tab: pinnedTab });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/mktg-os-agents', 'documents', 'brand-kit', 'living'], {
      queryParams: expect.objectContaining({ revision: id, tab: pinnedTab ?? 'color' }),
    });
    expect(store.approveRevision).not.toHaveBeenCalled();
    expect(store.restoreRevision).not.toHaveBeenCalled();
  });

  it('reports a stored Draft whose landing is rejected instead of silently losing the result', async () => {
    useFrameworkRevision();
    await render('/documents/foundation-message/living');
    const panel = harness.routeDebugElement?.query(By.directive(MktgCommentsPanelComponent)).componentInstance as MktgCommentsPanelComponent | undefined;
    if (!panel) throw new Error('Missing synthetic comments panel');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    panel.ready.emit({ agentKey: 'boilerplates', documentId: 'living', revisionId: `000003-${'c'.repeat(64)}` });
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(query('mktg-document-view-notice')?.textContent).toContain('A new Draft was stored; open it from Revisions');
    expect(store.approveRevision).not.toHaveBeenCalled();
  });

  it('clears comments while a different historical revision is still loading', async () => {
    useFrameworkRevision();
    const select = vi.spyOn(TestBed.inject(MktgDocumentCommentsService), 'select');
    await render('/documents/foundation-message/living');
    store.getRevision.mockReturnValue(NEVER);
    await TestBed.inject(Router).navigateByUrl('/documents/foundation-message/living?revision=' + OLDER.id);
    await settle();
    expect(query('mktg-comments-panel')).toBeNull();
    expect(select).toHaveBeenLastCalledWith(null);
  });

  it('renders the framework with its report and revision-scoped Comments sidebar', async () => {
    useFrameworkRevision();
    const selectComments = vi.spyOn(TestBed.inject(MktgDocumentCommentsService), 'select');

    await render('/documents/foundation-message/living');

    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Messaging framework');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-framework-view-title')).toBeNull();
    expect(query('mktg-document-view-version')?.textContent).toContain('v2');
    const runAgain = expectHeaderRunAgain('mktg-framework-view-header', 'mktg-framework-view-actions');
    const exportAction = query('mktg-framework-view-export-slides');
    if (!exportAction) throw new Error('Missing framework export');
    expect(exportAction.compareDocumentPosition(runAgain) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(runAgain.getAttribute('href')).toBe(
      '/mktg-os-agents/' + MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message')?.catalogAgentId + '?project=testorbit&mode=new'
    );
    expect(query('mktg-framework-view-tagline')?.textContent).toContain('Release, open.');
    expect(query('mktg-framework-view-goal-adoption')?.textContent).toContain('End users');
    expectContentColumn('mktg-framework-view');
    expect(query('mktg-document-view-revisions')?.parentElement?.querySelector('lfx-mktg-downstream')).not.toBeNull();
    expect(query('mktg-comments-panel')).not.toBeNull();
    expect(query('mktg-comments-panel')?.closest('[aria-label="Revision details"]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('[aria-label="Document content"]')?.parentElement?.className).toContain('@[800px]:grid-cols');
    expect(selectComments).toHaveBeenLastCalledWith({ projectUid: PROJECT.uid, agentKey: 'foundation-message', documentId: 'living', revisionId: LATEST.id });

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

  it('keeps content and an accepted approval alive through progressive refresh', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const response = faqResponse();
    const pending = new Subject<MktgRevisionResponse>();
    store.getDocument.mockReturnValue(of({ ...response, runs: [{ ...started('writing'), agentKey: 'faq' }] }));
    store.getRevision.mockImplementation(() => of({ ...response }));
    store.approveRevision.mockReturnValue(pending);
    await render('/documents/faq/living');
    const content = query('mktg-document-view-faq');
    expect(content).not.toBeNull();
    query('mktg-document-view-approve')?.querySelector('button')?.click();
    await settle();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(store.getDocument.mock.calls.length).toBeGreaterThan(1);
    expect(query('mktg-document-view-faq')).toBe(content);
    expect(pending.observed).toBe(true);
    expect(query('mktg-document-view-approve')?.querySelector('button')?.disabled).toBe(true);
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
    pending.next({ ...response, approval, revision: { ...response.revision, approval }, approvedCurrent: { revisionId: LATEST.id, number: 2 } });
    pending.complete();
    await settle();
    expect(query('mktg-document-view-approval-state')?.textContent?.trim()).toBe('Approved');
    expect(query('mktg-document-view-approve')).toBeNull();
  });

  it('does not consume or resume a creator hand-off before initial identity resolution', async () => {
    viewer.set(undefined);
    await render('/documents/brand-kit/living?generation=synthetic-handoff');
    expect(store.getDocument).toHaveBeenCalled();
    expect(TestBed.inject(MktgRunAttemptService).consume).not.toHaveBeenCalled();
    expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    viewer.set({ sub: 'synthetic-resolved-subject' });
    await settle();
    expect(TestBed.inject(MktgRunAttemptService).consume).toHaveBeenCalledExactlyOnceWith('synthetic-handoff', PROJECT.uid, BRAND_KIT.catalogAgentId);
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
    expect(query('mktg-document-view-run-again')?.getAttribute('href')).toBe('/project/mktg-os-agents/foundation-setup?project=testorbit&mode=new');
    store.getRevision.mockReturnValue(of(faqResponse()));
    await harness.navigateByUrl(`/project/mktg-os-agents/documents/faq/living?project=testorbit&revision=${LATEST.id}`);
    await settle();
    expect(query('mktg-document-view-run-again')?.getAttribute('href')).toBe('/project/mktg-os-agents/faq?project=testorbit&mode=new');
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

  it('omits Approve for a legacy-only pre-revision Markdown document', async () => {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'icp');
    if (!type) throw new Error('Missing synthetic Markdown type');
    const legacy = revision(1, { id: `legacy-${'a'.repeat(64)}`, origin: 'legacy', latest: true });
    store.getRevision.mockReturnValue(of({ ...revisionResponse(legacy), type, revisions: [legacy] }));
    await render(`/documents/icp/living?revision=${legacy.id}`);
    expect(harness.routeNativeElement?.querySelector('lfx-markdown-renderer')).not.toBeNull();
    expect(query('mktg-document-view-approve')).toBeNull();
    expect(store.approveRevision).not.toHaveBeenCalled();
  });

  it('keeps a legacy Brand Kit unsupported without Markdown fallback or approval', async () => {
    const legacy = revision(1, { id: `legacy-${'a'.repeat(64)}`, origin: 'legacy', latest: true });
    store.getRevision.mockReturnValue(of({ ...revisionResponse(legacy), revisions: [legacy] }));
    await render(`/documents/brand-kit/living?revision=${legacy.id}`);
    expect(query('mktg-document-view-unsupported-asset')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('lfx-markdown-renderer')).toBeNull();
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

  it.each([401, 403])('asks for write access on a %s', async (status) => {
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status })));
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
  it('renders a Brand Kit revision on the kit’s web view, in the content column, from its sidecar — the book for print only, not the Markdown, not the framework view', async () => {
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
    const approved = { ...LATEST, approval };
    store.getRevision.mockReturnValue(
      of({ ...revisionResponse(approved), approval, approvedCurrent: { revisionId: approved.id, number: approved.number }, sidecar: kitSidecar() })
    );

    await render('/documents/brand-kit/living');

    expect(query('mktg-document-view-brand-kit')).not.toBeNull();
    const panel = harness.routeDebugElement?.query(By.directive(MktgCommentsPanelComponent)).componentInstance as MktgCommentsPanelComponent | undefined;
    expect(panel?.scope()).toEqual({ projectUid: PROJECT.uid, agentKey: 'brand-kit', documentId: 'living', revisionId: LATEST.id });
    expect(panel?.content()).toMatchObject({ chapters: kitSidecar()['chapters'], kit: kitSidecar()['kit'] });
    expect(harness.routeDebugElement?.query(By.directive(MktgSlidesExportComponent)).componentInstance.viewingDraft()).toBe(false);
    expect(query('mktg-comments-panel')?.closest('[aria-label="Revision details"]')).not.toBeNull();
    expect(query('mktg-document-view-framework')).toBeNull();
    expect(query('mktg-document-view-document')).toBeNull();
    expectContentColumn('brand-kit-web-view');
    expect(query('brand-kit-web-view-title')).toBeNull();
    expect(query('mktg-document-view-version')?.textContent?.trim()).toBe(`v${LATEST.number}`);
    expect(query('mktg-document-view-brand-kit')?.parentElement?.parentElement?.className).toContain('@[800px]:grid-cols');
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
    expect(harness.routeDebugElement?.query(By.directive(MktgSlidesExportComponent)).componentInstance.viewingDraft()).toBe(true);
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

  it.each([true, false])('passes the viewed framework Draft state (%s) through to its export panel', async (viewingDraft) => {
    useFrameworkRevision(viewingDraft);
    await render('/documents/foundation-message/living');
    expect(harness.routeDebugElement?.query(By.directive(MktgSlidesExportComponent)).componentInstance.viewingDraft()).toBe(viewingDraft);
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

  it('renders a Boilerplates revision (JSON content) on the Boilerplates view, in the content column, with the sidecar’s report and word counts', async () => {
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
    const runAgain = expectHeaderRunAgain('mktg-boilerplates-view-header', 'mktg-boilerplates-view-actions');
    expect(runAgain.getAttribute('href')).toBe('/mktg-os-agents/boilerplates?project=testorbit&mode=new');
    expect(query('mktg-boilerplates-view-text-0')?.textContent).toContain('TestOrbit is the open release toolkit.');
    expect(query('mktg-boilerplates-view-count-1')?.textContent).toContain('10 / 25 words');
    const panel = harness.routeDebugElement?.query(By.directive(MktgCommentsPanelComponent)).componentInstance as MktgCommentsPanelComponent | undefined;
    expect(panel?.scope()).toEqual({ projectUid: PROJECT.uid, agentKey: 'boilerplates', documentId: 'living', revisionId: jsonRevision.id });
    expect(panel?.content()).toEqual(content);
    expectContentColumn('mktg-boilerplates-view');
    expect(query('mktg-comments-panel')?.closest('[aria-label="Revision details"]')).not.toBeNull();

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

  it('renders an FAQ revision (JSON content) on the FAQ view, in the content column, flagging what needs an answer', async () => {
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
    expect(query('mktg-comments-panel')).toBeNull();
    expect(query('mktg-faq-view-metadata')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('lfx-mktg-slides-export')).toBeNull();
    expect(query('mktg-faq-view-question-0-0')?.textContent).toContain('An open release toolkit.');
    expect(query('mktg-faq-view-needs-answer-0-1')).not.toBeNull();
    expect(query('mktg-faq-view-unanswered-chip')?.textContent).toContain('1 question needs an answer from your team');
    expectContentColumn('mktg-faq-view');
  });
});
