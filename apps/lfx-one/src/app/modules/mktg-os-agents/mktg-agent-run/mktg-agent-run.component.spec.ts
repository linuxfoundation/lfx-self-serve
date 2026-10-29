// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ICP_INTAKE,
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_READ_REASONS,
  MKTG_AGENT_INTAKES,
  MKTG_AGENTS,
  MKTG_DOCUMENT_TYPES,
  MKTG_INTAKE_FORMAT_ERRORS,
  MKTG_INTAKE_LINK_ADVICE,
  MKTG_DRIVE_SHARING_HINT,
  MKTG_RUN_FAILURE_REASON,
  MKTG_RUN_ACTIVE,
  MKTG_RUN_ANSWERED,
} from '@lfx-one/shared/constants';
import {
  MktgAgent,
  MktgAgentIntake,
  MktgActiveRunConflict,
  MktgAnswerMemory,
  MktgDependencyDocument,
  MktgDocumentExtractResponse,
  MktgDocumentDetailResponse,
  MktgDocumentRunProgress,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgPendingGeneration,
  MktgRevisionSummary,
  MktgRunAnswer,
  MktgRunAsset,
  MktgRunQuestionsPending,
  MktgRunVersion,
  MktgStoredAgentRun,
  Project,
  ProjectContext,
  User,
} from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgIntakeDocumentsService } from '@services/mktg-intake-documents.service';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { mktgRunProgressFixture } from '@shared/testing/mktg-run-progress-test-data';
import { mktgSentenceCaseLabel } from '@lfx-one/shared/utils/mktg-navigation.utils';
import { mktgActiveRunConflictHeading } from '@lfx-one/shared/utils/mktg-run-active.utils';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, ConfirmEventType, MessageService } from 'primeng/api';
import { BehaviorSubject, concat, from, NEVER, of, Subject, throwError, TimeoutError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { MktgIntakeDocumentsComponent } from '../mktg-intake-documents/mktg-intake-documents.component';
import { MktgIntakeLogoFilesComponent } from '../mktg-intake-logo-files/mktg-intake-logo-files.component';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';
import { MktgAgentRunComponent } from './mktg-agent-run.component';
import { MktgRunProgressComponent } from '../components/mktg-run-progress/mktg-run-progress.component';

/**
 * A fixture agent for the shell's OWN logic — the LFX prefill sources, a
 * format rule, the section checklist, the chat follow-up path — registered
 * in the catalog for this spec only. No shipping intake carries every one of
 * those shapes any more (the Brand Kit became a logo-upload form with a JSON
 * kit for a result), and the shell's behaviour is what these cases lock, not
 * any one agent's form.
 */
const SHELL_AGENT: MktgAgent = {
  id: 'shell-fixture',
  number: 99,
  name: 'Shell Fixture Agent',
  tags: ['Fixture'],
  status: 'active',
  description: 'A fixture.',
  icon: 'fa-light fa-flask',
  accent: 'gray',
  guildAgentHandle: 'shell-fixture',
};
const SHELL_INTAKE: MktgAgentIntake = {
  agentId: SHELL_AGENT.id,
  formTitleAction: 'Develop',
  documentName: 'Fixture Document',
  intro: 'A fixture intake.',
  batchPreamble: ['BATCH INTAKE SUBMISSION (fixture).'],
  fields: [
    { key: 'project_name', question: "What's the name of the LF project?", kind: 'text', prefill: 'project-name' },
    { key: 'github_url', question: "What's the URL of the project's GitHub repo or README?", kind: 'text', prefill: 'repository-url', format: 'github-url' },
    {
      key: 'one_line_description',
      question: 'One-line description — what does it do, beyond the name?',
      kind: 'text',
      prefill: 'project-description',
      missingPrefillHint: 'Not set on your LFX project — describe it in your own words.',
    },
    { key: 'voice_adjectives', question: 'Three adjectives for the voice you want?', kind: 'textarea', rows: 2 },
  ],
  sections: ['Review Sheet', 'How to Use This Document', '1. Project Definition', '2. Positioning', 'Appendix A: Document Architecture'],
  endpoints: {
    generate: '/api/mktg-agents/shell-fixture/generate',
    result: '/api/mktg-agents/shell-fixture/result',
    answers: '/api/mktg-agents/shell-fixture/answers',
  },
};
MKTG_AGENTS.push(SHELL_AGENT);
MKTG_AGENT_INTAKES[SHELL_AGENT.id] = SHELL_INTAKE;

/**
 * Locks the run page's own logic — the pieces the service spec cannot see:
 * the fromLfx (prefill APPLIED) vs lfxMissing (source actually empty)
 * invariant behind the "From LFX" chips and the "not set on your LFX project"
 * hint, the section checklist's prefix-tolerant heading matcher, the full
 * state reset + restore on an active-context switch, and the SSR guard on
 * download.
 */
describe('MktgAgentRunComponent', () => {
  const PROJECT_1: ProjectContext = { uid: 'proj-1', name: 'Project One', slug: 'proj-one' };
  const PROJECT_2: ProjectContext = { uid: 'proj-2', name: 'Project Two', slug: 'proj-two' };

  let fixture: ComponentFixture<MktgAgentRunComponent>;
  let component: MktgAgentRunComponent;
  let activeContext: WritableSignal<ProjectContext | null>;
  let userSignal: WritableSignal<User | null>;
  /** Stored run per projectUid, returned by the mocked run service. */
  let storedRuns: Record<string, MktgStoredAgentRun>;
  /** Project detail per slug, resolved by the mocked getProject. */
  let projects: Record<string, Partial<Project> | null>;
  /** Resolved dependency document per `<projectUid>:<agentId>`, returned by the mocked dependency service. */
  let dependencyDocs: Record<string, MktgDependencyDocument>;
  /** Remembered answers per projectUid, returned by the mocked answer memory. */
  let rememberedAnswers: Record<string, MktgAnswerMemory>;
  let loadRun: Mock;
  let lastIntake: Mock;
  let listDocuments: Mock;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let getProject: Mock;
  let generate: Mock;
  let answerQuestions: Mock;
  let resolveDependencies: Mock;
  let resolveBrandKit: Mock;
  let rememberAnswers: Mock;
  let notifyDocumentsChanged: Mock;
  let slidesExport: { last: Mock; start: Mock; poll: Mock };
  let readFile: Mock;
  let confirmationService: ConfirmationService;
  const discardPrompt = () => vi.mocked(confirmationService.confirm).mock.calls.at(-1)?.[0];

  const storedRun = (projectUid: string, document: string, answers: Record<string, string>): MktgStoredAgentRun => ({
    agentId: SHELL_AGENT.id,
    projectUid,
    sessionId: `sess-${projectUid}`,
    ownerToken: `token-${projectUid}`,
    answers,
    versions: [{ version: 1, document, createdAt: '2026-08-19T00:00:00.000Z' }],
    savedAt: '2026-08-19T00:00:00.000Z',
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  const fromLfxChip = (fieldKey: string): HTMLElement | null => query(`mktg-agent-run-from-lfx-${fieldKey}`);
  const priorRunChip = (fieldKey: string): HTMLElement | null => query(`mktg-agent-run-from-prior-run-${fieldKey}`);
  const fieldError = (fieldKey: string): HTMLElement | null => query(`mktg-agent-run-field-error-${fieldKey}`);

  const configure = async (platformId: 'browser' | 'server' = 'browser', agentId = SHELL_AGENT.id, params: Record<string, string> = {}): Promise<void> => {
    window.localStorage.clear();
    activeContext = signal<ProjectContext | null>(null);
    userSignal = signal<User | null>({ sub: 'auth0|user-1' } as User);
    storedRuns = {};
    projects = {};
    queryParams = new BehaviorSubject(convertToParamMap(params));
    lastIntake = vi.fn(() => of(null));
    listDocuments = vi.fn(() => of({ groups: [] }));
    dependencyDocs = {};
    rememberedAnswers = {};
    rememberAnswers = vi.fn();
    notifyDocumentsChanged = vi.fn();
    readFile = vi.fn();
    // Stored runs are keyed per agent: `<projectUid>` alone keeps the legacy
    // brand-kit fixtures working, `<projectUid>:<agentId>` scopes when a test
    // needs both the page agent's run AND a dependency source run.
    loadRun = vi.fn((projectUid: string, runAgentId: string) => storedRuns[`${projectUid}:${runAgentId}`] ?? storedRuns[projectUid] ?? null);
    getProject = vi.fn((slug: string) => of(projects[slug] ?? null));
    generate = vi.fn(() => of<MktgGenerateProgress>({ type: 'submitted' }));
    answerQuestions = vi.fn(() => of<MktgGenerateProgress>({ type: 'submitted' }));
    resolveDependencies = vi.fn((projectUid: string, agentIds: string[]) =>
      of(Object.fromEntries(agentIds.map((agentId) => [agentId, dependencyDocs[`${projectUid}:${agentId}`] ?? null])))
    );
    resolveBrandKit = vi.fn(() => of(null));
    slidesExport = {
      last: vi.fn(() => of({ last: null, latestRevision: null })),
      start: vi.fn(() => of({ sessionId: 's', ownerToken: 't', revision: { id: 'r', number: 1, contentSha256: 'a' }, mode: 'create', logoNote: null })),
      poll: vi.fn(() => NEVER),
    };

    await TestBed.configureTestingModule({
      imports: [MktgAgentRunComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        // The documents section's file-upload wrapper (PrimeNG) injects HttpClient; the testing backend keeps every request local.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platformId },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParams.asObservable(),
            snapshot: {
              paramMap: convertToParamMap({ agentId }),
              get queryParamMap() {
                return queryParams.value;
              },
            },
          },
        },
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: () => activeContext()?.uid ?? '' } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: UserService, useValue: { user: userSignal } },
        {
          provide: MktgAgentRunService,
          useValue: {
            loadRun,
            lastIntake,
            generate,
            answerQuestions,
            acknowledgementVersion: signal(0),
            resume: vi.fn(() => NEVER),
            activeRunConflict: MktgAgentRunService.prototype.activeRunConflict,
            canRetryActiveConflict: vi.fn(() => true),
            recheckActiveConflict: vi.fn(() => NEVER),
          },
        },
        { provide: MktgDocumentStoreService, useValue: { listDocuments, getDocument: vi.fn(() => NEVER) } },
        { provide: MktgDependencyService, useValue: { resolveDependencies, resolveBrandKit, notifyDocumentsChanged, documentsChanged$: NEVER } },
        provideMktgSlidesExportStub(slidesExport),
        { provide: MktgIntakeDocumentsService, useValue: { readFile } },
        {
          provide: MktgAnswerMemoryService,
          useValue: { load: (projectUid: string): MktgAnswerMemory => rememberedAnswers[projectUid] ?? {}, remember: rememberAnswers },
        },
        MessageService,
      ],
    }).compileComponents();

    if (!vi.isMockFunction(Router.prototype.navigate)) vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(MktgAgentRunComponent);
    component = fixture.componentInstance;
    confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    vi.spyOn(confirmationService, 'confirm');
    await fixture.whenStable();
  };

  function useRecordedStateFixture(
    agentId: string,
    runId: string,
    state: 'writing' | 'questions',
    pendingQuestions?: MktgDocumentRunProgress['pendingQuestions'],
    startedAt = new Date().toISOString()
  ): void {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
    if (!type) throw new Error('Missing recorded fixture type');
    const run: MktgDocumentRunProgress = {
      project: PROJECT_1.uid,
      agentKey: type.agentKey,
      documentId: 'living',
      runId,
      state,
      startedAt,
      ...(pendingQuestions && { pendingQuestions }),
    };
    listDocuments.mockReturnValue(of({ project: PROJECT_1.uid, groups: [], runs: [run] }));
    vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(
      of({ project: PROJECT_1.uid, type, documentId: 'living', approvedCurrent: null, revisions: [], runs: [run] })
    );
  }
  function useRecordedQuestionsFixture(pending: MktgRunQuestionsPending, startedAt = new Date().toISOString()): void {
    pending.attempt.runId ??= 'b'.repeat(64);
    useRecordedStateFixture(
      pending.attempt.session.agentId,
      pending.attempt.runId,
      'questions',
      { questionsId: pending.questionsId, questions: pending.questions, askedAt: startedAt },
      startedAt
    );
  }

  it('appends the shared Drive guidance to every URL-list row description without changing existing hint text', async () => {
    SHELL_INTAKE.fields.push({
      key: 'synthetic_links',
      question: 'Synthetic links',
      kind: 'url-list',
      format: 'source-url-list',
      optional: true,
      hint: 'Existing source guidance.',
    });
    try {
      await configure();
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const hint = host().querySelector('#mktg-intake-synthetic_links-hint');
      expect(hint?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`Existing source guidance. ${MKTG_DRIVE_SHARING_HINT}`);
      component['onAddLinkRow']('synthetic_links');
      await fixture.whenStable();
      const rows = component['linkRows']()['synthetic_links'];
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(host().querySelector(`[data-test="mktg-intake-${row}"]`)?.getAttribute('aria-describedby')).toBe(hint?.id);
      }
      expect(host().querySelector('#mktg-intake-project_name-hint')).toBeNull();
    } finally {
      SHELL_INTAKE.fields.pop();
    }
  });

  it('does not route another one-off intake into the dedicated audit form', async () => {
    SHELL_INTAKE.oneOffDocument = true;
    try {
      await configure();
      expect(component['dedicatedAudit']).toBe(false);
      expect(query('mktg-agent-run-page')).toBeNull();
      expect(host().querySelector('lfx-aeo-geo-run')).toBeNull();
    } finally {
      delete SHELL_INTAKE.oneOffDocument;
    }
  });

  it.each(['foundation-setup', 'brand-kit'])('uses Kit labels and fixed parents for %s', async (agentId) => {
    await configure('browser', agentId);
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const label = agentId === 'brand-kit' ? 'Brand kit' : 'Messaging framework';
    expect(query('mktg-agent-run-name')?.textContent).toBe(label);
    expect(fixture.nativeElement.querySelector('[aria-current="page"]')?.textContent).toBe(label);
    const breadcrumb: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="mktg-breadcrumb"]');
    expect(breadcrumb?.textContent).toContain('kit');
    expect(breadcrumb?.textContent).toContain('Positioning & brand');
    expect(breadcrumb?.querySelectorAll('a')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-agent-run-back-button"]')).toBeNull();
  });

  it('keeps one page h1 when the intake form is shown and titles the form as a section', async () => {
    await configure('browser', 'foundation-setup');
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const page = query('mktg-agent-run-page');
    expect(page?.querySelectorAll('h1')).toHaveLength(1);
    expect(query('mktg-agent-run-name')?.tagName).toBe('H1');
    expect(query('mktg-agent-run-form-title')?.tagName).toBe('H2');
    expect(query('mktg-agent-run-form')?.classList.contains('hidden')).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses the catalog asset title and keeps the first-create action enabled with its explanation', async () => {
    await configure('browser', 'foundation-setup');
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === 'foundation-setup');
    expect(query('mktg-agent-run-name')?.textContent).toBe(type?.itemLabel);
    expect(query('mktg-agent-run-submit-button')?.textContent).toContain(`Create ${mktgSentenceCaseLabel(type?.itemLabel ?? '')}`);
    expect(query('mktg-agent-run-submit-button')?.querySelector('button')?.disabled).toBe(false);
    component['onSubmit']();
    await fixture.whenStable();
    expect(query('mktg-agent-run-error')?.textContent).toContain('Complete the required fields');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'uses actual stored revisions for the creation label in Sources=%s, without inferring a version from intake history',
    async (fresh) => {
      await configure('browser', 'foundation-setup', fresh ? { mode: 'new' } : {});
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === 'foundation-setup');
      if (!type) throw new Error('Missing fixture document type');
      lastIntake.mockReturnValue(of({ answers: {}, documentCount: 0, logoCount: 0 }));
      listDocuments.mockReturnValue(of({ groups: [{ type, documents: [{ revisionCount: 1 }] }] }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const action = () => query(fresh ? 'mktg-run-start' : 'mktg-agent-run-submit-button')?.querySelector('button');
      expect(action()?.textContent?.trim()).toBe('Create a new version');
      expect(action()?.disabled).toBe(false);
      expect(listDocuments).toHaveBeenLastCalledWith(PROJECT_1.uid);
      listDocuments.mockReturnValue(of({ groups: [{ type, documents: [] }] }));
      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      expect(action()?.textContent?.trim()).toBe(`Create ${mktgSentenceCaseLabel(type.itemLabel)}`);
      expect(generate).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])('falls back to last intake only when the document summary fails, in Sources=%s', async (fresh) => {
    await configure('browser', 'foundation-setup', fresh ? { mode: 'new' } : {});
    listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    lastIntake.mockReturnValue(of({ answers: {}, documentCount: 0, logoCount: 0 }));
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(component['submitLabel']()).toBe('Create a new version');
    lastIntake.mockReturnValue(of(null));
    activeContext.set(PROJECT_2);
    await fixture.whenStable();
    expect(component['submitLabel']()).toBe(`Create ${mktgSentenceCaseLabel(component['assetName'])}`);
    expect(query(fresh ? 'mktg-run-start' : 'mktg-agent-run-submit-button')?.querySelector('button')?.disabled).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('preserves the FAQ acronym in the first-create action and catalog field labels in the hint', async () => {
    await configure('server', 'faq');
    expect(component['submitLabel']()).toBe('Create FAQ');
    for (const field of MKTG_AGENT_INTAKES['faq'].fields.filter((field) => !field.optional)) {
      expect(component['sourcesHint']).toContain(field.question);
    }
  });

  it('pushes user navigation with only the active project', async () => {
    await configure();
    activeContext.set(PROJECT_2);
    await fixture.whenStable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    component['onOpenAgent']('foundation-setup');
    expect(navigate).toHaveBeenLastCalledWith(['..', 'foundation-setup'], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { project: PROJECT_2.slug },
    });
  });

  describe('explicit new-run Sources', () => {
    const agentId = 'foundation-setup';
    const history = {
      answers: { project_name: 'Previous synthetic project', website_url: 'https://previous.example', github_url: '' },
      documentCount: 0,
      logoCount: 0,
    };

    it('consumes accepted entry mode without cancelling the run, then reloads its questions without a second Generate', async () => {
      await configure('browser', agentId, { mode: 'new', project: PROJECT_1.slug });
      lastIntake.mockReturnValue(of(history));
      const progress = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(progress);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      await fixture.whenStable();
      expect(query('mktg-agent-run-starting-note')?.textContent?.trim()).toBe('Getting started… Stay on this page for a few seconds.');
      expect(query('mktg-agent-run-leave-note')).toBeNull();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      progress.next({ type: 'submitted' });
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { mode: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        })
      );
      queryParams.next(convertToParamMap({ project: PROJECT_1.slug }));
      await fixture.whenStable();
      expect(progress.observed).toBe(true);
      expect(component['phase']()).toBe('running');
      expect(component['freshMode']()).toBe(true);
      expect(query('mktg-run-sources')).toBeNull();
      expect(query('mktg-agent-run-leave-note')?.textContent).toContain('You can leave this page — the agent keeps working.');
      expect(query('mktg-agent-run-starting-note')).toBeNull();
      expect(query('mktg-agent-run-live')?.querySelector('lfx-button')).toBeNull();
      const status = query('mktg-agent-run-status');
      expect(status?.contains(query('mktg-agent-run-leave-note'))).toBe(true);
      expect(host().querySelectorAll('[data-testid="mktg-agent-run-status"]')).toHaveLength(1);
      expect(query('mktg-agent-run-page')?.querySelectorAll('h1, h2')).toHaveLength(1);
      expect(query('mktg-run-activity-elapsed')).toBeNull();
      const request = generate.mock.calls[0]?.[0] as MktgGenerateRequest;
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId, sessionId: 'synthetic-accepted', ownerToken: 'synthetic-proof' }, priorVersion: 0 },
        questionsId: 'e'.repeat(64),
        questions: [{ key: 'goal', label: 'Goal', question: 'Which synthetic goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
      };
      useRecordedQuestionsFixture(pending);
      TestBed.inject(MktgRunAttemptService).save({
        request,
        state: 'questions',
        attempt: pending.attempt,
        pendingQuestions: pending,
        updatedAt: new Date().toISOString(),
      });
      progress.next({ type: 'questions', pending });
      progress.complete();
      await fixture.whenStable();
      expect(component['phase']()).toBe('questions');
      fixture.destroy();
      fixture = TestBed.createComponent(MktgAgentRunComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();
      expect(component['phase']()).toBe('questions');
      expect(component['pendingQuestions']()).toEqual(pending.questions);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(lastIntake).toHaveBeenCalledTimes(1);
      expect(query('mktg-run-start')).toBeNull();
    });

    it('restores an accepted writing attempt after the consumed URL reloads, without re-submitting', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      const progress = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(progress);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      const request = generate.mock.calls[0]?.[0] as MktgGenerateRequest;
      TestBed.inject(MktgRunAttemptService).save({
        request,
        state: 'writing',
        requiresReattachment: true,
        attempt: { session: { agentId, sessionId: 'synthetic-writing', ownerToken: 'synthetic-proof' }, runId: 'b'.repeat(64), priorVersion: 0 },
        updatedAt: new Date().toISOString(),
      });
      useRecordedStateFixture(agentId, 'b'.repeat(64), 'writing');
      progress.next({ type: 'submitted' });
      queryParams.next(convertToParamMap({}));
      await fixture.whenStable();
      expect(progress.observed).toBe(true);
      fixture.destroy();
      fixture = TestBed.createComponent(MktgAgentRunComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();
      expect(component['phase']()).toBe('running');
      expect(TestBed.inject(MktgAgentRunService).resume).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(query('mktg-agent-run-submit-button')).toBeNull();
    });

    it.each(['project', 'subject'])('does not let accepted URL consumption mask a real %s change', async (change) => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      const progress = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(progress);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      progress.next({ type: 'submitted' });
      queryParams.next(convertToParamMap({}));
      await fixture.whenStable();
      expect(progress.observed).toBe(true);
      if (change === 'project') activeContext.set(PROJECT_2);
      else userSignal.set({ sub: 'synthetic-other-subject' } as User);
      await fixture.whenStable();
      expect(progress.observed).toBe(false);
      expect(component['freshMode']()).toBe(false);
      expect(component['intakeForm'].get('website_url')?.value).not.toBe(history.answers.website_url);
    });

    it('reads durable scalars before defaults, preserves blank optionals, and does not touch the accepted attempt on open', async () => {
      await configure('browser', agentId, { mode: 'new', questions: 'unrelated-token' });
      lastIntake.mockReturnValue(of(history));
      projects[PROJECT_1.slug] = { website_url: 'https://default.example' };
      rememberedAnswers[PROJECT_1.uid] = { github_url: { value: 'https://github.com/example/older', agentId, savedAt: new Date().toISOString() } };
      const attempts = TestBed.inject(MktgRunAttemptService);
      const consume = vi.spyOn(attempts, 'consume');
      const prepare = vi.spyOn(attempts, 'prepare');
      const reserve = vi.spyOn(attempts, 'reserve');
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['intakeForm'].get('website_url')?.value).toBe(history.answers.website_url);
      expect(component['intakeForm'].get('github_url')?.value).toBe('');
      expect(query('mktg-run-source-website_url')?.textContent).toContain('From last time');
      expect(query('mktg-run-waiting-notice')).toBeNull();
      expect(query('mktg-run-start')).not.toBeNull();
      expect(generate).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(component['showIntakeForm']()).toBe(false);
    });

    it.each([agentId, 'brand-kit'])('labels answer-cache fallback from %s before Start without claiming no prior inputs', async (sourceAgent) => {
      await configure('browser', agentId, { mode: 'new' });
      rememberedAnswers[PROJECT_1.uid] = {
        github_url: { value: 'https://github.com/synthetic/remembered', agentId: sourceAgent, savedAt: new Date().toISOString() },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['sourceFields']().find((field) => field.key === 'github_url')).toMatchObject({
        value: 'https://github.com/synthetic/remembered',
        origin: sourceAgent === agentId ? 'Remembered on this device' : 'From your Brand Kit run',
      });
      expect(component['sourceNote']()).toBe('');
      expect(generate).not.toHaveBeenCalled();
    });

    it('keeps project-default priority and the unavailable-history warning with remembered fallbacks', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      projects[PROJECT_1.slug] = { repository_url: 'https://github.com/synthetic/default' };
      rememberedAnswers[PROJECT_1.uid] = {
        github_url: { value: 'https://github.com/synthetic/remembered', agentId, savedAt: new Date().toISOString() },
        website_url: { value: 'https://remembered.example', agentId, savedAt: new Date().toISOString() },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['sourceFields']().find((field) => field.key === 'github_url')).toMatchObject({
        value: 'https://github.com/synthetic/default',
        origin: 'Suggested',
      });
      expect(component['sourceFields']().find((field) => field.key === 'website_url')).toMatchObject({
        value: 'https://remembered.example',
        origin: 'Remembered on this device',
      });
      expect(component['sourceNote']()).toContain('could not be loaded');
    });

    it.each([false, true])('merges partial durable fields with visit/device fields without replacing explicit blanks (visit=%s)', async (visit) => {
      await configure('browser', agentId, { mode: 'new' });
      const device = { project_name: 'Device name', website_url: 'https://device.example', github_url: 'https://github.com/synthetic/device' };
      storedRuns[PROJECT_1.uid] = storedRun(PROJECT_1.uid, 'Synthetic completed run', device);
      if (visit)
        TestBed.inject(MktgRunAttemptService).reserve({
          agentId,
          intake: MKTG_AGENT_INTAKES[agentId],
          projectUid: PROJECT_1.uid,
          answers: { github_url: 'https://github.com/synthetic/visit' },
        });
      lastIntake.mockReturnValue(of({ ...history, answers: { project_name: 'Durable name', website_url: '' } }));
      projects[PROJECT_1.slug] = { repository_url: 'https://github.com/synthetic/default' };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['sourceFields']().find((field) => field.key === 'project_name')).toMatchObject({ value: 'Durable name', origin: 'From last time' });
      expect(component['sourceFields']().find((field) => field.key === 'website_url')).toMatchObject({ value: '', origin: 'From last time' });
      expect(component['sourceFields']().find((field) => field.key === 'github_url')).toMatchObject({
        value: visit ? 'https://github.com/synthetic/visit' : device.github_url,
        origin: visit ? 'Saved in this visit' : 'Saved on this device',
      });
      expect(generate).not.toHaveBeenCalled();
    });

    it.each(['missing', 'failed'])('shows the %s dependency blocker and recovery before opening Edit', async (state) => {
      await configure('browser', 'brand-kit', { mode: 'new' });
      if (state === 'failed') resolveDependencies.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['showIntakeForm']()).toBe(false);
      expect(component['submitDisabled']()).toBe(true);
      expect(query('mktg-run-sources')?.contains(query('mktg-agent-run-missing-dependency'))).toBe(true);
      if (state === 'failed') {
        expect(query('mktg-run-sources')?.contains(query('mktg-agent-run-dependency-retry'))).toBe(true);
        resolveDependencies.mockReturnValue(of({}));
        query('mktg-agent-run-dependency-retry')?.querySelector('button')?.click();
        await fixture.whenStable();
        expect(component['dependencyCheckFailed']()).toBe(false);
      }
      expect(query('mktg-run-sources')?.contains(query('mktg-agent-run-missing-dependency-link'))).toBe(true);
      component['onEditSources']();
      await fixture.whenStable();
      expect(host().querySelectorAll('[data-testid="mktg-agent-run-missing-dependency"]')).toHaveLength(1);
      expect(query('mktg-agent-run-form')?.contains(query('mktg-agent-run-missing-dependency'))).toBe(true);
      expect(generate).not.toHaveBeenCalled();
    });

    it('edits on this page then starts exactly one fresh run, showing only the working view', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      query('mktg-run-sources-edit')?.querySelector('button')?.click();
      await fixture.whenStable();
      expect(component['showIntakeForm']()).toBe(true);
      const edit = query('mktg-run-sources-edit')?.querySelector('button');
      expect(edit?.getAttribute('aria-expanded')).toBe('true');
      expect(edit?.getAttribute('aria-controls')).toBe('mktg-run-intake-form');
      expect(query('mktg-agent-run-form')?.contains(document.activeElement)).toBe(true);
      component['intakeForm'].get('website_url')?.markAsDirty();
      component['intakeForm'].get('website_url')?.setValue('https://edited.example');
      await fixture.whenStable();
      query('mktg-run-sources-done')?.querySelector('button')?.click();
      await fixture.whenStable();
      expect(query('mktg-run-source-website_url')?.textContent).toContain('Changed just now');
      expect(edit?.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(edit);
      component['onSubmit']();
      component['onSubmit']();
      await fixture.whenStable();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][0]).toMatchObject({ agentId, newRun: true, answers: { website_url: 'https://edited.example' } });
      expect(component['phase']()).toBe('running');
      expect(query('mktg-run-sources')).toBeNull();
      expect(query('mktg-agent-run-leave-note')?.textContent).toContain('You can leave this page');
      expect(component['intakeForm'].controls['website_url'].value).toBe('https://edited.example');
      expect(query('mktg-agent-run-result')).toBeNull();
    });

    it('keeps Run again idle until Start and retries a failed fresh request without losing its sources or mode', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      generate.mockReturnValue(
        of<MktgGenerateProgress>({ type: 'failed', failure: { eventType: 'runtime_error', reason: 'Synthetic failed session. Retry.' } })
      );
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(generate).not.toHaveBeenCalled();
      expect(component['showIntakeForm']()).toBe(false);
      component['onSubmit']();
      await fixture.whenStable();
      const request = generate.mock.calls[0]?.[0] as MktgGenerateRequest;
      expect(request).toMatchObject({ newRun: true, answers: { website_url: history.answers.website_url } });
      expect(component['runFailed']()).toBe(true);
      expect(component['phase']()).toBe('form');
      expect(query('mktg-agent-run-retry')).not.toBeNull();
      generate.mockReturnValue(of<MktgGenerateProgress>({ type: 'submitted' }));
      component['onRetryRun']();
      await fixture.whenStable();
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate).toHaveBeenLastCalledWith(request);
      expect(component['freshMode']()).toBe(true);
      expect(component['runFailed']()).toBe(false);
      expect(component['phase']()).toBe('running');
    });

    it('clears entry-only fresh mode when opening a sibling agent', async () => {
      await configure('browser', agentId, { mode: 'new', project: 'synthetic' });
      component['onOpenAgent']('brand-kit');
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['..', 'brand-kit'], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { project: null },
      });
    });

    it('keeps a deliberately cleared optional source blank through submit, save and reopening', async () => {
      await configure('browser', agentId, { mode: 'new' });
      projects[PROJECT_1.slug] = { repository_url: 'https://github.com/synthetic/default' };
      lastIntake.mockReturnValue(of({ ...history, answers: { ...history.answers, github_url: 'https://github.com/synthetic/previous' } }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].get('github_url')?.setValue('');
      component['onSubmit']();
      const submitted = generate.mock.calls[0]?.[0] as MktgGenerateRequest;
      expect(submitted.answers['github_url']).toBe('');
      lastIntake.mockReturnValue(of({ ...history, answers: submitted.answers }));
      queryParams.next(convertToParamMap({}));
      await fixture.whenStable();
      queryParams.next(convertToParamMap({ mode: 'new' }));
      await fixture.whenStable();
      expect(component['intakeForm'].get('github_url')?.value).toBe('');
      expect(component['sourceFields']().find((field) => field.key === 'github_url')?.value).toBe('');
    });

    it('toggles Edit back to the labelled summary when the disclosure is activated again', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const edit = query('mktg-run-sources-edit')?.querySelector('button');
      edit?.click();
      await fixture.whenStable();
      expect(edit?.getAttribute('aria-expanded')).toBe('true');
      edit?.click();
      await fixture.whenStable();
      expect(edit?.getAttribute('aria-expanded')).toBe('false');
      expect(query('mktg-run-source-website_url')?.textContent).toContain('From last time');
      expect(document.activeElement).toBe(edit);
    });

    it.each([1, 2])('explains %s missing files, keeping creation enabled but guarded until reattachment or explicit omission', async (count) => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of({ ...history, documentCount: count }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-run-reattach-documents')?.textContent).toContain(`(${count})`);
      expect(query('mktg-run-missing-files-note')?.textContent).toBe(
        count === 1
          ? '1 file from last time is not kept here. Re-attach it, or carry on without it.'
          : '2 files from last time are not kept here. Re-attach them, or carry on without them.'
      );
      expect(query('mktg-run-drop-missing')?.textContent?.trim()).toBe(count === 1 ? 'Continue without it' : 'Continue without them');
      expect(query('mktg-run-drop-missing')?.parentElement).toBe(query('mktg-run-reattach-documents')?.parentElement);
      expect(query('mktg-run-start')?.querySelector('button')?.disabled).toBe(false);
      expect(component['submitDisabled']()).toBe(true);
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();
      query('mktg-run-reattach-documents')?.querySelector('button')?.click();
      await fixture.whenStable();
      expect(host().querySelector('#mktg-run-documents')?.contains(document.activeElement)).toBe(true);
      component['onDropPriorFiles']();
      await fixture.whenStable();
      expect(component['submitDisabled']()).toBe(false);
    });

    it.each([true, false])('never infers upload identity from equal scalars/counts (shared history exists=%s)', async (accepted) => {
      await configure('browser', agentId, { mode: 'new' });
      const intake = MKTG_AGENT_INTAKES[agentId];
      const request = {
        agentId,
        intake,
        projectUid: PROJECT_1.uid,
        answers: history.answers,
        documents: [{ kind: 'file' as const, title: 'synthetic.txt', text: 'Synthetic source text.' }],
      };
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.reserve(request);
      const before = attempts.load(PROJECT_1.uid, agentId);
      // A failed first Generate before acknowledgement leaves only this reserved draft, not durable or completed-run history.
      lastIntake.mockReturnValue(of(accepted ? { ...history, documentCount: 1 } : null));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      // The shared snapshot may belong to another writer/run with equal scalars/counts.
      // It has no run-binding identifier; local synthetic.txt cannot be treated as that run's file.
      expect(component['documents']()).toHaveLength(accepted ? 0 : 1);
      if (!accepted) expect(component['documents']()[0]?.title).toBe('synthetic.txt');
      expect(component['missingDocuments']()).toBe(accepted ? 1 : 0);
      expect(component['priorDocumentCount']()).toBe(1);
      expect(component['intakeForm'].get('website_url')?.value).toBe(history.answers.website_url);
      expect(loadRun).toHaveBeenCalledWith(PROJECT_1.uid, agentId);
      expect(generate).not.toHaveBeenCalled();
      expect(attempts.load(PROJECT_1.uid, agentId)).toBe(before);
    });

    it('requires logo reattachment when a shared snapshot cannot be bound to this visit', async () => {
      await configure('browser', 'brand-kit', { mode: 'new' });
      const answers = { project_name: 'Synthetic brand', website_url: 'https://brand.example' };
      TestBed.inject(MktgRunAttemptService).reserve({
        agentId: 'brand-kit',
        intake: MKTG_AGENT_INTAKES['brand-kit'],
        projectUid: PROJECT_1.uid,
        answers,
        logoFiles: [{ name: 'local.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }],
      });
      lastIntake.mockReturnValue(of({ answers, documentCount: 0, logoCount: 1 }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['logoFiles']()).toEqual([]);
      expect(component['missingLogos']()).toBe(1);
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([null, 503, 403])('labels fallback/defaults honestly and fails closed on denied history (%s)', async (status) => {
      await configure('browser', agentId, { mode: 'new' });
      if (status) lastIntake.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      projects[PROJECT_1.slug] = { website_url: 'https://default.example' };
      if (status === 503) storedRuns[PROJECT_1.uid] = storedRun(PROJECT_1.uid, 'Synthetic prior result', history.answers);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      if (status === 403) {
        expect(query('mktg-run-sources-denied')).toBeTruthy();
        expect(component['intakeForm'].get('website_url')?.value).toBe('');
        expect(component['submitDisabled']()).toBe(true);
      } else {
        const expected = status === 503 ? 'Saved on this device' : 'Suggested';
        expect(query('mktg-run-source-website_url')?.textContent).toContain(expected);
        expect(query('mktg-run-sources-note')?.textContent).toContain(status === 503 ? 'could not be loaded' : 'no previous run');
      }
      expect(generate).not.toHaveBeenCalled();
    });

    it('cancels late history on null project and resets when only mode changes', async () => {
      await configure('browser', agentId);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const response = new Subject<typeof history>();
      lastIntake.mockReturnValue(response);
      queryParams.next(convertToParamMap({ mode: 'new' }));
      await fixture.whenStable();
      expect(component['sourcesLoading']()).toBe(true);
      activeContext.set(null);
      await fixture.whenStable();
      response.next(history);
      expect(component['intakeForm'].get('website_url')?.value).toBe('');
      lastIntake.mockReturnValue(of(history));
      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      expect(lastIntake).toHaveBeenLastCalledWith(PROJECT_2.uid, agentId);
      queryParams.next(convertToParamMap({}));
      await fixture.whenStable();
      expect(component['freshMode']()).toBe(false);
      expect(query('mktg-run-sources')).toBeNull();
    });

    it('drops a late private history response after the effective subject changes', async () => {
      await configure('browser', agentId, { mode: 'new' });
      const oldResponse = new Subject<typeof history>();
      lastIntake
        .mockReturnValueOnce(oldResponse)
        .mockReturnValue(of({ ...history, answers: { ...history.answers, website_url: 'https://other-subject.example' } }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      userSignal.set({ sub: 'other-synthetic-subject' } as User);
      await fixture.whenStable();
      oldResponse.next(history);
      expect(component['intakeForm'].get('website_url')?.value).toBe('https://other-subject.example');
      expect(generate).not.toHaveBeenCalled();
    });

    it('opens an accepted writing draft from fresh mode and keeps it intact on Start over', async () => {
      await configure('browser', agentId, { mode: 'new' });
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
      if (!type) throw new Error('Missing synthetic asset type');
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.save({
        request: { agentId, projectUid: PROJECT_1.uid, intake: MKTG_AGENT_INTAKES[agentId], answers: history.answers },
        state: 'writing',
        attempt: { runId: 'b'.repeat(64), priorVersion: 0, session: { agentId, sessionId: 'synthetic-writing', ownerToken: 'synthetic-proof' } },
        updatedAt: new Date().toISOString(),
      });
      const saved = attempts.load(PROJECT_1.uid, agentId);
      useRecordedStateFixture(agentId, 'b'.repeat(64), 'writing'); // The click now verifies the still-active record, not its hint.
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-run-waiting-notice')?.textContent).toContain(`This ${mktgSentenceCaseLabel(type.itemLabel)} is being written.`);
      const open = query('mktg-run-waiting-open')?.querySelector('a');
      const url = new URL(open?.getAttribute('href') ?? '', 'https://synthetic.example');
      expect(url.pathname).toBe(`/mktg-os-agents/${agentId}`);
      expect(url.searchParams.get('run')).toBe('b'.repeat(64));
      expect(url.searchParams.get('project')).toBe(PROJECT_1.slug);
      expect(open?.classList.contains('p-button-text')).toBe(false);
      expect(query('mktg-run-waiting-continue')).toBeNull();
      expect(query('mktg-run-sources')).toBeNull();
      expect(component['showIntakeForm']()).toBe(false);
      expect(component['submitDisabled']()).toBe(true);
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();
      query('mktg-run-waiting-start-over')?.click();
      discardPrompt()?.accept?.();
      await fixture.whenStable();
      expect(query('mktg-run-sources')).not.toBeNull();
      expect(attempts.load(PROJECT_1.uid, agentId)).toEqual(saved);
    });

    it.each(['writing', 'storing', 'questions'] as const)(
      'offers a public %s run from another browser through the existing one-shot summary read',
      async (state) => {
        await configure('browser', agentId, { mode: 'new' });
        const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
        if (!type) throw new Error('Missing synthetic asset type');
        listDocuments.mockReturnValue(
          of({ groups: [], runs: [{ project: PROJECT_1.uid, agentKey: type.agentKey, documentId: 'living', runId: 'c'.repeat(64), state }] })
        );
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(query('mktg-run-waiting-notice')?.textContent).toContain(
          state === 'questions' ? 'This run is waiting for your answers.' : `This ${mktgSentenceCaseLabel(type.itemLabel)} is being written.`
        );
        const open = query('mktg-run-waiting-open')?.querySelector('a');
        expect(open?.getAttribute('href')).toContain(`run=${'c'.repeat(64)}`);
        if (state === 'questions') {
          expect(open?.textContent).toContain('Answer the questions');
          expect(open?.getAttribute('href')).toContain(`/mktg-os-agents/${agentId}?`);
        } else {
          expect(open?.textContent).toContain('Open it');
          expect(open?.getAttribute('href')).toContain(`/mktg-os-agents/${agentId}?`);
        }
        expect(query('mktg-run-waiting-continue')).toBeNull();
        expect(TestBed.inject(MktgRunAttemptService).load(PROJECT_1.uid, agentId)).toBeNull();
        expect(listDocuments).toHaveBeenCalledExactlyOnceWith(PROJECT_1.uid);
        expect(component['submitDisabled']()).toBe(true);
        expect(generate).not.toHaveBeenCalled();
      }
    );

    it.each(['browser', 'public'] as const)('dates stale waiting questions from the %s without starting another run', async (origin) => {
      await configure('browser', agentId, { mode: 'new' });
      const now = Date.parse('2026-10-28T12:00:00Z');
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
        if (!type) throw new Error('Missing living fixture');
        const startedAt = '2026-10-26T12:00:00Z';
        if (origin === 'public')
          listDocuments.mockReturnValue(
            of({
              groups: [],
              runs: [{ project: PROJECT_1.uid, agentKey: type.agentKey, documentId: 'living', runId: 'c'.repeat(64), state: 'questions', startedAt }],
            })
          );
        else {
          const pending: MktgRunQuestionsPending = {
            attempt: { priorVersion: 0, session: { agentId, sessionId: 'synthetic-stale', ownerToken: 'synthetic-proof' } },
            questionsId: 'synthetic-stale-block',
            questions: [],
          };
          useRecordedQuestionsFixture(pending, startedAt);
          vi.spyOn(TestBed.inject(MktgRunAttemptService), 'load').mockReturnValue({
            request: { agentId, projectUid: PROJECT_1.uid, intake: MKTG_AGENT_INTAKES[agentId], answers: {} },
            attempt: pending.attempt,
            state: 'questions',
            updatedAt: startedAt,
            pendingQuestions: pending,
          });
        }
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(query('mktg-run-waiting-notice')?.textContent).toContain(
          'Waiting for your answers since 26 Oct. Continue to answer them — if the agent no longer responds, start over.'
        );
        expect(query(origin === 'browser' ? 'mktg-run-waiting-continue' : 'mktg-run-waiting-open')).not.toBeNull();
        expect(query('mktg-run-waiting-start-over')).not.toBeNull();
        expect(generate).not.toHaveBeenCalled();
        expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    });

    it.each(['empty', 'error', 'unavailable', 'failed', 'other-project', 'other-asset'] as const)(
      'keeps fresh Sources without a notice on %s discovery',
      async (state) => {
        await configure('browser', agentId, { mode: 'new' });
        const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
        if (!type) throw new Error('Missing synthetic asset type');
        if (state === 'error') listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
        else
          listDocuments.mockReturnValue(
            of({
              groups: [],
              progressUnavailable: state === 'unavailable',
              runs:
                state === 'empty'
                  ? []
                  : [
                      {
                        project: state === 'other-project' ? PROJECT_2.uid : PROJECT_1.uid,
                        agentKey: state === 'other-asset' ? 'synthetic-other-asset' : type.agentKey,
                        documentId: 'living',
                        runId: 'c'.repeat(64),
                        state: state === 'failed' ? 'failed' : 'writing',
                      },
                    ],
            })
          );
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(query('mktg-run-waiting-notice')).toBeNull();
        expect(query('mktg-run-sources')).not.toBeNull();
        expect(generate).not.toHaveBeenCalled();
      }
    );

    it('updates a returned fresh page when its service-held ACK lands after that page mounted', async () => {
      await configure('browser', agentId, { mode: 'new' });
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-run-waiting-notice')).toBeNull();
      TestBed.inject(MktgRunAttemptService).save({
        request: { agentId, projectUid: PROJECT_1.uid, intake: MKTG_AGENT_INTAKES[agentId], answers: history.answers },
        state: 'writing',
        attempt: { runId: 'b'.repeat(64), priorVersion: 0, session: { agentId, sessionId: 'synthetic-late-ack', ownerToken: 'synthetic-proof' } },
        updatedAt: new Date().toISOString(),
      });
      TestBed.inject(MktgAgentRunService).acknowledgementVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(query('mktg-run-waiting-open')?.querySelector('a')?.getAttribute('href')).toContain(`run=${'b'.repeat(64)}`);
      expect(query('mktg-run-sources')).toBeNull();
      expect(generate).not.toHaveBeenCalled();
    });

    const activeConflict = (): MktgActiveRunConflict => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
      if (!type) throw new Error('Missing synthetic asset');
      const conflict: MktgActiveRunConflict = {
        code: MKTG_RUN_ACTIVE,
        message: 'A run is in progress.',
        activeRunId: 'b'.repeat(64),
        state: 'questions',
        agentKey: type.agentKey,
        documentId: 'living',
        startedBy: 'Another writer',
        startedByViewer: false,
        startedAt: '2026-10-19T12:00:00.000Z',
      };
      vi.mocked(TestBed.inject(MktgAgentRunService).recheckActiveConflict).mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: conflict }))
      );
      // 144-D: a cached/conflicting hint is not enough; the click's live selected-record read confirms this fixture.
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(
        of({
          project: PROJECT_1.uid,
          type,
          documentId: 'living',
          revisions: [],
          approvedCurrent: null,
          runs: [
            {
              project: PROJECT_1.uid,
              agentKey: type.agentKey,
              documentId: 'living',
              runId: conflict.activeRunId,
              state: conflict.state,
              startedAt: conflict.startedAt,
            },
          ],
        })
      );
      return conflict;
    };

    it.each(['absent', 'completed', 'discarded', 'superseded', 'failed'] as const)(
      'starts without a stale discard dialog when the click reads %s',
      async (state) => {
        await configure('browser', agentId, { mode: 'new' });
        const conflict = activeConflict();
        const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
        if (!type) throw new Error('Missing synthetic asset');
        lastIntake.mockReturnValue(of(history));
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        const attempts = TestBed.inject(MktgRunAttemptService);
        attempts.save({
          request: { agentId, projectUid: PROJECT_1.uid, intake: MKTG_AGENT_INTAKES[agentId], answers: history.answers },
          attempt: { runId: conflict.activeRunId, priorVersion: 0, session: { agentId, sessionId: 'synthetic-finished', ownerToken: 'synthetic-proof' } },
          state: 'writing',
          updatedAt: conflict.startedAt,
        });
        component['waitingRun'].set(null);
        component['existingRun'].set(null);
        const read = vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument);
        read.mockReturnValue(
          of({
            project: PROJECT_1.uid,
            type,
            documentId: 'living',
            revisions: [],
            approvedCurrent: null,
            runs:
              state === 'absent'
                ? []
                : [
                    {
                      project: PROJECT_1.uid,
                      agentKey: type.agentKey,
                      documentId: 'living',
                      runId: conflict.activeRunId,
                      state,
                      startedAt: conflict.startedAt,
                    },
                  ],
          })
        );
        component['onSubmit']();
        expect(read).toHaveBeenLastCalledWith(PROJECT_1.uid, type.agentKey, 'living', false, conflict.activeRunId, false, conflict.activeRunId);
        expect(confirmationService.confirm).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledOnce();
        expect(attempts.load(PROJECT_1.uid, agentId)).toBeNull();
      }
    );

    it('replays a stale POST conflict once after a fresh completed record, without opening a modal', async () => {
      await configure('browser', agentId, { mode: 'new' });
      const conflict = activeConflict();
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
      if (!type) throw new Error('Missing synthetic asset');
      lastIntake.mockReturnValue(of(history));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(
        of({
          project: PROJECT_1.uid,
          type,
          documentId: 'living',
          revisions: [],
          approvedCurrent: null,
          runs: [],
        })
      );
      generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })));
      const replay = vi.mocked(TestBed.inject(MktgAgentRunService).recheckActiveConflict).mockReturnValue(of({ type: 'submitted' }));
      component['onSubmit']();
      expect(replay).toHaveBeenCalledOnce();
      expect(confirmationService.confirm).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledOnce();
      expect(component['phase']()).toBe('running');
    });

    it('confirms Sources-first discard, opens progress on Keep it, and does not ask twice before one explicit Create', async () => {
      await configure('browser', agentId, { mode: 'new' });
      const conflict = activeConflict();
      lastIntake.mockReturnValue(of(history));
      listDocuments.mockReturnValue(
        of({ groups: [], runs: [{ project: PROJECT_1.uid, agentKey: conflict.agentKey, documentId: 'living', runId: conflict.activeRunId, state: 'writing' }] })
      );
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      query('mktg-run-waiting-start-over')?.click();
      expect(discardPrompt()).toMatchObject({
        header: 'Discard the messaging framework run?',
        message: 'Its questions and progress will be lost.',
        acceptLabel: 'Discard and start over',
        rejectLabel: 'Keep it',
        rejectButtonProps: { text: true },
      });
      discardPrompt()?.reject?.(ConfirmEventType.REJECT);
      await fixture.whenStable();
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
        ['/mktg-os-agents', agentId],
        expect.objectContaining({
          queryParams: expect.objectContaining({ project: PROJECT_1.slug, run: conflict.activeRunId, mode: null }),
        })
      );
      expect(generate).not.toHaveBeenCalled();
      // The router mock keeps this fixture mounted; reopen the discard branch explicitly.
      query('mktg-run-waiting-start-over')?.click();
      discardPrompt()?.accept?.();
      await fixture.whenStable();
      expect(query('mktg-run-waiting-notice')).toBeNull();
      expect(query('mktg-run-sources')).not.toBeNull();
      expect(generate).not.toHaveBeenCalled();
      component['onSubmit']();
      component['onSubmit']();
      await fixture.whenStable();
      expect(confirmationService.confirm).toHaveBeenCalledTimes(2);
      expect(generate).toHaveBeenCalledOnce();
    });

    it('guards a full-form Create with a known active server run and invalidates a late consent after project change', async () => {
      await configure('browser', agentId);
      const conflict = activeConflict();
      listDocuments.mockReturnValue(
        of({ groups: [], runs: [{ project: PROJECT_1.uid, agentKey: conflict.agentKey, documentId: 'living', runId: conflict.activeRunId, state: 'writing' }] })
      );
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].patchValue(history.answers);
      await fixture.whenStable();
      component['onSubmit']();
      const dialog = discardPrompt();
      expect(dialog?.header).toBe('Discard the messaging framework run?');
      expect(generate).not.toHaveBeenCalled();
      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      dialog?.accept?.();
      expect(generate).not.toHaveBeenCalled();
    });

    it('does not open a discard dialog when no active record or accepted browser draft exists', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      expect(confirmationService.confirm).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledOnce();
    });

    it.each(['open', 'discard', 'review', 'stale'] as const)('handles a validated 409 with the distinct owner dialog and %s choice', async (choice) => {
      await configure('browser', agentId, { mode: 'new' });
      const conflict = activeConflict();
      lastIntake.mockReturnValue(of(history));
      generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict }))).mockReturnValue(of({ type: 'submitted' }));
      vi.mocked(TestBed.inject(MktgAgentRunService).canRetryActiveConflict).mockReturnValue(choice !== 'review');
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      await fixture.whenStable();
      const request = generate.mock.calls[0][0] as MktgGenerateRequest;
      expect(component['waitingRun']()).toMatchObject({ startedAt: conflict.startedAt });
      expect(component['existingRun']()).toMatchObject({ startedAt: conflict.startedAt });
      expect(discardPrompt()).toMatchObject({
        header: "Another writer's Messaging framework run is in progress",
        rejectLabel: 'Open it',
        acceptLabel: 'Discard and start over',
      });
      if (choice === 'stale') {
        const dialog = discardPrompt();
        userSignal.set({ sub: 'synthetic-other-subject' } as User);
        await fixture.whenStable();
        dialog?.accept?.();
        expect(generate).toHaveBeenCalledOnce();
      } else if (choice === 'open') {
        discardPrompt()?.reject?.(ConfirmEventType.REJECT);
        expect(generate).toHaveBeenCalledOnce();
        expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
          ['/mktg-os-agents', agentId],
          expect.objectContaining({ queryParams: expect.objectContaining({ run: conflict.activeRunId, project: PROJECT_1.slug, mode: null }) })
        );
      } else {
        discardPrompt()?.accept?.();
        await fixture.whenStable();
        if (choice === 'discard') expect(generate).toHaveBeenNthCalledWith(2, request, conflict.activeRunId);
        else {
          expect(generate).toHaveBeenCalledOnce();
          expect(component['errorText']()).toContain('cannot be replayed safely');
          expect(component['intakeForm'].get('website_url')?.value).toBe(request.answers['website_url']);
          component['onSubmit']();
          expect(generate.mock.calls[1][0]).toMatchObject({ discard: conflict.activeRunId, newRun: true });
        }
      }
    });

    it.each(['fresh-conflict', 'started'] as const)('rechecks the catalog guard on focus and handles %s without another submit', async (outcome) => {
      await configure('browser', agentId, { mode: 'new' });
      const conflict = activeConflict();
      const recheck = vi.mocked(TestBed.inject(MktgAgentRunService).recheckActiveConflict);
      lastIntake.mockReturnValue(of(history));
      generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      await fixture.whenStable();
      const dialog = discardPrompt();
      const fresh = { ...conflict, activeRunId: 'c'.repeat(64), startedByViewer: true, startedAt: '2026-10-19T13:00:00Z' };
      if (outcome === 'started') recheck.mockReturnValue(of({ type: 'submitted' }));
      else recheck.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: fresh })));
      const notice = vi.spyOn(TestBed.inject(MessageService), 'add');
      const close = vi.spyOn(confirmationService, 'close');
      window.dispatchEvent(new Event('focus'));
      await fixture.whenStable();
      expect(recheck).toHaveBeenCalledTimes(2);
      expect(recheck.mock.calls[0][0]).toBe(generate.mock.calls[0][0]);
      expect(recheck.mock.calls[1][0]).toBe(generate.mock.calls[0][0]);
      expect(generate).toHaveBeenCalledOnce();
      if (outcome === 'started') {
        expect(close).toHaveBeenCalledOnce();
        expect(notice).toHaveBeenCalledWith(expect.objectContaining({ detail: 'The earlier run has finished — yours started.' }));
        expect(component['phase']()).toBe('running');
      } else {
        expect(discardPrompt()).toBe(dialog);
        expect(dialog?.header).toBe('Your Messaging framework run is in progress');
        expect(dialog?.message).toContain('19 Oct 2026');
        expect(close).not.toHaveBeenCalled();
        dialog?.reject?.(ConfirmEventType.REJECT);
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ queryParams: expect.objectContaining({ run: fresh.activeRunId }) })
        );
      }
    });

    it.each(['timeout', 'denied', 'network'] as const)('returns accepted recheck %s failures to the editable form without another start', async (failure) => {
      await configure('browser', agentId, { mode: 'new' });
      const conflict = activeConflict();
      lastIntake.mockReturnValue(of(history));
      generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      await fixture.whenStable();
      const events = new Subject<MktgGenerateProgress>();
      const recheck = vi.mocked(TestBed.inject(MktgAgentRunService).recheckActiveConflict);
      recheck.mockReturnValue(events);
      window.dispatchEvent(new Event('focus'));
      events.next({ type: 'submitted' });
      expect(component['phase']()).toBe('running');
      let error: Error = new TimeoutError();
      if (failure === 'denied') error = new HttpErrorResponse({ status: 403 });
      if (failure === 'network') error = new HttpErrorResponse({ status: 0 });
      events.error(error);
      await fixture.whenStable();
      expect(component['phase']()).toBe('form');
      expect(component['navigating']()).toBe(false);
      expect(component['recheckingAttempt']()).toBe(false);
      expect(component['writingStretch']()).toBe(false);
      expect(component['navigation']()).toBeNull();
      expect(component['waitingRun']()).toBeNull();
      expect(component['intakeForm'].get('website_url')?.value).toBe(history.answers['website_url']);
      expect(host().textContent).toContain('The original start could not be confirmed');
      expect(query('mktg-run-sources')).not.toBeNull();
      window.dispatchEvent(new Event('focus'));
      expect(generate).toHaveBeenCalledOnce();
      expect(recheck).toHaveBeenCalledTimes(2);
    });

    it('does not automatically loop when the server rejects an already-discarding retry', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      generate.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: activeConflict() })));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onSubmit']();
      discardPrompt()?.accept?.();
      await fixture.whenStable();
      expect(generate).toHaveBeenCalledTimes(2);
      expect(discardPrompt()?.acceptLabel).toBe('Discard and start over');
    });

    it('consumes visit-only receiver conflict metadata, never serializes it, and uses the one-off title variant', async () => {
      await configure('browser', agentId);
      const conflict = activeConflict();
      const attempts = TestBed.inject(MktgRunAttemptService);
      const request = { agentId, intake: MKTG_AGENT_INTAKES[agentId], projectUid: PROJECT_1.uid, answers: history.answers };
      attempts.save({ request, state: 'failed', activeRunConflict: conflict, updatedAt: new Date().toISOString() });
      expect(JSON.stringify({ ...localStorage })).not.toContain(MKTG_RUN_ACTIVE);
      const token = attempts.prepare(request, true);
      queryParams.next(convertToParamMap({ questions: token }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(discardPrompt()?.rejectLabel).toBe('Open it');
      expect(attempts.load(PROJECT_1.uid, agentId)?.activeRunConflict).toBeUndefined();
      expect(generate).not.toHaveBeenCalled();
      const oneOff = MKTG_DOCUMENT_TYPES.find((type) => type.kind === 'run');
      if (!oneOff) throw new Error('Missing synthetic one-off type');
      expect(mktgActiveRunConflictHeading({ ...conflict, agentKey: oneOff.agentKey })).toBe(
        `Your ${mktgSentenceCaseLabel(oneOff.itemLabel)} run is in progress`
      );
    });

    it.each(['continue', 'keep-it', 'start-over', 'dismiss'])('offers a waiting draft on a fresh visit, then %s without another Generate', async (choice) => {
      await configure('browser', agentId, { mode: 'new' });
      const attempts = TestBed.inject(MktgRunAttemptService);
      const request = { agentId, projectUid: PROJECT_1.uid, intake: MKTG_AGENT_INTAKES[agentId], answers: history.answers };
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId, sessionId: 'synthetic-waiting', ownerToken: 'synthetic-proof' }, priorVersion: 0 },
        questionsId: 'abc12345',
        questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
      };
      useRecordedQuestionsFixture(pending);
      attempts.save({ request, attempt: pending.attempt, state: 'questions', pendingQuestions: pending, updatedAt: new Date().toISOString() });
      const saved = attempts.load(PROJECT_1.uid, agentId);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-run-waiting-notice')?.textContent).toContain('This run is waiting for your answers.');
      expect(query('mktg-run-sources')).toBeNull();
      expect(component['showIntakeForm']()).toBe(false);
      expect(component['submitDisabled']()).toBe(true);
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockClear();
      if (choice === 'continue' || choice === 'keep-it') {
        if (choice === 'keep-it') {
          query('mktg-run-waiting-start-over')?.click();
          discardPrompt()?.reject?.(ConfirmEventType.REJECT);
        } else query('mktg-run-waiting-continue')?.querySelector('button')?.click();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
          ['/mktg-os-agents', agentId],
          expect.objectContaining({
            queryParams: expect.objectContaining({ mode: null, run: pending.attempt.runId }),
            replaceUrl: true,
          })
        );
        queryParams.next(convertToParamMap({ run: pending.attempt.runId })); // G: emit the selected active-run destination, never the reader.
        await fixture.whenStable();
        expect(component['phase']()).toBe('questions');
        expect(component['questionsPending']()).toEqual(pending);
        expect(component['intakeForm'].get('website_url')?.value).toBe(history.answers.website_url);
        expect(query('mktg-run-questions-return-note')?.textContent).toContain('Documents › Started runs › Answer the questions.');
      } else if (choice === 'dismiss') {
        query('mktg-run-waiting-start-over')?.click();
        discardPrompt()?.reject?.(ConfirmEventType.CANCEL);
        await fixture.whenStable();
        expect(navigate).not.toHaveBeenCalled();
        expect(query('mktg-run-waiting-notice')).not.toBeNull();
        expect(attempts.load(PROJECT_1.uid, agentId)).toEqual(saved);
      } else {
        query('mktg-run-waiting-start-over')?.click();
        discardPrompt()?.accept?.();
        await fixture.whenStable();
        expect(query('mktg-run-waiting-continue')).toBeNull();
        expect(query('mktg-run-sources')).not.toBeNull();
        expect(component['phase']()).toBe('form');
        expect(query('mktg-run-waiting-notice')).toBeNull();
        expect(attempts.load(PROJECT_1.uid, agentId)).toEqual(saved);
      }
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    });

    it('does not consume a questions token in fresh mode, then resumes that same block when fresh mode is removed', async () => {
      await configure('browser', agentId, { mode: 'new' });
      const attempts = TestBed.inject(MktgRunAttemptService);
      const request = { agentId, projectUid: PROJECT_1.uid, intake: MKTG_AGENT_INTAKES[agentId], answers: history.answers };
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' }, priorVersion: 0 },
        questionsId: 'abc12345',
        questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: 'Synthetic gap', suggestedAnswer: 'Adoption', basis: [] }],
      };
      useRecordedQuestionsFixture(pending);
      attempts.save({ request, attempt: pending.attempt, state: 'questions', pendingQuestions: pending, updatedAt: new Date().toISOString() });
      const token = attempts.prepare(request, true);
      queryParams.next(convertToParamMap({ mode: 'new', questions: token }));
      const consume = vi.spyOn(attempts, 'consume');
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(consume).not.toHaveBeenCalled();
      queryParams.next(convertToParamMap({ questions: token }));
      await fixture.whenStable();
      expect(consume).toHaveBeenCalledWith(token, PROJECT_1.uid, agentId);
      expect(component['phase']()).toBe('questions');
      expect(component['pendingQuestions']()).toEqual(pending.questions);
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it('keeps absent scalar keys eligible for suggested defaults, without erasing recorded blanks', async () => {
      await configure('browser', agentId, { mode: 'new' });
      lastIntake.mockReturnValue(of(history));
      projects[PROJECT_1.slug] = { description: 'Synthetic suggested description.' };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const key = MKTG_AGENT_INTAKES[agentId].fields.find((field) => field.prefill === 'project-description')?.key ?? '';
      expect(key).not.toBe('');
      expect(component['sourceFields']().find((field) => field.key === key)).toMatchObject({
        value: 'Synthetic suggested description.',
        origin: 'Suggested',
      });
      expect(component['sourceFields']().find((field) => field.key === 'github_url')).toMatchObject({ value: '', origin: 'From last time' });
    });

    it('clears private non-fresh inputs on null context and restores the same project afresh', async () => {
      await configure('browser', agentId);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].get('website_url')?.setValue('https://edited.example');
      const reads = loadRun.mock.calls.length;
      activeContext.set(null);
      await fixture.whenStable();
      expect(component['intakeForm'].get('website_url')?.value).toBeFalsy();
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['intakeForm'].get('website_url')?.value).not.toBe('https://edited.example');
      expect(loadRun).toHaveBeenCalledTimes(reads + 1);
    });

    it('opens the logo section from a keyboard-operable reattachment control', async () => {
      await configure('browser', 'brand-kit', { mode: 'new' });
      lastIntake.mockReturnValue(of({ ...history, logoCount: 1 }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const action = query('mktg-run-reattach-logos')?.querySelector('button');
      expect(action?.getAttribute('aria-controls')).toBe('mktg-run-logos');
      action?.click();
      await fixture.whenStable();
      expect(host().querySelector('#mktg-run-logos')?.contains(document.activeElement)).toBe(true);
    });

    it('does not read private history or files during SSR', async () => {
      await configure('server', agentId, { mode: 'new' });
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-agent-run-checking')).not.toBeNull();
      expect(query('mktg-run-source-website_url')).toBeNull();
      expect(lastIntake).not.toHaveBeenCalled();
      expect(loadRun).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });
  });

  it('restores the ICP request before a conflict handoff recheck opens its exact document receipt', async () => {
    await configure('browser', 'icp');
    const intake = MKTG_AGENT_INTAKES['icp'];
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === intake.agentId);
    if (!type) throw new Error('Missing synthetic ICP type');
    const request: MktgGenerateRequest = { agentId: intake.agentId, intake, projectUid: PROJECT_1.uid, answers: {} };
    const conflict: MktgActiveRunConflict = {
      code: MKTG_RUN_ACTIVE,
      message: 'A run is in progress.',
      activeRunId: 'b'.repeat(64),
      state: 'writing',
      agentKey: type.agentKey,
      documentId: 'living',
      startedBy: 'Synthetic writer',
      startedByViewer: true,
      startedAt: '2026-10-19T12:00:00Z',
    };
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save({ request, state: 'failed', activeRunConflict: conflict, updatedAt: new Date().toISOString() });
    const token = attempts.prepare(request, true);
    const run = { ...storedRun(PROJECT_1.uid, '# Synthetic ICP', {}), agentId: intake.agentId };
    const location = { agentKey: type.agentKey, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
    run.versions[0].documentLocation = location;
    const attempt = {
      runId: 'c'.repeat(64),
      priorVersion: 0,
      session: { agentId: intake.agentId, sessionId: 'synthetic-recheck', ownerToken: 'synthetic-proof' },
    };
    const events = new Subject<MktgGenerateProgress>();
    const recheck = vi.mocked(TestBed.inject(MktgAgentRunService).recheckActiveConflict);
    recheck.mockReturnValue(events);
    vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(
      of({
        project: PROJECT_1.uid,
        type,
        documentId: 'living',
        revisions: [],
        approvedCurrent: null,
        runs: [],
      })
    ); // Fresh record says the former conflict ended; only then replay the retained request.
    queryParams.next(convertToParamMap({ questions: token }));
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(component['activeRequest']).toEqual(request);
    events.next({ type: 'submitted' });
    expect(component['activeRequest']).toEqual(request);
    expect(component['phase']()).toBe('running');
    window.dispatchEvent(new Event('focus'));
    expect(recheck).toHaveBeenCalledOnce();
    events.next(mktgRunProgressFixture('document', run, 1, attempt));
    await fixture.whenStable();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      ['..', 'documents', type.agentKey, 'living'],
      expect.objectContaining({ queryParams: expect.objectContaining({ revision: location.revisionId }) })
    );
    expect(component['errorText']()).not.toContain('The completed run could not be opened');
    expect(generate).not.toHaveBeenCalled();
    events.complete();
  });

  it('leaves the running phase on terminal failure, keeps typed inputs and offers Retry', async () => {
    await configure();
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const before = component['intakeForm'].getRawValue();
    const request: MktgGenerateRequest = {
      agentId: SHELL_AGENT.id,
      projectUid: PROJECT_1.uid,
      intake: SHELL_INTAKE,
      answers: before,
      feedback: 'Keep the revision feedback.',
    };
    component['activeRequest'] = request;
    component['phase'].set('running');
    component['onProgress']({ type: 'failed', failure: { eventType: 'runtime_error', reason: 'The agent could not start. Retry.' } }, PROJECT_1.uid);
    fixture.detectChanges();
    expect(component['phase']()).toBe('form');
    expect(component['intakeForm'].getRawValue()).toEqual(before);
    expect(query('mktg-agent-run-error')?.textContent).toContain('The agent could not start. Retry.');
    expect(query('mktg-agent-run-retry')?.textContent).toContain('Retry');
    const actions = query('mktg-agent-run-error-actions');
    expect(actions?.classList.contains('mt-3')).toBe(true);
    expect(actions?.classList.contains('flex')).toBe(true);
    expect(actions?.classList.contains('gap-2')).toBe(true);
    expect(actions?.contains(query('mktg-agent-run-retry'))).toBe(true);
    expect(component['activeRequest']).toBe(request);
    component['intakeForm'].reset(); // Retry must not rebuild from a subsequently edited form.
    component['onRetryRun']();
    expect(generate).toHaveBeenLastCalledWith(request);
    expect(generate.mock.calls.at(-1)?.[0].feedback).toBe('Keep the revision feedback.');
  });

  for (const agentId of ['not-catalogued', MKTG_AGENTS.find((agent) => agent.status === 'coming-soon')?.id ?? 'not-catalogued']) {
    it(`redirects unrunnable ${agentId} to the Kit`, async () => {
      const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
      try {
        await configure('browser', agentId);
        expect(navigate).toHaveBeenCalledWith(['..'], expect.objectContaining({ queryParams: { project: null }, replaceUrl: true }));
      } finally {
        navigate.mockRestore();
      }
    });
  }

  it.each([false, true])('restores an ICP failure without rechecking the dead session; explicit Retry starts here (reattach=%s)', async (reattach) => {
    await configure('browser', ICP_INTAKE.agentId);
    const attempts = TestBed.inject(MktgRunAttemptService);
    const request: MktgGenerateRequest = {
      projectUid: PROJECT_1.uid,
      agentId: ICP_INTAKE.agentId,
      intake: ICP_INTAKE,
      answers: { project_name: 'Retained synthetic ICP', github_url: 'https://github.com/synthetic-org/synthetic-orbit' },
      feedback: 'Keep this synthetic retry feedback',
    };
    attempts.save({
      request,
      state: 'failed',
      requiresReattachment: reattach,
      updatedAt: new Date().toISOString(),
      attempt: {
        runId: 'b'.repeat(64),
        priorVersion: 0,
        session: { agentId: ICP_INTAKE.agentId, sessionId: 'synthetic-dead-session', ownerToken: 'synthetic-proof' },
      },
      pendingQuestions: {
        questionsId: 'a'.repeat(64),
        questions: [],
        attempt: { priorVersion: 0, session: { agentId: ICP_INTAKE.agentId, sessionId: 'synthetic-dead-session', ownerToken: 'synthetic-proof' } },
      },
    });
    const token = attempts.prepare(request, true);
    queryParams.next(convertToParamMap({ questions: token, project: PROJECT_1.slug }));
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component['phase']()).toBe('form');
    expect(component['intakeForm'].get('project_name')?.value).toBe(request.answers['project_name']);
    expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    if (reattach) {
      expect(query('mktg-agent-run-retry')).toBeNull();
      expect(query('mktg-agent-run-error')?.textContent).toContain('Reattach');
    } else {
      const prepare = vi.spyOn(attempts, 'prepare');
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockClear();
      query('mktg-agent-run-retry')?.querySelector('button')?.click();
      await fixture.whenStable();
      expect(prepare).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledExactlyOnceWith([], expect.objectContaining({ queryParams: { questions: null }, replaceUrl: true }));
      expect(generate).toHaveBeenCalledExactlyOnceWith(request);
      expect(component['phase']()).toBe('running');
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    }
  });

  it('restores an intake-only transport signal to the form, never a document or automatic submission', async () => {
    await configure();
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    component['onProgress'](
      {
        type: 'restored',
        message: 'Your intake was restored. Reattach uploaded files and press Generate explicitly.',
        pending: {
          request: { agentId: SHELL_AGENT.id, projectUid: PROJECT_1.uid, intake: SHELL_INTAKE, answers: { project_name: 'Recovered synthetic project' } },
          state: 'failed',
          updatedAt: new Date().toISOString(),
          requiresReattachment: true,
        },
      },
      PROJECT_1.uid
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component['phase']()).toBe('form');
    expect(component['intakeForm'].get('project_name')?.value).toBe('Recovered synthetic project');
    expect(query('mktg-agent-run-error')?.textContent).toContain('Reattach uploaded files');
    expect(query('mktg-agent-run-error')?.textContent).toContain('press Generate explicitly');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([false, true])('restores accepted questions from serialized file intake with a live return token=%s', async (withToken) => {
    await configure();
    const questions: MktgRunQuestionsPending = {
      attempt: { session: { agentId: SHELL_AGENT.id, sessionId: 'synthetic-file-session', ownerToken: 'synthetic-owner' }, priorVersion: 0 },
      questionsId: 'abc12345',
      questions: [{ key: 'source', label: 'Source', question: 'Which original source should be used?', why: '', suggestedAnswer: '', basis: [] }],
    };
    const pending: MktgPendingGeneration = {
      request: { agentId: SHELL_AGENT.id, projectUid: PROJECT_1.uid, intake: SHELL_INTAKE, answers: { project_name: 'Recovered file intake' } },
      state: 'questions',
      updatedAt: new Date().toISOString(),
      requiresReattachment: true,
      pendingQuestions: questions,
    };
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save(pending);
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService()).load(PROJECT_1.uid, SHELL_AGENT.id);
    if (!restored) throw new Error('Missing serialized synthetic questions');
    vi.spyOn(attempts, 'load').mockReturnValue(restored);
    const token = withToken ? attempts.prepare(restored.request, true) : 'synthetic-token-lost-after-reload';
    Object.defineProperty(TestBed.inject(ActivatedRoute).snapshot, 'queryParamMap', { value: convertToParamMap({ questions: token }), configurable: true });
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component['phase']()).toBe('questions');
    expect(component['questionsPending']()).toEqual(questions);
    expect(host().textContent).toContain('Which original source should be used?');
    expect(query('mktg-agent-run-error')?.textContent ?? '').not.toContain('Reattach');
    expect(generate).not.toHaveBeenCalled();
    const answers: MktgRunAnswer[] = [{ key: 'source', text: 'Use the original uploaded source.', origin: 'requester' }];
    component['onAnswerQuestions'](answers);
    expect(answerQuestions).toHaveBeenCalledExactlyOnceWith(restored.request, questions, answers);
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses fresh restored IDs so mounted tag controls match each project’s submitted document', async () => {
    const intake = Object.values(MKTG_AGENT_INTAKES).find((entry) => (entry.documents?.tags?.length ?? 0) >= 2);
    const tags = intake?.documents?.tags;
    if (!intake || !tags) throw new Error('Missing catalog tagged-intake fixture');
    await configure('browser', intake.agentId);
    const attempts = TestBed.inject(MktgRunAttemptService);
    for (const [context, tag] of [
      [PROJECT_1, tags[0].value],
      [PROJECT_2, tags[1].value],
    ] as const) {
      attempts.save({
        request: {
          agentId: intake.agentId,
          projectUid: context.uid,
          intake,
          answers: {},
          documents: [{ kind: 'link', title: 'Synthetic tagged source', url: 'https://example.org/synthetic-source', tag }],
        },
        state: 'draft',
        updatedAt: new Date().toISOString(),
      });
    }
    const seen = new Set<string>();
    for (const [context, tag] of [
      [PROJECT_1, tags[0].value],
      [PROJECT_2, tags[1].value],
      [PROJECT_1, tags[0].value],
    ] as const) {
      activeContext.set(context);
      await fixture.whenStable();
      fixture.detectChanges();
      const document = component['documents']()[0];
      const section = component['documentsSection']();
      if (!document || !section) throw new Error('Missing restored tagged document');
      expect(seen.has(document.id)).toBe(false);
      seen.add(document.id);
      expect(section['tagsForm'].controls[document.id].value).toBe(tag);
      expect(document.tag).toBe(tag);
      expect(component['submittedDocuments']()[0]?.tag).toBe(tag);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  describe('public run receiver', () => {
    const runId = 'c'.repeat(64);
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'living' && entry.agentKey === 'foundation-message');
    if (!type?.catalogAgentId) throw new Error('Missing living receiver fixture');
    const intake = MKTG_AGENT_INTAKES[type.catalogAgentId];
    const record = (state: 'writing' | 'questions') => ({
      project: PROJECT_1.uid,
      type,
      documentId: 'living',
      revisions: [],
      approvedCurrent: null,
      runs: [{ runId, project: PROJECT_1.uid, agentKey: type.agentKey, documentId: 'living', state, startedAt: '2026-10-28T10:00:00Z' }],
    });

    it('renders the public identity skeleton on SSR without flashing the private intake', async () => {
      await configure('server', type.catalogAgentId, { run: runId });
      userSignal.set(null);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-run-public-identity-loading')?.getAttribute('aria-busy')).toBe('true');
      expect(query('mktg-agent-run-page')?.style.display).toBe('none');
      expect(query('mktg-run-public-error')).toBeNull();
      expect(TestBed.inject(MktgDocumentStoreService).getDocument).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    });

    it('settles a malformed run selector to an error and document recovery instead of a skeleton', async () => {
      await configure('browser', type.catalogAgentId, { run: 'invalid-run' });
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['checkingRun']()).toBe(false);
      expect(query('mktg-run-public-error')).not.toBeNull();
      expect(query('mktg-run-public-document-link')).not.toBeNull();
      expect(query('mktg-run-progress-loading')).toBeNull();
      expect(generate).not.toHaveBeenCalled();
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    });

    it.each(['writing', 'questions'] as const)('opens public %s progress without starting or resuming a private run', async (state) => {
      await configure('browser', type.catalogAgentId, { run: runId });
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(of(record(state)));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const reader = fixture.debugElement.query(By.directive(MktgRunProgressComponent))?.componentInstance as MktgRunProgressComponent;
      expect(reader.runId()).toBe(runId);
      expect(reader.project()).toBe(PROJECT_1.uid);
      expect(component['publicReceiver']()).toBe(true);
      expect(query('mktg-run-public-progress')?.querySelectorAll('h1, h2')).toHaveLength(1);
      expect(query('mktg-run-public-progress')?.querySelectorAll('p[role="status"]')).toHaveLength(1);
      if (state === 'questions') expect(host().textContent).toContain('browser that started this run');
      expect(generate).not.toHaveBeenCalled();
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    });

    it.each(['writing', 'storing', 'landed'] as const)('checks the server before restoring stale private questions on reload (%s)', async (state) => {
      await configure('browser', type.catalogAgentId, { run: runId });
      const attempt = { runId, priorVersion: 0, session: { agentId: intake.agentId, sessionId: 'synthetic-stale', ownerToken: 'synthetic-proof' } };
      TestBed.inject(MktgRunAttemptService).save({
        request: { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} },
        state: 'questions',
        updatedAt: new Date().toISOString(),
        attempt,
        pendingQuestions: {
          attempt,
          questionsId: 'synthetic-stale',
          questions: [{ key: 'goal', label: 'Goal', question: 'Stale question?', why: '', suggestedAnswer: '', basis: [] }],
        },
      });
      const response = new Subject<MktgDocumentDetailResponse>();
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(response);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-agent-run-form')).toBeNull();
      expect(query('mktg-run-questions')).toBeNull();
      expect(query('mktg-run-progress-loading')?.getAttribute('aria-busy')).toBe('true');
      expect(query('mktg-run-public-progress')?.querySelector('h1')).toBeNull();
      const measured: MktgDocumentDetailResponse = { ...record('writing'), runs: state === 'landed' ? [] : [{ ...record('writing').runs[0], state }] };
      if (state === 'landed') measured.revisions = [{ id: 'synthetic-current', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
      response.next(measured);
      await fixture.whenStable();
      expect(query('mktg-run-questions')).toBeNull();
      expect(query('mktg-agent-run-form')).toBeNull();
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
      if (state === 'landed') {
        // 144-A replaces current-document landing for a browser with the matching private capability.
        expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
        expect(TestBed.inject(MktgAgentRunService).resume).toHaveBeenCalledOnce();
      } else expect(query('mktg-document-view-run-steps')).not.toBeNull();
    });

    it('resolves a plain Needs answers entry to public progress when this browser has no questions', async () => {
      await configure('browser', type.catalogAgentId);
      listDocuments.mockReturnValue(of({ ...record('questions'), groups: [] }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { run: runId }, queryParamsHandling: 'merge', replaceUrl: true })
      );
      expect(generate).not.toHaveBeenCalled();
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
    });

    it.each([false, true])('replaces public completion with the current document, or failed card (failed=%s)', async (failed) => {
      await configure('browser', type.catalogAgentId, { run: runId });
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const reader = fixture.debugElement.query(By.directive(MktgRunProgressComponent))?.componentInstance as MktgRunProgressComponent;
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      if (failed) reader.failed.emit();
      else reader.landed.emit();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledWith(
        ['..', 'documents', type.agentKey, 'living'],
        expect.objectContaining({ replaceUrl: true, queryParams: expect.objectContaining({ revision: null, generation: null, run: failed ? runId : null }) })
      );
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([true, false])('uses a public completed run pointer when present, never guesses it (pointer=%s)', async (hasPointer) => {
      await configure('browser', type.catalogAgentId, { run: runId });
      const producedRevision = '000009-' + '9'.repeat(64);
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(
        of({
          ...record('writing'),
          runs: [
            {
              ...record('writing').runs[0],
              state: 'completed',
              ...(hasPointer && { producedRevisionId: producedRevision }),
            },
          ],
        })
      );
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
        ['..', 'documents', type.agentKey, 'living'],
        expect.objectContaining({ queryParams: expect.objectContaining({ revision: hasPointer ? producedRevision : null }), replaceUrl: true })
      );
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });

    it('waits for its private v9 receipt when public completion can only identify approved v1', async () => {
      await configure('browser', type.catalogAgentId, { run: runId });
      const attempt = { runId, priorVersion: 8, session: { agentId: intake.agentId, sessionId: 'synthetic-owned', ownerToken: 'synthetic-proof' } };
      const pending: MktgPendingGeneration = {
        request: { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} },
        attempt,
        state: 'writing',
        updatedAt: '2026-10-29T09:00:00Z',
      };
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.save(pending);
      const result = new Subject<MktgGenerateProgress>();
      vi.mocked(TestBed.inject(MktgAgentRunService).resume).mockReturnValue(result);
      const metadata = new Subject<MktgDocumentDetailResponse>();
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(metadata);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      metadata.next(record('writing'));
      await fixture.whenStable();
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockClear();
      const reader = fixture.debugElement.query(By.directive(MktgRunProgressComponent))?.componentInstance as MktgRunProgressComponent;
      const approved: MktgRevisionSummary = {
        id: '000001-' + '1'.repeat(64),
        number: 1,
        createdAt: '2026-10-28T09:00:00Z',
        origin: 'generated',
        restoredFromNumber: null,
        intakeMode: 'form',
        status: '',
        contentSha256: '1'.repeat(64),
        format: 'markdown',
        commentCount: 0,
        latest: true,
        approval: null,
      };
      metadata.next({ ...record('writing'), runs: [], revisions: [approved], approvedCurrent: { revisionId: approved.id, number: 1 } });
      await fixture.whenStable();
      expect(navigate).not.toHaveBeenCalled();
      expect(result.observed).toBe(true);
      const producedRevision = '000009-' + '9'.repeat(64);
      const stored: MktgStoredAgentRun = {
        ...storedRun(PROJECT_1.uid, '# Produced v9', {}),
        agentId: intake.agentId,
        runId,
        versions: [
          {
            version: 9,
            document: '# Produced v9',
            createdAt: '2026-10-29T09:01:00Z',
            documentLocation: { agentKey: type.agentKey, documentId: 'living', revisionId: producedRevision },
          },
        ],
      };
      attempts.clear(PROJECT_1.uid, intake.agentId); // The SDK clears its hint before emitting the validated receipt.
      result.next(mktgRunProgressFixture('document', stored, 9, attempt));
      reader.landed.emit(); // A simultaneous public event cannot overwrite the exact queued destination.
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        ['..', 'documents', type.agentKey, 'living'],
        expect.objectContaining({ queryParams: expect.objectContaining({ revision: producedRevision }), replaceUrl: true })
      );
      expect(generate).not.toHaveBeenCalled();
    });

    it.each(['writing', 'questions'] as const)(
      'resumes the matching %s owner after a pre-auth public completion, never a current-document shortcut',
      async (state) => {
        await configure('browser', type.catalogAgentId, { run: runId });
        const attempt = { runId, priorVersion: 8, session: { agentId: intake.agentId, sessionId: 'synthetic-late-owner', ownerToken: 'synthetic-proof' } };
        TestBed.inject(MktgRunAttemptService).save({
          request: { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} },
          attempt,
          state,
          updatedAt: '2026-10-29T09:00:00Z',
          ...(state === 'questions' && {
            pendingQuestions: {
              attempt,
              questionsId: 'd'.repeat(64),
              questions: [{ key: 'goal', label: 'Goal', question: 'Synthetic goal?', why: '', suggestedAnswer: '', basis: [] }],
            },
          }),
        });
        userSignal.set(null);
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        const reader = fixture.debugElement.query(By.directive(MktgRunProgressComponent))?.componentInstance as MktgRunProgressComponent;
        reader.landed.emit();
        await fixture.whenStable();
        const navigate = vi.mocked(TestBed.inject(Router).navigate);
        expect(navigate).not.toHaveBeenCalled();
        userSignal.set({ sub: 'auth0|user-1' } as User);
        await fixture.whenStable();
        expect(TestBed.inject(MktgAgentRunService).resume).toHaveBeenCalledOnce();
        expect(vi.mocked(TestBed.inject(MktgAgentRunService).resume).mock.calls[0]?.[0].attempt?.runId).toBe(runId);
        expect(navigate).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
      }
    );

    it('stops private result polling and retires its hint when the server confirms failure', async () => {
      await configure('browser', type.catalogAgentId, { run: runId });
      const attempt = { runId, priorVersion: 0, session: { agentId: intake.agentId, sessionId: 'synthetic-active', ownerToken: 'synthetic-proof' } };
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.save({
        request: { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} },
        attempt,
        state: 'writing',
        updatedAt: new Date().toISOString(),
      });
      const privateResult = new Subject<MktgGenerateProgress>();
      vi.mocked(TestBed.inject(MktgAgentRunService).resume).mockReturnValue(privateResult);
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(of(record('writing')));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(privateResult.observed).toBe(true);
      const measured = record('writing');
      const failed: MktgDocumentDetailResponse = { ...measured, runs: [{ ...measured.runs[0], state: 'failed' }] };
      component['onPublicObserved']({ detail: failed, view: null });
      expect(privateResult.observed).toBe(false);
      expect(attempts.load(PROJECT_1.uid, intake.agentId)?.state).toBe('failed');
      expect(component['questionsPending']()).toBeNull();
      expect(component['waitingRun']()).toBeNull();
      expect(component['waitingQuestions']()).toBe(false);
      expect(generate).not.toHaveBeenCalled();
    });

    it('renders questions after Start ACK, private result and canonical turn while retaining the public observer', async () => {
      await configure('browser', type.catalogAgentId);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      for (const field of intake.fields) {
        if (field.optional || field.kind === 'url-list') continue;
        let value = 'Synthetic researched project';
        if (field.prefill === 'project-name') value = PROJECT_1.name;
        if (field.format?.startsWith('github')) value = 'https://github.com/synthetic/orbit';
        else if (field.format) value = 'https://synthetic.example';
        component['intakeForm'].controls[field.key].setValue(value);
      }
      const result = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(result);
      component['onSubmit']();
      await fixture.whenStable();
      expect(generate).toHaveBeenCalledOnce();
      const request = component['activeRequest'];
      if (!request) throw new Error('Missing accepted synthetic request');
      const attempt = { runId, priorVersion: 0, session: { agentId: intake.agentId, sessionId: 'synthetic-mid-run', ownerToken: 'synthetic-proof' } };
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.save({ request, attempt, state: 'writing', updatedAt: new Date().toISOString() });
      result.next({ type: 'submitted' });
      const pending = {
        attempt,
        questionsId: 'f'.repeat(64),
        questions: [{ key: 'goal', label: 'Goal', question: 'Which researched goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
      };
      const metadata = new Subject<MktgDocumentDetailResponse>();
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(metadata);
      attempts.save({ request, attempt, state: 'questions', pendingQuestions: pending, updatedAt: new Date().toISOString() });
      result.next({ type: 'questions', pending });
      await fixture.whenStable();
      expect(query('mktg-run-questions')).toBeNull();
      expect(query('mktg-run-progress-loading')).not.toBeNull();
      const measured = record('questions');
      metadata.next({
        ...measured,
        current: null,
        runs: measured.runs.map((row) => ({
          ...row,
          pendingQuestions: { questionsId: pending.questionsId, questions: pending.questions, askedAt: row.startedAt },
        })),
      });
      await fixture.whenStable();
      expect(component['publicReceiver']()).toBe(true);
      expect(component['phase']()).toBe('questions');
      expect(component['checkingRun']()).toBe(false);
      expect(query('mktg-run-questions')?.textContent).toContain('Which researched goal?');
      expect(query('mktg-run-questions')?.querySelector('textarea')).not.toBeNull();
      expect(query('mktg-agent-run-form')).toBeNull();
      expect(query('mktg-run-progress-loading')).toBeNull();
      expect(generate).toHaveBeenCalledOnce();
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it('does not paint a private result questions event before the canonical record confirms it', async () => {
      await configure('browser', type.catalogAgentId);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const attempt = { runId, priorVersion: 0, session: { agentId: intake.agentId, sessionId: 'synthetic-result', ownerToken: 'synthetic-proof' } };
      const pending = {
        attempt,
        questionsId: 'f'.repeat(64),
        questions: [{ key: 'goal', label: 'Goal', question: 'Unconfirmed questions?', why: '', suggestedAnswer: '', basis: [] }],
      };
      const request = { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} };
      TestBed.inject(MktgRunAttemptService).save({ request, attempt, state: 'questions', pendingQuestions: pending, updatedAt: new Date().toISOString() });
      component['activeRequest'] = request;
      const response = new Subject<MktgDocumentDetailResponse>();
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(response);
      component['onProgress']({ type: 'questions', pending }, PROJECT_1.uid);
      await fixture.whenStable();
      expect(query('mktg-run-progress-loading')?.getAttribute('aria-busy')).toBe('true');
      expect(query('mktg-run-questions')).toBeNull();
      expect(query('mktg-agent-run-form')).toBeNull();
      response.next(record('writing'));
      await fixture.whenStable();
      expect(query('mktg-run-questions')).toBeNull();
      expect(query('mktg-run-progress-status')?.textContent).toContain('Writing');
      expect(TestBed.inject(MktgRunAttemptService).load(PROJECT_1.uid, intake.agentId)?.pendingQuestions).toBeUndefined();
    });

    it.each([true, false])('keeps an owner-token conflict notice on the same run with observer=%s', async (available) => {
      await configure('browser', type.catalogAgentId, { run: runId });
      const attempt = { runId, priorVersion: 0, session: { agentId: intake.agentId, sessionId: 'synthetic-owner', ownerToken: 'synthetic-proof' } };
      const pending = {
        attempt,
        questionsId: 'a'.repeat(64),
        questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: 'Synthetic adoption', basis: [] }],
      };
      TestBed.inject(MktgRunAttemptService).save({
        request: { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} },
        attempt,
        pendingQuestions: pending,
        state: 'questions',
        updatedAt: new Date().toISOString(),
      });
      const metadata = vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument);
      metadata.mockReturnValue(
        of({
          ...record('questions'),
          runs: [
            {
              ...record('questions').runs[0],
              pendingQuestions: { questionsId: pending.questionsId, questions: pending.questions, askedAt: record('questions').runs[0].startedAt },
            },
          ],
        })
      );
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      metadata.mockReturnValue(of(record('writing')));
      answerQuestions.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: MKTG_RUN_ANSWERED, details: { answeredBy: 'Synthetic writer', answeredAt: '2026-10-28T10:01:00Z' } },
            })
        )
      );
      if (!available) {
        component['publicReceiver'].set(false);
        await fixture.whenStable();
      }
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockClear();
      component['onAnswerQuestions']([{ key: 'goal', text: 'Synthetic adoption', origin: 'accepted' }]);
      await fixture.whenStable();
      expect(query('mktg-run-progress-answered-note')?.textContent).toContain('Synthetic writer already answered these — the agent is writing.');
      expect(navigate).not.toHaveBeenCalled();
      // A child observer can remount while writing; its initial reset must not erase the host's scoped notice.
      component['publicReceiver'].set(false);
      await fixture.whenStable();
      component['publicReceiver'].set(true);
      await fixture.whenStable();
      expect(query('mktg-run-progress-answered-note')?.textContent).toContain('Synthetic writer already answered these — the agent is writing.');
      expect(navigate).not.toHaveBeenCalled();
      expect(query('mktg-run-questions')).toBeNull();
      expect(component['phase']()).toBe('running');
      expect(answerQuestions).toHaveBeenCalledOnce();
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([false, true].flatMap((failed) => [false, true].map((opened) => ({ failed, opened }))))(
      'holds public landing on a skeleton until identity resolves (failed=$failed, opened=$opened)',
      async ({ failed, opened }) => {
        await configure('browser', type.catalogAgentId, { run: runId });
        userSignal.set(null);
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(opened);
        const reader = fixture.debugElement.query(By.directive(MktgRunProgressComponent))?.componentInstance as MktgRunProgressComponent;
        if (failed) reader.failed.emit();
        else reader.landed.emit();
        await fixture.whenStable();
        expect(query('mktg-run-public-identity-loading')).not.toBeNull();
        expect(query('mktg-run-public-progress')?.querySelector<HTMLElement>('lfx-mktg-run-progress')?.style.display).toBe('none');
        expect(query('mktg-run-public-error')).toBeNull();
        expect(query('mktg-agent-run-open-asset')).toBeNull();
        expect(component['errorText']()).toBe('');
        expect(component['navigation']()?.runId).toBe(failed ? runId : undefined);
        expect(navigate).not.toHaveBeenCalled();
        userSignal.set({ sub: 'synthetic-signed-in' } as User);
        await fixture.whenStable();
        // No second landed/failed output: the first authenticated identity resumes
        // the saved public destination rather than resetting it away.
        expect(query('mktg-run-public-identity-loading')).toBeNull();
        expect(navigate).toHaveBeenCalledExactlyOnceWith(
          ['..', 'documents', type.agentKey, 'living'],
          expect.objectContaining({ queryParams: expect.objectContaining({ run: failed ? runId : null }), replaceUrl: true })
        );
        if (opened) {
          expect(component['navigation']()).toBeNull();
          expect(query('mktg-run-public-error')).toBeNull();
        } else {
          expect(query('mktg-run-public-error')?.textContent).toContain('could not be opened');
          query('mktg-agent-run-open-asset')?.querySelector('button')?.click();
          await fixture.whenStable();
          expect(navigate).toHaveBeenCalledTimes(2);
        }
        expect(host().textContent).not.toContain('Sign in before opening this run');
        expect(generate).not.toHaveBeenCalled();
        expect(answerQuestions).not.toHaveBeenCalled();
      }
    );

    it('discards a pre-auth public destination when its project changes before identity resolves', async () => {
      await configure('browser', type.catalogAgentId, { run: runId });
      userSignal.set(null);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      component['onPublicLanding'](true);
      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      userSignal.set({ sub: 'synthetic-signed-in' } as User);
      await fixture.whenStable();
      expect(component['navigation']()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([false, true])('continues only this browser’s matching questions attempt (matching=%s)', async (matching) => {
      await configure('browser', type.catalogAgentId, { run: runId });
      const attempt = {
        runId: matching ? runId : 'd'.repeat(64),
        priorVersion: 0,
        session: { agentId: intake.agentId, sessionId: 'synthetic-owned', ownerToken: 'synthetic-proof' },
      };
      TestBed.inject(MktgRunAttemptService).save({
        request: { projectUid: PROJECT_1.uid, agentId: intake.agentId, intake, answers: {} },
        state: 'questions',
        updatedAt: new Date().toISOString(),
        attempt,
        pendingQuestions: {
          attempt,
          questionsId: 'synthetic-block',
          questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: '', basis: [] }],
        },
      });
      const measured = record('questions');
      vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(
        of({
          ...measured,
          runs: [
            {
              ...measured.runs[0],
              pendingQuestions: {
                questionsId: 'synthetic-block',
                askedAt: measured.runs[0].startedAt,
                questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: '', basis: [] }],
              },
            },
          ],
        })
      );
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(component['publicReceiver']()).toBe(true);
      expect(component['phase']()).toBe(matching ? 'questions' : 'form');
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
      expect(TestBed.inject(MktgAgentRunService).resume).not.toHaveBeenCalled();
      if (matching) {
        vi.mocked(TestBed.inject(MktgDocumentStoreService).getDocument).mockReturnValue(of(record('writing')));
        window.dispatchEvent(new Event('focus'));
        await fixture.whenStable();
        expect(component['phase']()).toBe('running');
        expect(query('mktg-run-questions')).toBeNull();
        expect(query('mktg-document-view-run-steps')).not.toBeNull();
        expect(answerQuestions).not.toHaveBeenCalled();
      }
    });
  });

  describe('run-page progress until stored-revision landing', () => {
    const target = Object.values(MKTG_AGENT_INTAKES).find((intake) => intake.regenerateViaGenerate && !intake.endpoints.answers);
    if (!target) {
      throw new Error('Missing registered direct intake');
    }
    const fill = async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      for (const field of target.fields) {
        component['intakeForm'].controls[field.key].setValue(
          field.format?.startsWith('github') ? 'https://github.com/synthetic-org/synthetic-orbit' : 'Synthetic answer'
        );
      }
      await fixture.whenStable();
    };

    it('does not prepare or navigate an asset handoff while the effective subject is missing', async () => {
      await configure('browser', target.agentId);
      userSignal.set(null);
      await fixture.whenStable();
      await fill();
      const prepare = vi.spyOn(TestBed.inject(MktgRunAttemptService), 'prepare');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      navigate.mockClear();
      component['onSubmit']();
      await fixture.whenStable();
      expect(prepare).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(component['phase']()).toBe('form');
      expect(query('mktg-agent-run-error')).toBeNull();
      expect(query('mktg-agent-run-checking')).not.toBeNull();
    });

    it('labels a no-feed accepted attempt as writing, never as premature asset navigation', async () => {
      await configure('browser', target.agentId);
      await fill();
      const progress = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(progress);
      component['onSubmit']();
      await fixture.whenStable();
      expect(query('mktg-agent-run-status')?.textContent).toContain('Getting started');
      progress.next({ type: 'submitted' });
      await fixture.whenStable();
      expect(query('mktg-agent-run-status')?.textContent).toContain('Writing the asset');
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    });

    const accepted = () => {
      const request: MktgGenerateRequest = {
        agentId: target.agentId,
        projectUid: PROJECT_1.uid,
        intake: target,
        answers: component['intakeForm'].getRawValue(),
      };
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.save({
        request,
        state: 'writing',
        attempt: { session: { agentId: target.agentId, sessionId: 'synthetic-check-session', ownerToken: 'synthetic-check-proof' }, priorVersion: 0 },
        updatedAt: new Date().toISOString(),
      });
      component['activeRequest'] = request;
      component['phase'].set('running');
      return { request, attempts };
    };
    const complete = () => {
      const { request } = accepted();
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === target.agentId);
      if (!type) throw new Error('Missing registered document type');
      const run = storedRun(PROJECT_1.uid, '# Synthetic asset', request.answers);
      run.agentId = target.agentId;
      run.versions[0].documentLocation = { agentKey: type.agentKey, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
      component['onProgress'](mktgRunProgressFixture('document', run, 1), PROJECT_1.uid);
    };
    const checking: MktgGenerateProgress = {
      type: 'activity',
      activity: [{ id: 'synthetic-check', kind: 'checking', label: 'Checking the synthetic asset', status: 'running', startedAt: '2026-10-20T10:00:00Z' }],
    };

    it.each([
      ['generate', 'cancelled'],
      ['generate', 'rejected'],
      ['resume', 'cancelled'],
      ['resume', 'rejected'],
    ] as const)('clears a cancelled handoff on %s stream error after navigation was %s', async (origin, outcome) => {
      const intake = Object.values(MKTG_AGENT_INTAKES).find(
        (entry) => entry.endpoints.answers && entry.liveActivity && !(entry.attachments ?? []).some((attachment) => !attachment.optional)
      );
      if (!intake) throw new Error('Missing registered self-contained live intake');
      await configure('browser', intake.agentId);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      for (const field of intake.fields) {
        if (field.kind === 'url-list') continue;
        let value = 'Synthetic answer';
        if (field.format?.startsWith('github')) value = 'https://github.com/synthetic-org/synthetic-orbit';
        else if (field.key.includes('url')) value = 'https://example.org/source';
        component['intakeForm'].controls[field.key].setValue(value);
      }
      await fixture.whenStable();
      const progress = new Subject<MktgGenerateProgress>();
      const request: MktgGenerateRequest = { agentId: intake.agentId, projectUid: PROJECT_1.uid, intake, answers: component['intakeForm'].getRawValue() };
      const pending: MktgPendingGeneration = {
        request,
        state: 'writing',
        updatedAt: new Date().toISOString(),
        attempt: {
          session: { agentId: intake.agentId, sessionId: 'synthetic-error-session', ownerToken: 'synthetic-proof' },
          runId: 'b'.repeat(64),
          priorVersion: 0,
        },
      };
      const attempts = TestBed.inject(MktgRunAttemptService);
      attempts.save(pending);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      if (outcome === 'rejected') navigate.mockRejectedValue(new Error('Synthetic navigation rejection'));
      else navigate.mockResolvedValue(false);
      if (origin === 'generate') {
        useRecordedStateFixture(intake.agentId, 'b'.repeat(64), 'writing'); // 144-D requires a live record before consent.
        generate.mockReturnValue(progress);
        component['onSubmit']();
        expect(generate).not.toHaveBeenCalled(); // The fixture seeded an active attempt; fresh Generate requires C1 consent.
        discardPrompt()?.accept?.();
        expect(generate).toHaveBeenCalledTimes(1);
      } else {
        useRecordedStateFixture(intake.agentId, 'b'.repeat(64), 'writing');
        vi.spyOn(TestBed.inject(MktgAgentRunService), 'resume').mockReturnValue(progress);
        const token = attempts.prepare(request, true);
        Object.defineProperty(TestBed.inject(ActivatedRoute).snapshot, 'queryParamMap', { value: convertToParamMap({ questions: token }), configurable: true });
        activeContext.set(null);
        await fixture.whenStable();
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
      }
      expect(progress.observed).toBe(true);
      progress.next(checking);
      await fixture.whenStable();
      expect(component['navigation']()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(component['phase']()).toBe('running');
      progress.error(new HttpErrorResponse({ status: 503 }));
      await fixture.whenStable();
      expect(component['navigation']()).toBeNull();
      expect(component['navigating']()).toBe(false);
      expect(component['recheckingAttempt']()).toBe(false);
      expect(attempts.load(PROJECT_1.uid, intake.agentId)?.attempt).toEqual(pending.attempt);
      expect(component['phase']()).toBe('form');
      expect(component['submitDisabled']()).toBe(false);
      component['onRetryHandoff']();
      expect(navigate).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(origin === 'generate' ? 1 : 0);
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it.each(['failed', 'refused'] as const)('opens a recorded %s run on the document failed card, not at checking', async (event) => {
      await configure('browser', target.agentId);
      await fill();
      const { request, attempts } = accepted();
      const pending = attempts.load(PROJECT_1.uid, target.agentId);
      if (!pending?.attempt) throw new Error('Missing accepted attempt');
      const runId = 'c'.repeat(64);
      attempts.save({ ...pending, state: 'failed', attempt: { ...pending.attempt, runId } });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
      component['onProgress'](checking, PROJECT_1.uid);
      expect(navigate).not.toHaveBeenCalled();
      component['onProgress'](
        event === 'failed' ? { type: 'failed', failureText: 'Synthetic failure' } : { type: 'refused', reply: 'Synthetic refusal' },
        PROJECT_1.uid
      );
      await fixture.whenStable();
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === request.agentId);
      expect(navigate).toHaveBeenCalledWith(
        ['..', 'documents', type?.agentKey, 'living'],
        expect.objectContaining({ replaceUrl: true, queryParams: expect.objectContaining({ run: runId, revision: null, generation: null }) })
      );
      expect(component['runFailed']()).toBe(false);
      expect(query('mktg-agent-run-retry')).toBeNull();
      expect(query('mktg-agent-run-open-asset')).not.toBeNull();
      component['onRetryHandoff']();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledTimes(2);
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it.each((['document', 'persisted'] as const).flatMap((event) => [false, true].map((receipted) => ({ event, receipted }))))(
      'opens the selected older $event outcome, or recovers its exact attempt (receipt=$receipted)',
      async ({ event, receipted }) => {
        await configure('browser', target.agentId);
        await fill();
        const { request, attempts } = accepted();
        const attempt = attempts.load(PROJECT_1.uid, target.agentId)?.attempt;
        const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === target.agentId);
        if (!attempt || !type) throw new Error('Missing selected outcome fixture');
        const location = { agentKey: type.agentKey, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
        const run = storedRun(PROJECT_1.uid, '# Older replay', request.answers);
        run.agentId = target.agentId;
        run.sessionId = 'synthetic-newer-session';
        run.ownerToken = 'synthetic-newer-proof';
        if (receipted) run.versions[0].documentLocation = location;
        run.versions.push({
          version: 2,
          document: '# Newer cached document',
          createdAt: run.savedAt,
          documentLocation: { ...location, revisionId: `000002-${'b'.repeat(64)}` },
        });
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
        component['onProgress'](mktgRunProgressFixture(event, run, 1, attempt), PROJECT_1.uid);
        await fixture.whenStable();
        if (receipted) {
          expect(navigate).toHaveBeenCalledTimes(1);
          expect(navigate.mock.calls[0]?.[1]?.replaceUrl).toBe(true);
          expect(navigate.mock.calls[0]?.[1]?.queryParamsHandling).toBeUndefined();
          expect(navigate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ replaceUrl: true, queryParams: expect.objectContaining({ project: PROJECT_1.slug, revision: location.revisionId }) })
          );
        } else {
          expect(navigate).not.toHaveBeenCalled();
          expect(component['navigation']()).toBeNull();
          expect(component['phase']()).toBe('running');
          expect(component['writingStretch']()).toBe(true);
          expect(attempts.load(PROJECT_1.uid, target.agentId)?.attempt).toEqual(attempt);
        }
        expect(generate).not.toHaveBeenCalled();
        expect(answerQuestions).not.toHaveBeenCalled();
      }
    );

    it.each([false, true])('admits only the current catalog asset receipt before navigation (foreign=%s)', async (foreign) => {
      await configure('browser', target.agentId);
      await fill();
      const { request } = accepted();
      const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === target.agentId);
      const other = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey !== type?.agentKey);
      if (!type || !other) throw new Error('Missing synthetic catalog asset types');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const run = storedRun(PROJECT_1.uid, '# Synthetic asset', request.answers);
      run.agentId = target.agentId;
      run.versions[0].documentLocation = { agentKey: foreign ? other.agentKey : type.agentKey, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
      component['onProgress'](mktgRunProgressFixture('document', run, 1), PROJECT_1.uid);
      await fixture.whenStable();
      if (foreign) {
        expect(navigate).not.toHaveBeenCalled();
        expect(component['phase']()).toBe('form');
        expect(query('mktg-agent-run-error')?.textContent).toContain('receipt belongs to another asset');
      } else {
        expect(navigate).toHaveBeenCalledWith(
          ['..', 'documents', type.agentKey, 'living'],
          expect.objectContaining({
            replaceUrl: true,
            queryParams: expect.objectContaining({ project: PROJECT_1.slug, revision: `000001-${'a'.repeat(64)}` }),
          })
        );
      }
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it.each(['opened', 'cancelled', 'rejected'] as const)('coalesces receipt-less document then persisted while original navigation is %s', async (outcome) => {
      await configure('browser', target.agentId);
      await fill();
      const { request } = accepted();
      let finish: ((opened: boolean) => void) | undefined;
      let fail: ((error: Error) => void) | undefined;
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigate')
        .mockResolvedValue(true)
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve, reject) => {
              finish = resolve;
              fail = reject;
            })
        );
      const run = storedRun(PROJECT_1.uid, '# Synthetic asset', request.answers);
      run.agentId = target.agentId;
      component['onProgress'](mktgRunProgressFixture('document', run, 1), PROJECT_1.uid);
      expect(component['navigation']()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === target.agentId);
      if (!type) throw new Error('Missing document type');
      run.versions[0].documentLocation = { agentKey: type.agentKey, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
      component['onProgress'](mktgRunProgressFixture('persisted', run, 1), PROJECT_1.uid);
      if (!finish || !fail) throw new Error('Missing deferred document navigation');
      expect(component['navigation']()?.revisionId).toBe(run.versions[0].documentLocation.revisionId);
      expect(navigate).toHaveBeenCalledTimes(1);
      if (outcome === 'rejected') fail(new Error('Synthetic navigation rejection'));
      else finish(outcome === 'opened');
      await fixture.whenStable();
      expect(component['navigating']()).toBe(false);
      if (outcome !== 'opened') {
        const retry = host().querySelector<HTMLButtonElement>('[data-testid="mktg-agent-run-open-asset"] button');
        expect(retry?.disabled).toBe(false);
        retry?.click();
        await fixture.whenStable();
        expect(navigate).toHaveBeenCalledTimes(2);
      }
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it('coalesces repeated checking and completed receipts while navigation is still unresolved', async () => {
      await configure('browser', target.agentId);
      await fill();
      const { request } = accepted();
      let finish: ((opened: boolean) => void) | undefined;
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      );
      component['onProgress'](checking, PROJECT_1.uid);
      expect(component['navigation']()).toBeNull();
      component['onProgress'](checking, PROJECT_1.uid);
      expect(navigate).not.toHaveBeenCalled();
      const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === target.agentId);
      if (!type) throw new Error('Missing registered document type');
      const run = storedRun(PROJECT_1.uid, '# Synthetic asset', request.answers);
      run.agentId = target.agentId;
      run.versions[0].documentLocation = { agentKey: type.agentKey, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
      component['onProgress'](mktgRunProgressFixture('document', run, 1), PROJECT_1.uid);
      const destination = component['navigation']();
      component['onProgress'](mktgRunProgressFixture('persisted', run, 1), PROJECT_1.uid);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(component['navigation']()).toBe(destination);
      if (!finish) throw new Error('Expected deferred navigation');
      finish(true);
      await fixture.whenStable();
      expect(component['navigation']()).toBeNull();
      expect(component['navigating']()).toBe(false);
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it('retries a failed navigation only, never Generate, and keeps the form instead of a result/feedback section', async () => {
      await configure('browser', target.agentId);
      await fill();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValueOnce(false).mockResolvedValue(true);
      complete();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
      host().querySelector<HTMLButtonElement>('[data-testid="mktg-agent-run-open-asset"] button')?.click();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledTimes(2);
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="mktg-agent-run-result"]')).toBeNull();
      expect(host().querySelector('[data-testid="mktg-agent-run-version-chips"]')).toBeNull();
    });

    it.each(['project', 'subject'])('clears a stale %s destination when retry runs before the context effect', async (change) => {
      await configure('browser', target.agentId);
      await fill();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
      complete();
      await fixture.whenStable();
      expect(component['navigation']()?.revisionId).toBeTruthy();
      if (change === 'project') activeContext.set(PROJECT_2);
      else userSignal.update((user) => (user ? { ...user, sub: 'synthetic-other-subject' } : user));
      component['onRetryHandoff']();
      expect(component['navigation']()).toBeNull();
      expect(component['navigating']()).toBe(false);
      expect(component['phase']()).toBe('form');
      expect(component['errorText']()).toContain('project or identity changed');
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
      expect(answerQuestions).not.toHaveBeenCalled();
      await fixture.whenStable();
    });

    it.each(['project', 'null-context', 'subject'])('discards a pending token on %s change and ignores late navigation rejection', async (change) => {
      await configure('browser', target.agentId);
      await fill();
      let finish: (opened: boolean) => void = () => undefined;
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      );
      complete();
      await fixture.whenStable();
      expect(component['navigation']()?.revisionId).toBeTruthy();
      if (change === 'subject') userSignal.update((user) => (user ? { ...user, sub: 'synthetic-other-subject' } : user));
      else activeContext.set(change === 'project' ? PROJECT_2 : null);
      await fixture.whenStable();
      expect(component['navigation']()).toBeNull();
      finish(false);
      await fixture.whenStable();
      expect(component['navigation']()).toBeNull();
      expect(component['errorText']()).toBe('');
      component['onRetryHandoff']();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  it.each(['Synthetic runtime rejection.', ''])(
    'shows a runtime-ended failure %j as an intake error without treating it as a document',
    async (failureText) => {
      await configure();
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onProgress']({ type: 'failed', failureText }, PROJECT_1.uid);
      await fixture.whenStable();
      expect(component['phase']()).toBe('form');
      expect(query('mktg-agent-run-error')?.textContent).toContain(MKTG_RUN_FAILURE_REASON);
      if (failureText) expect(query('mktg-agent-run-error')?.textContent).not.toContain(failureText);
    }
  );

  it.each(['request', 'run'] as const)('returns an incomplete current-scope completion with missing %s to an actionable intake', async (missing) => {
    await configure();
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    component['phase'].set('running');
    component['writingStretch'].set(true);
    component['activeRequest'] = missing === 'request' ? null : { agentId: SHELL_AGENT.id, projectUid: PROJECT_1.uid, intake: SHELL_INTAKE, answers: {} };
    const progress: MktgGenerateProgress =
      missing === 'run'
        ? mktgRunProgressFixture('persisted', null, 1)
        : mktgRunProgressFixture('document', storedRun(PROJECT_1.uid, '# Synthetic asset', {}), 1);
    component['onProgress'](progress, PROJECT_1.uid);
    await fixture.whenStable();
    expect(component['phase']()).toBe('form');
    expect(component['writingStretch']()).toBe(false);
    expect(query('mktg-agent-run-form')).not.toBeNull();
    expect(query('mktg-agent-run-error')?.textContent).toContain('open Documents to check it, or try again');
    expect(generate).not.toHaveBeenCalled();
    expect(answerQuestions).not.toHaveBeenCalled();
  });

  it('ignores a late foreign-project completion without changing the active intake', async () => {
    await configure();
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    component['phase'].set('running');
    component['writingStretch'].set(true);
    component['activeRequest'] = { agentId: SHELL_AGENT.id, projectUid: PROJECT_1.uid, intake: SHELL_INTAKE, answers: {} };
    component['onProgress'](mktgRunProgressFixture('document', storedRun(PROJECT_2.uid, '# Foreign synthetic asset', {}), 1), PROJECT_2.uid);
    expect(component['phase']()).toBe('running');
    expect(component['writingStretch']()).toBe(true);
    expect(component['errorText']()).toBe('');
    expect(notifyDocumentsChanged).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(answerQuestions).not.toHaveBeenCalled();
  });

  describe('LFX prefill — applied (fromLfx) vs available (lfxMissing)', () => {
    beforeEach(async () => configure());

    it('fills empty controls from LFX and badges exactly those fields "From LFX"', async () => {
      projects = { 'proj-one': { repository_url: 'https://github.com/one/repo', description: 'One-line description from LFX' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].getRawValue()).toMatchObject({
        project_name: 'Project One',
        github_url: 'https://github.com/one/repo',
        one_line_description: 'One-line description from LFX',
      });
      expect(fromLfxChip('project_name')).not.toBeNull();
      expect(fromLfxChip('github_url')).not.toBeNull();
      expect(fromLfxChip('one_line_description')).not.toBeNull();
      // The source had a value, so the "not set on LFX" hint must not appear.
      expect(host().textContent).not.toContain('Not set on your LFX project');
    });

    it('shows the missing-prefill hint only when the resolved LFX source is actually empty', async () => {
      projects = { 'proj-one': { repository_url: 'https://github.com/one/repo', description: '' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(fromLfxChip('one_line_description')).toBeNull();
      expect(host().textContent).toContain('Not set on your LFX project');
    });

    it('never marks restored answers "From LFX" nor reads an existing LFX value as missing', async () => {
      // The stored run's answers restore BEFORE the project lookup resolves —
      // the LFX description exists but is not applied over them.
      storedRuns = {
        'proj-1': storedRun('proj-1', '# Doc', { project_name: 'My Name', github_url: 'https://github.com/mine', one_line_description: 'My own words' }),
      };
      projects = { 'proj-one': { repository_url: 'https://github.com/one/repo', description: 'One-line description from LFX' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      await fixture.whenStable();

      // Restored answers stay untouched, carry no "From LFX" chip…
      expect(component['intakeForm'].getRawValue()).toMatchObject({ one_line_description: 'My own words' });
      expect(fromLfxChip('project_name')).toBeNull();
      expect(fromLfxChip('one_line_description')).toBeNull();
      // …and the available-but-unapplied LFX value must NOT read as missing.
      expect(host().textContent).not.toContain('Not set on your LFX project');
    });
  });

  /**
   * A live demo hit the worst version of this: the repo URL was typed into the
   * Brand Kit intake, LFX had no `repository_url` for the project, and the
   * Message Foundation form then asked for it again with an empty box. The
   * marketplace must not re-ask what the user already answered — and must be
   * honest about where a reused value came from, because calling it "From LFX"
   * would claim LFX knows something it does not.
   */
  describe('prior-answer prefill — never re-ask what another agent already collected', () => {
    beforeEach(async () => configure());

    it('fills a field LFX has nothing for from the user’s earlier answer to another agent', async () => {
      projects = { 'proj-one': { repository_url: '', description: '' } };
      rememberedAnswers = {
        'proj-1': { github_url: { value: 'https://github.com/example-org/example-repo', agentId: 'foundation-setup', savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].getRawValue()).toMatchObject({ github_url: 'https://github.com/example-org/example-repo' });
    });

    it('labels a reused answer with the run it came from — never "From LFX"', async () => {
      projects = { 'proj-one': { repository_url: '', description: '' } };
      rememberedAnswers = {
        'proj-1': { github_url: { value: 'https://github.com/example-org/example-repo', agentId: 'foundation-setup', savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(priorRunChip('github_url')?.textContent).toContain('From your Messaging framework run');
      expect(fromLfxChip('github_url')).toBeNull();
    });

    it('lets LFX win: a value LFX HAS is never replaced by an older answer, and keeps the "From LFX" chip', async () => {
      projects = { 'proj-one': { repository_url: 'https://github.com/lfx/from-lfx', description: 'From LFX' } };
      rememberedAnswers = {
        'proj-1': { github_url: { value: 'https://github.com/example-org/older-answer', agentId: 'foundation-setup', savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].getRawValue()).toMatchObject({ github_url: 'https://github.com/lfx/from-lfx' });
      expect(fromLfxChip('github_url')).not.toBeNull();
      expect(priorRunChip('github_url')).toBeNull();
    });

    it('never overwrites a restored answer, and re-offers this agent’s OWN answers without a provenance chip', async () => {
      // A stored run is pruned after 24h while the answer memory lives 30 days,
      // so from day two the memory is the ONLY surviving copy of this agent's
      // own answers — skipping them outright would re-ask the user. The chip is
      // what gets suppressed: "From your Brand Kit run" on the Brand Kit form
      // would be nonsense.
      storedRuns = { 'proj-1': storedRun('proj-1', '# Doc', { project_name: 'Restored Name' }) };
      rememberedAnswers = {
        'proj-1': {
          project_name: { value: 'Reused Name', agentId: 'foundation-setup', savedAt: '2026-08-20T00:00:00.000Z' },
          voice_adjectives: { value: 'confident, technical', agentId: SHELL_AGENT.id, savedAt: '2026-08-20T00:00:00.000Z' },
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      await fixture.whenStable();

      expect(component['intakeForm'].getRawValue()).toMatchObject({ project_name: 'Restored Name', voice_adjectives: 'confident, technical' });
      expect(priorRunChip('project_name')).toBeNull();
      expect(priorRunChip('voice_adjectives')).toBeNull();
    });

    it('suppresses the LFX-empty hint for the agent’s OWN remembered answer too, chip or no chip', async () => {
      // Own-agent fills carry no provenance chip, so the hint has to be
      // suppressed on the fill itself — otherwise the form tells the user to
      // describe their project right next to the description it just filled.
      projects = { 'proj-one': { repository_url: '', description: '' } };
      rememberedAnswers = {
        'proj-1': { one_line_description: { value: 'A runtime for agents.', agentId: SHELL_AGENT.id, savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].getRawValue()).toMatchObject({ one_line_description: 'A runtime for agents.' });
      expect(priorRunChip('one_line_description')).toBeNull();
      expect(host().textContent).not.toContain('Not set on your LFX project');
    });

    it('suppresses the "not set on your LFX project" hint when a prior answer filled the field instead', async () => {
      projects = { 'proj-one': { repository_url: '', description: '' } };
      rememberedAnswers = {
        'proj-1': { one_line_description: { value: 'A runtime for agents.', agentId: 'foundation-setup', savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].getRawValue()).toMatchObject({ one_line_description: 'A runtime for agents.' });
      expect(priorRunChip('one_line_description')).not.toBeNull();
      expect(host().textContent).not.toContain('Not set on your LFX project');
    });

    /**
     * A chip is a claim about the value in the box, so it has to be withdrawn
     * when the value goes. Clearing a reused repo URL used to leave "From your
     * Message Foundation run" beside an empty control — and, worse, the fill it
     * recorded kept suppressing the LFX-empty hint that was true again.
     */
    it('withdraws the reused-answer chip once the user clears the value it filled', async () => {
      projects = { 'proj-one': { repository_url: '', description: '' } };
      rememberedAnswers = {
        'proj-1': { github_url: { value: 'https://github.com/example-org/example-repo', agentId: 'foundation-setup', savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(priorRunChip('github_url')).not.toBeNull();

      component['intakeForm'].controls['github_url'].setValue('');
      await fixture.whenStable();

      expect(priorRunChip('github_url')).toBeNull();
    });

    it('brings the LFX-empty hint back when the answer it stood down for is cleared', async () => {
      projects = { 'proj-one': { repository_url: '', description: '' } };
      rememberedAnswers = {
        'proj-1': { one_line_description: { value: 'A runtime for agents.', agentId: SHELL_AGENT.id, savedAt: '2026-08-20T00:00:00.000Z' } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(host().textContent).not.toContain('Not set on your LFX project');

      component['intakeForm'].controls['one_line_description'].setValue('');
      await fixture.whenStable();

      // LFX still has nothing and the box is empty again — the hint is the honest state.
      expect(host().textContent).toContain('Not set on your LFX project');
    });

    it('stops calling a value "From LFX" once the user has typed over it', async () => {
      projects = { 'proj-one': { repository_url: 'https://github.com/one/repo', description: 'One-line description from LFX' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(fromLfxChip('github_url')).not.toBeNull();

      component['intakeForm'].controls['github_url'].setValue('https://github.com/mine/own-repo');
      await fixture.whenStable();

      expect(fromLfxChip('github_url')).toBeNull();
      // The other fields are untouched, so their provenance stands.
      expect(fromLfxChip('one_line_description')).not.toBeNull();
    });

    it('renders NO provenance chip at all when the LFX source resolves empty and nothing else fills the field', async () => {
      projects = { 'proj-one': { repository_url: '', description: '' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // An empty prefill source must never be dressed up as "From LFX".
      expect(fromLfxChip('github_url')).toBeNull();
      expect(priorRunChip('github_url')).toBeNull();
      expect(component['intakeForm'].getRawValue()).toMatchObject({ github_url: '' });
    });

    it('re-announces the project’s documents when a late persistence retry lands the server copy', async () => {
      // Dependency resolution prefers the SERVER copy over any browser-stored
      // run, so a document announced while the write was still failing would
      // leave consumers on the previous server version until a page reload.
      dependencyDocs = {};
      const progress: MktgGenerateProgress[] = [
        { type: 'submitted' },
        mktgRunProgressFixture('document', storedRun('proj-1', '# Kit v2', { project_name: 'TestOrbit' }), 1),
        mktgRunProgressFixture('persisted', null, 1),
      ];
      generate.mockImplementation(() => from(progress));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      for (const [key, control] of Object.entries(component['intakeForm'].controls)) {
        control.setValue(key === 'github_url' ? 'https://github.com/example-org/example-repo' : `answer for ${key}`);
      }

      component['onSubmit']();
      await fixture.whenStable();

      // Once for the document, once for the server copy catching up.
      expect(notifyDocumentsChanged.mock.calls.filter(([uid]) => uid === 'proj-1')).toHaveLength(2);
    });

    it('records the submitted answers so the NEXT agent can reuse them', async () => {
      dependencyDocs = {};
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      for (const [key, control] of Object.entries(component['intakeForm'].controls)) {
        // github_url carries a blocking format rule — a placeholder there
        // would refuse the submission this test is about.
        control.setValue(key === 'github_url' ? 'https://github.com/example-org/example-repo' : `answer for ${key}`);
      }

      component['onSubmit']();

      expect(rememberAnswers).toHaveBeenCalledWith(
        'proj-1',
        SHELL_AGENT.id,
        expect.objectContaining({ github_url: 'https://github.com/example-org/example-repo', project_name: 'answer for project_name' })
      );
    });
  });

  describe('full width with a side margin — no inner max-width cap on the form or the result', () => {
    beforeEach(async () => configure());

    it('lets the form span the page container with a healthy margin', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const form = query('mktg-agent-run-form');
      expect(form?.className).toContain('w-full');
      expect(form?.className).toContain('px-6');
      expect(form?.className).not.toMatch(/max-w-/);
    });
  });

  describe('textarea field styling — full-width, never collapsed', () => {
    beforeEach(async () => configure());

    it('renders every intake textarea with the full-width field classes (w-full, min-height, resize-y)', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const textareas = Array.from(host().querySelectorAll<HTMLTextAreaElement>('textarea[data-test^="mktg-intake-"]'));
      expect(textareas.length).toBeGreaterThan(0);
      for (const textarea of textareas) {
        expect(textarea.classList.contains('w-full')).toBe(true);
        expect(textarea.classList.contains('min-h-20')).toBe(true);
        expect(textarea.classList.contains('resize-y')).toBe(true);
      }
    });
  });

  describe('resetForContext — an active-context switch never bleeds state across projects', () => {
    beforeEach(async () => configure());

    it('cancels on A to null and reinitializes the same A without automatically resubmitting', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      for (const field of SHELL_INTAKE.fields) {
        component['intakeForm'].controls[field.key].setValue(
          field.format === 'github-url' ? 'https://github.com/synthetic-org/synthetic-orbit' : 'Synthetic answer'
        );
      }
      const progress = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(progress);
      component['onSubmit']();
      await fixture.whenStable();
      expect(progress.observed).toBe(true);
      expect(component['phase']()).toBe('running');
      activeContext.set(null);
      await fixture.whenStable();
      expect(progress.observed).toBe(false);
      expect(component['activeRequest']).toBeNull();
      expect(component['navigation']()).toBeNull();
      expect(component['phase']()).toBe('form');
      expect(component['writingStretch']()).toBe(false);
      loadRun.mockClear();
      getProject.mockClear();
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(loadRun).toHaveBeenCalledWith(PROJECT_1.uid, SHELL_AGENT.id);
      expect(getProject).toHaveBeenCalledWith(PROJECT_1.slug, false);
      expect(component['intakeForm'].controls['project_name'].value).toBe(PROJECT_1.name);
      expect(component['phase']()).toBe('form');
      expect(query('mktg-agent-run-form')).not.toBeNull();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it('restores the stored run for the active project and resets fully when switching to a project without one', async () => {
      storedRuns = { 'proj-1': storedRun('proj-1', '# Doc', { project_name: 'Stored Name' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // Restored history fills the intake; the result belongs on the asset page.
      expect(query('mktg-agent-run-result')).toBeNull();
      expect(query('mktg-agent-run-form')).not.toBeNull();
      expect(component['intakeForm'].getRawValue()).toMatchObject({ project_name: 'Stored Name' });

      // Project 2 has no stored run — back to a clean form, no leaked answers,
      // only its own prefill.
      activeContext.set(PROJECT_2);
      await fixture.whenStable();

      expect(loadRun).toHaveBeenCalledWith('proj-2', SHELL_AGENT.id);
      expect(query('mktg-agent-run-result')).toBeNull();
      expect(query('mktg-agent-run-form')).not.toBeNull();
      expect(component['intakeForm'].getRawValue()).toMatchObject({ project_name: 'Project Two' });
      expect(fromLfxChip('project_name')).not.toBeNull();
    });
  });

  /**
   * The Brand Kit's `github_url` rule differs from the README-fed intakes'
   * (hand test, 2026-10-12): its answer reaches the agent as text and no
   * README is fetched from it, so a GitHub organization URL is a usable
   * answer to "the project's GitHub repo or README". Only a value that is not a
   * GitHub URL at all is refused. The ICP block below keeps refusing the
   * same account URL, because its BFF needs a repository README.
   */
  describe('Brand Kit — the logo files and the kit', () => {
    /** The approved current framework returned by the Brand Kit's sidecar read. */
    const latestFramework: MktgDependencyDocument = {
      agentId: 'foundation-setup',
      source: 'server',
      version: 2,
      document: '# Project One Messaging Framework',
      storedAt: '2026-10-17T09:00:00.000Z',
      sidecar: {
        contract: 'messaging-document-output/v1',
        fields: { 'md.tagline': { value: 'Open standards for orbital computing', source: 'Site', status: 'approved' } },
      },
    };

    beforeEach(async () => configure('browser', 'brand-kit'));

    it('asks for the project, the website, the brand page and notes, offers the logo-files section, and submits the files with the form', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(host().textContent).toContain('Your project’s approved Messaging Framework is attached automatically');
      expect(Object.keys(component['intakeForm'].controls)).toEqual(['project_name', 'website_url', 'brand_page_url', 'notes']);
      expect(fixture.debugElement.query(By.directive(MktgIntakeLogoFilesComponent))).not.toBeNull();
      expect(query('mktg-intake-documents')).toBeNull();
      // The page spans the whole width: the result is laid out as pages.
      expect(query('mktg-agent-run-page')?.className).toContain('w-full');
      expect(query('mktg-agent-run-page')?.className).not.toContain('container');

      component['intakeForm'].controls['website_url'].setValue('none');
      await fixture.whenStable();
      expect(fieldError('website_url')?.textContent).toContain('https://');
      expect(component['submitDisabled']()).toBe(true);

      component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      component['logoFiles'].set([{ id: 'svg-1', file: { name: 'logo.svg', text: '<svg/>' }, badge: 'SVG', status: '1 KB, sent as text' }]);
      component['logoFilesBusy'].set(true);
      expect(component['submitDisabled']()).toBe(true);
      component['logoFilesBusy'].set(false);
      await fixture.whenStable();
      expect(component['submitDisabled']()).toBe(false);

      component['onSubmit']();
      await fixture.whenStable();
      const request = generate.mock.calls[0][0] as MktgGenerateRequest;
      // The approved current framework goes with the form, as its JSON.
      expect(request.answers).toEqual({
        project_name: 'Project One',
        website_url: 'https://one.example.org',
        messaging_framework: JSON.stringify(latestFramework.sidecar),
      });
      expect(request.logoFiles).toEqual([{ name: 'logo.svg', text: '<svg/>' }]);
    });

    it('fills the website from the LFX project, marked From LFX and editable, like the framework intake', async () => {
      projects = { 'proj-one': { repository_url: '', website_url: 'https://one.example.org', description: '' } };
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].controls['website_url'].value).toBe('https://one.example.org');
      expect(fromLfxChip('website_url')).not.toBeNull();
      expect(fieldError('website_url')).toBeNull();

      component['intakeForm'].controls['website_url'].setValue('https://www.one.example.org');
      await fixture.whenStable();
      expect(fromLfxChip('website_url')).toBeNull();
    });

    it('drops a logo file still being read when the project changes — the old project’s artwork never lands on the new form', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const section = fixture.debugElement.query(By.directive(MktgIntakeLogoFilesComponent)).componentInstance as MktgIntakeLogoFilesComponent;
      const cancelReads = vi.spyOn(section, 'cancelReads');

      activeContext.set(PROJECT_2);
      await fixture.whenStable();

      expect(cancelReads).toHaveBeenCalled();
    });

    it('shows the live feed, then the questions, on their own — no document title, status chip or kit until there is a kit', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      await fixture.whenStable();
      const questions = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(
        concat(
          from<MktgGenerateProgress[]>([
            { type: 'submitted' },
            {
              type: 'activity',
              activity: [{ id: 'step-1', kind: 'reading', label: 'Inspecting the logo files', status: 'running', startedAt: '2026-10-18T08:00:00Z' }],
            },
          ]),
          questions
        )
      );

      component['onSubmit']();
      await fixture.whenStable();

      expect(component['phase']()).toBe('running');
      expect(query('mktg-agent-run-live')?.querySelector('[data-testid="mktg-run-activity-step-step-1"]')?.textContent).toContain('Inspecting the logo files');
      expect(query('mktg-agent-run-doc-title')).toBeNull();
      expect(query('mktg-agent-run-doc-status')).toBeNull();
      expect(query('mktg-agent-run-brand-kit')).toBeNull();
      expect(query('mktg-agent-run-result')).toBeNull();

      questions.next({
        type: 'questions',
        pending: {
          attempt: { session: { agentId: 'brand-kit', sessionId: 'sess-bk', ownerToken: 'token-bk' }, priorVersion: 0 },
          questionsId: 'bk123456',
          questions: [
            { key: 'colors', label: 'Colors', question: 'Which colours are the brand’s?', why: 'The CSS names none.', suggestedAnswer: '#F37625', basis: [] },
          ],
        },
      });
      await fixture.whenStable();

      expect(component['phase']()).toBe('questions');
      expect(query('mktg-agent-run-questions')).not.toBeNull();
      expect(query('mktg-agent-run-live')).toBeNull();
      expect(query('mktg-agent-run-doc-title')).toBeNull();
      expect(query('mktg-agent-run-brand-kit')).toBeNull();
    });

    it('attaches a framework stored as JSON — the envelope the BFF serves, the framework under `content` — and submits it as is', async () => {
      const jsonFramework: MktgDependencyDocument = {
        agentId: 'foundation-setup',
        source: 'server',
        version: 3,
        document: JSON.stringify({
          mf: { positioning: 'For platform teams.', tagline: 'Release, open.' },
          icp: [],
          mh: { umbrella: 'For platform teams.', line: 'Release, open.' },
          nums: [],
        }),
        storedAt: '2026-10-18T09:00:00.000Z',
        sidecar: {
          contract: 'messaging-framework-output/v1',
          content: {
            mf: { positioning: 'For platform teams.', tagline: 'Release, open.' },
            icp: [],
            mh: { umbrella: 'For platform teams.', line: 'Release, open.' },
            nums: [],
          },
          report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
        },
      };
      dependencyDocs = { 'proj-1:foundation-setup': jsonFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      await fixture.whenStable();

      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent?.replace(/\s+/g, ' ')).toContain('Uses the approved messaging framework · v3');
      expect(query('mktg-agent-run-missing-dependency')).toBeNull();
      expect(component['submitDisabled']()).toBe(false);

      component['onSubmit']();
      await fixture.whenStable();

      expect((generate.mock.calls[0][0] as MktgGenerateRequest).answers['messaging_framework']).toBe(JSON.stringify(jsonFramework.sidecar));
    });

    describe('the approved messaging framework — the framework is approved before the kit', () => {
      const fillRequired = (): void => {
        component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      };

      it('resolves the server’s approved framework with its sidecar, never this browser’s run', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['foundation-setup'], ['foundation-setup']);
      });

      it('names the approved attached revision and links to its page without a framework form field', async () => {
        const router = TestBed.inject(Router);
        const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        const chip = query('mktg-agent-run-attachment-foundation-setup');
        expect(chip?.textContent?.replace(/\s+/g, ' ')).toContain('Uses the approved messaging framework · v2 · 17 Oct');
        expect(chip?.textContent).toContain('approved');
        expect(host().querySelector('[data-test="mktg-intake-messaging_framework"]')).toBeNull();
        expect(query('mktg-agent-run-missing-dependency')).toBeNull();
        expect(query('mktg-agent-run-missing-dependency-link')).toBeNull();

        (chip as HTMLButtonElement | null)?.click();

        expect(navigate).toHaveBeenCalledWith(['..', 'foundation-setup'], expect.objectContaining({ queryParams: { project: PROJECT_1.slug } }));
      });

      it.each(['none stored', 'stored but unapproved'])('requires approval when the framework is %s', async () => {
        const router = TestBed.inject(Router);
        const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expect(component['submitDisabled']()).toBe(true);
        expect(query('mktg-agent-run-submit-button')?.querySelector('button')?.disabled).toBe(false);
        expect(component['submitReason']()).toContain('Approve');
        expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain(
          'Approve a messaging framework first — the Brand Kit builds on the approved one'
        );
        expect(query('mktg-agent-run-attachment-foundation-setup')).toBeNull();
        const link = query('mktg-agent-run-missing-dependency-link');
        expect(link?.textContent).toContain('Open the Messaging Framework page');

        link?.querySelector('button')?.click();

        expect(navigate).toHaveBeenCalledWith(['..', 'foundation-setup'], expect.objectContaining({ queryParams: { project: PROJECT_1.slug } }));
        component['onSubmit']();
        expect(generate).not.toHaveBeenCalled();
      });

      /**
       * The latest revision exists but the agent can read no voice from it
       * — the same rule the BFF validator applies, so the page stops here
       * instead of submitting a run that would 400 on every retry.
       */
      const expectIncompleteFrameworkStop = (): void => {
        expect(component['submitDisabled']()).toBe(true);
        expect(query('mktg-agent-run-submit-button')?.querySelector('button')?.disabled).toBe(false);
        expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain(
          'The messaging framework has no positioning or tagline yet — finish it first.'
        );
        expect(query('mktg-agent-run-missing-dependency')?.textContent).not.toContain('Approve a messaging framework first');
        expect(query('mktg-agent-run-missing-dependency-link')?.textContent).toContain('Open the Messaging Framework page');
        expect(query('mktg-agent-run-attachment-foundation-setup')).toBeNull();
        component['onSubmit']();
        expect(generate).not.toHaveBeenCalled();
      };

      it('stops with "no positioning or tagline yet — finish it first" when the latest revision has both voice fields still tbd', async () => {
        const tbd = { value: 'Needs input', source: 'Asked', status: 'tbd' };
        dependencyDocs = {
          'proj-1:foundation-setup': {
            ...latestFramework,
            sidecar: { contract: 'messaging-document-output/v1', fields: { 'md.positioning': tbd, 'md.tagline': tbd } },
          },
        };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expectIncompleteFrameworkStop();
      });

      it('stops the same way when the approved revision carries no sidecar at all (a legacy revision)', async () => {
        dependencyDocs = {
          'proj-1:foundation-setup': {
            agentId: latestFramework.agentId,
            source: latestFramework.source,
            version: latestFramework.version,
            document: latestFramework.document,
            storedAt: latestFramework.storedAt,
          },
        };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expectIncompleteFrameworkStop();
      });

      it('shows a failed check with Try again rather than approval guidance when the read fails, and re-resolves from the button', async () => {
        resolveDependencies.mockReturnValueOnce(throwError(() => new Error('503 from the BFF')));
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expect(component['submitDisabled']()).toBe(true);
        expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('Could not check the project’s Messaging Framework — try again.');
        expect(query('mktg-agent-run-missing-dependency')?.textContent).not.toContain('Approve a messaging framework first');
        expect(query('mktg-agent-run-missing-dependency-link')).toBeNull();
        expect(query('mktg-agent-run-attachment-foundation-setup')).toBeNull();

        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        query('mktg-agent-run-dependency-retry')?.querySelector('button')?.click();
        await fixture.whenStable();

        expect(resolveDependencies).toHaveBeenCalledTimes(2);
        expect(query('mktg-agent-run-missing-dependency')).toBeNull();
        expect(query('mktg-agent-run-dependency-retry')).toBeNull();
        expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('messaging framework · v2');
        expect(component['submitDisabled']()).toBe(false);
      });

      it('lets only the latest Try again land: a slower, earlier retry that fails afterwards does not clear its result', async () => {
        resolveDependencies.mockReturnValueOnce(throwError(() => new Error('503 from the BFF')));
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        const slowRetry = new Subject<Record<string, MktgDependencyDocument | null>>();
        resolveDependencies.mockReturnValueOnce(slowRetry.asObservable());
        component['onRetryDependencies']();
        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        component['onRetryDependencies']();
        slowRetry.error(new Error('503 from the BFF'));
        await fixture.whenStable();

        expect(component['dependencyCheckFailed']()).toBe(false);
        expect(query('mktg-agent-run-missing-dependency')).toBeNull();
        expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('messaging framework · v2');
        expect(component['submitDisabled']()).toBe(false);
      });

      it('drops a Try again still in flight when the project changes, so it cannot land on the new project', async () => {
        resolveDependencies.mockReturnValueOnce(throwError(() => new Error('503 from the BFF')));
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        const retry = new Subject<Record<string, MktgDependencyDocument | null>>();
        resolveDependencies.mockReturnValueOnce(retry.asObservable());
        component['onRetryDependencies']();
        dependencyDocs = { 'proj-2:foundation-setup': latestFramework };
        activeContext.set(PROJECT_2);
        await fixture.whenStable();
        retry.error(new Error('503 from the BFF'));
        await fixture.whenStable();

        expect(retry.observed).toBe(false);
        expect(component['dependencyCheckFailed']()).toBe(false);
        expect(query('mktg-agent-run-missing-dependency')).toBeNull();
        expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('messaging framework · v2');
      });

      it('reports a check that fails at submit time as such, not as a failed run', async () => {
        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();
        resolveDependencies.mockReturnValueOnce(throwError(() => new Error('503 from the BFF')));

        component['onSubmit']();
        await fixture.whenStable();

        expect(generate).not.toHaveBeenCalled();
        expect(component['phase']()).toBe('form');
        expect(query('mktg-agent-run-error')?.textContent).toContain('Could not check the project’s Messaging Framework — try again.');
        expect(query('mktg-agent-run-dependency-retry')).not.toBeNull();
      });

      it('stays disabled, with no note, while the framework is still resolving', async () => {
        resolveDependencies.mockReturnValueOnce(new Subject<Record<string, MktgDependencyDocument | null>>().asObservable());
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expect(component['submitDisabled']()).toBe(true);
        expect(query('mktg-agent-run-missing-dependency')).toBeNull();
      });

      it('aborts the submit honestly when the revision is gone by submit time', async () => {
        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();
        dependencyDocs = {};

        component['onSubmit']();
        await fixture.whenStable();

        expect(generate).not.toHaveBeenCalled();
        expect(component['phase']()).toBe('form');
        expect(query('mktg-agent-run-error')?.textContent).toContain('Approve a messaging framework first');
      });

      it('shows the agent’s refusal reply as the run’s outcome — back on the form, nothing stored — should the agent still refuse', async () => {
        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();
        generate.mockReturnValue(
          from<MktgGenerateProgress[]>([
            { type: 'submitted' },
            {
              type: 'refused',
              reply:
                'The Brand Kit request for Project One has no approved messaging framework attached, so this run was not started: nothing was read, inspected or built.',
            },
          ])
        );

        component['onSubmit']();
        await fixture.whenStable();

        expect(component['phase']()).toBe('form');
        expect(query('mktg-agent-run-error')?.textContent).toContain('this run was not started');
        expect(query('mktg-agent-run-result')).toBeNull();
        expect(component['activeRequest']).toBeNull();
        expect(component['intakeForm'].controls['website_url'].value).toBe('https://one.example.org');
      });
    });
  });

  describe('Boilerplates — a short form, the run, the questions, landing on the Boilerplates view', () => {
    /** The project's latest stored messaging framework revision as the sidecar read rebuilds it: the envelope with the content back under `content`. */
    const latestFramework: MktgDependencyDocument = {
      agentId: 'foundation-setup',
      source: 'server',
      version: 3,
      document: '# Project One Messaging framework',
      storedAt: '2026-10-18T09:00:00.000Z',
      sidecar: {
        contract: 'messaging-framework-output/v1',
        version: 1,
        content: {
          mf: { positioning: 'The open service mesh.', tagline: 'Mesh, open.' },
          icp: [],
          mh: { umbrella: 'Open mesh', line: 'Mesh, open.' },
          nums: [],
        },
      },
    };
    const BOILERPLATES: MktgRunAsset = {
      kind: 'boilerplates',
      mode: 'draft',
      content: {
        bp: [
          { l: 'One-liner', max: 15, t: 'Project One is the open service mesh.' },
          { l: '25 words', max: 25, t: 'Project One, a Linux Foundation project, is the open service mesh.' },
          { l: '50 words', max: 50, t: 'Project One, a Linux Foundation project, is the open service mesh for platform teams.' },
          { l: '100 words', max: 100, t: 'Project One, a Linux Foundation project, is the open service mesh. Learn more at one.example.org.' },
        ],
      },
      report: { sources_read: ['https://one.example.org'], sources_failed: [], gaps: ['The launch year is not stated.'], notes: '' },
      checks: { word_counts: [7, 11, 14, 16], findings: [] },
    };

    beforeEach(async () => configure('browser', 'boilerplates'));

    it('asks only for the project name, the website and notes — both prefilled from LFX — and spans the full width', async () => {
      projects = { 'proj-one': { repository_url: '', website_url: 'https://one.example.org', description: '' } };
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(Object.keys(component['intakeForm'].controls)).toEqual(['project_name', 'website_url', 'notes']);
      expect(component['intakeForm'].controls['project_name'].value).toBe('Project One');
      expect(component['intakeForm'].controls['website_url'].value).toBe('https://one.example.org');
      expect(fromLfxChip('project_name')).not.toBeNull();
      expect(fromLfxChip('website_url')).not.toBeNull();
      expect(query('mktg-agent-run-form-title')?.textContent).toContain('Write the Project One Boilerplates');
      expect(host().querySelector('[data-test="mktg-intake-messaging_framework"]')).toBeNull();
      expect(query('mktg-agent-run-page')?.className).toContain('w-full');
      expect(query('mktg-agent-run-page')?.className).not.toContain('container');
      // Nothing a user reads names the author of the reference material.
      expect(host().textContent).not.toMatch(/\bPaul\b/);
    });

    it('attaches the latest messaging framework, says so with its version, and submits it with the form and the project', async () => {
      projects = { 'proj-one': { repository_url: '', website_url: 'https://one.example.org', description: '' } };
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['foundation-setup'], ['foundation-setup']);
      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent?.replace(/\s+/g, ' ')).toContain(
        'Uses the approved messaging framework · v3 · 18 Oct'
      );
      expect(component['submitDisabled']()).toBe(false);

      component['onSubmit']();
      await fixture.whenStable();

      const request = generate.mock.calls[0][0] as MktgGenerateRequest;
      expect(request.intake).toBe(MKTG_AGENT_INTAKES['boilerplates']);
      expect(request.projectUid).toBe('proj-1');
      expect(request.answers).toEqual({
        project_name: 'Project One',
        website_url: 'https://one.example.org',
        messaging_framework: JSON.stringify(latestFramework.sidecar),
      });
    });

    it('cannot run without a framework: Run is disabled, the page says to run the framework first and links to it', async () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['submitDisabled']()).toBe(true);
      expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('Approve the messaging framework in Documents first');
      const link = query('mktg-agent-run-missing-dependency-link');
      expect(link?.textContent).toContain('Open the Messaging Framework page');
      link?.querySelector('button')?.click();
      expect(navigate).toHaveBeenCalledWith(['..', 'foundation-setup'], expect.objectContaining({ queryParams: { project: PROJECT_1.slug } }));
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();
    });

    it('stops on a latest revision that is not a framework (a legacy Messaging Document), with the link, instead of a run that would fail', async () => {
      dependencyDocs = {
        'proj-1:foundation-setup': {
          ...latestFramework,
          sidecar: { contract: 'messaging-document-output/v1', fields: { 'md.tagline': { value: 'Mesh, open.', source: 'Site', status: 'approved' } } },
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['submitDisabled']()).toBe(true);
      expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain(
        'The approved messaging framework could not be read — generate and approve a new revision in Documents first.'
      );
      expect(query('mktg-agent-run-missing-dependency-link')?.textContent).toContain('Open the Messaging Framework page');
      expect(query('mktg-agent-run-attachment-foundation-setup')).toBeNull();
    });

    it('shows the live feed alone while the agent works, then lands on the Boilerplates view', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const progress = new Subject<MktgGenerateProgress>();
      generate.mockReturnValue(progress.asObservable());

      component['onSubmit']();
      progress.next({ type: 'submitted' });
      await fixture.whenStable();
      expect(query('mktg-agent-run-live')).not.toBeNull();
      expect(query('mktg-boilerplates-view')).toBeNull();

      vi.useFakeTimers();
      try {
        progress.next(
          mktgRunProgressFixture(
            'document',
            {
              agentId: 'boilerplates',
              projectUid: 'proj-1',
              sessionId: 'sess-bp',
              ownerToken: 'token-bp',
              answers: {},
              versions: [
                {
                  version: 1,
                  document: '',
                  asset: BOILERPLATES,
                  createdAt: '2026-10-19T09:00:00.000Z',
                  documentLocation: { agentKey: 'boilerplates', documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` },
                },
              ],
              savedAt: '2026-10-19T09:00:00.000Z',
            },
            1
          )
        );
        vi.advanceTimersByTime(600);
      } finally {
        vi.useRealTimers();
      }
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).toBeNull();
      expect(query('mktg-boilerplates-view')).toBeNull();
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['..', 'documents', 'boilerplates', 'living'], expect.anything());
      expect(notifyDocumentsChanged).toHaveBeenCalledWith('proj-1');
    });
  });

  describe('github_url format rule — an organization URL is a usable answer', () => {
    beforeEach(async () => configure());

    const fillAll = (githubUrl: string): void => {
      for (const [key, control] of Object.entries(component['intakeForm'].controls)) {
        control.setValue(key === 'github_url' ? githubUrl : `answer for ${key}`);
      }
    };

    it('accepts an organization URL and submits it as answered', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      fillAll('https://github.com/opensearch-project');
      await fixture.whenStable();

      expect(fieldError('github_url')).toBeNull();
      expect(component['submitDisabled']()).toBe(false);
      component['onSubmit']();
      expect(generate).toHaveBeenCalledTimes(1);
      expect((generate.mock.calls[0][0] as MktgGenerateRequest).answers).toMatchObject({ github_url: 'https://github.com/opensearch-project' });
    });

    it('still blocks a URL that is not a GitHub URL at all, offering both shapes', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      fillAll('https://gitlab.com/example-org/example-repo');
      await fixture.whenStable();

      expect(fieldError('github_url')?.textContent).toContain('doesn’t look like a GitHub URL');
      expect(fieldError('github_url')?.textContent).toContain('https://github.com/org/repo or https://github.com/org');
      expect(component['submitDisabled']()).toBe(true);
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe('Messaging Framework — the intake form, the run on the asset view, the questions', () => {
    const fillRequired = (): void => {
      component['intakeForm'].controls['project_name'].setValue('TestOrbit');
    };
    const giveSource = (): void => {
      component['intakeForm'].controls['website_url'].setValue('https://testorbit.example.org');
    };
    const submitted = (): MktgGenerateRequest => generate.mock.calls[0][0] as MktgGenerateRequest;
    const QUESTIONS = [
      {
        key: 'ranked-goals',
        label: 'Ranked goals',
        question: 'Which goals matter most this year?',
        why: 'The site lists no plan.',
        suggestedAnswer: 'Adoption first.',
        basis: ['https://testorbit.example.org/about', 'inferred'],
      },
      { key: 'words-to-avoid', label: 'Words to avoid', question: 'Which words should the framework avoid?', why: '', suggestedAnswer: '', basis: [] },
    ];
    const pendingQuestions = (): MktgRunQuestionsPending => ({
      attempt: { session: { agentId: 'foundation-setup', sessionId: 'sess-mf', ownerToken: 'token-mf' }, priorVersion: 0 },
      questionsId: 'abc12345',
      questions: QUESTIONS,
    });
    const pair = (a: string, b: string): [string, string] => [a, b];
    /** A framework as the result endpoint returns it: the run's asset. */
    const ASSET: MktgRunAsset = {
      kind: 'messaging-framework',
      mode: 'draft',
      content: {
        mf: {
          vision: 'A vision.',
          mission: 'A mission.',
          positioning: 'For platform teams, TestOrbit is the open release toolkit.',
          tagline: 'Release, open.',
          goals: [
            {
              id: 'adoption',
              n: 1,
              t: 'Adoption',
              vp: 'VP.',
              key: 'Key.',
              proof: [pair('1,200 members', 'Website')],
              bite: 'Adoption in the open',
              icps: ['users'],
            },
          ],
          crosscut: 'Every column grows the audience.',
          say: ['open release'],
          avoid: [pair('synergy', 'working together')],
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
            lead: 'Ship with confidence.',
            proof: [pair('A fact', 'Docs')],
            cta: 'Try it.',
            channels: ['Docs'],
            objection: ['Too early?', null],
            personas: [pair('SRE', 'uptime')],
            basis: 'Website',
          },
        ],
        mh: {
          umbrella: 'Umbrella.',
          line: 'Release, open.',
          pillars: [{ t: 'Open', m: 'Open message.', p: [pair('Fact', 'Web')] }],
          found: 'A Linux Foundation project.',
          aud: [pair('End users', 'Ship with confidence.')],
        },
        nums: [pair('1,200', 'members')],
      },
      report: { sources_read: ['https://testorbit.example.org'], sources_failed: [], gaps: ['No member count.'], notes: '' },
      checks: { findings: [] },
    };
    const assetRun = (versions: MktgRunVersion[]): MktgStoredAgentRun => ({
      agentId: 'foundation-setup',
      projectUid: 'proj-1',
      sessionId: 'sess-mf',
      ownerToken: 'token-mf',
      answers: { project_name: 'TestOrbit', website_url: 'https://testorbit.example.org' },
      versions,
      savedAt: new Date().toISOString(),
    });

    beforeEach(async () => configure('browser', 'foundation-setup'));

    it('warns about a stored Drive source immediately on restore', async () => {
      const stored = assetRun([]);
      stored.answers['website_url'] = 'https://drive.google.com/file/d/synthetic/view';
      storedRuns['proj-1'] = stored;
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-agent-run-link-warning-website_url')?.textContent).toContain(MKTG_INTAKE_LINK_ADVICE.drivePrivate);
      expect(generate).not.toHaveBeenCalled();
    });

    it('warns about Drive sources and duplicate fields without disabling Generate', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const url = 'https://drive.google.com/drive/folders/synthetic';
      component['intakeForm'].patchValue({ project_name: 'Synthetic project', website_url: url, deck_url: url + '/?usp=sharing' });
      await fixture.whenStable();
      expect(query('mktg-agent-run-link-warning-website_url')?.textContent).toContain(MKTG_INTAKE_LINK_ADVICE.driveFolder);
      expect(query('mktg-agent-run-link-warning-deck_url')?.textContent).toContain(MKTG_INTAKE_LINK_ADVICE.duplicate);
      expect(component['submitDisabled']()).toBe(false);
      expect(host().querySelector<HTMLButtonElement>('[data-testid="mktg-agent-run-submit-button"] button')?.disabled).toBe(false);
      expect(component['documentsSection']()?.earlierUrls()).toContain(url);
      component['intakeForm'].patchValue({ website_url: 'https://project.example', deck_url: '' });
      await fixture.whenStable();
      expect(query('mktg-agent-run-link-warning-deck_url')).toBeNull();
    });

    it('renders the guided form: the project, one labelled source field per thing the agent reads, in order, each with its explanation and example; other links and documents in one section', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const project = query('mktg-agent-run-group-project');
      expect(project?.querySelector('[data-test="mktg-intake-project_name"]')).not.toBeNull();
      expect(project?.querySelector('[data-test="mktg-intake-description"]')).not.toBeNull();
      const sources = query('mktg-agent-run-group-sources');
      const labels = Array.from(sources?.querySelectorAll('label:not(.sr-only)') ?? []).map((label) => label.textContent?.replaceAll('*', '').trim());
      expect(labels).toEqual([
        'Website',
        'GitHub repository or README',
        'Launch press release or announcement',
        'Members or partners page',
        'Projects or products page',
        'Existing deck or pitch',
        'Marketing or strategy plan',
        'Brand page',
      ]);
      for (const key of ['website_url', 'github_url', 'press_release_url', 'members_page_url', 'projects_page_url', 'deck_url', 'plan_url', 'brand_page_url']) {
        const input = sources?.querySelector(`[data-test="mktg-intake-${key}"]`);
        expect(input).not.toBeNull();
        const hint = host().querySelector('#mktg-intake-' + key + '-hint');
        expect(hint?.textContent).toContain(MKTG_DRIVE_SHARING_HINT);
        expect(input?.getAttribute('aria-describedby')).toBe(hint?.id);
        const existing = component['intake']?.fields.find((field) => field.key === key)?.hint;
        if (existing) expect(hint?.textContent).toContain(existing);
      }
      // Each source says what it is for and shows an example value.
      expect(sources?.textContent).toContain('searches the LF press archive itself');
      expect(sources?.querySelector<HTMLInputElement>('[data-test="mktg-intake-members_page_url"]')?.placeholder).toBe('https://aaif.io/members');
      expect(sources?.querySelector<HTMLInputElement>('[data-test="mktg-intake-website_url"]')?.placeholder).toBe('https://aaif.io');
      // The GitHub field (hand test, 18 Oct) sits right after the website, optional, with its own hint.
      expect(sources?.querySelector<HTMLInputElement>('[data-test="mktg-intake-github_url"]')?.placeholder).toBe('https://github.com/…');
      expect(sources?.textContent).toContain('Leave it empty and the agent looks for it itself');
      // The deck and the plan take an upload or a link; the pages take a link only.
      expect(query('mktg-intake-deck_url-upload')).not.toBeNull();
      expect(query('mktg-intake-plan_url-upload')).not.toBeNull();
      expect(query('mktg-intake-members_page_url-upload')).toBeNull();
      // No separate "Other links" list (hand test, 18 Oct): extra links and uploads share one section at the end.
      expect(query('mktg-agent-run-list-links')).toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-links"]')).toBeNull();
      // No notes field and no notes group (hand test, 18 Oct): audiences, goals and words to avoid come up as the agent's gap questions.
      expect(query('mktg-agent-run-group-notes')).toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-notes"]')).toBeNull();
      // The intro says what the agent does with the form and what is optional.
      expect(host().textContent).toContain('Only the website is required');
      // No questions on the form: the agent asks only the gaps afterwards.
      expect(query('mktg-agent-run-group-questions')).toBeNull();
      expect(query('mktg-intake-documents')).not.toBeNull();
      expect(query('mktg-intake-documents')?.textContent).toContain('Other links and documents');
      // Runs first: no Brand Kit chip and no missing-dependency gate.
      expect(query('mktg-agent-run-attachments')).toBeNull();
      expect(query('mktg-agent-run-missing-dependency')).toBeNull();
      expect(host().textContent).not.toContain('Messaging Document');
    });

    it('names no one anywhere the user sees — this is a product, not a proof of concept', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(host().textContent).not.toContain('Paul');
      for (const copy of [MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_INTAKE_FORMAT_ERRORS, FOUNDATION_MESSAGE_READ_REASONS]) {
        expect(JSON.stringify(copy)).not.toContain('Paul');
      }
    });

    it('requires the project name and the website — a real page, never "none" — and says beside the button that the rest is optional', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      // The project name is prefilled; the website is the one field left to give.
      expect(component['intakeForm'].valid).toBe(false);
      expect(component['submitDisabled']()).toBe(true);
      expect(query('mktg-agent-run-submit-button')?.parentElement?.textContent).toContain('* required — everything else is optional');
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();

      component['intakeForm'].controls['website_url'].setValue('none');
      await fixture.whenStable();
      expect(fieldError('website_url')?.textContent).toContain('https://');
      expect(component['submitDisabled']()).toBe(true);

      // A deck alone does not open the button: the website is the one gate, as the BFF's validator holds it.
      component['intakeForm'].controls['website_url'].setValue('');
      component['intakeForm'].controls['deck_url'].setValue('https://docs.google.com/presentation/d/x');
      await fixture.whenStable();
      expect(component['submitDisabled']()).toBe(true);

      giveSource();
      await fixture.whenStable();
      expect(fieldError('website_url')).toBeNull();
      expect(component['intakeForm'].valid).toBe(true);
      expect(component['submitDisabled']()).toBe(false);

      component['intakeForm'].controls['project_name'].setValue('');
      expect(component['submitDisabled']()).toBe(true);
    });

    it('takes "none" or an https:// link on the optional link fields, blocks anything else saying why', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();
      giveSource();

      component['intakeForm'].controls['press_release_url'].setValue('None');
      await fixture.whenStable();
      expect(fieldError('press_release_url')).toBeNull();
      component['intakeForm'].controls['press_release_url'].setValue('http://press.example.org/launch');
      await fixture.whenStable();
      expect(fieldError('press_release_url')?.textContent).toContain('https://');
      expect(component['submitDisabled']()).toBe(true);
      component['intakeForm'].controls['press_release_url'].setValue('https://press.example.org/launch');
      await fixture.whenStable();
      expect(fieldError('press_release_url')).toBeNull();
    });

    it('fills the website and the GitHub repository from the LFX project, marked From LFX, and leaves them editable', async () => {
      // Hand test, 18 Oct: "it should get the github from the lfx ui. website too if it has it".
      projects = { 'proj-one': { repository_url: 'https://github.com/testorbit/testorbit', website_url: 'https://testorbit.example.org', description: '' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].controls['website_url'].value).toBe('https://testorbit.example.org');
      expect(component['intakeForm'].controls['github_url'].value).toBe('https://github.com/testorbit/testorbit');
      expect(fromLfxChip('website_url')).not.toBeNull();
      expect(fromLfxChip('github_url')).not.toBeNull();
      expect(fieldError('website_url')).toBeNull();

      component['intakeForm'].controls['website_url'].setValue('https://www.testorbit.example.org');
      await fixture.whenStable();
      expect(fromLfxChip('website_url')).toBeNull();
    });

    it('fills the one-line description from a multi-paragraph LFX description as ONE line, and submits it as one line', async () => {
      // An LFX project description with paragraph breaks: the input would hide
      // them while the control kept them, and the BFF refuses a description
      // that is not one line — the run would fail with a cause nobody can see.
      projects = { 'proj-one': { repository_url: '', description: 'An open release toolkit.\n\nBuilt by platform teams.\r\n  For everyone.  ' } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].controls['description'].value).toBe('An open release toolkit. Built by platform teams. For everyone.');
      expect(fromLfxChip('description')).not.toBeNull();
      expect(fieldError('description')).toBeNull();

      fillRequired();
      giveSource();
      component['onSubmit']();
      await fixture.whenStable();

      expect(submitted().answers['description']).toBe('An open release toolkit. Built by platform teams. For everyone.');
      expect(submitted().answers['description']).not.toMatch(/[\r\n]/);
    });

    it('blocks a multi-line value in the one-line description on the form, saying why, instead of sending a run the BFF refuses', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();
      giveSource();

      // A paste, or a value restored into the control, that still holds its line breaks.
      component['intakeForm'].controls['description'].setValue('An open release toolkit.\nBuilt by platform teams.');
      await fixture.whenStable();

      expect(fieldError('description')?.textContent).toContain('one line');
      expect(component['intakeForm'].valid).toBe(false);
      expect(component['submitDisabled']()).toBe(true);
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();

      component['intakeForm'].controls['description'].setValue('An open release toolkit. Built by platform teams.');
      await fixture.whenStable();

      expect(fieldError('description')).toBeNull();
      expect(component['submitDisabled']()).toBe(false);
    });

    it('submits every source field given and the documents — a link by its URL, a file by its text, each with its tag — and waits while a file is being read', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();
      giveSource();
      component['intakeForm'].controls['github_url'].setValue('https://github.com/testorbit/testorbit');
      component['intakeForm'].controls['press_release_url'].setValue('https://press.example.org/launch');
      component['intakeForm'].controls['members_page_url'].setValue('https://testorbit.example.org/members');
      component['documents'].set([
        {
          id: 'link-1',
          kind: 'link',
          title: 'https://wiki.example.org/positioning',
          url: 'https://wiki.example.org/positioning',
          tag: 'doc',
          read: false,
          words: 0,
          truncated: false,
        },
        { id: 'file-1', kind: 'file', title: 'deck.pdf', text: 'Members deck.', tag: 'deck', read: true, words: 2, truncated: false },
      ]);

      component['documentsBusy'].set(true);
      expect(component['submitDisabled']()).toBe(true);
      component['documentsBusy'].set(false);

      component['onSubmit']();
      await fixture.whenStable();

      // Blank optionals stay out; the BFF maps each key to the agent's contract (press → a press document, github and members → links).
      expect(submitted().answers).toEqual({
        project_name: 'TestOrbit',
        website_url: 'https://testorbit.example.org',
        github_url: 'https://github.com/testorbit/testorbit',
        press_release_url: 'https://press.example.org/launch',
        members_page_url: 'https://testorbit.example.org/members',
      });
      expect(submitted().documents).toEqual([
        { kind: 'link', title: 'https://wiki.example.org/positioning', url: 'https://wiki.example.org/positioning', tag: 'doc' },
        { kind: 'file', title: 'deck.pdf', text: 'Members deck.', tag: 'deck' },
      ]);
    });

    it('lists a file picked on the deck field under the documents, already tagged as a deck', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          ...assetRun([]),
          answers: { project_name: 'TestOrbit', website_url: 'https://testorbit.example.org' },
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      readFile.mockReturnValue(of<MktgDocumentExtractResponse>({ title: 'board-deck.pptx', read: true, words: 3, truncated: false, text: 'Deck text here' }));
      const deckField = component['intake']?.fields.find((field) => field.key === 'deck_url');
      expect(deckField?.uploadTag).toBe('deck');
      component['onFieldFilesSelected'](deckField!, { originalEvent: new Event('change'), files: [new File(['x'], 'board-deck.pptx')], currentFiles: [] });
      await fixture.whenStable();

      expect(component['documents']()).toEqual([expect.objectContaining({ kind: 'file', title: 'board-deck.pptx', text: 'Deck text here', tag: 'deck' })]);
      expect(query('mktg-intake-documents-list')?.textContent).toContain('board-deck.pptx');
    });

    it('never attaches a file picked for one project to another: a project switch cancels the read still in flight', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const response = new Subject<MktgDocumentExtractResponse>();
      readFile.mockReturnValue(response.asObservable());
      const section = fixture.debugElement.query(By.directive(MktgIntakeDocumentsComponent)).componentInstance as MktgIntakeDocumentsComponent;
      section['onFilesSelected']({ originalEvent: new Event('change'), files: [new File(['Deck.'], 'deck.md')], currentFiles: [] });
      expect(component['documentsBusy']()).toBe(true);

      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      // Project One's file answers after the switch.
      response.next({ title: 'deck.md', read: true, words: 1, truncated: false, text: 'Deck.' });
      response.complete();
      await fixture.whenStable();

      expect(component['documents']()).toEqual([]);
      expect(component['documentsBusy']()).toBe(false);
    });

    describe('the run route owns research and questions before handing off to the asset route', () => {
      it('keeps the research feed on the run route and labels the writing stretch after answers', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        giveSource();
        generate.mockReturnValue(
          concat(
            from<MktgGenerateProgress[]>([
              { type: 'submitted' },
              {
                type: 'activity',
                activity: [
                  {
                    id: 'step-1',
                    kind: 'reading',
                    label: 'Reading testorbit.example.org',
                    status: 'done',
                    startedAt: '2026-10-16T08:00:00Z',
                    endedAt: '2026-10-16T08:00:02Z',
                  },
                  {
                    id: 'step-2',
                    kind: 'search',
                    label: 'Searching the web',
                    detail: '“TestOrbit adopters”',
                    status: 'running',
                    startedAt: '2026-10-16T08:00:03Z',
                  },
                ],
              },
            ]),
            NEVER
          )
        );
        component['onSubmit']();
        await fixture.whenStable();

        expect(component['phase']()).toBe('running');
        expect(query('mktg-agent-run-live')).not.toBeNull();
        // The run page owns the status; its compact feed has no duplicate header or document view.
        expect(query('mktg-framework-view')).toBeNull();
        expect(query('mktg-framework-view-title')).toBeNull();
        expect(query('mktg-framework-view-tabs')).toBeNull();
        expect(query('mktg-agent-run-status')?.textContent).toContain('Researching');
        expect(query('mktg-agent-run-live')?.querySelector('[data-testid="mktg-run-activity-title"]')).toBeNull();
        expect(query('mktg-agent-run-live')?.querySelector('h2')).toBeNull();
        expect(query('mktg-run-activity-step-step-1')?.textContent).toContain('Reading testorbit.example.org');
        expect(query('mktg-run-activity-step-step-2')?.textContent).toContain('“TestOrbit adopters”');
        expect(query('mktg-run-activity-status')?.textContent).toContain('Searching the web');
        // The old staged checklist and the document result card are for agents without an asset view.
        expect(query('mktg-agent-run-running')).toBeNull();
        expect(query('mktg-agent-run-doc-title')).toBeNull();
      });
    });

    describe('the questions step — after research, only the gaps, one at a time on their own page, each answer starting as the suggestion', () => {
      const stepper = (): MktgRunQuestionsComponent =>
        fixture.debugElement.query(By.directive(MktgRunQuestionsComponent)).componentInstance as MktgRunQuestionsComponent;
      // An lfx-button carries the test id on its host; the click has to reach the button inside.
      const click = async (testId: string): Promise<void> => {
        const target = query(testId);
        (target?.tagName === 'LFX-BUTTON' ? target.querySelector('button') : target)?.click();
        await fixture.whenStable();
      };
      const answerBox = (key: string): HTMLTextAreaElement | null =>
        host().querySelector<HTMLTextAreaElement>(`[data-test="mktg-run-questions-answer-${key}"]`);
      const type = async (key: string, text: string): Promise<void> => {
        stepper()['answersForm'].controls[key].setValue(text);
        await fixture.whenStable();
      };
      const sendWith = async (avoidAnswer: string): Promise<void> => {
        await click('mktg-run-questions-next');
        await type('words-to-avoid', avoidAnswer);
        await click('mktg-run-questions-send');
      };

      beforeEach(async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        giveSource();
        generate.mockReturnValue(from<MktgGenerateProgress[]>([{ type: 'submitted' }, { type: 'questions', pending: pendingQuestions() }]));
        component['onSubmit']();
        await fixture.whenStable();
      });

      it('asks one question at a time on its own page: the question, the why, the basis links, and one box holding the suggested answer', () => {
        expect(component['phase']()).toBe('questions');
        // The questions page stands alone too: no document shell around it.
        expect(query('mktg-framework-view')).toBeNull();
        expect(query('mktg-agent-run-questions')).not.toBeNull();
        expect(query('mktg-run-questions-progress')?.textContent).toContain('Question 1 of 2');
        expect(query('mktg-run-questions-card-ranked-goals')?.textContent).toContain('Which goals matter most this year?');
        expect(query('mktg-run-questions-card-words-to-avoid')).toBeNull();
        expect(query('mktg-run-questions-why-ranked-goals')?.textContent).toContain('lists no plan');
        const basis = query('mktg-run-questions-basis-ranked-goals');
        expect(basis?.querySelector('a')?.getAttribute('href')).toBe('https://testorbit.example.org/about');
        expect(basis?.textContent).toContain('inferred');
        expect(answerBox('ranked-goals')?.value).toBe('Adoption first.');
        expect(query('mktg-run-questions-hint-ranked-goals')?.textContent).toContain('suggestion');
        // One box, nothing to pick between, and no review step.
        expect(host().querySelectorAll('[role="radio"]').length).toBe(0);
        expect(host().querySelectorAll('textarea').length).toBe(1);
        expect(query('mktg-agent-run-name')?.textContent).toBe(component['assetName']);
        const currentChip = query('mktg-run-questions-chip-ranked-goals');
        expect(currentChip?.classList.contains('bg-white')).toBe(true);
        expect(currentChip?.classList.contains('font-semibold')).toBe(true);
        expect(currentChip?.classList.contains('text-gray-900')).toBe(true);
        expect(currentChip?.classList.contains('bg-blue-50')).toBe(false);
        expect(query('mktg-run-questions-back')).toBeNull();
        expect(query('mktg-run-questions-next')?.textContent?.trim()).toBe('Continue');
        expect(currentChip?.textContent).toContain('Ranked goals');
        expect(query('mktg-run-questions-chip-words-to-avoid')?.textContent).toContain('Words to');
        expect(query('mktg-agent-run-regenerate-button')).toBeNull();
        expect(query('mktg-agent-run-form')).toBeNull();
      });

      it('needs a real answer where there is no suggestion — no skip, no TBD, no empty — and says so', async () => {
        await click('mktg-run-questions-next');
        expect(answerBox('words-to-avoid')?.value).toBe('');
        expect(query('mktg-run-questions-hint-words-to-avoid')?.textContent).toContain('nothing to suggest');

        await type('words-to-avoid', 'TBD');
        await click('mktg-run-questions-send');
        expect(query('mktg-run-questions-error-words-to-avoid')?.textContent).toContain('TBD');
        expect(answerQuestions).not.toHaveBeenCalled();
      });

      it('refuses an answer longer than the answers turn takes before sending, naming the limit', async () => {
        await type('ranked-goals', 'a'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS + 1));
        await click('mktg-run-questions-next');
        expect(query('mktg-run-questions-error-ranked-goals')?.textContent).toContain('4,000 characters');
        expect(query('mktg-run-questions-progress')?.textContent).toContain('Question 1 of 2');

        // Exactly the cap stands.
        await type('ranked-goals', 'a'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS));
        await click('mktg-run-questions-next');
        expect(query('mktg-run-questions-progress')?.textContent).toContain('Question 2 of 2');
        expect(answerQuestions).not.toHaveBeenCalled();
      });

      it('lets the next run send its answers after a project switch cut the answers POST short', async () => {
        // The POST is still out: nothing has come back to clear the flag.
        answerQuestions.mockReturnValue(NEVER);
        await sendWith('Avoid "synergy".');
        expect(component['answersSending']()).toBe(true);

        activeContext.set(PROJECT_2);
        await fixture.whenStable();

        expect(component['answersSending']()).toBe(false);
        expect(component['phase']()).toBe('form');
      });

      it('sends each answer with its origin on the same run and prepares the asset-route handoff', async () => {
        const answers: MktgRunAnswer[] = [
          { key: 'ranked-goals', text: 'Adoption first.', origin: 'accepted' },
          { key: 'words-to-avoid', text: 'Avoid "synergy".', origin: 'requester' },
        ];
        const run = assetRun([
          {
            version: 1,
            document: '',
            asset: ASSET,
            questions: QUESTIONS,
            answers,
            createdAt: '2026-10-17T00:00:00.000Z',
            documentLocation: { agentKey: 'foundation-message', documentId: 'living', revisionId: 'synthetic-selected-revision' },
          },
        ]);
        answerQuestions.mockReturnValue(from<MktgGenerateProgress[]>([{ type: 'submitted' }, mktgRunProgressFixture('document', run, 1)]));

        await click('mktg-run-questions-next');
        await type('words-to-avoid', 'Avoid "synergy".');
        // The result lands after a short pause; fake timers only from the send on.
        vi.useFakeTimers();
        try {
          query('mktg-run-questions-send')?.querySelector('button')?.click();
          await vi.advanceTimersByTimeAsync(700);
        } finally {
          vi.useRealTimers();
        }
        await fixture.whenStable();

        const [request, pending, sent] = answerQuestions.mock.calls[0] as [MktgGenerateRequest, MktgRunQuestionsPending, MktgRunAnswer[]];
        expect(request).toMatchObject({ agentId: 'foundation-setup', projectUid: 'proj-1', answers: { project_name: 'TestOrbit' } });
        expect(pending.questionsId).toBe('abc12345');
        expect(sent).toEqual(answers);
        expect(generate).toHaveBeenCalledTimes(1);

        expect(query('mktg-agent-run-result')).toBeNull();
        expect(query('mktg-agent-run-asked-toggle')).toBeNull();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['..', 'documents', 'foundation-message', 'living'], expect.anything());
      });

      it('keeps the answered run feed through checking and receipt-less readiness, then replaces with the exact revision', async () => {
        const progress = new Subject<MktgGenerateProgress>();
        answerQuestions.mockReturnValue(progress);
        const navigate = TestBed.inject(Router).navigate;
        const prepare = vi.spyOn(TestBed.inject(MktgRunAttemptService), 'prepare');
        await sendWith('Avoid "synergy".');
        progress.next({ type: 'submitted' });
        progress.next({
          type: 'activity',
          activity: [{ id: 'synthetic-check', kind: 'checking', label: 'Checking the draft', status: 'running', startedAt: '2026-10-24T01:00:00Z' }],
        });
        await fixture.whenStable();
        expect(component['answersSending']()).toBe(false);
        expect(component['phase']()).toBe('running');
        expect(query('mktg-run-activity')).not.toBeNull();
        expect(navigate).not.toHaveBeenCalled();
        const earlier = assetRun([{ version: 1, document: '# Exact answer result', createdAt: '2026-10-17T00:00:00Z' }]);
        progress.next(mktgRunProgressFixture('document', earlier, 1));
        expect(navigate).not.toHaveBeenCalled();
        expect(prepare).not.toHaveBeenCalled();
        const location = { agentKey: 'foundation-message' as const, documentId: 'living', revisionId: 'synthetic-answer-revision' };
        const stored = assetRun([
          { ...earlier.versions[0], version: 1, document: '# Exact answer result', createdAt: '2026-10-17T00:00:00Z', documentLocation: location },
        ]);
        progress.next(mktgRunProgressFixture('persisted', stored, 1));
        await fixture.whenStable();
        expect(navigate).toHaveBeenLastCalledWith(['..', 'documents', 'foundation-message', 'living'], {
          relativeTo: TestBed.inject(ActivatedRoute),
          queryParams: { project: PROJECT_1.slug, generation: null, questions: null, revision: location.revisionId, run: null },
          replaceUrl: true,
        });
        expect(answerQuestions).toHaveBeenCalledTimes(1);
      });

      it('marks an edited suggestion as edited, goes back with Back, and shows the writing feed once sent', async () => {
        answerQuestions.mockReturnValue(concat(of<MktgGenerateProgress>({ type: 'submitted' }), NEVER));

        await type('ranked-goals', 'Adoption, then community.');
        await click('mktg-run-questions-next');
        expect(query('mktg-run-questions-back')?.querySelector('button')?.className).toContain('p-button-text');
        expect(query('mktg-run-questions-send')?.textContent?.trim()).toBe('Send answers and write the draft');
        await click('mktg-run-questions-back');
        expect(answerBox('ranked-goals')?.value).toBe('Adoption, then community.');
        await sendWith('Avoid "synergy".');

        const sent = answerQuestions.mock.calls[0][2] as MktgRunAnswer[];
        expect(sent[0]).toEqual({ key: 'ranked-goals', text: 'Adoption, then community.', origin: 'edited' });
        expect(component['phase']()).toBe('running');
        expect(query('mktg-run-activity-title')?.textContent).toContain('Writing your Messaging framework');
      });

      it('exits a bounded receipt wait honestly without navigation or another answers POST', async () => {
        const progress = new Subject<MktgGenerateProgress>();
        answerQuestions.mockReturnValue(progress);
        await sendWith('Avoid "synergy".');
        progress.next({ type: 'submitted' });
        progress.complete();
        await fixture.whenStable();
        expect(component['phase']()).toBe('form');
        expect(query('mktg-agent-run-error')?.textContent).toContain('check Documents');
        expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
        expect(answerQuestions).toHaveBeenCalledTimes(1);
      });

      it('does not offer to resend accepted answers when their result poll fails', async () => {
        const progress = new Subject<MktgGenerateProgress>();
        answerQuestions.mockReturnValue(progress);
        await sendWith('Avoid "synergy".');
        progress.next({ type: 'submitted' });
        progress.error(new Error('Synthetic result-poll error'));
        await fixture.whenStable();
        expect(component['phase']()).toBe('form');
        expect(component['questionsPending']()).toBeNull();
        expect(query('mktg-agent-run-error')?.textContent).toContain('check Documents');
        expect(answerQuestions).toHaveBeenCalledTimes(1);
      });

      it('disarms Retry after an acknowledged answers stream errors without starting another Generate', async () => {
        const progress = new Subject<MktgGenerateProgress>();
        answerQuestions.mockReturnValue(progress);
        const startGeneration = vi.spyOn(component as unknown as { startGeneration: () => void }, 'startGeneration');
        generate.mockClear();
        const request = component['activeRequest'];
        await sendWith('Avoid "synergy".');
        progress.next({ type: 'submitted' });
        progress.error(new Error('Synthetic post-ACK poll failure'));
        await fixture.whenStable();

        expect(component['runFailed']()).toBe(false);
        expect(component['phase']()).toBe('form');
        expect(component['errorText']()).toContain('check Documents');
        expect(component['questionsPending']()).toBeNull();
        expect(component['answersSending']()).toBe(false);
        expect(component['writingStretch']()).toBe(false);
        expect(component['activeRequest']).toBe(request);
        expect(query('mktg-agent-run-retry')).toBeNull();
        component['onRetryRun']();
        expect(startGeneration).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
      });

      it('keeps the answers and returns to the questions step when the answers could not be sent', async () => {
        answerQuestions.mockReturnValue(throwError(() => new Error('network')));

        await sendWith('Avoid "synergy".');

        expect(component['phase']()).toBe('questions');
        expect(component['errorText']()).toContain('kept');
        expect(stepper()['answersForm'].controls['words-to-avoid'].value).toBe('Avoid "synergy".');
      });
    });

    it('restores a run the earlier Markdown form saved to the form, its answers kept — never an empty generating shell', async () => {
      storedRuns = {
        'proj-1:foundation-setup': assetRun([{ version: 1, document: '# An earlier Messaging Document', createdAt: '2026-10-01T00:00:00.000Z' }]),
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['phase']()).toBe('form');
      expect(query('mktg-agent-run-result')).toBeNull();
      expect(query('mktg-agent-run-version-chips')).toBeNull();
      expect(component['intakeForm'].controls['website_url'].value).toBe('https://testorbit.example.org');
    });

    it('restores a run stored by the previous Messaging Document form cleanly — its retired answer keys are ignored, its repository URL is kept', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-mf',
          ownerToken: 'token-mf',
          answers: { project_name: 'TestOrbit', github_url: 'https://github.com/example-org/testorbit', other_links: 'https://blog.example.org/launch' },
          versions: [{ version: 1, document: '# Doc', createdAt: '2026-08-19T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      await fixture.whenStable();

      const restored = component['intakeForm'].getRawValue();
      expect(restored['project_name']).toBe('TestOrbit');
      // The GitHub field is back on the form (hand test, 18 Oct), so the old form's repository URL fills it.
      expect(restored['github_url']).toBe('https://github.com/example-org/testorbit');
      expect(restored).not.toHaveProperty('other_links');
    });
  });

  describe('ICP — OPTIONAL sibling-document attachments', () => {
    /** Fills the three answers the ICP agent's form contract requires. */
    const fillRequired = (): void => {
      component['intakeForm'].controls['project_name'].setValue('TestOrbit');
      component['intakeForm'].controls['github_url'].setValue('https://github.com/example-org/testorbit');
      component['intakeForm'].controls['business_outcome'].setValue('Membership growth');
    };
    const siblingDoc = (agentId: string, document: string, version = 2): MktgDependencyDocument => ({ agentId, source: 'server', version, document });
    const submittedAnswers = (): Record<string, string> => generate.mock.calls.at(-1)?.[0].answers ?? {};

    beforeEach(async () => configure('browser', 'icp'));

    it('never asks for the sibling documents and requires only the three contract answers', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(host().querySelector('[data-test="mktg-intake-brand_kit_markdown"]')).toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-message_foundation_markdown"]')).toBeNull();
      expect(host().textContent).not.toContain('[Project Name]');

      fillRequired();
      expect(component['intakeForm'].valid).toBe(true);
    });

    it('submits with NEITHER sibling document — an optional attachment never blocks the run', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();

      expect(component['submitDisabled']()).toBe(false);
      expect(query('mktg-agent-run-missing-dependency')).toBeNull();

      component['onSubmit']();
      await fixture.whenStable();

      expect(generate).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(component['phase']()).toBe('running');
      expect(submittedAnswers()).toEqual({
        project_name: 'TestOrbit',
        github_url: 'https://github.com/example-org/testorbit',
        business_outcome: 'Membership growth',
      });
    });

    it('says plainly which sibling documents the run will NOT have', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-attachment-brand-kit')?.textContent).toContain('No Brand Kit stored for Project One');
      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('No Messaging framework stored for Project One');
    });

    it('attaches whichever stored documents the project has, and labels the rest honestly', async () => {
      dependencyDocs = { 'proj-1:brand-kit': siblingDoc('brand-kit', '# TestOrbit Brand Kit v2') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-attachment-brand-kit')?.textContent).toContain('Using Project One’s Brand Kit (v2)');
      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('No Messaging framework stored');

      fillRequired();
      component['onSubmit']();
      await fixture.whenStable();

      expect(submittedAnswers()['brand_kit_markdown']).toBe('# TestOrbit Brand Kit v2');
      expect(submittedAnswers()['message_foundation_markdown']).toBeUndefined();
    });

    it('attaches both stored documents when the project has both', async () => {
      dependencyDocs = {
        'proj-1:brand-kit': siblingDoc('brand-kit', '# TestOrbit Brand Kit v2'),
        'proj-1:foundation-setup': siblingDoc('foundation-setup', '# TestOrbit Message Foundation v3', 3),
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();
      component['onSubmit']();
      await fixture.whenStable();

      expect(submittedAnswers()['brand_kit_markdown']).toBe('# TestOrbit Brand Kit v2');
      expect(submittedAnswers()['message_foundation_markdown']).toBe('# TestOrbit Message Foundation v3');
    });

    it('resolves BOTH optional attachment sources, not just the catalog dependencies', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // Neither optional attachment is approved-only: both resolve to the latest stored document.
      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', expect.arrayContaining(['brand-kit', 'foundation-setup']), []);
    });

    it('omits the four optional gap-fill answers when left blank', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();
      component['intakeForm'].controls['disqualifiers'].setValue('Single-developer hobby projects');
      component['onSubmit']();
      await fixture.whenStable();

      expect(submittedAnswers()['disqualifiers']).toBe('Single-developer hobby projects');
      expect(submittedAnswers()['competitive_landscape']).toBeUndefined();
      expect(submittedAnswers()['trigger_events']).toBeUndefined();
    });

    /**
     * `https://github.com/aaif` — an organization, not a repository — was
     * accepted by this form, dropped by the BFF's README fetch at debug level,
     * and surfaced only as a document that said no README was provided. The UI
     * now refuses it outright (product ruling: don't accept a URL that
     * provably cannot yield a README). Paul's contract still governs what the
     * AGENT accepts — free text, missing README tolerated — and the question
     * wording is untouched; it simply doesn't bind the collection UI.
     */
    describe('github_url format rule — blocking', () => {
      const fillNameAndUrl = (url: string): void => {
        component['intakeForm'].controls['project_name'].setValue('TestOrbit');
        component['intakeForm'].controls['business_outcome'].setValue('Membership growth');
        component['intakeForm'].controls['github_url'].setValue(url);
      };

      it('blocks submission on a bare account URL and says why, without guessing it is an organization', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('https://github.com/aaif');
        await fixture.whenStable();

        // `github.com/<owner>` is a person as often as an organization, and the
        // message must not tell the user which one their own account is.
        expect(fieldError('github_url')?.textContent).toContain('GitHub account URL');
        expect(fieldError('github_url')?.textContent).not.toContain('organization');
        expect(fieldError('github_url')?.textContent).toContain('https://github.com/org/repo');
        expect(component['intakeForm'].valid).toBe(false);
        expect(component['submitDisabled']()).toBe(true);
        component['onSubmit']();
        expect(generate).not.toHaveBeenCalled();
      });

      it('associates the blocking error with the control so a screen reader can find it', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('https://github.com/orgs/aaif/repositories');
        await fixture.whenStable();

        const input = host().querySelector<HTMLInputElement>('[data-test="mktg-intake-github_url"]');
        expect(input?.getAttribute('aria-invalid')).toBe('true');
        expect(input?.getAttribute('aria-describedby')).toBe('mktg-intake-github_url-error');
        expect(fieldError('github_url')?.id).toBe('mktg-intake-github_url-error');

        fillNameAndUrl('https://github.com/example-org/example-repo');
        await fixture.whenStable();
        expect(host().querySelector('[data-test="mktg-intake-github_url"]')?.getAttribute('aria-invalid')).toBeNull();
      });

      it('blocks submission on a URL that is not a GitHub repository at all', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('https://gitlab.com/example-org/example-repo');
        await fixture.whenStable();

        expect(fieldError('github_url')?.textContent).toContain('doesn’t look like a GitHub repository URL');
        expect(component['submitDisabled']()).toBe(true);
        component['onSubmit']();
        expect(generate).not.toHaveBeenCalled();
      });

      it('clears the error and re-enables submission once a real repository URL is entered', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('https://github.com/aaif');
        await fixture.whenStable();
        expect(component['submitDisabled']()).toBe(true);

        component['intakeForm'].controls['github_url'].setValue('https://github.com/example-org/example-repo');
        await fixture.whenStable();

        expect(fieldError('github_url')).toBeNull();
        expect(component['submitDisabled']()).toBe(false);
        component['onSubmit']();
        expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledTimes(1);
      });

      it('blocks a full submission on the same format rule before any handoff or generation', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillNameAndUrl('https://github.com/synthetic-org');
        await fixture.whenStable();
        expect(component['submitDisabled']()).toBe(true);
        component['onSubmit']();
        expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
      });

      it('leaves an empty box to the required rule — no format error, and no double message', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('');
        await fixture.whenStable();

        expect(fieldError('github_url')).toBeNull();
        expect(component['submitDisabled']()).toBe(true);
      });
    });

    it('reuses the repository URL a prior agent already collected instead of re-asking', async () => {
      rememberedAnswers = {
        'proj-1': { github_url: { value: 'https://github.com/example-org/testorbit', agentId: 'brand-kit', savedAt: new Date().toISOString() } },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['intakeForm'].controls['github_url'].value).toBe('https://github.com/example-org/testorbit');
      expect(priorRunChip('github_url')?.textContent).toContain('From your Brand Kit run');
    });
  });

  describe('FAQ — intake, approved framework gating and submitted context', () => {
    /** The latest stored Messaging Framework revision, as the sidecar read resolves it. */
    const framework: MktgDependencyDocument = {
      agentId: 'foundation-setup',
      source: 'server',
      version: 2,
      document: '# Project One Messaging framework',
      storedAt: '2026-10-17T09:00:00.000Z',
      sidecar: { contract: 'messaging-framework-output/v1', version: 1, content: { mf: { tagline: 'Release, open.' }, icp: [], mh: {}, nums: [] } },
    };
    beforeEach(async () => configure('browser', 'faq'));

    it('asks for the project, the sources, other links and documents, then the notes — on a full-width page', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-page')?.className).toContain('w-full');
      expect(query('mktg-agent-run-form-title')?.textContent).toContain('Build the Project One FAQ');
      const order = ['mktg-agent-run-group-project', 'mktg-agent-run-group-sources', 'mktg-intake-documents', 'mktg-agent-run-group-notes'].map((testId) =>
        Array.from(host().querySelectorAll('[data-testid]')).indexOf(query(testId) as Element)
      );
      expect(order.every((position) => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(query('mktg-intake-documents')?.textContent).toContain('Other links and documents');
      expect(host().textContent).not.toContain('Paul');
    });

    it('requires an approved framework in Documents and links to it when none is available', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['foundation-setup'], ['foundation-setup']);
      expect(component['submitDisabled']()).toBe(true);
      expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('Approve the messaging framework in Documents first.');
      expect(query('mktg-agent-run-missing-dependency-link')?.textContent).toContain('Open the Messaging Framework page');
    });

    it('refuses a latest revision that carries no framework, with its own note', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': { ...framework, sidecar: { contract: 'messaging-framework-output/v1', content: {} } } };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['submitDisabled']()).toBe(true);
      expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('carries no framework the FAQ can read');
    });

    it('names the attached framework revision and submits it with the answers', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': framework };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      component['intakeForm'].controls['notes'].setValue('Members ask about cost.');
      await fixture.whenStable();

      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent?.replace(/\s+/g, ' ')).toContain(
        'Uses the approved messaging framework · v2 · 17 Oct'
      );
      component['onSubmit']();
      await fixture.whenStable();

      const request = generate.mock.calls[0][0] as MktgGenerateRequest;
      expect(request.answers).toEqual({
        project_name: 'Project One',
        website_url: 'https://one.example.org',
        notes: 'Members ask about cost.',
        messaging_framework: JSON.stringify(framework.sidecar),
      });
    });
  });
});
