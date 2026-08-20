// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  MktgDependencyDocument,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgStoredAgentRun,
  Project,
  ProjectContext,
  User,
} from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  let loadRun: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let generate: ReturnType<typeof vi.fn>;
  let resolveDependencies: ReturnType<typeof vi.fn>;

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
    // Stored runs are keyed per agent: `<projectUid>` alone keeps the legacy
    // brand-kit fixtures working, `<projectUid>:<agentId>` scopes when a test
    // needs both the page agent's run AND a dependency source run.
    loadRun = vi.fn((projectUid: string, runAgentId: string) => storedRuns[`${projectUid}:${runAgentId}`] ?? storedRuns[projectUid] ?? null);
    getProject = vi.fn((slug: string) => of(projects[slug] ?? null));
    generate = vi.fn(() => of<MktgGenerateProgress>({ type: 'submitted' }));
    resolveDependencies = vi.fn((projectUid: string, agentIds: string[]) =>
      of(Object.fromEntries(agentIds.map((agentId) => [agentId, dependencyDocs[`${projectUid}:${agentId}`] ?? null])))
    );

    await TestBed.configureTestingModule({
      imports: [MktgAgentRunComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ agentId }) } } },
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: () => activeContext()?.uid ?? '' } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: UserService, useValue: { user: userSignal } },
        { provide: MktgAgentRunService, useValue: { loadRun, generate } },
        { provide: MktgDependencyService, useValue: { resolveDependencies } },
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

  describe('Message Foundation — dependency auto-attach (dec-agent-dependency-gating)', () => {
    /** Fills the two always-required base fields. */
    const fillBase = (): void => {
      component['intakeForm'].controls['project_name'].setValue('TestOrbit');
      component['intakeForm'].controls['github_url'].setValue('https://github.com/example-org/testorbit');
    };
    const brandKitDoc = (document: string, version = 2, source: 'server' | 'browser' = 'server'): MktgDependencyDocument => ({
      agentId: 'brand-kit',
      source,
      version,
      document,
    });
    const submittedAnswers = (): Record<string, string> => (generate.mock.calls[0][0] as MktgGenerateRequest).answers;

    beforeEach(async () => configure('browser', 'foundation-setup'));

    it('renders no Brand Kit gate UI: only project name, GitHub URL and the optional gap-fill notes', async () => {
      dependencyDocs = { 'proj-1:brand-kit': brandKitDoc('# TestOrbit Brand Kit v2') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // The retired use/paste/discovery gate — and Paul's raw
      // "[Project Name] Brand Kit" template string — must not render.
      expect(query('mktg-agent-run-gate')).toBeNull();
      expect(host().textContent).not.toContain('[Project Name]');
      expect(host().querySelector('[data-test="mktg-intake-brand_kit_markdown"]')).toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-one_line_description"]')).toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-project_name"]')).not.toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-github_url"]')).not.toBeNull();
      expect(host().querySelector('[data-test="mktg-intake-gap_fill_notes"]')).not.toBeNull();

      // The two base fields are all that is required.
      fillBase();
      expect(component['intakeForm'].valid).toBe(true);
    });

    it('shows the non-interactive "Using <project>\'s Brand Kit (vN)" chip and always submits the stored document', async () => {
      dependencyDocs = { 'proj-1:brand-kit': brandKitDoc('# TestOrbit Brand Kit v2') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      const chip = query('mktg-agent-run-attachment-brand-kit');
      expect(chip?.textContent).toContain('Using Project One’s Brand Kit (v2)');
      // Non-interactive: a plain chip, not a form control or button.
      expect(chip?.querySelector('input, button')).toBeNull();

      fillBase();
      component['onSubmit']();

      // brand_kit_markdown is ALWAYS the stored kit's document, fetched at
      // submit time — satisfying the agent's conditional contract with the
      // discovery fields omitted.
      expect(generate).toHaveBeenCalledTimes(1);
      expect(submittedAnswers()).toEqual({
        project_name: 'TestOrbit',
        github_url: 'https://github.com/example-org/testorbit',
        brand_kit_markdown: '# TestOrbit Brand Kit v2',
      });
    });

    it('falls back to the browser-stored Brand Kit run when server persistence has none', async () => {
      dependencyDocs = { 'proj-1:brand-kit': brandKitDoc('# Browser-stored kit', 1, 'browser') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(query('mktg-agent-run-attachment-brand-kit')?.textContent).toContain('(v1)');
      fillBase();
      component['onSubmit']();

      expect(submittedAnswers()['brand_kit_markdown']).toBe('# Browser-stored kit');
    });

    it('keeps submission disabled with an honest note when the project has no stored Brand Kit at all', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillBase();

      expect(query('mktg-agent-run-attachment-brand-kit')).toBeNull();
      expect(query('mktg-agent-run-missing-dependency')).not.toBeNull();
      expect(component['submitDisabled']()).toBe(true);
      component['onSubmit']();
      expect(generate).not.toHaveBeenCalled();
    });

    it('gates "Request changes" on the dependency exactly like the first submit — both are full resubmits', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillBase();
      component['feedbackForm'].controls.feedback.setValue('Sharpen the pitch.');
      await fixture.whenStable();

      // No stored Brand Kit for this project: neither submit path may fire.
      expect(component['submitDisabled']()).toBe(true);
      expect(component['regenerateDisabled']()).toBe(true);
      component['onRegenerate']();
      expect(generate).not.toHaveBeenCalled();

      // Once the dependency resolves, both paths open together.
      component['dependencyDocs'].set({ 'brand-kit': brandKitDoc('# Kit') });
      expect(component['regenerateDisabled']()).toBe(false);
    });

    it('re-resolves the attachment at submit time — a kit stored after page load is picked up', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillBase();
      expect(component['submitDisabled']()).toBe(true);

      // The user generates a Brand Kit in another tab, then a fresh resolution succeeds.
      dependencyDocs = { 'proj-1:brand-kit': brandKitDoc('# Fresh kit', 3) };
      component['startGeneration']();
      await fixture.whenStable();

      expect(generate).toHaveBeenCalledTimes(1);
      expect(submittedAnswers()['brand_kit_markdown']).toBe('# Fresh kit');
    });

    it('omits the blank optional gap_fill_notes and includes it when filled', async () => {
      dependencyDocs = { 'proj-1:brand-kit': brandKitDoc('# Kit') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      fillBase();
      component['onSubmit']();
      expect(submittedAnswers()['gap_fill_notes']).toBeUndefined();

      generate.mockClear();
      // The mocked generate never delivers a document, so the first submit
      // parked the page on 'running' — return to the form for the second one.
      component['phase'].set('form');
      component['intakeForm'].controls['gap_fill_notes'].setValue('Anchor to the v2 launch');
      component['onSubmit']();
      expect((generate.mock.calls[0][0] as MktgGenerateRequest).answers['gap_fill_notes']).toBe('Anchor to the v2 launch');
    });

    it('surfaces the five derivative chips as copyable values on the result', async () => {
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-mf',
          ownerToken: 'token-mf',
          answers: { project_name: 'TestOrbit', github_url: 'https://github.com/example-org/testorbit', brand_kit_markdown: '# Kit' },
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
          answers: { project_name: 'TestOrbit', github_url: 'https://github.com/example-org/testorbit', brand_kit_markdown: '# Kit' },
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

    it('restores a run persisted by the retired gate UI cleanly — unknown answer keys are ignored', async () => {
      dependencyDocs = { 'proj-1:brand-kit': brandKitDoc('# Kit') };
      storedRuns = {
        'proj-1:foundation-setup': {
          agentId: 'foundation-setup',
          projectUid: 'proj-1',
          sessionId: 'sess-mf',
          ownerToken: 'token-mf',
          answers: { project_name: 'TestOrbit', github_url: 'https://github.com/example-org/testorbit', brand_kit_markdown: '# Kit' },
          versions: [{ version: 1, document: '# Doc', createdAt: '2026-08-19T00:00:00.000Z' }],
          savedAt: new Date().toISOString(),
        },
      };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      component['onEditInputs']();
      await fixture.whenStable();

      // The retired brand_kit_markdown answer has no control anymore; the
      // surviving fields restore and the form is submit-ready.
      expect(component['intakeForm'].getRawValue()).toEqual({
        project_name: 'TestOrbit',
        github_url: 'https://github.com/example-org/testorbit',
        gap_fill_notes: '',
      });
      expect(component['intakeForm'].valid).toBe(true);
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
