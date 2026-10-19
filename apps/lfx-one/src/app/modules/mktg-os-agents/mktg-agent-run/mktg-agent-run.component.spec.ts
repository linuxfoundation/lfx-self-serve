// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_READ_REASONS,
  MKTG_AGENT_INTAKES,
  MKTG_AGENTS,
  MKTG_INTAKE_FORMAT_ERRORS,
  MKTG_README_SKIP_NOTES,
} from '@lfx-one/shared/constants';
import {
  MktgAnswerMemory,
  MktgDependencyDocument,
  MktgDocumentExtractResponse,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgRunAnswer,
  MktgRunQuestionsPending,
  MktgRunVersion,
  MktgStoredAgentRun,
  Project,
  ProjectContext,
  User,
} from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgIntakeDocumentsService } from '@services/mktg-intake-documents.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { concat, from, NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgIntakeDocumentsComponent } from '../mktg-intake-documents/mktg-intake-documents.component';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';
import { MktgAgentRunComponent } from './mktg-agent-run.component';

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
  let loadRun: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let generate: ReturnType<typeof vi.fn>;
  let answerQuestions: ReturnType<typeof vi.fn>;
  let resolveDependencies: ReturnType<typeof vi.fn>;
  let rememberAnswers: ReturnType<typeof vi.fn>;
  let notifyDocumentsChanged: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn>;

  const storedRun = (projectUid: string, document: string, answers: Record<string, string>): MktgStoredAgentRun => ({
    agentId: 'brand-kit',
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
  /** The checklist row's icon + SR state for one configured section label. */
  const sectionState = (label: string): { icon: string; sr: string } | null => {
    const rows = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="mktg-agent-run-sections"] > div'));
    const row = rows.find((candidate) => candidate.textContent?.includes(label));
    if (!row) {
      return null;
    }
    return { icon: row.querySelector('i')?.className ?? '', sr: row.querySelector('.sr-only')?.textContent?.trim() ?? '' };
  };

  const configure = async (platformId: 'browser' | 'server' = 'browser', agentId = 'brand-kit'): Promise<void> => {
    activeContext = signal<ProjectContext | null>(null);
    userSignal = signal<User | null>({ sub: 'auth0|user-1' } as User);
    storedRuns = {};
    projects = {};
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

    await TestBed.configureTestingModule({
      imports: [MktgAgentRunComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        // The documents section's file-upload wrapper (PrimeNG) injects HttpClient; the testing backend keeps every request local.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ agentId }) } } },
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: () => activeContext()?.uid ?? '' } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: UserService, useValue: { user: userSignal } },
        { provide: MktgAgentRunService, useValue: { loadRun, generate, answerQuestions } },
        { provide: MktgDependencyService, useValue: { resolveDependencies, notifyDocumentsChanged } },
        { provide: MktgIntakeDocumentsService, useValue: { readFile } },
        {
          provide: MktgAnswerMemoryService,
          useValue: { load: (projectUid: string): MktgAnswerMemory => rememberedAnswers[projectUid] ?? {}, remember: rememberAnswers },
        },
        MessageService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MktgAgentRunComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  };

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

      // Back to the form (restored runs land on the result phase).
      component['onEditInputs']();
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

      expect(priorRunChip('github_url')?.textContent).toContain('From your Messaging Document run');
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
          voice_adjectives: { value: 'confident, technical', agentId: 'brand-kit', savedAt: '2026-08-20T00:00:00.000Z' },
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      component['onEditInputs']();
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
        'proj-1': { one_line_description: { value: 'A runtime for agents.', agentId: 'brand-kit', savedAt: '2026-08-20T00:00:00.000Z' } },
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
        'proj-1': { one_line_description: { value: 'A runtime for agents.', agentId: 'brand-kit', savedAt: '2026-08-20T00:00:00.000Z' } },
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
        { type: 'document', run: storedRun('proj-1', '# Kit v2', { project_name: 'TestOrbit' }) },
        { type: 'persisted' },
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
        'brand-kit',
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

    it('lets the result span the page container too', async () => {
      storedRuns = { 'proj-1': storedRun('proj-1', '# Doc', { project_name: 'P1' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const result = query('mktg-agent-run-result');
      expect(result?.className).toContain('w-full');
      expect(result?.className).not.toMatch(/max-w-/);
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

    it('renders the request-changes textarea with the same full-width field classes', async () => {
      storedRuns = { 'proj-1': storedRun('proj-1', '# Doc', { project_name: 'My Name' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const feedback = host().querySelector<HTMLTextAreaElement>('textarea[data-test="mktg-agent-run-feedback"]');
      expect(feedback).not.toBeNull();
      expect(feedback?.classList.contains('w-full')).toBe(true);
      expect(feedback?.classList.contains('min-h-20')).toBe(true);
      expect(feedback?.classList.contains('resize-y')).toBe(true);
    });
  });

  describe('section checklist — prefix-tolerant heading matcher', () => {
    beforeEach(async () => configure());

    it('accepts exact labels and headings without the config numbering/appendix prefix, and flags absent sections', async () => {
      // "Project Definition" satisfies "1. Project Definition"; "Document
      // Architecture" satisfies "Appendix A: Document Architecture";
      // "Positioning" (config label "2. Positioning") is absent.
      storedRuns = { 'proj-1': storedRun('proj-1', '# How to Use This Document\n## Project Definition\n## Document Architecture', {}) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).not.toBeNull();
      expect(sectionState('How to Use This Document')).toMatchObject({ icon: expect.stringContaining('fa-circle-check'), sr: 'included' });
      expect(sectionState('1. Project Definition')).toMatchObject({ icon: expect.stringContaining('fa-circle-check'), sr: 'included' });
      expect(sectionState('Appendix A: Document Architecture')).toMatchObject({ icon: expect.stringContaining('fa-circle-check'), sr: 'included' });
      expect(sectionState('2. Positioning')).toMatchObject({ icon: expect.stringContaining('fa-circle-xmark'), sr: 'missing' });
    });

    it('marks every section missing for an empty document', async () => {
      storedRuns = { 'proj-1': storedRun('proj-1', '', {}) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(sectionState('How to Use This Document')).toMatchObject({ icon: expect.stringContaining('fa-circle-xmark'), sr: 'missing' });
      expect(sectionState('1. Project Definition')).toMatchObject({ icon: expect.stringContaining('fa-circle-xmark'), sr: 'missing' });
    });
  });

  describe('document status chip — the review label read from the document', () => {
    beforeEach(async () => configure());

    it('shows a draft label from the Review Sheet status line, styled as a draft', async () => {
      const doc =
        '# Project One Brand Kit\n\n## Review Sheet\n\nStatus: Draft — from your documents · 9 of 14 fields from your documents\n\n## 1. Project Definition';
      storedRuns = { 'proj-1': storedRun('proj-1', doc, {}) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const chip = query('mktg-agent-run-doc-status');
      expect(chip?.textContent?.trim()).toBe('Draft — from your documents');
      expect(chip?.className).toContain('amber');
      // The version chip is unchanged — the status is a second, separate label.
      expect(query('mktg-agent-run-doc-version')?.textContent).toContain('v1');
    });

    it('shows an ED-reviewed label styled as reviewed', async () => {
      const doc = '# Project One Brand Kit\n\n| Project | Project One |\n| Status | ED-reviewed — Jane Doe, 2026-10-12 |\n\n## Review Sheet';
      storedRuns = { 'proj-1': storedRun('proj-1', doc, {}) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const chip = query('mktg-agent-run-doc-status');
      expect(chip?.textContent?.trim()).toBe('ED-reviewed — Jane Doe, 2026-10-12');
      expect(chip?.className).toContain('emerald');
    });

    it('keeps the full label visible to every user — it wraps rather than truncating behind a hover-only tooltip', async () => {
      const doc = '# Project One Brand Kit\n\n| Status | ED-reviewed — A Very Long Executive Director Name, 12 October 2026 |\n\n## Review Sheet';
      storedRuns = { 'proj-1': storedRun('proj-1', doc, {}) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const chip = query('mktg-agent-run-doc-status');
      // No `title`: a tooltip on a non-focusable span is mouse-only. The text is
      // the single exposure of the label, so it must never be clipped.
      expect(chip?.hasAttribute('title')).toBe(false);
      expect(chip?.className).not.toContain('truncate');
      expect(chip?.className).not.toContain('whitespace-nowrap');
    });

    it('renders no status chip when the document states no status', async () => {
      storedRuns = { 'proj-1': storedRun('proj-1', '# Doc\n\nThis first draft — built from your answers — has no status line.', {}) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).not.toBeNull();
      expect(query('mktg-agent-run-doc-status')).toBeNull();
    });
  });

  describe('resetForContext — an active-context switch never bleeds state across projects', () => {
    beforeEach(async () => configure());

    it('restores the stored run for the active project and resets fully when switching to a project without one', async () => {
      storedRuns = { 'proj-1': storedRun('proj-1', '# Doc', { project_name: 'Stored Name' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // Project 1 restores straight to its stored document.
      expect(query('mktg-agent-run-result')).not.toBeNull();
      expect(query('mktg-agent-run-doc-version')?.textContent).toContain('v1');
      expect(component['intakeForm'].getRawValue()).toMatchObject({ project_name: 'Stored Name' });

      // Project 2 has no stored run — back to a clean form, no leaked answers,
      // only its own prefill.
      activeContext.set(PROJECT_2);
      await fixture.whenStable();

      expect(loadRun).toHaveBeenCalledWith('proj-2', 'brand-kit');
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
  describe('Brand Kit — github_url accepts an organization URL', () => {
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

  describe('Messaging Document — the form from the design canvas', () => {
    const fillRequired = (): void => {
      component['intakeForm'].controls['project_name'].setValue('TestOrbit');
    };
    const submitted = (): MktgGenerateRequest => generate.mock.calls[0][0] as MktgGenerateRequest;
    const QUESTIONS = [
      {
        key: 'audiences',
        label: 'Audiences',
        question: 'Who are the primary audiences?',
        why: 'The site names platform teams only.',
        suggestedAnswer: 'Platform teams; SREs.',
        basis: ['https://testorbit.example.org', 'the README'],
      },
      { key: 'tagline_ctas_constraints', label: 'Tagline, CTAs and constraints', question: 'Is a tagline locked?', why: '', suggestedAnswer: '', basis: [] },
    ];
    const pendingQuestions = (): MktgRunQuestionsPending => ({
      attempt: { session: { agentId: 'foundation-setup', sessionId: 'sess-md', ownerToken: 'token-md' }, priorVersion: 0 },
      questionsId: 'abc12345',
      questions: QUESTIONS,
    });

    beforeEach(async () => configure('browser', 'foundation-setup'));

    it('renders the sources as links — the four, a GitHub repo or organization page, the other links — and the existing documents; no questions on the first form', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const sources = query('mktg-agent-run-group-sources');
      for (const key of ['project_name', 'website_url', 'github_url', 'press_release_url', 'brand_page_url', 'other_links']) {
        expect(sources?.querySelector(`[data-test="mktg-intake-${key}"]`)).not.toBeNull();
      }
      expect(query('mktg-agent-run-group-questions')).toBeNull();
      expect(host().querySelectorAll('textarea').length).toBe(1);
      expect(query('mktg-intake-documents')).not.toBeNull();
      // Runs first: no Brand Kit chip and no missing-dependency gate.
      expect(query('mktg-agent-run-attachments')).toBeNull();
      expect(query('mktg-agent-run-missing-dependency')).toBeNull();
    });

    it('names no one anywhere the user sees — this is a product, not a proof of concept', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(host().textContent).not.toContain('Paul');
      for (const copy of [MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_INTAKE_FORMAT_ERRORS, MKTG_README_SKIP_NOTES, FOUNDATION_MESSAGE_READ_REASONS]) {
        expect(JSON.stringify(copy)).not.toContain('Paul');
      }
    });

    it('requires only the project name — every source is optional', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      // Prefilled from the active project, so the form starts valid; clearing the one required field is what invalidates it.
      expect(component['intakeForm'].valid).toBe(true);
      component['intakeForm'].controls['project_name'].setValue('');
      expect(component['intakeForm'].valid).toBe(false);

      fillRequired();
      expect(component['intakeForm'].valid).toBe(true);
    });

    it('takes "none" or an https:// link for a source, a repository or an organization page for GitHub, one link per line for the rest, and blocks anything else, saying why', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();

      component['intakeForm'].controls['press_release_url'].setValue('None');
      await fixture.whenStable();
      expect(fieldError('press_release_url')).toBeNull();

      component['intakeForm'].controls['website_url'].setValue('http://testorbit.example.org');
      await fixture.whenStable();
      expect(fieldError('website_url')?.textContent).toContain('https://');
      expect(component['submitDisabled']()).toBe(true);
      component['intakeForm'].controls['website_url'].setValue('https://testorbit.example.org');
      await fixture.whenStable();
      expect(fieldError('website_url')).toBeNull();

      // An organization page (https://github.com/aaif) is a usable GitHub source now that the agent reads it.
      component['intakeForm'].controls['github_url'].setValue('https://github.com/aaif');
      await fixture.whenStable();
      expect(fieldError('github_url')).toBeNull();
      component['intakeForm'].controls['github_url'].setValue('https://gitlab.example.org/aaif');
      await fixture.whenStable();
      expect(fieldError('github_url')?.textContent).toContain('GitHub');
      component['intakeForm'].controls['github_url'].setValue('https://github.com/aaif/spec');
      await fixture.whenStable();
      expect(fieldError('github_url')).toBeNull();

      component['intakeForm'].controls['other_links'].setValue('https://blog.example.org/a\nnot a link');
      await fixture.whenStable();
      expect(fieldError('other_links')?.textContent).toContain('Every line');
      component['intakeForm'].controls['other_links'].setValue('https://blog.example.org/a\n\nhttps://blog.example.org/b');
      await fixture.whenStable();
      expect(fieldError('other_links')).toBeNull();
      expect(component['submitDisabled']()).toBe(false);
    });

    it('submits the links and the documents — a link by its URL, a file by its text — and waits while a file is being read', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillRequired();
      component['intakeForm'].controls['website_url'].setValue('https://testorbit.example.org');
      component['intakeForm'].controls['other_links'].setValue('https://blog.example.org/launch');
      component['documents'].set([
        { id: 'link-1', kind: 'link', title: 'https://wiki.example.org/note', url: 'https://wiki.example.org/note', read: false, words: 0, truncated: false },
        { id: 'file-1', kind: 'file', title: 'brand.md', text: 'Brand guide.', read: true, words: 2, truncated: false },
      ]);

      component['documentsBusy'].set(true);
      expect(component['submitDisabled']()).toBe(true);
      component['documentsBusy'].set(false);

      component['onSubmit']();
      await fixture.whenStable();

      expect(submitted().answers).toEqual({
        project_name: 'TestOrbit',
        website_url: 'https://testorbit.example.org',
        other_links: 'https://blog.example.org/launch',
      });
      expect(submitted().documents).toEqual([
        { kind: 'link', title: 'https://wiki.example.org/note', url: 'https://wiki.example.org/note' },
        { kind: 'file', title: 'brand.md', text: 'Brand guide.' },
      ]);
    });

    it('never attaches a file picked for one project to another: a project switch cancels the read still in flight', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const response = new Subject<MktgDocumentExtractResponse>();
      readFile.mockReturnValue(response.asObservable());
      const section = fixture.debugElement.query(By.directive(MktgIntakeDocumentsComponent)).componentInstance as MktgIntakeDocumentsComponent;
      section['onFilesSelected']({ originalEvent: new Event('change'), files: [new File(['Brand guide.'], 'brand.md')], currentFiles: [] });
      expect(component['documentsBusy']()).toBe(true);

      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      // Project One's file answers after the switch.
      response.next({ title: 'brand.md', read: true, words: 2, truncated: false, text: 'Brand guide.' });
      response.complete();
      await fixture.whenStable();

      expect(component['documents']()).toEqual([]);
      expect(component['documentsBusy']()).toBe(false);
    });

    describe('the live feed — what the agent does, in plain words, while it works', () => {
      it('shows each step as it is reported, and switches to writing once the answers went back', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
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
        expect(query('mktg-run-activity-title')?.textContent).toContain('Researching');
        expect(query('mktg-run-activity-step-step-1')?.textContent).toContain('Reading testorbit.example.org');
        expect(query('mktg-run-activity-step-step-2')?.textContent).toContain('“TestOrbit adopters”');
        expect(query('mktg-run-activity-status')?.textContent).toContain('Searching the web');
        // The old staged checklist is for agents without a feed.
        expect(query('mktg-agent-run-running')).toBeNull();
      });
    });

    describe('the questions step — after research, only the gaps, one at a time, each answer starting as the suggestion', () => {
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
      const sendWith = async (taglineAnswer: string): Promise<void> => {
        await click('mktg-run-questions-next');
        await type('tagline_ctas_constraints', taglineAnswer);
        await click('mktg-run-questions-send');
      };

      beforeEach(async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        generate.mockReturnValue(from<MktgGenerateProgress[]>([{ type: 'submitted' }, { type: 'questions', pending: pendingQuestions() }]));
        component['onSubmit']();
        await fixture.whenStable();
      });

      it('asks one question at a time: the question, the why, the basis links, and one box holding the suggested answer', () => {
        expect(component['phase']()).toBe('questions');
        expect(query('mktg-run-questions-progress')?.textContent).toContain('Question 1 of 2');
        expect(query('mktg-run-questions-card-audiences')?.textContent).toContain('Who are the primary audiences?');
        expect(query('mktg-run-questions-card-tagline_ctas_constraints')).toBeNull();
        expect(query('mktg-run-questions-why-audiences')?.textContent).toContain('platform teams only');
        const basis = query('mktg-run-questions-basis-audiences');
        expect(basis?.querySelector('a')?.getAttribute('href')).toBe('https://testorbit.example.org');
        expect(basis?.textContent).toContain('the README');
        expect(answerBox('audiences')?.value).toBe('Platform teams; SREs.');
        expect(query('mktg-run-questions-hint-audiences')?.textContent).toContain('suggestion');
        // One box, nothing to pick between, and no review step.
        expect(host().querySelectorAll('[role="radio"]').length).toBe(0);
        expect(host().querySelectorAll('textarea').length).toBe(1);
        expect(query('mktg-run-questions-chip-audiences')?.textContent).toContain('Audiences');
        expect(query('mktg-run-questions-chip-tagline_ctas_constraints')?.textContent).toContain('Tagline');
        expect(query('mktg-agent-run-regenerate-button')).toBeNull();
        expect(query('mktg-agent-run-form')).toBeNull();
      });

      it('needs a real answer where there is no suggestion — no skip, no TBD, no empty — and says so', async () => {
        await click('mktg-run-questions-next');
        expect(answerBox('tagline_ctas_constraints')?.value).toBe('');
        expect(query('mktg-run-questions-hint-tagline_ctas_constraints')?.textContent).toContain('nothing to suggest');

        await type('tagline_ctas_constraints', 'TBD');
        await click('mktg-run-questions-send');
        expect(query('mktg-run-questions-error-tagline_ctas_constraints')?.textContent).toContain('TBD');
        expect(answerQuestions).not.toHaveBeenCalled();
      });

      it('refuses an answer longer than the answers turn takes before sending, naming the limit', async () => {
        await type('audiences', 'a'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS + 1));
        await click('mktg-run-questions-next');
        expect(query('mktg-run-questions-error-audiences')?.textContent).toContain('4,000 characters');
        expect(query('mktg-run-questions-progress')?.textContent).toContain('Question 1 of 2');

        // Exactly the cap stands.
        await type('audiences', 'a'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS));
        await click('mktg-run-questions-next');
        expect(query('mktg-run-questions-progress')?.textContent).toContain('Question 2 of 2');
        expect(answerQuestions).not.toHaveBeenCalled();
      });

      it('lets the next run send its answers after a project switch cut the answers POST short', async () => {
        // The POST is still out: nothing has come back to clear the flag.
        answerQuestions.mockReturnValue(NEVER);
        await sendWith('No tagline is locked.');
        expect(component['answersSending']()).toBe(true);

        activeContext.set(PROJECT_2);
        await fixture.whenStable();

        expect(component['answersSending']()).toBe(false);
        expect(component['phase']()).toBe('form');
      });

      it('sends every answer with its origin from the last question, on the same run, and shows the document with what was asked', async () => {
        const answers: MktgRunAnswer[] = [
          { key: 'audiences', text: 'Platform teams; SREs.', origin: 'accepted' },
          { key: 'tagline_ctas_constraints', text: 'No tagline is locked.', origin: 'requester' },
        ];
        const run: MktgStoredAgentRun = {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-md',
          ownerToken: 'token-md',
          answers: { project_name: 'TestOrbit' },
          versions: [{ version: 1, document: '# TestOrbit Messaging Document', questions: QUESTIONS, answers, createdAt: '2026-10-15T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        };
        answerQuestions.mockReturnValue(from<MktgGenerateProgress[]>([{ type: 'submitted' }, { type: 'document', run }]));

        await click('mktg-run-questions-next');
        await type('tagline_ctas_constraints', 'No tagline is locked.');
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

        expect(component['phase']()).toBe('result');
        expect(query('mktg-agent-run-asked-toggle')?.textContent).toContain('asked 2 question(s)');
        query('mktg-agent-run-asked-toggle')?.click();
        await fixture.whenStable();
        expect(query('mktg-agent-run-asked-audiences')?.textContent).toContain('Platform teams; SREs.');
        expect(query('mktg-agent-run-asked-audiences')?.textContent).toContain('Suggested by the agent, accepted');
        expect(query('mktg-agent-run-asked-tagline_ctas_constraints')?.textContent).toContain('Your answer');
      });

      it('marks an edited suggestion as edited, goes back with Back, and shows the writing feed once sent', async () => {
        answerQuestions.mockReturnValue(concat(of<MktgGenerateProgress>({ type: 'submitted' }), NEVER));

        await type('audiences', 'Platform teams only.');
        await click('mktg-run-questions-next');
        await click('mktg-run-questions-back');
        expect(answerBox('audiences')?.value).toBe('Platform teams only.');
        await sendWith('No tagline is locked.');

        const sent = answerQuestions.mock.calls[0][2] as MktgRunAnswer[];
        expect(sent[0]).toEqual({ key: 'audiences', text: 'Platform teams only.', origin: 'edited' });
        expect(component['phase']()).toBe('running');
        expect(query('mktg-run-activity-title')?.textContent).toContain('Writing your Messaging Document');
      });

      it('keeps the answers and returns to the questions step when the answers could not be sent', async () => {
        answerQuestions.mockReturnValue(throwError(() => new Error('network')));

        await sendWith('No tagline is locked.');

        expect(component['phase']()).toBe('questions');
        expect(component['errorText']()).toContain('kept');
        expect(stepper()['answersForm'].controls['tagline_ctas_constraints'].value).toBe('No tagline is locked.');
      });
    });

    it('offers no "Request changes" box on the result — edit the inputs and generate a new revision instead', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-md',
          ownerToken: 'token-md',
          answers: { project_name: 'TestOrbit' },
          versions: [{ version: 1, document: '# TestOrbit Messaging Document', createdAt: '2026-10-15T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).not.toBeNull();
      expect(query('mktg-agent-run-regenerate-button')).toBeNull();
      expect(query('mktg-agent-run-new-run')).not.toBeNull();
      // A version written without a questions round shows nothing about questions.
      expect(query('mktg-agent-run-asked')).toBeNull();

      query('mktg-agent-run-edit-inputs-button')?.querySelector('button')?.click();
      await fixture.whenStable();
      expect(component['phase']()).toBe('form');
      expect(component['intakeForm'].controls['project_name'].value).toBe('TestOrbit');
    });

    it('surfaces the five derivative chips as copyable values on the result', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-mf',
          ownerToken: 'token-mf',
          answers: { project_name: 'TestOrbit' },
          versions: [
            {
              version: 1,
              document: '# Doc',
              derivatives: { summary_25: 'Twenty-five words.', llms_txt: '# TestOrbit' },
              createdAt: '2026-08-19T00:00:00.000Z',
            },
          ],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).not.toBeNull();
      // Only derivatives the envelope actually carried render as chips.
      expect(query('mktg-agent-run-derivative-summary_25')?.textContent).toContain('25-word summary');
      expect(query('mktg-agent-run-derivative-llms_txt')).not.toBeNull();
      expect(query('mktg-agent-run-derivative-boilerplate')).toBeNull();

      // Copy flashes the chip to "Copied" and writes the derivative VALUE.
      const writeText = vi.fn(() => Promise.resolve());
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      try {
        query('mktg-agent-run-derivative-summary_25')?.click();
        await fixture.whenStable();
        expect(writeText).toHaveBeenCalledWith('Twenty-five words.');
        expect(query('mktg-agent-run-derivative-summary_25')?.textContent).toContain('Copied');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('surfaces a copy failure as an error toast instead of a silently dead button', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-mf',
          ownerToken: 'token-mf',
          answers: { project_name: 'TestOrbit' },
          versions: [{ version: 1, document: '# Doc', derivatives: { summary_25: 'Twenty-five words.' }, createdAt: '2026-08-19T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');

      // Clipboard API unavailable (insecure context / unsupported browser).
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
      try {
        query('mktg-agent-run-derivative-summary_25')?.click();
        await fixture.whenStable();
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Copy not supported' }));
        expect(query('mktg-agent-run-derivative-summary_25')?.textContent).not.toContain('Copied');
      } finally {
        vi.unstubAllGlobals();
      }

      // Write rejected (permission denied) — also surfaced, chip never flashes.
      toast.mockClear();
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
      try {
        query('mktg-agent-run-derivative-summary_25')?.click();
        await fixture.whenStable();
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Copy failed' }));
        expect(query('mktg-agent-run-derivative-summary_25')?.textContent).not.toContain('Copied');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    describe('README outcome on the result — a thin document is never a silent mystery', () => {
      /** A stored Messaging Document run whose single version carries the given README outcome. */
      const runWithReadme = (readme: MktgRunVersion['readme']): MktgStoredAgentRun => ({
        agentId: 'foundation-setup',
        projectUid: 'proj-1',
        sessionId: 'sess-mf',
        ownerToken: 'token-mf',
        answers: { project_name: 'TestOrbit', github_url: 'https://github.com/aaif' },
        versions: [{ version: 1, document: '# Doc', readme, createdAt: '2026-08-19T00:00:00.000Z' }],
        savedAt: new Date().toISOString(),
      });

      it('states that the document was generated WITHOUT a README, and why', async () => {
        storedRuns = { 'proj-1:foundation-setup': runWithReadme({ fetched: false, skipReason: 'not-a-repo-url' }) };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        expect(query('mktg-agent-run-readme-note')?.textContent).toContain('Generated without a README');
        expect(query('mktg-agent-run-readme-note')?.textContent).toContain('didn’t resolve to a readable repository');
      });

      it('distinguishes an absent README from GitHub being unreachable', async () => {
        storedRuns = { 'proj-1:foundation-setup': runWithReadme({ fetched: false, skipReason: 'no-readme' }) };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(query('mktg-agent-run-readme-note')?.textContent).toContain('has no README');

        storedRuns = { 'proj-2:foundation-setup': { ...runWithReadme({ fetched: false, skipReason: 'fetch-failed' }), projectUid: 'proj-2' } };
        activeContext.set(PROJECT_2);
        await fixture.whenStable();
        expect(query('mktg-agent-run-readme-note')?.textContent).toContain('couldn’t be reached');
      });

      it('says a repository was not publicly readable rather than claiming it has no README', async () => {
        // Different remedy: the repo may well HAVE a README — what failed was
        // access, and telling the user to fix the URL sends them nowhere.
        storedRuns = { 'proj-1:foundation-setup': runWithReadme({ fetched: false, skipReason: 'not-public' }) };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        expect(query('mktg-agent-run-readme-note')?.textContent).toContain('isn’t publicly readable');
        expect(query('mktg-agent-run-readme-note')?.textContent).not.toContain('has no README');
      });

      it('says nothing when a README WAS used, or when the run predates the outcome being recorded', async () => {
        storedRuns = { 'proj-1:foundation-setup': runWithReadme({ fetched: true, source: 'repository' }) };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(query('mktg-agent-run-readme-note')).toBeNull();

        storedRuns = { 'proj-2:foundation-setup': { ...runWithReadme(undefined), projectUid: 'proj-2' } };
        activeContext.set(PROJECT_2);
        await fixture.whenStable();
        expect(query('mktg-agent-run-readme-note')).toBeNull();
      });
    });

    it('restores a run stored by the previous Message Foundation form cleanly — its retired answer keys are ignored', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-mf',
          ownerToken: 'token-mf',
          answers: { project_name: 'TestOrbit', github_url: 'https://github.com/example-org/testorbit', brand_kit_markdown: '# Kit', gap_fill_notes: 'Old' },
          versions: [{ version: 1, document: '# Doc', createdAt: '2026-08-19T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      component['onEditInputs']();
      await fixture.whenStable();

      const restored = component['intakeForm'].getRawValue();
      expect(restored['project_name']).toBe('TestOrbit');
      expect(restored['github_url']).toBe('https://github.com/example-org/testorbit');
      expect(restored).not.toHaveProperty('brand_kit_markdown');
      expect(restored).not.toHaveProperty('gap_fill_notes');
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
    const submittedAnswers = (): Record<string, string> => (generate.mock.calls[0][0] as MktgGenerateRequest).answers;

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
      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('No Messaging Document stored for Project One');
    });

    it('attaches whichever stored documents the project has, and labels the rest honestly', async () => {
      dependencyDocs = { 'proj-1:brand-kit': siblingDoc('brand-kit', '# TestOrbit Brand Kit v2') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-attachment-brand-kit')?.textContent).toContain('Using Project One’s Brand Kit (v2)');
      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent).toContain('No Messaging Document stored');

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

      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', expect.arrayContaining(['brand-kit', 'foundation-setup']));
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
        expect(generate).toHaveBeenCalledTimes(1);
      });

      it('leaves an empty box to the required rule — no format error, and no double message', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('');
        await fixture.whenStable();

        expect(fieldError('github_url')).toBeNull();
        expect(component['submitDisabled']()).toBe(true);
      });

      it('blocks the regenerate path on the same rule — a resubmit is a full submit', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        fillNameAndUrl('https://github.com/aaif');
        component['feedbackForm'].controls.feedback.setValue('Sharpen the pitch.');
        await fixture.whenStable();

        expect(component['regenerateDisabled']()).toBe(true);
        component['onRegenerate']();
        expect(generate).not.toHaveBeenCalled();
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

  describe('onDownload — SSR guard', () => {
    beforeEach(async () => configure('server'));

    it('returns early on the server — no blob URL is ever created outside the browser', () => {
      // A current version exists, so ONLY the platform guard stands between
      // onDownload and the browser-only Blob/URL APIs.
      component['run'].set(storedRun('proj-1', '# Doc', {}));
      const createObjectURL = vi.fn();
      vi.stubGlobal('URL', { ...URL, createObjectURL });
      try {
        component['onDownload']();
        expect(createObjectURL).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
