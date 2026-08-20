// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_RUN_STAGES } from '@lfx-one/shared/constants';
import {
  MktgAgent,
  MktgAgentAccent,
  MktgAgentIntake,
  MktgBrandKitGateChoice,
  MktgIntakeField,
  MktgIntakeGateOption,
  MktgIntakePrefillSource,
  MktgRunPhase,
  MktgRunVersion,
  MktgStoredAgentRun,
  ProjectContext,
  User,
} from '@lfx-one/shared/interfaces';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { combineLatest, distinctUntilChanged, filter, map, Subscription, switchMap } from 'rxjs';

import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';

// Form-first agent run page (approved Marketing OS design): batch intake form
// → staged running checklist → document result with versions and a
// "Request changes" feedback box that regenerates as v+1 through the existing
// chat/session BFF. The page is driven entirely by the shared intake registry
// (MKTG_AGENT_INTAKES), so additional agent forms slot in without touching the
// shell.
@Component({
  selector: 'lfx-mktg-agent-run',
  imports: [
    NgClass,
    NgTemplateOutlet,
    ReactiveFormsModule,
    ButtonComponent,
    InputTextComponent,
    RadioButtonComponent,
    TextareaComponent,
    MarkdownRendererComponent,
    MessageComponent,
  ],
  templateUrl: './mktg-agent-run.component.html',
})
export class MktgAgentRunComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runService = inject(MktgAgentRunService);
  private readonly userService = inject(UserService);

  // toObservable needs the injection context — created here, subscribed (browser
  // only) in the constructor.
  private readonly activeContext$ = toObservable(this.projectContext.activeContext);
  private readonly effectiveUser$ = toObservable(this.userService.user);
  /** In-flight generation — cancelled when the active project changes so a run can never land on another project. */
  private generationSub: Subscription | null = null;
  /** Deferred phase-set timer from completeRun — cleared on destroy so no timer outlives the view. */
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Reset timer for the transient "Copied" chip state — cleared on destroy. */
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  // === Catalog lookups (route param is stable for the component's lifetime) ===
  protected readonly agent: MktgAgent | null = this.resolveAgent();
  protected readonly intake: MktgAgentIntake | null = this.agent ? (MKTG_AGENT_INTAKES[this.agent.id] ?? null) : null;

  // === Constants ===
  protected readonly stageLabels = MKTG_RUN_STAGES;

  // === Forms ===
  protected readonly intakeForm: FormGroup<Record<string, FormControl<string>>> = this.buildIntakeForm();
  protected readonly feedbackForm = new FormGroup({
    feedback: new FormControl('', { nonNullable: true }),
  });
  /** Brand Kit gate (Q1c) selection — a form control so the radio group and programmatic restore share one path. */
  protected readonly gateForm = new FormGroup({
    choice: new FormControl<MktgBrandKitGateChoice>('discovery', { nonNullable: true }),
  });

  // === Signals ===
  protected readonly phase = signal<MktgRunPhase>('form');
  protected readonly stage = signal(0);
  protected readonly errorText = signal('');
  protected readonly run = signal<MktgStoredAgentRun | null>(null);
  protected readonly viewVersion = signal<number | null>(null);
  protected readonly docExpanded = signal(false);
  /** Field keys pre-filled from LFX data this session — drives the "From LFX" chips. */
  protected readonly fromLfx = signal<Record<string, boolean>>({});
  /**
   * Field keys whose LFX prefill source resolved WITHOUT a value. Tracked
   * separately from fromLfx (which only records that a prefill was APPLIED to
   * an empty control) so the "not set on your LFX project" hint reflects what
   * LFX actually has — never restored answers or early typing.
   */
  protected readonly lfxMissing = signal<Record<string, boolean>>({});
  /**
   * The active project's stored Brand Kit document for the gate's `stored`
   * option — currently the browser-persisted Brand Kit agent run (the only
   * stored-document source until server-side Brand Kit persistence lands;
   * the receipt/stored-document lookup slots in here). Null hides the option.
   */
  protected readonly storedBrandKit = signal<{ version: number; document: string } | null>(null);
  /** Derivative chip key whose value was just copied — drives the transient "Copied" state. */
  protected readonly copiedDerivative = signal('');

  // === Computed ===
  private readonly intakeValid = toSignal(this.intakeForm.statusChanges.pipe(map((status) => status === 'VALID')), { initialValue: this.intakeForm.valid });
  private readonly feedbackValue = toSignal(this.feedbackForm.controls.feedback.valueChanges, { initialValue: '' });
  /** Current Brand Kit gate choice as a signal (form control is the single write path). */
  protected readonly gateChoice = toSignal(this.gateForm.controls.choice.valueChanges, { initialValue: this.gateForm.controls.choice.value });

  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name || 'Your Project');
  protected readonly formTitle = computed(() => `${this.intake?.formTitleAction} the ${this.projectName()} ${this.intake?.documentName}`);
  protected readonly docTitle = computed(() => `${this.projectName()} ${this.intake?.documentName}`);
  protected readonly submitLabel = computed(() => `Generate ${this.intake?.documentName}`);
  protected readonly versions = computed(() => this.run()?.versions ?? []);
  protected readonly currentVersion: Signal<MktgRunVersion | null> = this.initCurrentVersion();
  protected readonly nextVersion = computed(() => (this.versions().at(-1)?.version ?? 0) + 1);
  protected readonly showVersionChips = computed(() => this.versions().length > 1 && this.phase() !== 'running');
  protected readonly feedbackNote = computed(() => (this.currentVersion()?.feedback ?? '').slice(0, 120));
  protected readonly submitDisabled = computed(() => !this.intakeValid() || this.phase() === 'running' || !this.gateSatisfied());
  /**
   * Gate options actually offered: the `stored` option only exists when the
   * project has a stored Brand Kit document (its label then names the draft
   * version) — the form degrades gracefully to paste/discovery otherwise.
   */
  protected readonly gateOptions: Signal<MktgIntakeGateOption[]> = this.initGateOptions();
  /** Fields rendered ABOVE the gate block (or all fields when the intake has no gate). */
  protected readonly preGateFields: Signal<MktgIntakeField[]> = this.initPreGateFields();
  /** Gate-branched fields rendered BELOW the gate block, filtered to the active choice. */
  protected readonly postGateFields: Signal<MktgIntakeField[]> = this.initPostGateFields();
  /** Copyable derivative chips for the current version (empty when the agent has none). */
  protected readonly derivativeChips: Signal<{ key: string; label: string; value: string; copied: boolean }[]> = this.initDerivativeChips();
  protected readonly regenerateDisabled = computed(() => !this.feedbackValue().trim() || !this.intakeValid() || this.phase() === 'running');
  protected readonly stages: Signal<{ label: string; state: 'done' | 'active' | 'pending'; labelClass: string }[]> = this.initStages();
  protected readonly sectionChecklist: Signal<{ label: string; present: boolean; iconClass: string; srText: string }[]> = this.initSectionChecklist();

  // Accent → Tailwind classes, kept as a class field with literal class names so
  // Tailwind's content scan (./src/**/*.ts) generates them.
  private readonly accentIcon: Record<MktgAgentAccent, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  private readonly stageLabelClass: Record<'done' | 'active' | 'pending', string> = {
    done: 'text-gray-400',
    active: 'text-gray-600',
    pending: 'text-gray-300',
  };

  // The agent is fixed for the component's lifetime (route param), so its
  // presentation derives once here — templates bind properties, never call
  // methods (docs/reviews/frontend-checklist.md §4).
  protected readonly agentIconClass: string = this.accentIcon[this.agent?.accent ?? 'gray'];
  protected readonly agentTagline: string = this.agent?.tags.join(' · ') ?? '';

  public constructor() {
    // The deferred timers must not outlive the view (their callbacks only
    // write signals today, but an unmanaged timer is a foot-gun).
    this.destroyRef.onDestroy(() => {
      if (this.phaseTimer !== null) {
        clearTimeout(this.phaseTimer);
        this.phaseTimer = null;
      }
      if (this.copyTimer !== null) {
        clearTimeout(this.copyTimer);
        this.copyTimer = null;
      }
    });
    // Unknown, coming-soon, or intake-less agents have no run page — back to the grid.
    if (!this.agent || this.agent.status !== 'active' || !this.intake) {
      this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
      return;
    }
    // The Brand Kit gate toggles which controls are REQUIRED (paste vs the
    // five discovery answers). One subscription covers user picks and
    // programmatic restores alike — the form control is the single write path.
    if (this.intake.brandKitGate) {
      this.gateForm.controls.choice.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((choice) => this.applyGateValidators(choice));
    }
    // Stored runs + LFX prefill read browser state (localStorage, HTTP-backed
    // project detail), and the project selector reuses this component on a
    // switch (it only rewrites ?project=) — so restore + prefill must re-run,
    // and ALL run state must reset, on every active-context change, never just
    // the first render (docs/reviews/frontend-checklist.md 14.14). The stream
    // is keyed by the EFFECTIVE user too: Admin Mode impersonation swaps
    // `user()` in place with the same project selected, and without a reset the
    // page would keep rendering the previous effective user's restored run and
    // an in-flight completion could persist under whichever sub is current when
    // it finishes (resetForContext cancels the in-flight generation).
    // Browser-only so SSR output stays stable; the first emission lands
    // post-hydration.
    if (isPlatformBrowser(this.platformId)) {
      combineLatest([this.activeContext$, this.effectiveUser$])
        .pipe(
          filter((pair): pair is [ProjectContext, User | null] => !!pair[0]),
          distinctUntilChanged(([previousContext, previousUser], [context, user]) => previousContext.uid === context.uid && previousUser?.sub === user?.sub),
          switchMap(([context]) => {
            this.resetForContext(context);
            // getProject memoizes per slug and maps errors to null, and
            // switchMap drops a stale in-flight lookup on project change.
            return this.projectService.getProject(context.slug, false);
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((project) => {
          if (!project) {
            return;
          }
          this.applyPrefill('repository-url', project.repository_url);
          this.applyPrefill('project-description', project.description);
        });
    }
  }

  // === Protected methods ===
  protected onBack(): void {
    this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  protected onSubmit(): void {
    if (this.submitDisabled()) {
      return;
    }
    this.startGeneration();
  }

  protected onRegenerate(): void {
    if (this.regenerateDisabled()) {
      return;
    }
    this.startGeneration(this.feedbackForm.controls.feedback.value.trim());
  }

  protected onEditInputs(): void {
    this.phase.set('form');
  }

  protected onPickVersion(version: number): void {
    this.viewVersion.set(version);
    this.docExpanded.set(false);
    this.phase.set('result');
  }

  protected onToggleDocument(): void {
    this.docExpanded.update((expanded) => !expanded);
  }

  protected onDownload(): void {
    // SSR guard: Blob/URL/document are browser-only (ssr-safety rule).
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const current = this.currentVersion();
    if (!current) {
      return;
    }
    const blob = new Blob([current.document], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.docTitle()} v${current.version}.md`;
    anchor.click();
    // Deferred: some browsers begin the download asynchronously, and revoking
    // synchronously can invalidate the blob URL before it is consumed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Copies a derivative chip's value; the chip flashes "Copied" for a moment. */
  protected async onCopyDerivative(chip: { key: string; value: string }): Promise<void> {
    // SSR guard: navigator/clipboard are browser-only (ssr-safety rule).
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(chip.value);
    } catch {
      // Clipboard permission denied — leave the chip un-flashed rather than lie.
      return;
    }
    this.copiedDerivative.set(chip.key);
    if (this.copyTimer !== null) {
      clearTimeout(this.copyTimer);
    }
    this.copyTimer = setTimeout(() => {
      this.copyTimer = null;
      this.copiedDerivative.set('');
    }, 2000);
  }

  // === Private initializers ===
  private initCurrentVersion(): Signal<MktgRunVersion | null> {
    return computed(() => {
      const versions = this.versions();
      return versions.find((candidate) => candidate.version === this.viewVersion()) ?? versions.at(-1) ?? null;
    });
  }

  private initStages(): Signal<{ label: string; state: 'done' | 'active' | 'pending'; labelClass: string }[]> {
    return computed(() => {
      const current = this.stage();
      return this.stageLabels.map((label, index) => {
        let state: 'done' | 'active' | 'pending' = 'pending';
        if (index < current) {
          state = 'done';
        } else if (index === current) {
          state = 'active';
        }
        return { label, state, labelClass: this.stageLabelClass[state] };
      });
    });
  }

  private initSectionChecklist(): Signal<{ label: string; present: boolean; iconClass: string; srText: string }[]> {
    return computed(() => {
      const document = this.currentVersion()?.document ?? '';
      const lowerDoc = document.toLowerCase();
      // Present vs missing is conveyed by DISTINCT icons plus screen-reader
      // text, never color alone.
      return (this.intake?.sections ?? []).map((label) => {
        const present = this.sectionPresent(lowerDoc, label);
        return {
          label,
          present,
          iconClass: present ? 'fa-light fa-circle-check text-emerald-500' : 'fa-light fa-circle-xmark text-gray-400',
          srText: present ? 'included' : 'missing',
        };
      });
    });
  }

  private initGateOptions(): Signal<MktgIntakeGateOption[]> {
    return computed(() => {
      const gate = this.intake?.brandKitGate;
      if (!gate) {
        return [];
      }
      const stored = this.storedBrandKit();
      return gate.options
        .filter((option) => option.choice !== 'stored' || stored !== null)
        .map((option) => (option.choice === 'stored' && stored ? { ...option, label: `${option.label} (v${stored.version})` } : option));
    });
  }

  private initPreGateFields(): Signal<MktgIntakeField[]> {
    return computed(() => {
      const fields = this.intake?.fields ?? [];
      if (!this.intake?.brandKitGate) {
        return fields;
      }
      const firstBranchIndex = fields.findIndex((field) => this.isGateBranchField(field));
      return firstBranchIndex === -1 ? fields : fields.slice(0, firstBranchIndex);
    });
  }

  private initPostGateFields(): Signal<MktgIntakeField[]> {
    return computed(() => {
      const gate = this.intake?.brandKitGate;
      const fields = this.intake?.fields ?? [];
      if (!gate) {
        return [];
      }
      const firstBranchIndex = fields.findIndex((field) => this.isGateBranchField(field));
      if (firstBranchIndex === -1) {
        return [];
      }
      const choice = this.gateChoice();
      return fields.slice(firstBranchIndex).filter((field) => {
        if (field.key === gate.pasteFieldKey) {
          return choice === 'paste';
        }
        if (gate.discoveryFieldKeys.includes(field.key)) {
          return choice === 'discovery';
        }
        return true;
      });
    });
  }

  private initDerivativeChips(): Signal<{ key: string; label: string; value: string; copied: boolean }[]> {
    return computed(() => {
      const chips = this.intake?.derivativeChips ?? [];
      const derivatives = this.currentVersion()?.derivatives ?? {};
      const copiedKey = this.copiedDerivative();
      return chips
        .filter((chip) => !!derivatives[chip.key]?.trim())
        .map((chip) => ({ key: chip.key, label: chip.label, value: derivatives[chip.key], copied: chip.key === copiedKey }));
    });
  }

  // === Private helpers ===
  private resolveAgent(): MktgAgent | null {
    const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';
    return MKTG_AGENTS.find((candidate) => candidate.id === agentId) ?? null;
  }

  private buildIntakeForm(): FormGroup<Record<string, FormControl<string>>> {
    const controls: Record<string, FormControl<string>> = {};
    const gate = this.intake?.brandKitGate;
    for (const field of this.intake?.fields ?? []) {
      // Optional fields never carry the required validator; the gate's paste
      // field starts without it because the initial choice is `discovery`
      // (applyGateValidators keeps the branch validators in sync afterwards).
      const required = !field.optional && field.key !== gate?.pasteFieldKey;
      controls[field.key] = new FormControl('', { nonNullable: true, validators: required ? [trimmedRequired()] : [] });
    }
    return new FormGroup(controls);
  }

  /**
   * Keeps the gate-branched validators aligned with the active choice: the
   * paste field is required only on `paste`, the five discovery answers only
   * on `discovery` (the agent contract's conditional requirement — required
   * exactly when no brand_kit_markdown is submitted). Hidden branches lose
   * their validator so stale text in them can never block submission.
   */
  private applyGateValidators(choice: MktgBrandKitGateChoice): void {
    const gate = this.intake?.brandKitGate;
    if (!gate) {
      return;
    }
    const pasteControl = this.intakeForm.controls[gate.pasteFieldKey];
    if (pasteControl) {
      pasteControl.setValidators(choice === 'paste' ? [trimmedRequired()] : []);
      pasteControl.updateValueAndValidity();
    }
    for (const key of gate.discoveryFieldKeys) {
      const control = this.intakeForm.controls[key];
      if (control) {
        control.setValidators(choice === 'discovery' ? [trimmedRequired()] : []);
        control.updateValueAndValidity();
      }
    }
  }

  /**
   * Assembles the submitted answers from the form per the gate state:
   * hidden branch fields are omitted, blank optional fields are omitted, and
   * the `stored` choice submits the stored Brand Kit document as the paste
   * key (the agent's v1 paste/pass-through path — the BFF receives the same
   * `brand_kit_markdown` either way). Null aborts the submission (the stored
   * document disappeared — should be unreachable while the option is shown).
   */
  private buildAnswers(): Record<string, string> | null {
    if (!this.intake) {
      return null;
    }
    const gate = this.intake.brandKitGate;
    const choice = this.gateChoice();
    const answers: Record<string, string> = {};

    for (const field of this.intake.fields) {
      if (gate && field.key === gate.pasteFieldKey && choice !== 'paste') {
        continue;
      }
      if (gate && gate.discoveryFieldKeys.includes(field.key) && choice !== 'discovery') {
        continue;
      }
      const value = this.intakeForm.controls[field.key].value.trim();
      if (field.optional && !value) {
        continue;
      }
      answers[field.key] = value;
    }

    if (gate && choice === 'stored') {
      const stored = this.storedBrandKit();
      if (!stored) {
        this.errorText.set('No stored Brand Kit was found for this project — paste one or answer the discovery questions instead.');
        return null;
      }
      answers[gate.pasteFieldKey] = stored.document;
    }

    return answers;
  }

  /** The `stored` choice is only satisfiable while a stored Brand Kit document actually exists. */
  private gateSatisfied(): boolean {
    if (!this.intake?.brandKitGate) {
      return true;
    }
    return this.gateChoice() !== 'stored' || this.storedBrandKit() !== null;
  }

  /** Whether a field belongs to a gate branch (rendered below the gate, visibility driven by the choice). */
  private isGateBranchField(field: MktgIntakeField): boolean {
    const gate = this.intake?.brandKitGate;
    if (!gate) {
      return false;
    }
    return field.key === gate.pasteFieldKey || gate.discoveryFieldKeys.includes(field.key);
  }

  /**
   * Resets ALL run state for the (new) active project, then restores that
   * project's stored run and applies its LFX prefill. Runs on every active
   * context change so one project's session, answers and versions can never
   * bleed into another's.
   */
  private resetForContext(context: ProjectContext): void {
    if (!this.agent || !this.intake) {
      return;
    }

    this.generationSub?.unsubscribe();
    this.generationSub = null;
    this.run.set(null);
    this.viewVersion.set(null);
    this.phase.set('form');
    this.stage.set(0);
    this.errorText.set('');
    this.docExpanded.set(false);
    this.fromLfx.set({});
    this.lfxMissing.set({});
    this.copiedDerivative.set('');
    this.intakeForm.reset();
    this.feedbackForm.reset();

    // Stored Brand Kit lookup for the gate's `stored` option — this project's
    // browser-persisted Brand Kit agent run (per-project, so it resets with
    // the rest of the context state).
    const gate = this.intake.brandKitGate;
    if (gate) {
      const brandKitRun = this.runService.loadRun(context.uid, gate.storedSourceAgentId);
      const latest = brandKitRun?.versions.at(-1);
      this.storedBrandKit.set(latest?.document ? { version: latest.version, document: latest.document } : null);
    }

    const stored = this.runService.loadRun(context.uid, this.agent.id);
    if (stored) {
      this.run.set(stored);
      this.intakeForm.patchValue(stored.answers);
      this.viewVersion.set(stored.versions.at(-1)?.version ?? null);
      if (stored.versions.length > 0) {
        this.phase.set('result');
      }
    }

    // Gate restore: a restored submission that carried Brand Kit markdown
    // lands on `paste` (the document is right there in the textarea — honest
    // even when it originally came from the stored option); otherwise a fresh
    // form defaults to the stored Brand Kit when one exists, else discovery.
    if (gate) {
      let choice: MktgBrandKitGateChoice = 'discovery';
      if (stored) {
        choice = stored.answers[gate.pasteFieldKey]?.trim() ? 'paste' : 'discovery';
      } else if (this.storedBrandKit()) {
        choice = 'stored';
      }
      this.gateForm.controls.choice.setValue(choice);
    }

    // LFX prefill — fill only still-empty answers, and mark them "From LFX".
    // repository-url / project-description follow from the getProject lookup
    // chained in the constructor.
    this.applyPrefill('project-name', context.name);
  }

  /**
   * Records what the resolved LFX source actually has — fields whose source
   * came back empty get the honest "not set on your LFX project" hint — and
   * fills still-empty controls from it, marking those "From LFX". Availability
   * is tracked independently of application: restored answers or early typing
   * must never make an existing LFX value read as missing.
   */
  private applyPrefill(source: MktgIntakePrefillSource, value: string | null | undefined): void {
    if (!this.intake) {
      return;
    }
    const trimmedValue = value?.trim() ?? '';
    for (const field of this.intake.fields) {
      if (field.prefill !== source) {
        continue;
      }
      this.lfxMissing.update((flags) => ({ ...flags, [field.key]: !trimmedValue }));
      if (!trimmedValue) {
        continue;
      }
      const control = this.intakeForm.controls[field.key];
      if (control && !control.value.trim()) {
        control.setValue(trimmedValue);
        this.fromLfx.update((flags) => ({ ...flags, [field.key]: true }));
      }
    }
  }

  private startGeneration(feedback?: string): void {
    const projectUid = this.projectContext.activeContextUid();
    if (!this.agent || !this.intake) {
      return;
    }
    if (!projectUid) {
      this.errorText.set('No active project — select a project before running this agent.');
      return;
    }

    const answers = this.buildAnswers();
    if (!answers) {
      return;
    }

    this.errorText.set('');
    this.docExpanded.set(false);
    this.phase.set('running');
    this.stage.set(0);

    // The prior draft's version is NOT sent — the run service derives it from
    // the stored run so the follow-up's version directive always matches the
    // version its result poll will accept.
    this.generationSub?.unsubscribe();
    this.generationSub = this.runService
      .generate({ agentId: this.agent.id, projectUid, intake: this.intake, answers, feedback })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => {
          if (progress.type === 'submitted') {
            this.stage.set(1);
            return;
          }
          this.stage.set(2);
          this.completeRun(progress.run);
        },
        error: () => {
          this.errorText.set('The agent could not complete this run. Your answers are kept — try again.');
          this.phase.set(this.versions().length > 0 ? 'result' : 'form');
        },
      });
  }

  private completeRun(run: MktgStoredAgentRun): void {
    this.run.set(run);
    this.viewVersion.set(run.versions.at(-1)?.version ?? null);
    this.feedbackForm.reset();
    // Let the "Validating required sections" stage register before the result
    // lands — but only if a project switch hasn't reset the page meanwhile.
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
    }
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      if (this.run() === run) {
        this.phase.set('result');
      }
    }, 600);
  }

  private sectionPresent(lowerDoc: string, label: string): boolean {
    if (!lowerDoc) {
      return false;
    }
    if (lowerDoc.includes(label.toLowerCase())) {
      return true;
    }
    // Fallback: match the heading without the config label's numbering/appendix
    // prefix ("1. Project Definition" → "Project Definition", "Appendix A:
    // Document Architecture" → "Document Architecture") — the agent may render
    // its own numbering, but the section name itself must appear.
    const core = label.replace(/^\d+\.\s*/, '').replace(/^appendix [a-z]:\s*/i, '');
    return lowerDoc.includes(core.toLowerCase());
  }
}
