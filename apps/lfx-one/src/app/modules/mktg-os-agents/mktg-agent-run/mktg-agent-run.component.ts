// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_DOCUMENT_TYPES, MKTG_INTAKE_FORMAT_ERRORS, MKTG_LIVING_DOCUMENT_ID } from '@lfx-one/shared/constants';
import {
  GithubRepoUrlError,
  MktgAgent,
  MktgAgentAccent,
  MktgAgentIntake,
  MktgAttachmentChip,
  MktgDependencyDocument,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgIntakeDocument,
  MktgIntakeDocumentEntry,
  MktgIntakeField,
  MktgIntakePrefillSource,
  MktgResolvedFieldGroup,
  MktgRunAnswer,
  MktgRunActivity,
  MktgRunPhase,
  MktgRunQuestionsPending,
  ProjectContext,
  User,
} from '@lfx-one/shared/interfaces';
import { mktgAgentDocumentName } from '@lfx-one/shared/utils';
import { githubRepoUrlValidator, sourceUrlValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { combineLatest, distinctUntilChanged, EMPTY, filter, map, Subscription, switchMap, take } from 'rxjs';

import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';

import { MktgIntakeDocumentsComponent } from '../mktg-intake-documents/mktg-intake-documents.component';
import { MktgRunActivityComponent } from '../mktg-run-activity/mktg-run-activity.component';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';

// Form-first agent run page (approved Marketing OS design): batch intake form
// → the document view, or the agent's research activity → the questions
// they could not settle, one at a time, each with a suggested answer to take
// or replace, answered on the same run →) document view. Results and feedback
// belong to Documents, never this intake. The page is driven by the intake registry
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
    TextareaComponent,
    MessageComponent,
    MktgIntakeDocumentsComponent,
    MktgRunActivityComponent,
    MktgRunQuestionsComponent,
  ],
  templateUrl: './mktg-agent-run.component.html',
})
export class MktgAgentRunComponent {
  // === Injections ===
  private readonly answerMemory = inject(MktgAnswerMemoryService);
  private readonly dependencyService = inject(MktgDependencyService);
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
  /** Intake dependency resolution and navigation handoff, cancelled when the active context changes. */
  private generationSub: Subscription | null = null;
  /** The existing-documents section, when the intake has one and the form is on screen: its file reads are cancelled with the generation. */
  private readonly documentsSection = viewChild(MktgIntakeDocumentsComponent);
  /** The generate request of the run in flight — what an answers round continues. */
  private activeRequest: MktgGenerateRequest | null = null;

  // === Catalog lookups (route param is stable for the component's lifetime) ===
  protected readonly agent: MktgAgent | null = this.resolveAgent();
  protected readonly intake: MktgAgentIntake | null = this.agent ? (MKTG_AGENT_INTAKES[this.agent.id] ?? null) : null;
  /** Catalog dependency ids of this agent (dec-agent-dependency-gating); empty for independent agents. */
  private readonly dependencyIds: string[] = this.agent?.dependsOn ?? [];
  /**
   * Every sibling agent whose stored output this run may submit: the hard
   * dependencies PLUS the intake's optional attachments. Resolution covers
   * both, gating covers only `dependencyIds` — an optional attachment that
   * resolves to nothing is submitted as nothing, never as a blocked run.
   */
  private readonly attachmentSourceIds: string[] = [
    ...new Set([...(this.agent?.dependsOn ?? []), ...(this.intake?.attachments ?? []).map((attachment) => attachment.sourceAgentId)]),
  ];

  // === Constants ===

  // === Forms ===
  protected readonly intakeForm: FormGroup<Record<string, FormControl<string>>> = this.buildIntakeForm();

  // === Signals ===
  protected readonly phase = signal<MktgRunPhase>('form');
  protected readonly errorText = signal('');
  /** Field keys pre-filled from LFX data this session — the raw record behind the "From LFX" chips. */
  private readonly fromLfxApplied = signal<Record<string, boolean>>({});
  /**
   * Field keys whose LFX prefill source resolved WITHOUT a value. Tracked
   * separately from fromLfxApplied (which only records that a prefill was
   * APPLIED to an empty control) so the "not set on your LFX project" hint
   * reflects what LFX actually has — never restored answers or early typing.
   */
  protected readonly lfxMissing = signal<Record<string, boolean>>({});
  /**
   * Field keys filled from an answer the user gave ANOTHER agent on this
   * project, mapped to the chip label naming that agent's document ("From your
   * Brand Kit run"). Separate from {@link fromLfxApplied} on purpose: a reused
   * answer is not something LFX knows, and labelling it "From LFX" would
   * misstate where the value came from.
   */
  private readonly fromPriorRunApplied = signal<Record<string, string>>({});
  /**
   * Field keys filled from the answer memory at all — a superset of
   * {@link fromPriorRunApplied}, which covers only the fills that earn a chip.
   * The agent's OWN remembered answers fill without a chip, and the
   * "not set on your LFX project" hint has to stand down for those too.
   */
  private readonly filledFromMemoryApplied = signal<Record<string, boolean>>({});
  /**
   * The exact (trimmed) value each prefill wrote into its control. Provenance
   * is a claim about the value ON SCREEN, not about the session: once the user
   * edits or clears a prefilled answer, "From LFX" / "From your Brand Kit run"
   * describes nothing that is there, and the hint those fills suppress becomes
   * the truth again. This is what {@link prefillIntact} compares against.
   */
  private readonly prefillAppliedValues = signal<Record<string, string>>({});
  /**
   * Resolved stored output per dependency agent id for the active project
   * (dec-agent-dependency-gating): server-persisted preferred, browser-stored
   * run fallback. `null` means resolution is still in flight (or hasn't
   * started); submission stays disabled until every dependency resolves, so a
   * run can never be submitted without its attachments.
   */
  protected readonly dependencyDocs = signal<Record<string, MktgDependencyDocument | null> | null>(null);
  /**
   * The existing documents on the form (intakes with a documents section),
   * already read to text by the BFF. Kept for edit-inputs resubmits; not
   * stored with the run, since file texts are document-sized.
   */
  protected readonly documents = signal<MktgIntakeDocumentEntry[]>([]);
  /** True while a document is still being read — submission waits for it. */
  protected readonly documentsBusy = signal(false);
  /** The questions turn waiting for answers, while the page is on the questions step. */
  protected readonly questionsPending = signal<MktgRunQuestionsPending | null>(null);
  /** The agent's activity so far (intakes with a live feed), as the result endpoint last reported it. */
  protected readonly activity = signal<MktgRunActivity[]>([]);
  /** Epoch ms the current stretch of the run started — the feed's timer. */
  protected readonly activityStartedAt = signal(Date.now());
  /** True once the answers went back: the run is writing, not researching. */
  protected readonly writingStretch = signal(false);
  /** The answers last sent, by key — they come back on the questions step if sending failed. */
  protected readonly lastAnswers = signal<Record<string, string>>({});
  /** True while the answers are on their way to the agent. */
  protected readonly answersSending = signal(false);

  // === Computed ===
  private readonly intakeValid = toSignal(this.intakeForm.statusChanges.pipe(map((status) => status === 'VALID')), { initialValue: this.intakeForm.valid });
  private readonly intakeValue = toSignal(this.intakeForm.valueChanges, { initialValue: this.intakeForm.getRawValue() });

  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name || 'Your Project');
  protected readonly formTitle = computed(() => `${this.intake?.formTitleAction} the ${this.projectName()} ${this.intake?.documentName}`);
  protected readonly submitLabel = computed(() => `Generate ${this.intake?.documentName}`);
  protected readonly submitDisabled = computed(
    () => !this.intakeValid() || this.phase() === 'running' || this.documentsBusy() || !this.dependenciesSatisfied()
  );
  /** Field labels as shown: the registered question per field key. */
  protected readonly fieldLabels: Record<string, string> = Object.fromEntries((this.intake?.fields ?? []).map((field) => [field.key, field.question]));
  /** The questions the agent is waiting on, for the stepper. */
  protected readonly pendingQuestions = computed(() => this.questionsPending()?.questions ?? []);
  /** The feed's header line. */
  protected readonly activityTitle = computed(() =>
    this.writingStretch() ? `Writing your ${this.intake?.documentName ?? 'document'}…` : `Researching ${this.projectName()}…`
  );
  /**
   * Non-interactive "Using <project>'s <document> (vN)" chips for the
   * intake's auto-attached dependency documents (dec-agent-dependency-gating)
   * — there is no choice UI; the stored document is always what is submitted.
   */
  protected readonly attachmentChips: Signal<MktgAttachmentChip[]> = this.initAttachmentChips();
  /**
   * Honest note shown when a dependency has no stored output for the active
   * project (deep-link case — the marketplace card is disabled then). Empty
   * while dependency resolution is still in flight and when all are met.
   */
  protected readonly missingDependencyNote = computed(() => {
    const names = this.missingDependencyNames();
    if (names.length === 0) {
      return '';
    }
    return `This agent builds on the project’s ${names.join(' and ')} — generate ${names.length > 1 ? 'them' : 'it'} from the marketplace first.`;
  });
  /**
   * Blocking format error per field key for the value currently typed — e.g. a
   * `github_url` that names an account rather than a repository. The
   * control carries the validator, so this signal is only the MESSAGE:
   * submission is already blocked by the form's own validity. The user is told
   * which mistake they made, at the moment they make it, instead of
   * discovering it minutes later as an unexplained thin document.
   */
  protected readonly fieldFormatErrors: Signal<Record<string, string>> = this.initFieldFormatErrors();
  /**
   * Prefilled keys whose control STILL holds the value the prefill wrote.
   * Every provenance claim is gated on this, so clearing a reused repository
   * URL drops its chip instead of captioning an empty box, and editing an LFX
   * value stops it reading as LFX's.
   */
  private readonly prefillIntact: Signal<Record<string, boolean>> = computed(() => {
    // Depend on the form's value so this follows every keystroke.
    this.intakeValue();
    const applied = this.prefillAppliedValues();
    return Object.fromEntries(Object.entries(applied).map(([key, value]) => [key, (this.intakeForm.controls[key]?.value ?? '').trim() === value]));
  });
  /** "From LFX" chips — only for the fields still showing what LFX supplied. */
  protected readonly fromLfx: Signal<Record<string, boolean>> = computed(() => this.gateOnIntactPrefill(this.fromLfxApplied()));
  /** "From your <document> run" chips — likewise dropped the moment the reused value is edited away. */
  protected readonly fromPriorRun: Signal<Record<string, string>> = computed(() => this.gateOnIntactPrefill(this.fromPriorRunApplied()));
  /**
   * Field keys that should show the "not set on your LFX project" hint: the
   * LFX source came back empty AND nothing else filled the control. A field
   * filled from the answer memory already holds a value the user gave, so
   * repeating the LFX-is-empty hint next to it is noise — or, for the
   * agent's own remembered answers, which carry no chip, an instruction to
   * supply what the form has already supplied. Once that fill is edited away
   * the field is empty-or-the-user's again and the hint is due back.
   */
  protected readonly missingPrefillHintKeys: Signal<Record<string, boolean>> = computed(() => {
    const missing = this.lfxMissing();
    const reused = this.gateOnIntactPrefill(this.filledFromMemoryApplied());
    return Object.fromEntries(Object.entries(missing).map(([key, isMissing]) => [key, isMissing && !reused[key]]));
  });

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
  // Chip presentation per attachment state. Kept as a class field (not
  // module-level) with literal class names so Tailwind's content scan
  // (./src/**/*.ts) generates them. An absent optional document is neutral,
  // not an error: the run proceeds without it.
  private readonly attachmentChipStyle: Record<'present' | 'absent', { chipClass: string; iconClass: string }> = {
    present: { chipClass: 'border-blue-200 bg-blue-50 text-blue-700', iconClass: 'fa-light fa-paperclip' },
    absent: { chipClass: 'border-gray-200 bg-gray-50 text-gray-600', iconClass: 'fa-light fa-circle-info' },
  };

  // The agent is fixed for the component's lifetime (route param), so its
  // presentation derives once here — templates bind properties, never call
  // methods (docs/reviews/frontend-checklist.md §4).
  protected readonly agentIconClass: string = this.accentIcon[this.agent?.accent ?? 'gray'];
  protected readonly agentTagline: string = this.agent?.tags.join(' · ') ?? '';
  /** The intake's titled field groups with their fields resolved, or empty for a flat form. */
  protected readonly fieldGroups: MktgResolvedFieldGroup[] = this.initFieldGroups();
  /** The Documents area type this agent's output is stored as, when it has one. */
  protected readonly documentsAgentKey: string | null = MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === this.agent?.id)?.agentKey ?? null;

  public constructor() {
    // Unknown, coming-soon, or intake-less agents have no run page — back to the grid.
    if (!this.agent || this.agent.status !== 'active' || !this.intake) {
      this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
      return;
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
            // switchMap drops stale in-flight lookups on project change. The
            // dependency resolution rides the same stream so the attachment
            // chips / gating always reflect the ACTIVE project's stored
            // documents (dec-agent-dependency-gating).
            return combineLatest([
              this.projectService.getProject(context.slug, false),
              this.dependencyService.resolveDependencies(context.uid, this.attachmentSourceIds),
            ]).pipe(map(([project, dependencies]) => ({ context, project, dependencies })));
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(({ context, project, dependencies }) => {
          this.dependencyDocs.set(dependencies);
          if (project) {
            this.applyPrefill('repository-url', project.repository_url);
            this.applyPrefill('project-description', project.description);
          }
          // STRICTLY after the LFX prefill: prior answers fill only what LFX
          // had nothing for (and a failed project lookup is "nothing" too).
          // Order is the precedence — LFX project data > an answer given to
          // another agent > empty.
          this.applyRememberedAnswers(context.uid);
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

  /** Sends answers on the same session; once accepted, the document view takes over the result poll. */
  protected onAnswerQuestions(answers: MktgRunAnswer[]): void {
    const pending = this.questionsPending();
    const request = this.activeRequest;
    if (!pending || !request || this.answersSending()) {
      return;
    }
    this.lastAnswers.set(Object.fromEntries(answers.map((answer) => [answer.key, answer.text])));
    this.errorText.set('');
    this.answersSending.set(true);
    this.writingStretch.set(true);
    this.activityStartedAt.set(Date.now());
    this.phase.set('running');
    this.generationSub?.unsubscribe();
    this.generationSub = this.runService
      .answerQuestions(request, pending, answers)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => {
          this.answersSending.set(false);
          if (progress.type === 'submitted') {
            const generation = this.runService.prepareGeneration({ ...request, answersRound: { pending, answers, submitted: true } });
            this.openDocument(generation);
            return;
          }
          this.onProgress(progress, request.projectUid);
        },
        error: () => {
          // The answers come back on the questions step, as given: not square one.
          this.answersSending.set(false);
          this.writingStretch.set(false);
          this.errorText.set('The agent could not take your answers. They are kept — try again.');
          this.phase.set('questions');
        },
      });
  }

  private initAttachmentChips(): Signal<MktgAttachmentChip[]> {
    return computed(() => {
      const docs = this.dependencyDocs();
      if (!docs) {
        return [];
      }
      const chips: MktgAttachmentChip[] = [];
      for (const attachment of this.intake?.attachments ?? []) {
        const doc = docs[attachment.sourceAgentId];
        if (doc) {
          chips.push({
            key: attachment.sourceAgentId,
            label: `Using ${this.projectName()}’s ${attachment.documentName} (v${doc.version})`,
            ...this.attachmentChipStyle.present,
          });
          continue;
        }
        // A missing REQUIRED attachment is the gate's business — the blocking
        // note already names it, and a second chip saying the same thing would
        // read as an alternative outcome rather than a stop. A missing
        // OPTIONAL one has no other surface, and it changes the document the
        // user is about to get, so it is stated here instead of silently
        // dropped.
        if (attachment.optional) {
          chips.push({
            key: attachment.sourceAgentId,
            label: `No ${attachment.documentName} stored for ${this.projectName()} — the agent works without it`,
            ...this.attachmentChipStyle.absent,
          });
        }
      }
      return chips;
    });
  }

  private initFieldGroups(): MktgResolvedFieldGroup[] {
    return (this.intake?.fieldGroups ?? []).map((group) => ({
      id: group.id,
      title: group.title,
      hint: group.hint ?? '',
      footnote: group.footnote ?? '',
      fields: group.fieldKeys.map((key) => this.intake?.fields.find((field) => field.key === key)).filter((field): field is MktgIntakeField => !!field),
    }));
  }

  private initFieldFormatErrors(): Signal<Record<string, string>> {
    return computed(() => {
      // Depend on the form's value so the message follows every keystroke.
      // Angular re-runs the validators BEFORE valueChanges emits, so the
      // control's errors are already current when this recomputes.
      this.intakeValue();
      const messages: Record<string, string> = {};
      for (const field of this.intake?.fields ?? []) {
        const errors = this.intakeForm.controls[field.key]?.errors;
        const error = (errors?.['githubRepoUrl'] ?? errors?.['sourceUrl']) as GithubRepoUrlError | undefined;
        const message = field.format && error ? MKTG_INTAKE_FORMAT_ERRORS[field.format][error.reason] : undefined;
        if (message) {
          messages[field.key] = message;
        }
      }
      return messages;
    });
  }

  // === Private helpers ===
  private resolveAgent(): MktgAgent | null {
    const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';
    return MKTG_AGENTS.find((candidate) => candidate.id === agentId) ?? null;
  }

  private buildIntakeForm(): FormGroup<Record<string, FormControl<string>>> {
    const controls: Record<string, FormControl<string>> = {};
    for (const field of this.intake?.fields ?? []) {
      // Optional fields never carry the required validator; a format rule
      // applies either way — an answer that IS given has to be usable.
      const validators = field.optional ? [] : [trimmedRequired()];
      if (field.format === 'github-repo-url') {
        validators.push(githubRepoUrlValidator());
      } else if (field.format === 'github-url') {
        // The Brand Kit's rule: a GitHub organization URL is a usable answer;
        // only a value that is not a GitHub URL at all is refused.
        validators.push(githubRepoUrlValidator({ acceptOwner: true }));
      } else if (field.format === 'source-url') {
        // A page the agent fetches itself: an https:// link, or the agent's "none".
        validators.push(sourceUrlValidator());
      } else if (field.format === 'source-url-list') {
        // Several such links, one per line.
        validators.push(sourceUrlValidator({ list: true }));
      }
      controls[field.key] = new FormControl('', { nonNullable: true, validators });
    }
    return new FormGroup(controls);
  }

  /** Assembles the submitted answers from the form: blank optional fields are omitted. */
  private buildAnswers(): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const field of this.intake?.fields ?? []) {
      const value = this.intakeForm.controls[field.key].value.trim();
      if (field.optional && !value) {
        continue;
      }
      answers[field.key] = value;
    }
    return answers;
  }

  /**
   * Every intake field with its trimmed value, BLANKS INCLUDED — the answer
   * memory needs the full submitted state to erase a field the user cleared,
   * which the submit payload (`buildAnswers`) deliberately omits. Without it
   * the memory would keep re-offering an optional answer the user removed.
   */
  private buildIntakeState(): Record<string, string> {
    const state: Record<string, string> = {};
    for (const field of this.intake?.fields ?? []) {
      state[field.key] = this.intakeForm.controls[field.key].value.trim();
    }
    return state;
  }

  /** The form's existing documents as the generate request takes them: a link by its URL (the agent reads it), a file by its text. */
  private submittedDocuments(): MktgIntakeDocument[] {
    return this.documents().map((document): MktgIntakeDocument => {
      if (document.kind === 'link') {
        return { kind: 'link', title: document.title, url: document.url };
      }
      return { kind: 'file', title: document.title, text: document.text };
    });
  }

  /**
   * Whether every catalog dependency of this agent has resolved stored output
   * for the active project. Fail-closed while resolution is in flight (the
   * record is null) — a run must never submit without its attachments.
   */
  private dependenciesSatisfied(): boolean {
    if (this.dependencyIds.length === 0) {
      return true;
    }
    const docs = this.dependencyDocs();
    if (!docs) {
      return false;
    }
    return this.dependencyIds.every((agentId) => !!docs[agentId]);
  }

  /** Human names of the unresolved dependencies, once resolution has completed. */
  private missingDependencyNames(): string[] {
    const docs = this.dependencyDocs();
    if (!docs) {
      return [];
    }
    return this.dependencyIds.filter((agentId) => !docs[agentId]).map((agentId) => mktgAgentDocumentName(agentId));
  }

  /**
   * Overlays the intake's auto-attached dependency documents onto the
   * submitted answers (dec-agent-dependency-gating): the stored document is
   * ALWAYS what is submitted — there is no user-facing choice. Null when an
   * attachment's document is missing (submission must abort).
   */
  private applyAttachments(answers: Record<string, string>, docs: Record<string, MktgDependencyDocument | null>): Record<string, string> | null {
    const attached = { ...answers };
    for (const attachment of this.intake?.attachments ?? []) {
      const doc = docs[attachment.sourceAgentId];
      if (!doc?.document) {
        // Optional attachments (the ICP's Brand Kit / Message Foundation) are
        // simply omitted — the agent's own contract makes them optional and
        // it has a documented branch for their absence. Only a REQUIRED
        // attachment aborts the submission.
        if (attachment.optional) {
          continue;
        }
        return null;
      }
      attached[attachment.answerKey] = doc.document;
    }
    return attached;
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
    // The answers POST was cut with it: its callbacks will never clear the flag, so the next questions step must not inherit it.
    this.answersSending.set(false);
    this.phase.set('form');
    this.errorText.set('');
    this.fromLfxApplied.set({});
    this.lfxMissing.set({});
    this.fromPriorRunApplied.set({});
    this.filledFromMemoryApplied.set({});
    this.prefillAppliedValues.set({});
    // A file still being read for the previous context must not land in this one: the section stays mounted, so its reads are cancelled here.
    this.documentsSection()?.cancelReads();
    this.documents.set([]);
    this.activeRequest = null;
    this.clearQuestions();
    this.intakeForm.reset();
    // Dependency documents are per-project — back to "resolving" until the
    // constructor stream's resolution for the NEW context lands (fail-closed:
    // submission stays disabled meanwhile).
    this.dependencyDocs.set(null);

    const stored = this.runService.loadRun(context.uid, this.agent.id);
    if (stored) {
      // patchValue ignores keys without a control — answers persisted by the
      // retired Brand Kit gate UI (e.g. brand_kit_markdown) restore cleanly.
      this.intakeForm.patchValue(stored.answers);
    }
    const questionsId = this.route.snapshot.queryParamMap?.get('questions');
    const prepared = questionsId ? this.runService.takePreparedGeneration(questionsId, context.uid, this.agent.id) : null;
    if (prepared?.pendingQuestions) {
      this.activeRequest = prepared;
      this.showQuestions(prepared.pendingQuestions);
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
        this.recordPrefill(field.key, trimmedValue);
        this.fromLfxApplied.update((flags) => ({ ...flags, [field.key]: true }));
      }
    }
  }

  /**
   * Fills the still-empty controls from answers the user already gave ANOTHER
   * agent on this project, and labels each with where it came from.
   *
   * This is the "stop re-asking me" half of the prefill contract: LFX only
   * knows what LFX stores, so a project with no `repository_url` on record
   * left this form asking for a repo URL the user had typed into the Brand Kit
   * intake minutes earlier. Precedence is enforced by ORDER and by the
   * empty-control check — LFX wins, a restored answer wins, and this fills
   * only what is left.
   *
   * The agent's OWN remembered answers fill too, but carry no provenance chip:
   * "From your Message Foundation run" on the Message Foundation form would be
   * nonsense, while skipping them outright re-asks the user from day two
   * onward — stored runs are pruned at `MKTG_RUN_STORAGE_TTL_MS` (24h, they
   * hold a session capability token) while the answer memory lives for
   * `MKTG_ANSWER_MEMORY_TTL_MS` (30 days), so after the run expires this is
   * the only surviving copy. The empty-control check above already decides
   * whether anything needs filling.
   */
  private applyRememberedAnswers(projectUid: string): void {
    if (!this.intake) {
      return;
    }
    const remembered = this.answerMemory.load(projectUid);
    for (const field of this.intake.fields) {
      const entry = remembered[field.key];
      if (!entry) {
        continue;
      }
      const control = this.intakeForm.controls[field.key];
      if (!control || control.value.trim()) {
        continue;
      }
      control.setValue(entry.value);
      this.recordPrefill(field.key, entry.value.trim());
      this.filledFromMemoryApplied.update((flags) => ({ ...flags, [field.key]: true }));
      if (entry.agentId !== this.agent?.id) {
        this.fromPriorRunApplied.update((labels) => ({ ...labels, [field.key]: `From your ${mktgAgentDocumentName(entry.agentId)} run` }));
      }
    }
  }

  /** Remembers what a prefill wrote, so the chips it earns can be withdrawn when the user replaces it. */
  private recordPrefill(key: string, value: string): void {
    this.prefillAppliedValues.update((values) => ({ ...values, [key]: value }));
  }

  /** Keeps only the provenance entries whose field still holds the prefilled value. */
  private gateOnIntactPrefill<T>(applied: Record<string, T>): Record<string, T> {
    const intact = this.prefillIntact();
    return Object.fromEntries(Object.entries(applied).filter(([key]) => intact[key]));
  }

  private startGeneration(): void {
    const projectUid = this.projectContext.activeContextUid();
    const agent = this.agent;
    const intake = this.intake;
    if (!agent || !intake) {
      return;
    }
    if (!projectUid) {
      this.errorText.set('No active project — select a project before running this agent.');
      return;
    }
    const answers = this.buildAnswers();
    // Remember what the user typed, keyed by intake field key, so the NEXT
    // agent's form on this project can offer it back instead of asking again.
    // Only the intake's own answers — the auto-attached dependency documents
    // added below are document-sized and resolved from their own source. The
    // FULL state goes in, not the payload: a cleared optional field has to
    // erase its remembered answer rather than leave the old one to be
    // re-offered once this run's 24h record expires.
    this.answerMemory.remember(projectUid, agent.id, this.buildIntakeState());

    this.errorText.set('');
    this.clearQuestions();
    this.activity.set([]);
    this.activityStartedAt.set(Date.now());
    this.writingStretch.set(false);
    this.lastAnswers.set({});
    this.phase.set('running');

    // The prior draft's version is NOT sent — the run service derives it from
    // the stored run so the follow-up's version directive always matches the
    // version its result poll will accept. Dependency documents are re-resolved
    // AT SUBMIT TIME (server-persisted preferred, browser fallback) so the
    // attached document is always the current stored one, then overlaid onto
    // the answers (dec-agent-dependency-gating).
    this.generationSub?.unsubscribe();
    this.generationSub = this.dependencyService
      .resolveDependencies(projectUid, this.attachmentSourceIds)
      .pipe(
        switchMap((docs) => {
          this.dependencyDocs.set(docs);
          const attached = this.applyAttachments(answers, docs);
          if (!attached) {
            // The stored dependency disappeared between page load and submit —
            // surface the honest gate note instead of submitting an invalid run.
            this.errorText.set(this.missingDependencyNote() || 'A required dependency document is no longer available for this project.');
            this.phase.set('form');
            return EMPTY;
          }
          const request: MktgGenerateRequest = {
            agentId: agent.id,
            projectUid,
            intake,
            answers: attached,
            startedAt: new Date().toISOString(),
            documents: this.submittedDocuments(),
          };
          this.activeRequest = request;
          if (!intake.endpoints.answers) {
            this.openDocument(this.runService.prepareGeneration(request));
            return EMPTY;
          }
          // Research and questions keep the merged intake flow; once answers
          // are accepted, the document view owns the remaining work.
          return this.runService.generate(request);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (progress) => this.onProgress(progress, projectUid),
        error: () => {
          this.errorText.set('The agent could not complete this run. Your answers are kept — try again.');
          this.phase.set('form');
        },
      });
  }

  /** One handler for the generate stream and the answers stream: they emit the same events. */
  private onProgress(progress: MktgGenerateProgress, projectUid: string): void {
    if (progress.type === 'submitted') {
      return;
    }
    if (progress.type === 'activity') {
      // The whole feed so far, every time it changed.
      this.activity.set(progress.activity);
      return;
    }
    if (progress.type === 'questions') {
      // The agent read the sources and wants the gaps answered before it
      // writes: a second step on the same run, pre-filled with its
      // suggestions. The stream is over; the answers continue the session.
      this.showQuestions(progress.pending);
      return;
    }
    if (progress.type === 'persisted') {
      // The server copy landed on a retry after the document was already
      // announced. Dependency resolution prefers the server copy, so
      // without this second announcement consumers would stay attached
      // to the PREVIOUS server version until a page reload.
      this.dependencyService.notifyDocumentsChanged(projectUid);
      return;
    }
    if (progress.type === 'failed') {
      this.errorText.set(progress.failureText || 'The agent finished without producing a document. Your answers are kept — try again.');
      this.phase.set('form');
      return;
    }
    this.dependencyService.notifyDocumentsChanged(projectUid);
    this.openDocument(undefined, progress.location?.revisionId);
  }

  /** Navigate without ever serializing answers, documents or session capabilities. */
  private openDocument(generation?: string, revision?: string): void {
    if (!this.documentsAgentKey) {
      this.phase.set('form');
      this.errorText.set('This agent does not support document-view generation yet.');
      return;
    }
    this.router
      .navigate(['..', 'documents', this.documentsAgentKey, MKTG_LIVING_DOCUMENT_ID], {
        relativeTo: this.route,
        queryParams: { generation: generation ?? null, revision: revision ?? null, questions: null },
        queryParamsHandling: 'merge',
      })
      .then((opened) => {
        if (!opened) {
          this.phase.set(this.questionsPending() ? 'questions' : 'form');
          this.errorText.set('The document view could not be opened. Your answers are kept — try again.');
        }
      })
      .catch(() => {
        this.phase.set(this.questionsPending() ? 'questions' : 'form');
        this.errorText.set('The document view could not be opened. Your answers are kept — try again.');
      });
  }

  /** Puts the agent's questions on the page; the stepper asks them one at a time. */
  private showQuestions(pending: MktgRunQuestionsPending): void {
    this.lastAnswers.set({});
    this.questionsPending.set(pending);
    this.phase.set('questions');
  }

  private clearQuestions(): void {
    this.questionsPending.set(null);
  }
}
