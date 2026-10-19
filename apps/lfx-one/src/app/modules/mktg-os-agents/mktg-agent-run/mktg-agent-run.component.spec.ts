// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_READ_REASONS,
  MKTG_AGENT_INTAKES,
  MKTG_AGENTS,
  MKTG_INTAKE_FORMAT_ERRORS,
  MKTG_README_SKIP_NOTES,
} from '@lfx-one/shared/constants';
import {
  MktgAgent,
  MktgAgentIntake,
  MktgAnswerMemory,
  MktgDependencyDocument,
  MktgDocumentExtractResponse,
  MktgGenerateProgress,
  MktgGenerateRequest,
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
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgIntakeDocumentsService } from '@services/mktg-intake-documents.service';
import { MktgSlidesExportService } from '@services/mktg-slides-export.service';
import { ProjectContextService } from '@services/project-context.service';
import { brandKitTestRevision } from '@shared/testing/brand-kit-test-data';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { concat, from, NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrandKitWebViewComponent } from '../brand-kit-web-view/brand-kit-web-view.component';
import { MktgIntakeDocumentsComponent } from '../mktg-intake-documents/mktg-intake-documents.component';
import { MktgIntakeLogoFilesComponent } from '../mktg-intake-logo-files/mktg-intake-logo-files.component';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';
import { MktgAgentRunComponent } from './mktg-agent-run.component';

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
  endpoints: { generate: '/api/mktg-agents/shell-fixture/generate', result: '/api/mktg-agents/shell-fixture/result' },
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
  let loadRun: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let generate: ReturnType<typeof vi.fn>;
  let answerQuestions: ReturnType<typeof vi.fn>;
  let resolveDependencies: ReturnType<typeof vi.fn>;
  let resolveBrandKit: ReturnType<typeof vi.fn>;
  let rememberAnswers: ReturnType<typeof vi.fn>;
  let notifyDocumentsChanged: ReturnType<typeof vi.fn>;
  let slidesExport: { last: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> };
  let readFile: ReturnType<typeof vi.fn>;

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
  /** The checklist row's icon + SR state for one configured section label. */
  const sectionState = (label: string): { icon: string; sr: string } | null => {
    const rows = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="mktg-agent-run-sections"] > div'));
    const row = rows.find((candidate) => candidate.textContent?.includes(label));
    if (!row) {
      return null;
    }
    return { icon: row.querySelector('i')?.className ?? '', sr: row.querySelector('.sr-only')?.textContent?.trim() ?? '' };
  };

  const configure = async (platformId: 'browser' | 'server' = 'browser', agentId = SHELL_AGENT.id): Promise<void> => {
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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ agentId }) } } },
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: () => activeContext()?.uid ?? '' } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: UserService, useValue: { user: userSignal } },
        { provide: MktgAgentRunService, useValue: { loadRun, generate, answerQuestions } },
        { provide: MktgDependencyService, useValue: { resolveDependencies, resolveBrandKit, notifyDocumentsChanged } },
        { provide: MktgSlidesExportService, useValue: slidesExport },
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
    /** The project's latest stored messaging framework revision — approved or not — as the dependency service resolves it. */
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
      // The latest messaging framework always goes with the form, as its JSON.
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

      expect(query('mktg-agent-run-attachment-foundation-setup')?.textContent?.replace(/\s+/g, ' ')).toContain('Uses the latest messaging framework · v3');
      expect(query('mktg-agent-run-missing-dependency')).toBeNull();
      expect(component['submitDisabled']()).toBe(false);

      component['onSubmit']();
      await fixture.whenStable();

      expect((generate.mock.calls[0][0] as MktgGenerateRequest).answers['messaging_framework']).toBe(JSON.stringify(jsonFramework.sidecar));
    });

    describe('the latest messaging framework — the run order is the framework first, then the kit', () => {
      const fillRequired = (): void => {
        component['intakeForm'].controls['website_url'].setValue('https://one.example.org');
      };

      it('resolves the framework from the server’s latest revision with its sidecar — approved or not, never this browser’s run', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['foundation-setup'], ['foundation-setup']);
      });

      it('shows the attached revision — "Uses the latest messaging framework · v2 · 17 Oct", linking to its page — and never asks for it on the form', async () => {
        const router = TestBed.inject(Router);
        const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        dependencyDocs = { 'proj-1:foundation-setup': latestFramework };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        const chip = query('mktg-agent-run-attachment-foundation-setup');
        expect(chip?.textContent?.replace(/\s+/g, ' ')).toContain('Uses the latest messaging framework · v2 · 17 Oct');
        expect(chip?.textContent).not.toContain('approved');
        expect(host().querySelector('[data-test="mktg-intake-messaging_framework"]')).toBeNull();
        expect(query('mktg-agent-run-missing-dependency')).toBeNull();
        expect(query('mktg-agent-run-missing-dependency-link')).toBeNull();

        (chip as HTMLButtonElement | null)?.click();

        expect(navigate).toHaveBeenCalledWith(['..', 'foundation-setup'], expect.objectContaining({ queryParamsHandling: 'preserve' }));
      });

      it('disables Run with "Run the messaging framework first" and links to the Messaging Framework page only when the project has no revision at all', async () => {
        const router = TestBed.inject(Router);
        const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expect(component['submitDisabled']()).toBe(true);
        expect(query('mktg-agent-run-submit-button')?.querySelector('button')?.disabled).toBe(true);
        expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('Run the messaging framework first');
        expect(query('mktg-agent-run-attachment-foundation-setup')).toBeNull();
        const link = query('mktg-agent-run-missing-dependency-link');
        expect(link?.textContent).toContain('Open the Messaging Framework page');

        link?.querySelector('button')?.click();

        expect(navigate).toHaveBeenCalledWith(['..', 'foundation-setup'], expect.objectContaining({ queryParamsHandling: 'preserve' }));
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
        expect(query('mktg-agent-run-submit-button')?.querySelector('button')?.disabled).toBe(true);
        expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain(
          'The messaging framework has no positioning or tagline yet — finish it first.'
        );
        expect(query('mktg-agent-run-missing-dependency')?.textContent).not.toContain('Run the messaging framework first');
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

      it('stops the same way when the latest revision carries no sidecar at all (a restored legacy revision)', async () => {
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

      it('shows a failed check with Try again — never "Run the messaging framework first" — when the read fails, and re-resolves from the button', async () => {
        resolveDependencies.mockReturnValueOnce(throwError(() => new Error('503 from the BFF')));
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        fillRequired();
        await fixture.whenStable();

        expect(component['submitDisabled']()).toBe(true);
        expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('Could not check the project’s Messaging Framework — try again.');
        expect(query('mktg-agent-run-missing-dependency')?.textContent).not.toContain('Run the messaging framework');
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
        expect(query('mktg-agent-run-error')?.textContent).toContain('Run the messaging framework first');
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
        expect(component['run']()).toBeNull();
        expect(component['intakeForm'].controls['website_url'].value).toBe('https://one.example.org');
      });
    });

    it('renders a stored version’s kit as the web view — the book kept for print only, no document card, no .md download, no section checklist', async () => {
      storedRuns = {
        'proj-1:brand-kit': {
          agentId: 'brand-kit',
          projectUid: 'proj-1',
          sessionId: 'sess-bk',
          ownerToken: 'token-bk',
          answers: { project_name: 'Project One', website_url: 'https://one.example.org' },
          versions: [{ version: 1, document: '# Project One Brand Kit', brandKit: brandKitTestRevision(), createdAt: '2026-10-17T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).not.toBeNull();
      expect(query('mktg-agent-run-brand-kit')).not.toBeNull();
      expect(fixture.debugElement.query(By.directive(BrandKitWebViewComponent))).not.toBeNull();
      // The kit is an app page with its own header and actions: no document card around it.
      expect(query('mktg-agent-run-doc-title')).toBeNull();
      expect(query('mktg-agent-run-view-button')).toBeNull();
      expect(query('mktg-agent-run-download-button')).toBeNull();
      expect(query('mktg-agent-run-doc-preview')).toBeNull();
      expect(query('mktg-agent-run-sections')).toBeNull();
      expect(query('brand-kit-web-view-title')?.textContent?.trim()).toBe('Project One Brand Kit');
      expect(query('brand-kit-web-view-version')?.textContent?.trim()).toBe('v1');
      expect(query('brand-kit-web-view-built-from')?.textContent).toContain('Built from the logo file logo.svg');
      // The book is there for Download PDF only, in its print-only wrapper.
      expect(query('brand-kit-web-view-print')?.className).toContain('lfx-brand-kit-print-only');
      expect(query('brand-kit-web-view-print')?.querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(query('brand-kit-web-view-download-pdf')?.querySelector('button')?.disabled).toBe(false);
      // Export to Google Slides reads the project's stored kit (the version carries no stored hash here: the latest revision).
      expect(query('brand-kit-web-view-export-slides')?.querySelector('button')?.disabled).toBe(false);
      expect(slidesExport.last).toHaveBeenCalledWith({ project: 'proj-1', agentKey: 'brand-kit', documentId: 'living' });
      // A kit is revised from edited inputs, never from a feedback box.
      expect(query('mktg-agent-run-regenerate-button')).toBeNull();
      expect(query('mktg-agent-run-new-run')).not.toBeNull();
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
        'Uses the latest messaging framework · v3 · 18 Oct'
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
      expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('Run the messaging framework first');
      const link = query('mktg-agent-run-missing-dependency-link');
      expect(link?.textContent).toContain('Open the Messaging Framework page');
      link?.querySelector('button')?.click();
      expect(navigate).toHaveBeenCalledWith(['..', 'foundation-setup'], expect.objectContaining({ queryParamsHandling: 'preserve' }));
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
      expect(query('mktg-agent-run-missing-dependency')?.textContent).toContain('could not be read as a framework');
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
        progress.next({
          type: 'document',
          run: {
            agentId: 'boilerplates',
            projectUid: 'proj-1',
            sessionId: 'sess-bp',
            ownerToken: 'token-bp',
            answers: {},
            versions: [{ version: 1, document: '', asset: BOILERPLATES, createdAt: '2026-10-19T09:00:00.000Z' }],
            savedAt: '2026-10-19T09:00:00.000Z',
          },
        });
        vi.advanceTimersByTime(600);
      } finally {
        vi.useRealTimers();
      }
      await fixture.whenStable();

      expect(component['phase']()).toBe('result');
      expect(query('mktg-boilerplates-view-title')?.textContent).toContain('Project One Boilerplates');
      expect(query('mktg-boilerplates-view-version')?.textContent).toContain('v1');
      expect(query('mktg-boilerplates-view-text-0')?.textContent).toContain('Project One is the open service mesh.');
      expect(query('mktg-boilerplates-view-count-3')?.textContent).toContain('16 / 100 words');
      expect(query('mktg-framework-view')).toBeNull();
      expect(query('mktg-agent-run-change-note')?.textContent).toContain('To change the boilerplates, edit the inputs and generate again');
      expect(query('mktg-agent-run-download-pdf')?.textContent).toContain('Download PDF');
      expect(query('mktg-agent-run-export-slides')?.textContent).toContain('Export to Google Slides');
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
        expect(sources?.querySelector(`[data-test="mktg-intake-${key}"]`)).not.toBeNull();
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
      for (const copy of [MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_INTAKE_FORMAT_ERRORS, MKTG_README_SKIP_NOTES, FOUNDATION_MESSAGE_READ_REASONS]) {
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

    describe('the run lands on the asset view — the live feed inside it while the agent works', () => {
      it('shows the framework shell in its generating state with each step as it is reported, and switches to writing once the answers went back', async () => {
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
        expect(query('mktg-agent-run-asset')).not.toBeNull();
        // The live page is the feed alone (hand test, 18 Oct): no document title, status chip or tabs until there is a document.
        expect(query('mktg-framework-view')).toBeNull();
        expect(query('mktg-framework-view-title')).toBeNull();
        expect(query('mktg-framework-view-tabs')).toBeNull();
        expect(query('mktg-agent-run-live')?.querySelector('[data-testid="mktg-run-activity-title"]')?.textContent).toContain('Researching');
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
        expect(query('mktg-run-questions-chip-ranked-goals')?.textContent).toContain('Ranked goals');
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

      it('sends every answer with its origin from the last question, on the same run, and lands on the rendered framework with what was asked', async () => {
        const answers: MktgRunAnswer[] = [
          { key: 'ranked-goals', text: 'Adoption first.', origin: 'accepted' },
          { key: 'words-to-avoid', text: 'Avoid "synergy".', origin: 'requester' },
        ];
        const run = assetRun([{ version: 1, document: '', asset: ASSET, questions: QUESTIONS, answers, createdAt: '2026-10-17T00:00:00.000Z' }]);
        answerQuestions.mockReturnValue(from<MktgGenerateProgress[]>([{ type: 'submitted' }, { type: 'document', run }]));

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

        expect(component['phase']()).toBe('result');
        expect(query('mktg-agent-run-result')).not.toBeNull();
        expect(query('mktg-framework-view-tagline')?.textContent).toContain('Release, open.');
        expect(query('mktg-framework-view-version')?.textContent).toContain('v1');
        expect(query('mktg-agent-run-asked-toggle')?.textContent).toContain('asked 2 question(s)');
        query('mktg-agent-run-asked-toggle')?.click();
        await fixture.whenStable();
        expect(query('mktg-agent-run-asked-ranked-goals')?.textContent).toContain('Adoption first.');
        expect(query('mktg-agent-run-asked-ranked-goals')?.textContent).toContain('Suggested by the agent, accepted');
        expect(query('mktg-agent-run-asked-words-to-avoid')?.textContent).toContain('Your answer');
      });

      it('marks an edited suggestion as edited, goes back with Back, and shows the writing feed once sent', async () => {
        answerQuestions.mockReturnValue(concat(of<MktgGenerateProgress>({ type: 'submitted' }), NEVER));

        await type('ranked-goals', 'Adoption, then community.');
        await click('mktg-run-questions-next');
        await click('mktg-run-questions-back');
        expect(answerBox('ranked-goals')?.value).toBe('Adoption, then community.');
        await sendWith('Avoid "synergy".');

        const sent = answerQuestions.mock.calls[0][2] as MktgRunAnswer[];
        expect(sent[0]).toEqual({ key: 'ranked-goals', text: 'Adoption, then community.', origin: 'edited' });
        expect(component['phase']()).toBe('running');
        expect(query('mktg-run-activity-title')?.textContent).toContain('Writing your Messaging framework');
      });

      it('keeps the answers and returns to the questions step when the answers could not be sent', async () => {
        answerQuestions.mockReturnValue(throwError(() => new Error('network')));

        await sendWith('Avoid "synergy".');

        expect(component['phase']()).toBe('questions');
        expect(component['errorText']()).toContain('kept');
        expect(stepper()['answersForm'].controls['words-to-avoid'].value).toBe('Avoid "synergy".');
      });
    });

    it('shows a stored framework on the asset view with no "Request changes" box — edit the inputs and generate a new revision instead', async () => {
      storedRuns = { 'proj-1:foundation-setup': assetRun([{ version: 1, document: '', asset: ASSET, createdAt: '2026-10-17T00:00:00.000Z' }]) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-result')).not.toBeNull();
      expect(query('mktg-framework-view-vision')?.textContent).toContain('A vision.');
      expect(query('mktg-agent-run-regenerate-button')).toBeNull();
      expect(query('mktg-agent-run-new-run')).not.toBeNull();
      expect(query('mktg-agent-run-documents-link')).not.toBeNull();
      // A version written without a questions round shows nothing about questions.
      expect(query('mktg-agent-run-asked')).toBeNull();

      query('mktg-agent-run-edit-inputs-button')?.querySelector('button')?.click();
      await fixture.whenStable();
      expect(component['phase']()).toBe('form');
      expect(component['intakeForm'].controls['project_name'].value).toBe('TestOrbit');
    });

    it('prints the framework in the project’s Brand Kit and exports the version on screen: Download PDF and Export to Google Slides in the framework’s header', async () => {
      resolveBrandKit.mockReturnValue(of(brandKitTestRevision()));
      storedRuns = {
        'proj-1:foundation-setup': assetRun([{ version: 1, document: '', asset: ASSET, contentSha256: 'c'.repeat(64), createdAt: '2026-10-17T00:00:00.000Z' }]),
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(resolveBrandKit).toHaveBeenCalledWith('proj-1');
      expect(query('mktg-framework-view-download-pdf')?.querySelector('button')?.disabled).toBe(false);
      expect(query('mktg-framework-view-export-slides')?.querySelector('button')?.disabled).toBe(false);
      expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('kit');
      // The export names this version's stored revision by the hash of its content.
      query('mktg-framework-view-export-slides')?.querySelector('button')?.click();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      expect(slidesExport.start).toHaveBeenCalledWith({
        project: 'proj-1',
        agentKey: 'foundation-message',
        documentId: 'living',
        contentSha256: 'c'.repeat(64),
        mode: 'create',
      });
      expect(query('mktg-agent-run-download-pdf')).toBeNull();
      expect(query('mktg-agent-run-export-slides')).toBeNull();
    });

    it('restores a run the earlier Markdown form saved to the form, its answers kept — never an empty generating shell', async () => {
      storedRuns = {
        'proj-1:foundation-setup': assetRun([{ version: 1, document: '# An earlier Messaging Document', createdAt: '2026-10-01T00:00:00.000Z' }]),
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(component['phase']()).toBe('form');
      expect(query('mktg-agent-run-result')).toBeNull();
      expect(component['versions']()).toEqual([]);
      expect(component['intakeForm'].controls['website_url'].value).toBe('https://testorbit.example.org');
    });

    it('downloads the framework as its JSON', async () => {
      storedRuns = { 'proj-1:foundation-setup': assetRun([{ version: 2, document: '', asset: ASSET, createdAt: '2026-10-17T00:00:00.000Z' }]) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      const blobs: Blob[] = [];
      const createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return 'blob:framework';
      });
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      try {
        component['onDownload']();
        expect(blobs[0]?.type).toBe('application/json');
        expect(await blobs[0]?.text()).toContain('"tagline": "Release, open."');
        // The blob URL is revoked on a deferred tick; let it run against the stub.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        click.mockRestore();
        vi.unstubAllGlobals();
      }
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

      component['onEditInputs']();
      await fixture.whenStable();

      const restored = component['intakeForm'].getRawValue();
      expect(restored['project_name']).toBe('TestOrbit');
      // The GitHub field is back on the form (hand test, 18 Oct), so the old form's repository URL fills it.
      expect(restored['github_url']).toBe('https://github.com/example-org/testorbit');
      expect(restored).not.toHaveProperty('other_links');
    });
  });

  describe('README outcome on the result — a thin document is never a silent mystery', () => {
    /** A stored ICP run whose single version carries the given README outcome. */
    const runWithReadme = (readme: MktgRunVersion['readme']): MktgStoredAgentRun => ({
      agentId: 'icp',
      projectUid: 'proj-1',
      sessionId: 'sess-icp',
      ownerToken: 'token-icp',
      answers: { project_name: 'TestOrbit', github_url: 'https://github.com/aaif', business_outcome: 'Membership growth' },
      versions: [{ version: 1, document: '# Doc', readme, createdAt: '2026-08-19T00:00:00.000Z' }],
      savedAt: new Date().toISOString(),
    });

    beforeEach(async () => configure('browser', 'icp'));

    it('states that the document was generated WITHOUT a README, and why', async () => {
      storedRuns = { 'proj-1:icp': runWithReadme({ fetched: false, skipReason: 'not-a-repo-url' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-readme-note')?.textContent).toContain('Generated without a README');
      expect(query('mktg-agent-run-readme-note')?.textContent).toContain('didn’t resolve to a readable repository');
    });

    it('distinguishes an absent README from GitHub being unreachable', async () => {
      storedRuns = { 'proj-1:icp': runWithReadme({ fetched: false, skipReason: 'no-readme' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-agent-run-readme-note')?.textContent).toContain('has no README');

      storedRuns = { 'proj-2:icp': { ...runWithReadme({ fetched: false, skipReason: 'fetch-failed' }), projectUid: 'proj-2' } };
      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      expect(query('mktg-agent-run-readme-note')?.textContent).toContain('couldn’t be reached');
    });

    it('says a repository was not publicly readable rather than claiming it has no README', async () => {
      // Different remedy: the repo may well HAVE a README — what failed was
      // access, and telling the user to fix the URL sends them nowhere.
      storedRuns = { 'proj-1:icp': runWithReadme({ fetched: false, skipReason: 'not-public' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-readme-note')?.textContent).toContain('isn’t publicly readable');
      expect(query('mktg-agent-run-readme-note')?.textContent).not.toContain('has no README');
    });

    it('says nothing when a README WAS used, or when the run predates the outcome being recorded', async () => {
      storedRuns = { 'proj-1:icp': runWithReadme({ fetched: true, source: 'repository' }) };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(query('mktg-agent-run-readme-note')).toBeNull();

      storedRuns = { 'proj-2:icp': { ...runWithReadme(undefined), projectUid: 'proj-2' } };
      activeContext.set(PROJECT_2);
      await fixture.whenStable();
      expect(query('mktg-agent-run-readme-note')).toBeNull();
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
