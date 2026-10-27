// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  LINKEDIN_POST_INTAKE,
  MKTG_AGENT_INTAKES,
  MKTG_AGENTS,
  MKTG_DOCUMENT_TYPES,
  MKTG_INTAKE_FORMAT_ERRORS,
  MKTG_INTAKE_ONE_LINE_ERROR,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_RUN_NEW_MODE,
  MKTG_RUN_FAILURE_REASON,
} from '@lfx-one/shared/constants';
import {
  GithubRepoUrlError,
  MktgAgent,
  MktgAgentAccent,
  MktgAgentIntake,
  MktgLastIntake,
  MktgRunSourceField,
  MktgAttachmentChip,
  MktgDependencyDocument,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgPendingGeneration,
  MktgRunNavigation,
  MktgIntakeAttachment,
  MktgIntakeDocument,
  MktgIntakeDocumentEntry,
  MktgIntakeField,
  MktgIntakeLogoFile,
  MktgIntakeLogoFileEntry,
  MktgIntakePrefillSource,
  MktgMissingDependencyLink,
  MktgResolvedFieldGroup,
  MktgRunAnswer,
  MktgRunActivity,
  MktgRunPhase,
  MktgRunQuestionsPending,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { mktgKitCrumbsFor, mktgKitRootPath, mktgAgentDocumentName, mktgJsonAttachmentUsable, mktgSentenceCaseLabel } from '@lfx-one/shared/utils';
import { githubRepoUrlValidator, httpsUrlValidator, oneLineValidator, sourceUrlValidator, trimmedRequired } from '@lfx-one/shared/validators';

import type { FileSelectEvent } from 'primeng/fileupload';
import { catchError, combineLatest, distinctUntilChanged, EMPTY, map, Observable, of, Subscription, switchMap, take } from 'rxjs';

import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';

import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import { LinkedinPostRunComponent } from '../components/linkedin-post-run/linkedin-post-run.component';
import { MktgIntakeDocumentsComponent } from '../mktg-intake-documents/mktg-intake-documents.component';
import { MktgIntakeLogoFilesComponent } from '../mktg-intake-logo-files/mktg-intake-logo-files.component';
import { MktgRunActivityComponent } from '../mktg-run-activity/mktg-run-activity.component';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';

// Catalog-driven intake, research/writing feed and questions. Accepted answers
// transfer this owned attempt at their ACK. Without an agent writing marker,
// only checking/finalize (or an earlier ready result) safely transfers a no-
// questions run. Direct no-answers intakes still open before their first POST.
// Failed navigation retries only navigation, never generation.
// Asset rendering, revisions and exports belong to the one document view.
@Component({
  selector: 'lfx-mktg-agent-run',
  imports: [
    LinkedinPostRunComponent,
    NgClass,
    MktgBreadcrumbComponent,
    NgTemplateOutlet,
    ReactiveFormsModule,
    ButtonComponent,
    FileUploadComponent,
    InputTextComponent,
    TextareaComponent,
    MessageComponent,
    MktgIntakeDocumentsComponent,
    MktgIntakeLogoFilesComponent,
    MktgRunActivityComponent,
    MktgRunQuestionsComponent,
  ],
  templateUrl: './mktg-agent-run.component.html',
})
export class MktgAgentRunComponent {
  // === Injections ===
  private readonly answerMemory = inject(MktgAnswerMemoryService);
  private readonly dependencyService = inject(MktgDependencyService);
  private readonly documentStore = inject(MktgDocumentStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runService = inject(MktgAgentRunService);
  private readonly runAttempts = inject(MktgRunAttemptService);
  private readonly userService = inject(UserService);

  // toObservable needs the injection context — created here, subscribed (browser
  // only) in the constructor.
  private readonly activeContext$ = toObservable(this.projectContext.activeContext);
  private readonly effectiveUser$ = toObservable(this.userService.user);
  private readonly freshMode$ = this.route.queryParamMap.pipe(
    map((params) => params.get('mode') === MKTG_RUN_NEW_MODE),
    distinctUntilChanged()
  );
  /** Per-visit Sources/submission state, independent of the consumed entry URL. */
  protected readonly freshMode = signal(this.route.snapshot.queryParamMap.get('mode') === MKTG_RUN_NEW_MODE);
  private consumedFreshProject: string | null = null;
  private consumedFreshSubject: string | null = null;
  /** In-flight generation — cancelled when the active project changes so a run can never land on another project. */
  private generationSub: Subscription | null = null;
  /**
   * In-flight "Try again" dependency check. Only one may run, and it is
   * cancelled when the active project changes: a late result (or a late
   * failure, which sets `dependencyCheckFailed`) must never overwrite the
   * newer check's record or land on another project.
   */
  private dependencyRetrySub: Subscription | null = null;
  /** The existing-documents section, when the intake has one and the form is on screen: its file reads are cancelled with the generation. */
  private readonly documentsSection = viewChild(MktgIntakeDocumentsComponent);
  /** The logo-files section, when the intake has one and the form is on screen: its file reads are cancelled the same way. */
  private readonly logoFilesSection = viewChild(MktgIntakeLogoFilesComponent);
  /** The generate request of the run in flight — what an answers round continues. */
  private activeRequest: MktgGenerateRequest | null = null;

  // === Catalog lookups (route param is stable for the component's lifetime) ===
  protected readonly agent: MktgAgent | null = this.resolveAgent();
  protected readonly intake: MktgAgentIntake | null = this.agent ? (MKTG_AGENT_INTAKES[this.agent.id] ?? null) : null;
  protected readonly linkedinIntake = LINKEDIN_POST_INTAKE;
  protected readonly assetName =
    MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === this.agent?.id)?.itemLabel ?? this.intake?.documentName ?? 'Document';
  protected readonly sourcesHint = this.intakeSourcesHint();
  /**
   * What gates this run (dec-agent-dependency-gating): the catalog
   * dependency ids PLUS the intake's REQUIRED attachments (the Brand Kit's
   * messaging framework). Empty for independent agents.
   */
  private readonly dependencyIds: string[] = [
    ...new Set([
      ...(this.agent?.dependsOn ?? []),
      ...(this.intake?.attachments ?? []).filter((attachment) => !attachment.optional).map((attachment) => attachment.sourceAgentId),
    ]),
  ];
  /**
   * Every sibling agent whose stored output this run may submit: the hard
   * dependencies PLUS the intake's attachments, optional ones included.
   * Resolution covers all, gating covers only `dependencyIds` — an optional
   * attachment that resolves to nothing is submitted as nothing, never as a
   * blocked run.
   */
  private readonly attachmentSourceIds: string[] = [
    ...new Set([...(this.agent?.dependsOn ?? []), ...(this.intake?.attachments ?? []).map((attachment) => attachment.sourceAgentId)]),
  ];
  /**
   * JSON attachment sources use the server sidecar read: the Brand Kit's
   * approved current framework, never a browser-stored run. A revision the
   * agent cannot read still counts as unmet, not as an attachment.
   */
  private readonly sidecarSourceIds: string[] = (this.intake?.attachments ?? [])
    .filter((attachment) => attachment.format === 'json')
    .map((attachment) => attachment.sourceAgentId);

  // === Forms ===
  protected readonly intakeForm: FormGroup<Record<string, FormControl<string>>> = this.buildIntakeForm();
  /**
   * One control per row of every `url-list` field, named by row id (no
   * intake has one at present). The rows are the editing surface only:
   * their non-blank values, joined by newlines, are written into the field's
   * own control in `intakeForm`, which keeps the validator, the answer
   * memory and the submitted answer exactly as a `source-url-list` textarea
   * would — so nothing downstream knows the field is a list of boxes.
   */
  protected readonly linkRowsForm = new FormGroup<Record<string, AbstractControl<string>>>({});

  // === Signals ===
  protected readonly phase = signal<MktgRunPhase>('form');
  private readonly hasVersion = signal(false);
  protected readonly sourcesEditing = signal(false);
  protected readonly sourcesLoading = signal(this.route.snapshot.queryParamMap.get('mode') === MKTG_RUN_NEW_MODE);
  protected readonly sourcesDenied = signal(false);
  protected readonly sourceNote = signal('');
  private readonly lastSourceValues = signal<Record<string, string>>({});
  private readonly lastSourceOrigins = signal<Record<string, string>>({});
  private readonly priorDocumentCount = signal(0);
  private readonly priorLogoCount = signal(0);
  protected readonly errorText = signal('');
  protected readonly runFailed = signal(false);
  protected readonly navigation = signal<MktgRunNavigation | null>(null);
  protected readonly navigating = signal(false);
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
   * True when the last dependency resolution FAILED (a 403, a 5xx, the
   * network) rather than found nothing: `dependencyDocs` stays null, submit
   * stays disabled, and the page says the check could not be made — never
   * "Approve a messaging framework first", which would read a failed read as
   * a measured absence. Try again re-resolves.
   */
  protected readonly dependencyCheckFailed = signal(false);
  /**
   * The existing documents on the form (intakes with a documents section),
   * already read to text by the BFF. Kept for edit-inputs resubmits; not
   * stored with the run, since file texts are document-sized.
   */
  protected readonly documents = signal<MktgIntakeDocumentEntry[]>([]);
  /** True while a document is still being read — submission waits for it. */
  protected readonly documentsBusy = signal(false);
  /**
   * The logo files on the form (intakes with a logo-files section), read in
   * the browser. Kept for edit-inputs resubmits; not stored with the run,
   * since the artwork is file-sized.
   */
  protected readonly logoFiles = signal<MktgIntakeLogoFileEntry[]>([]);
  /** True while a logo file is still being read — submission waits for it. */
  protected readonly logoFilesBusy = signal(false);
  /** The questions turn waiting for answers, while the page is on the questions step. */
  protected readonly questionsPending = signal<MktgRunQuestionsPending | null>(null);
  /** The agent's activity so far (intakes with a live feed), as the result endpoint last reported it. */
  protected readonly activity = signal<MktgRunActivity[]>([]);
  /** Epoch ms the current stretch of the run started — the feed's timer. */
  protected readonly activityStartedAt = signal(Date.now());
  /** True after accepted answers or a confirmed post-research handoff, never inferred from model calls. */
  protected readonly writingStretch = signal(false);
  private readonly recheckingAttempt = signal(false);
  /** The answers last sent, by key — they come back on the questions step if sending failed. */
  protected readonly lastAnswers = signal<Record<string, string>>({});
  /** True while the answers are on their way to the agent. */
  protected readonly answersSending = signal(false);
  /** The row ids of every `url-list` field, in display order, keyed by field key. */
  protected readonly linkRows = signal<Record<string, string[]>>({});
  /** Ever-increasing counter behind the row ids, so a removed row's id is never reused. */
  private linkRowSerial = 0;
  /** Never reuse a restored row ID: mounted tag controls are keyed by it. */
  private restoredDocumentSerial = 0;

  // === Computed ===
  private readonly intakeValid = toSignal(this.intakeForm.statusChanges.pipe(map((status) => status === 'VALID')), { initialValue: this.intakeForm.valid });
  private readonly intakeValue = toSignal(this.intakeForm.valueChanges, { initialValue: this.intakeForm.getRawValue() });

  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name || 'Your Project');
  protected readonly projectSlug = computed(() => this.projectContext.activeContext()?.slug ?? null);
  protected readonly crumbs = computed(() =>
    mktgKitCrumbsFor(this.agent?.id ?? '', this.projectName(), mktgKitRootPath(this.router.url), this.agent?.name ?? 'Agent')
  );
  protected readonly formTitle = computed(() => `${this.intake?.formTitleAction} the ${this.projectName()} ${this.intake?.documentName}`);
  protected readonly showIntakeForm = computed(() => !this.freshMode() || (!this.sourcesLoading() && !this.sourcesDenied() && this.sourcesEditing()));
  protected readonly submitLabel = computed(() => (this.hasVersion() ? 'Create a new version' : `Create ${mktgSentenceCaseLabel(this.assetName)}`));
  protected readonly submitReason = computed(() => {
    if (this.sourcesLoading()) return 'Wait for your sources to load.';
    if (this.sourcesDenied()) return this.sourceNote() || 'You need write access to create this document.';
    if (this.navigation()) return 'Open the accepted document before creating another version.';
    if (this.documentsBusy() || this.logoFilesBusy()) return 'Wait for the attached files to finish loading.';
    if (!this.dependenciesSatisfied()) return this.missingDependencyNote() || 'Wait while the required documents are checked.';
    if (this.freshMode() && (this.missingDocuments() || this.missingLogos())) return 'Re-attach the missing files, or choose to continue without them.';
    if (!this.intakeValid()) return 'Complete the required fields and correct any highlighted sources.';
    return '';
  });
  protected readonly missingDocuments = computed(() => Math.max(0, this.priorDocumentCount() - this.documents().length));
  protected readonly missingLogos = computed(() => Math.max(0, this.priorLogoCount() - this.logoFiles().length));
  protected readonly missingFiles = computed(() => this.missingDocuments() + this.missingLogos());
  protected readonly missingFilesNote = computed(() => {
    const count = this.missingFiles();
    return count === 1
      ? '1 file from last time is not kept here. Re-attach it, or carry on without it.'
      : `${count} files from last time are not kept here. Re-attach them, or carry on without them.`;
  });
  protected readonly sourceFields: Signal<MktgRunSourceField[]> = this.initSourceFields();
  protected readonly submitDisabled = computed(
    () =>
      !this.intakeValid() ||
      this.phase() === 'running' ||
      !!this.navigation() ||
      this.documentsBusy() ||
      this.logoFilesBusy() ||
      !this.dependenciesSatisfied() ||
      (this.freshMode() && (this.sourcesLoading() || this.sourcesDenied() || !!this.missingDocuments() || !!this.missingLogos()))
  );
  /** Field labels as shown: the registered question per field key. */
  protected readonly fieldLabels: Record<string, string> = Object.fromEntries((this.intake?.fields ?? []).map((field) => [field.key, field.question]));
  /** Whether each `url-list` field can take another row (under its `maxItems`). */
  protected readonly canAddLinkRow: Signal<Record<string, boolean>> = computed(() => {
    const rows = this.linkRows();
    return Object.fromEntries(
      (this.intake?.fields ?? [])
        .filter((field) => field.kind === 'url-list')
        .map((field) => [field.key, (rows[field.key]?.length ?? 0) < (field.maxItems ?? Number.POSITIVE_INFINITY)])
    );
  });
  /** The `accept` attribute of a field's own upload: the documents section's readable types. */
  protected readonly uploadAccept: string = (this.intake?.documents?.fileExtensions ?? []).join(',');
  /** What the asterisk means beside the submit button: the intake's own note, or the default for a question-style form. */
  protected readonly requiredNote: string = this.intake?.requiredNote ?? '* required — answers are open-ended, in your own words';
  /** The questions the agent is waiting on, for the stepper. */
  protected readonly pendingQuestions = computed(() => this.questionsPending()?.questions ?? []);
  /** The feed's header line. */
  protected readonly activityTitle = computed(() => (this.recheckingAttempt() ? 'Checking recorded run progress…' : this.activityTitleForStage()));
  /**
   * Non-interactive "Using <project>'s <document> (vN)" chips for the
   * intake's auto-attached dependency documents (dec-agent-dependency-gating)
   * — there is no choice UI; the stored document is always what is submitted.
   * The Brand Kit's `json` attachment names the approved current revision
   * and links to its page ("Uses the approved messaging framework · v3 · 16 Oct").
   */
  protected readonly attachmentChips: Signal<MktgAttachmentChip[]> = this.initAttachmentChips();
  /**
   * The required `json` attachment the project cannot satisfy, once
   * resolution has completed: no approved selection (absent framework or
   * stored but unapproved draft), or — `incomplete` —
   * an approved revision the agent can read nothing from (positioning and
   * tagline both still "tbd", a restored revision without its sidecar),
   * which the BFF validator would refuse with a 400 no retry could clear.
   * Null while resolving and when satisfied.
   */
  private readonly unmetRequiredAttachment: Signal<{ attachment: MktgIntakeAttachment; incomplete: boolean } | null> = computed(() => {
    const docs = this.dependencyDocs();
    if (!docs) {
      return null;
    }
    for (const attachment of this.intake?.attachments ?? []) {
      if (attachment.format !== 'json' || attachment.optional) {
        continue;
      }
      const doc = docs[attachment.sourceAgentId];
      if (!doc) {
        return { attachment, incomplete: false };
      }
      if (!mktgJsonAttachmentUsable(attachment, doc.sidecar)) {
        return { attachment, incomplete: true };
      }
    }
    return null;
  });
  /**
   * Honest note shown when a dependency has no stored output for the active
   * project (deep-link case — the marketplace card is disabled then), or
   * when a required attachment has no approved selection (the configured
   * approval-required message) or one the agent cannot read (the
   * attachment's `incompleteNote`), with the link below it. Empty while
   * dependency resolution is still in flight and when all are met.
   */
  protected readonly missingDependencyNote = computed(() => {
    if (this.dependencyCheckFailed()) {
      return `Could not check the project’s ${this.dependencyIds.map((agentId) => this.gateDocumentName(agentId)).join(' and ')} — try again.`;
    }
    const unmet = this.unmetRequiredAttachment();
    if (unmet?.incomplete) {
      return unmet.attachment.incompleteNote ?? `Finish the ${unmet.attachment.documentName.toLowerCase()} first.`;
    }
    if (unmet) {
      return unmet.attachment.missingNote ?? `Approve the ${unmet.attachment.documentName.toLowerCase()} in Documents first.`;
    }
    const names = this.missingDependencyNames();
    if (names.length === 0) {
      return '';
    }
    return `This agent builds on the project’s ${names.join(' and ')} — approve ${names.length > 1 ? 'them' : 'it'} in Documents first.`;
  });
  /** The link under the note: the page where the required document is made (the Messaging Framework page). */
  protected readonly missingDependencyLink: Signal<MktgMissingDependencyLink | null> = computed(() => {
    const unmet = this.unmetRequiredAttachment();
    return unmet ? { label: `Open the ${unmet.attachment.documentName} page`, agentId: unmet.attachment.sourceAgentId } : null;
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
  /** Outer intake/feed/questions gutters; asset layout belongs to the document route. */
  protected readonly pageClass: string = this.intake?.fullWidth ? 'w-full px-4 sm:px-6 lg:px-8 mt-3' : 'container mx-auto px-4 sm:px-6 lg:px-8 mt-3';
  /** The intake's titled field groups with their fields resolved, or empty for a flat form. */
  protected readonly fieldGroups: MktgResolvedFieldGroup[] = this.initFieldGroups();
  /** The groups shown before the documents section. */
  protected readonly leadingFieldGroups: MktgResolvedFieldGroup[] = this.fieldGroups.filter((group) => !group.afterDocuments);
  /** The groups shown after it (the FAQ's notes). */
  protected readonly trailingFieldGroups: MktgResolvedFieldGroup[] = this.fieldGroups.filter((group) => group.afterDocuments);

  public constructor() {
    // One empty row per list field from the start, so the form never shows a list with no box.
    this.seedLinkRows();
    // Unknown, coming-soon, or intake-less agents have no run page — back to the Kit.
    if (!this.agent || this.agent.status !== 'active' || !this.intake) {
      this.router.navigate(['..'], { relativeTo: this.route, queryParams: { mode: null }, queryParamsHandling: 'merge', replaceUrl: true });
      return;
    }
    if (this.intake.oneOffDocument) {
      return; // The dedicated surface owns profile, source intake and one-off output.
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
      combineLatest([this.activeContext$, this.effectiveUser$, this.freshMode$])
        .pipe(
          distinctUntilChanged(
            ([previousContext, previousUser, previousMode], [context, user, mode]) =>
              previousContext?.uid === context?.uid && previousUser?.sub === user?.sub && previousMode === mode
          ),
          switchMap(([context, user, fresh]) => {
            if (!fresh && context?.uid === this.consumedFreshProject && user?.sub === this.consumedFreshSubject) {
              // Our accepted-attempt URL replacement is not a new intake/context.
              this.consumedFreshProject = null;
              this.consumedFreshSubject = null;
              return EMPTY;
            }
            this.resetForContext(context, fresh);
            if (!context) return EMPTY;
            const history =
              fresh && user?.sub
                ? this.runService.lastIntake(context.uid, this.agent?.id ?? '').pipe(
                    catchError((error: unknown) => {
                      this.sourcesDenied.set(error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403));
                      this.sourceNote.set(
                        this.sourcesDenied()
                          ? 'You need write access to run this project’s agents.'
                          : 'Last run inputs could not be loaded. Available device inputs or suggested defaults are shown.'
                      );
                      return of(null);
                    })
                  )
                : of(null);
            if (fresh && !user?.sub) this.sourcesDenied.set(true);
            // getProject memoizes per slug and maps errors to null, and
            // switchMap drops stale in-flight lookups on project change. The
            // dependency resolution rides the same stream so the attachment
            // chips / gating always reflect the ACTIVE project's stored
            // documents (dec-agent-dependency-gating).
            return combineLatest([
              this.projectService.getProject(context.slug, false),
              this.resolveDependenciesForGate(context.uid),
              history,
              user?.sub ? this.readHasVersion(context.uid, fresh) : of(false),
            ]).pipe(map(([project, dependencies, lastIntake, versionExists]) => ({ context, project, dependencies, lastIntake, versionExists, fresh })));
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(({ context, project, dependencies, lastIntake, versionExists, fresh }) => {
          this.hasVersion.set(versionExists ?? !!lastIntake);
          this.dependencyDocs.set(dependencies);
          if (fresh) {
            this.sourcesLoading.set(false);
            if (this.sourcesDenied()) return;
            this.restoreFreshInputs(context.uid, lastIntake);
            this.applyPrefill('project-name', context.name);
          }
          if (project) {
            this.applyPrefill('repository-url', project.repository_url);
            this.applyPrefill('website-url', project.website_url);
            this.applyPrefill('project-description', project.description);
          }
          // STRICTLY after the LFX prefill: prior answers fill only what LFX
          // had nothing for (and a failed project lookup is "nothing" too).
          // Order is the precedence — LFX project data > an answer given to
          // another agent > empty.
          this.applyRememberedAnswers(context.uid);
          if (
            fresh &&
            !this.sourceNote() &&
            !Object.keys(this.lastSourceValues()).length &&
            !Object.keys(this.filledFromMemoryApplied()).length &&
            !this.priorDocumentCount() &&
            !this.priorLogoCount()
          ) {
            this.sourceNote.set('Suggested defaults — no previous run inputs are available.');
          }
          // A remembered list answer lands in the field's control; the rows follow it.
          this.seedLinkRows();
        });
    }
  }

  /** Navigation recovery retries only this saved destination, never Generate or the accepted answers POST. */
  protected onRetryHandoff(): void {
    const destination = this.navigation();
    if (!destination) return;
    if (destination.projectUid !== this.projectContext.activeContextUid() || !destination.subject || destination.subject !== this.userService.user()?.sub) {
      this.discardPendingNavigation();
      this.navigating.set(false);
      this.writingStretch.set(false);
      this.phase.set('form');
      this.errorText.set(
        destination.subject
          ? 'The project or identity changed. Review your intake and press Generate when you are ready.'
          : 'Sign in before opening this run. Your intake is kept.'
      );
      return;
    }
    if (this.navigating()) return;
    this.navigating.set(true);
    const current = () =>
      this.navigation() === destination &&
      destination.projectUid === this.projectContext.activeContextUid() &&
      destination.subject === this.userService.user()?.sub;
    void this.router
      .navigate(['..', 'documents', destination.agentKey, destination.documentId ?? MKTG_LIVING_DOCUMENT_ID], {
        relativeTo: this.route,
        queryParams: {
          generation: destination.generation ?? null,
          revision: destination.revisionId ?? null,
          run: destination.runId ?? null,
          questions: null,
          mode: null,
        },
        queryParamsHandling: 'merge',
      })
      .then((opened) => {
        if (!current()) {
          return;
        }
        this.navigating.set(false);
        if (opened) {
          this.navigation.set(null);
        } else {
          this.phase.set('form');
          this.errorText.set('The asset page could not be opened. Open asset retries navigation only; it does not start another run.');
        }
      })
      .catch(() => {
        if (!current()) {
          return;
        }
        this.navigating.set(false);
        this.phase.set('form');
        this.errorText.set('The asset page could not be opened. Open asset retries navigation only.');
      });
  }

  // === Protected methods ===
  /** The sibling agent's page — where the document this run needs is made (the Messaging Framework page). */
  protected onOpenAgent(agentId: string): void {
    this.router.navigate(['..', agentId], { relativeTo: this.route, queryParams: { mode: null }, queryParamsHandling: 'merge' });
  }

  /** Re-runs the dependency check that failed, for the active project. */
  protected onRetryDependencies(): void {
    const projectUid = this.projectContext.activeContextUid();
    if (!projectUid) {
      return;
    }
    this.dependencyRetrySub?.unsubscribe();
    this.dependencyRetrySub = this.resolveDependenciesForGate(projectUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((dependencies) => this.dependencyDocs.set(dependencies));
  }

  protected onEditSources(section?: string): void {
    if (this.phase() !== 'form' || this.sourcesLoading() || this.sourcesDenied()) return;
    if (!section && this.sourcesEditing()) {
      this.onDoneSources();
      return;
    }
    this.sourcesEditing.set(true);
    this.focusSourceControl(section ?? '#mktg-run-intake-form');
  }

  protected onDoneSources(): void {
    this.sourcesEditing.set(false);
    this.focusSourceControl('[data-testid="mktg-run-sources-edit"]');
  }

  /** PROVISIONAL board-silent affordance: explicit omission instead of silently losing sources after reload. */
  protected onDropPriorFiles(): void {
    this.priorDocumentCount.set(0);
    this.priorLogoCount.set(0);
  }

  protected onSubmit(): void {
    if (this.submitDisabled()) {
      this.intakeForm.markAllAsTouched();
      this.errorText.set(this.submitReason());
      return;
    }
    this.startGeneration();
  }

  protected onRetryRun(): void {
    const request = this.activeRequest;
    if (!this.runFailed() || !request || this.phase() === 'running') return;
    this.startGeneration(request);
  }

  /** Another empty row on a `url-list` field, up to its `maxItems`. */
  protected onAddLinkRow(key: string): void {
    if (!this.canAddLinkRow()[key]) {
      return;
    }
    this.addLinkRow(key, '');
  }

  /** Drops a row of a `url-list` field; the field keeps at least one (empty) row to type into. */
  protected onRemoveLinkRow(key: string, rowId: string): void {
    this.linkRowsForm.removeControl(rowId);
    this.linkRows.update((rows) => ({ ...rows, [key]: (rows[key] ?? []).filter((id) => id !== rowId) }));
    if ((this.linkRows()[key] ?? []).length === 0) {
      this.addLinkRow(key, '');
    }
    this.syncLinkField(key);
  }

  /**
   * A file picked on a field that offers an upload (the deck, the plan): it
   * joins the documents section, read to text there, already tagged with the
   * field's kind — the requester never tags it by hand.
   */
  protected onFieldFilesSelected(field: MktgIntakeField, event: FileSelectEvent): void {
    // `files` is this selection only; the uploader resets its input itself.
    this.documentsSection()?.addFiles(Array.from(event.files), field.uploadTag);
  }

  /** Sends answers once; the accepted ACK transfers this owned attempt to the asset page. */
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
        next: () => {
          this.answersSending.set(false);
          // The accepted answers were saved before this ACK. The asset resumes polling, not another POST.
          this.openPrepared(request, true);
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

  /** The same persisted revision summary used by Kit/family and Documents, not browser run history. */
  private readHasVersion(project: string, fresh: boolean): Observable<boolean | null> {
    return this.documentStore.listDocuments(project).pipe(
      map((documents) =>
        documents.groups.some((group) => group.type.catalogAgentId === this.agent?.id && group.documents.some((item) => item.revisionCount > 0))
      ),
      catchError(() => {
        // Sources already loads last intake; the full form reads it only as a label fallback.
        if (fresh) return of(null);
        return this.runService.lastIntake(project, this.agent?.id ?? '').pipe(
          map((intake) => !!intake),
          catchError(() => of(false))
        );
      })
    );
  }

  private intakeSourcesHint(): string {
    const required = (this.intake?.fields ?? []).filter((field) => !field.optional).map((field) => field.question);
    const intro = 'The agent reads these, searches the web and LFX for the rest, and may ask you a few questions.';
    if (!required.length) return `${intro} All sources are optional.`;
    const last = required.at(-1);
    const names = required.length > 1 ? `${required.slice(0, -1).join(', ')} and ${last}` : last;
    return `${intro} Only the ${names} ${required.length === 1 ? 'is' : 'are'} required.`;
  }

  private initSourceFields(): Signal<MktgRunSourceField[]> {
    return computed(() => {
      const values = this.intakeValue();
      return (this.intake?.fields ?? []).map((field) => {
        const value = values[field.key] ?? '';
        let origin = 'Suggested';
        if (this.filledFromMemoryApplied()[field.key] && this.prefillIntact()[field.key]) {
          origin = this.fromPriorRun()[field.key] ?? 'Remembered on this device';
        }
        if (Object.hasOwn(this.lastSourceValues(), field.key)) origin = this.lastSourceOrigins()[field.key] ?? origin;
        if (this.intakeForm.controls[field.key]?.dirty) origin = 'Changed just now';
        return { key: field.key, label: field.question, value, origin };
      });
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
          if (attachment.format === 'json') {
            if (!mktgJsonAttachmentUsable(attachment, doc.sidecar)) {
              // A revision the agent can read nothing from is not what the
              // run uses: the gate's note names it (an optional one is
              // simply not sent), so a "Uses the approved current …" chip would
              // contradict the stop beside it.
              continue;
            }
            // The sidecar read supplies the approved current framework and its date.
            const storedOn = doc.storedAt ? ` · ${formatDate(doc.storedAt, 'd MMM', 'en-US')}` : '';
            chips.push({
              key: attachment.sourceAgentId,
              label: `Uses the approved ${attachment.documentName.toLowerCase()} · v${doc.version}${storedOn}`,
              linkAgentId: attachment.sourceAgentId,
              ...this.attachmentChipStyle.present,
            });
            continue;
          }
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
      afterDocuments: !!group.afterDocuments,
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
        // The https-url validator raises a flag, not a reason: there is only one way to fail it.
        const httpsError: GithubRepoUrlError | undefined = errors?.['httpsUrl'] ? { reason: 'unrecognized' } : undefined;
        const error = (errors?.['githubRepoUrl'] ?? errors?.['sourceUrl'] ?? httpsError) as GithubRepoUrlError | undefined;
        const message = field.format && error ? MKTG_INTAKE_FORMAT_ERRORS[field.format][error.reason] : undefined;
        if (message) {
          messages[field.key] = message;
        } else if (errors?.['oneLine']) {
          // The format rule, when there is one, names the more specific
          // mistake; a line break in a one-line field is the fallback.
          messages[field.key] = MKTG_INTAKE_ONE_LINE_ERROR;
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
      if (field.kind === 'text' && field.oneLine) {
        // A single-line input hides a line break its control still holds (a
        // prefill, a restored answer, a paste), and this agent's BFF refuses
        // the run as "must be one line" — so the form catches it where it is
        // fixable. Other agents accept multi-line text here, so the rule is
        // per field, not per control kind.
        validators.push(oneLineValidator());
      }
      if (field.format === 'github-repo-url') {
        validators.push(githubRepoUrlValidator());
      } else if (field.format === 'github-url') {
        // The Brand Kit's rule: a GitHub organization URL is a usable answer;
        // only a value that is not a GitHub URL at all is refused.
        validators.push(githubRepoUrlValidator({ acceptOwner: true }));
      } else if (field.format === 'source-url') {
        // A page the agent fetches itself: an https:// link, or "none" — but
        // a REQUIRED source (the website) has to be a real page.
        validators.push(sourceUrlValidator({ none: !!field.optional }));
      } else if (field.format === 'source-url-list') {
        // Several such links, one per line (or one per row, for a `url-list`).
        validators.push(sourceUrlValidator({ list: true }));
      } else if (field.format === 'https-url') {
        // One https:// link the agent must read; "none" is not an answer here.
        validators.push(httpsUrlValidator());
      }
      controls[field.key] = new FormControl('', { nonNullable: true, validators });
    }
    return new FormGroup(controls);
  }

  /** Fresh snapshots keep intentional blanks; ordinary submissions omit blank optionals. */
  private buildAnswers(): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const field of this.intake?.fields ?? []) {
      const value = this.intakeForm.controls[field.key].value.trim();
      if (field.optional && !value && !this.freshMode()) {
        continue;
      }
      answers[field.key] = value;
    }
    return answers;
  }

  /**
   * Every intake field with its trimmed value, BLANKS INCLUDED — the answer
   * memory needs the full submitted state to erase a field the user cleared,
   * which ordinary submit payloads omit (fresh snapshots retain them). Without it
   * the memory would keep re-offering an optional answer the user removed.
   */
  private buildIntakeState(): Record<string, string> {
    const state: Record<string, string> = {};
    for (const field of this.intake?.fields ?? []) {
      state[field.key] = this.intakeForm.controls[field.key].value.trim();
    }
    return state;
  }

  /** The form's logo files as the generate request takes them. */
  private submittedLogoFiles(): MktgIntakeLogoFile[] {
    return this.logoFiles().map((entry) => entry.file);
  }

  /** The form's existing documents as the generate request takes them: a link by its URL (the agent reads it), a file by its text. */
  private submittedDocuments(): MktgIntakeDocument[] {
    return this.documents().map((document): MktgIntakeDocument => {
      const tag = document.tag ? { tag: document.tag } : {};
      if (document.kind === 'link') {
        return { kind: 'link', title: document.title, url: document.url, ...tag };
      }
      return { kind: 'file', title: document.title, text: document.text, ...tag };
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
    return this.dependencyIds.every((agentId) => this.dependencyMet(agentId, docs));
  }

  /** Human names of the unresolved dependencies, once resolution has completed. */
  private missingDependencyNames(): string[] {
    const docs = this.dependencyDocs();
    if (!docs) {
      return [];
    }
    return this.dependencyIds.filter((agentId) => !this.dependencyMet(agentId, docs)).map((agentId) => this.gateDocumentName(agentId));
  }

  /**
   * One dependency is met by a resolved document that the run can actually
   * submit: for a `json` attachment, a revision whose sidecar the agent can
   * read (the same rule `attachmentValue` applies, so the gate never opens
   * on a submission the BFF would refuse).
   */
  private dependencyMet(agentId: string, docs: Record<string, MktgDependencyDocument | null>): boolean {
    const doc = docs[agentId];
    if (!doc) {
      return false;
    }
    const attachment = (this.intake?.attachments ?? []).find((candidate) => candidate.sourceAgentId === agentId);
    return attachment?.format === 'json' ? mktgJsonAttachmentUsable(attachment, doc.sidecar) : true;
  }

  /**
   * The dependency resolution behind the gate: the resolved record, or null
   * with `dependencyCheckFailed` set when the read failed (the service logs
   * and rethrows anything but a 404 on a sidecar read). Null keeps
   * submit disabled; the flag keeps the note honest.
   */
  private resolveDependenciesForGate(projectUid: string): Observable<Record<string, MktgDependencyDocument | null> | null> {
    this.dependencyCheckFailed.set(false);
    return this.dependencyService.resolveDependencies(projectUid, this.attachmentSourceIds, this.sidecarSourceIds).pipe(
      catchError(() => {
        this.dependencyCheckFailed.set(true);
        return of(null);
      })
    );
  }

  /** How a gate names its document: the intake's own attachment name when it has one, else the catalog's. */
  private gateDocumentName(agentId: string): string {
    return (this.intake?.attachments ?? []).find((attachment) => attachment.sourceAgentId === agentId)?.documentName ?? mktgAgentDocumentName(agentId);
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
      const value = this.attachmentValue(attachment, docs[attachment.sourceAgentId]);
      if (value === null) {
        // Optional attachments (the ICP's Brand Kit / Message Foundation) are
        // simply omitted — the agent's own contract makes them optional and
        // it has a documented branch for their absence. Only a REQUIRED
        // attachment aborts the submission.
        if (attachment.optional) {
          continue;
        }
        return null;
      }
      attached[attachment.answerKey] = value;
    }
    return attached;
  }

  /**
   * Reconciles the rows of every `url-list` field with the field's control:
   * one row per link it holds, or one empty row. Called whenever the control
   * was written from outside the rows — a reset, a restored run, a remembered
   * answer — so the boxes always show what the answer is. Existing rows are
   * kept and given the new values (their ids are the `@for` track keys, so
   * the boxes are not torn down on every project switch); extra rows go,
   * missing ones are added.
   */
  private seedLinkRows(): void {
    for (const field of this.intake?.fields ?? []) {
      if (field.kind !== 'url-list') {
        continue;
      }
      const links = (this.intakeForm.controls[field.key]?.value ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const values = links.length > 0 ? links : [''];
      const kept = [...(this.linkRows()[field.key] ?? [])];
      for (const rowId of kept.splice(values.length)) {
        this.linkRowsForm.removeControl(rowId);
      }
      // The kept rows take their values quietly: the control already holds them, so nothing is echoed back.
      kept.forEach((rowId, index) => this.linkRowsForm.controls[rowId]?.setValue(values[index], { emitEvent: false }));
      this.linkRows.update((rows) => ({ ...rows, [field.key]: kept }));
      for (const value of values.slice(kept.length)) {
        this.addLinkRow(field.key, value);
      }
    }
  }

  /** One more row on a `url-list` field, holding `value`; typing into it rewrites the field's control. */
  private addLinkRow(key: string, value: string): void {
    this.linkRowSerial += 1;
    const rowId = `${key}-${this.linkRowSerial}`;
    const control = new FormControl(value, { nonNullable: true });
    this.linkRowsForm.addControl(rowId, control);
    control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.syncLinkField(key));
    this.linkRows.update((rows) => ({ ...rows, [key]: [...(rows[key] ?? []), rowId] }));
  }

  /** Writes a `url-list` field's rows — the non-blank ones, one per line — into the field's own control. */
  private syncLinkField(key: string): void {
    const control = this.intakeForm.controls[key];
    if (!control) {
      return;
    }
    const joined = (this.linkRows()[key] ?? [])
      .map((rowId) => this.linkRowsForm.controls[rowId]?.value.trim() ?? '')
      .filter((link) => link !== '')
      .join('\n');
    if (control.value !== joined) {
      control.setValue(joined);
    }
  }

  /**
   * What an attachment submits: the document's Markdown, or (a `json`
   * attachment) the revision's sidecar JSON serialized; null when absent,
   * or when the agent could read nothing from the sidecar — the BFF
   * validator would refuse that submission, so it is never made.
   */
  private attachmentValue(attachment: MktgIntakeAttachment, doc: MktgDependencyDocument | null): string | null {
    if (attachment.format === 'json') {
      return doc && mktgJsonAttachmentUsable(attachment, doc.sidecar) ? JSON.stringify(doc.sidecar) : null;
    }
    return doc?.document || null;
  }

  private focusSourceControl(selector: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const project = this.projectContext.activeContextUid();
    const subject = this.runAttempts.subject();
    afterNextRender(
      () => {
        if (this.phase() !== 'form' || project !== this.projectContext.activeContextUid() || subject !== this.runAttempts.subject()) return;
        this.host.nativeElement
          .querySelector<HTMLElement>(selector)
          ?.querySelector<HTMLElement>('input:not([type="file"]):not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled])')
          ?.focus();
      },
      { injector: this.injector }
    );
  }

  private restoreFreshInputs(project: string, history: MktgLastIntake | null): void {
    if (!this.agent || !this.intake) return;
    const memory = this.runAttempts.lastInputs(project, this.agent.id);
    const local = this.runService.loadRun(project, this.agent.id);
    const answers: Record<string, string> = {};
    const origins: Record<string, string> = {};
    for (const field of this.intake.fields) {
      if (history && Object.hasOwn(history.answers, field.key)) {
        answers[field.key] = history.answers[field.key];
        origins[field.key] = 'From last time';
      } else if (memory && Object.hasOwn(memory.answers, field.key)) {
        answers[field.key] = memory.answers[field.key];
        origins[field.key] = 'Saved in this visit';
      } else if (local && Object.hasOwn(local.answers, field.key)) {
        answers[field.key] = local.answers[field.key];
        origins[field.key] = 'Saved on this device';
      }
    }
    this.lastSourceValues.set(answers);
    this.lastSourceOrigins.set(origins);
    this.intakeForm.patchValue(answers);
    // Shared history has no run binding for local bytes. Equal scalars/counts
    // cannot prove ownership, so never reuse uploads alongside a durable snapshot.
    // A same-visit draft with no shared snapshot can still retain its own inputs.
    if (!history && memory) this.restoreInputs({ ...memory, answers }, 'last-visit');
    const memoryDocuments = !history ? (memory?.documents?.length ?? 0) : 0;
    const memoryLogos = !history ? (memory?.logoFiles?.length ?? 0) : 0;
    this.priorDocumentCount.set(history?.documentCount ?? memoryDocuments);
    this.priorLogoCount.set(history?.logoCount ?? memoryLogos);
    this.seedLinkRows();
  }

  private restoreInputs(request: MktgGenerateRequest, prefix: string): void {
    this.intakeForm.patchValue(request.answers);
    this.documents.set(
      (request.documents ?? []).map((document) => ({
        ...document,
        id: `${prefix}-document-${++this.restoredDocumentSerial}`,
        read: document.kind === 'file',
        words: (document.text ?? '').split(/\s+/).filter(Boolean).length,
        truncated: false,
      }))
    );
    this.logoFiles.set(
      (request.logoFiles ?? []).map((file, index) => ({
        id: `${prefix}-logo-${index}`,
        file,
        badge: file.url ? 'LINK' : (file.name.split('.').at(-1)?.toUpperCase() ?? 'FILE'),
        status: 'Restored input',
      }))
    );
  }

  /** Discards a pending navigation token without discarding the recoverable intake. */
  private discardPendingNavigation(): void {
    const token = this.navigation()?.generation;
    if (token) this.runAttempts.discard(token);
    this.navigation.set(null);
  }

  /**
   * Resets ALL run state for the (new) active project, then restores that
   * project's stored run and applies its LFX prefill. Runs on every active
   * context change so one project's session, answers and versions can never
   * bleed into another's.
   */
  private resetForContext(context: ProjectContext | null, fresh: boolean): void {
    if (!this.agent || !this.intake) {
      return;
    }

    this.consumedFreshProject = null;
    this.consumedFreshSubject = null;
    this.freshMode.set(fresh);
    this.hasVersion.set(false);
    this.generationSub?.unsubscribe();
    this.generationSub = null;
    this.discardPendingNavigation();
    this.navigating.set(false);
    this.dependencyRetrySub?.unsubscribe();
    this.dependencyRetrySub = null;
    // The answers POST was cut with it: its callbacks will never clear the flag, so the next questions step must not inherit it.
    this.answersSending.set(false);
    this.writingStretch.set(false);
    this.activity.set([]);
    this.activityStartedAt.set(0);
    this.phase.set('form');
    this.recheckingAttempt.set(false);
    this.runFailed.set(false);
    this.errorText.set('');
    this.fromLfxApplied.set({});
    this.lfxMissing.set({});
    this.fromPriorRunApplied.set({});
    this.filledFromMemoryApplied.set({});
    this.prefillAppliedValues.set({});
    // A file still being read for the previous context must not land in this one: the sections stay mounted, so their reads are cancelled here.
    this.documentsSection()?.cancelReads();
    this.logoFilesSection()?.cancelReads();
    this.documents.set([]);
    this.logoFiles.set([]);
    this.logoFilesBusy.set(false);
    this.activeRequest = null;
    this.clearQuestions();
    this.intakeForm.reset();
    // Dependency documents are per-project — back to "resolving" until the
    // constructor stream's resolution for the NEW context lands (fail-closed:
    // submission stays disabled meanwhile).
    this.dependencyDocs.set(null);
    this.dependencyCheckFailed.set(false);
    this.sourcesEditing.set(false);
    this.sourcesLoading.set(fresh);
    this.sourcesDenied.set(false);
    this.sourceNote.set('');
    this.lastSourceValues.set({});
    this.lastSourceOrigins.set({});
    this.priorDocumentCount.set(0);
    this.priorLogoCount.set(0);
    if (!context) return;
    if (fresh) return; // No token consumption, attempt restore/resume or prepare on a fresh visit.

    const stored = this.runService.loadRun(context.uid, this.agent.id);
    if (stored) {
      // patchValue ignores keys without a control — answers persisted by the
      // retired Brand Kit gate UI (e.g. brand_kit_markdown) restore cleanly.
      this.intakeForm.patchValue(stored.answers);
    }

    const draft = this.runAttempts.load(context.uid, this.agent.id);
    if (draft) {
      this.restoreInputs(draft.request, 'restored');
      if (draft.pendingQuestions) {
        this.activeRequest = draft.request;
        this.showQuestions(draft.pendingQuestions);
      } else if (draft.requiresReattachment && draft.state !== 'writing') {
        this.errorText.set('Your saved intake was restored. Reattach the source files, then press Generate explicitly.');
      }
    }

    // Receiver lands before the handoff producer: a new agent questions round returns to this intake.
    const token = this.route.snapshot.queryParamMap?.get('questions');
    const returned = token ? this.runAttempts.consume(token, context.uid, this.agent.id) : null;
    if (returned?.pending.requiresReattachment && !returned.pending.pendingQuestions) {
      this.restoreInputs(returned.pending.request, 'returned');
      this.errorText.set('Your saved intake was restored. Reattach the source files, then press Generate explicitly.');
    } else if (returned?.pending.pendingQuestions) {
      this.activeRequest = returned.pending.request;
      this.restoreInputs(returned.pending.request, 'returned');
      this.showQuestions(returned.pending.pendingQuestions);
    } else if (returned?.pending.attempt) {
      this.resumeAcceptedAttempt(returned.pending, context.uid);
    } else if (draft?.state === 'writing' && draft.attempt) {
      // Consumed entry URLs also restore an accepted run before its first questions.
      this.resumeAcceptedAttempt(draft, context.uid);
    }

    // LFX prefill — fill only still-empty answers, and mark them "From LFX".
    // repository-url / project-description follow from the getProject lookup
    // chained in the constructor.
    this.applyPrefill('project-name', context.name);
    // The reset and a restored run both wrote the list fields' controls; the rows follow them.
    this.seedLinkRows();
  }

  private resumeAcceptedAttempt(pending: MktgPendingGeneration, projectUid: string): void {
    this.activeRequest = pending.request;
    this.restoreInputs(pending.request, 'returned');
    this.phase.set('running');
    this.recheckingAttempt.set(true);
    this.writingStretch.set(!!pending.answered);
    this.activityStartedAt.set(Date.now());
    this.generationSub = this.runService
      .resume(pending)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => this.onProgress(progress, projectUid),
        error: (error: unknown) => {
          const errorType = error instanceof Error ? error.name : typeof error;
          console.error('Failed to re-check Marketing OS run', error instanceof HttpErrorResponse ? { status: error.status } : { errorType });
          this.discardPendingNavigation();
          this.navigating.set(false);
          this.writingStretch.set(false);
          this.recheckingAttempt.set(false);
          this.phase.set('form');
          this.errorText.set('The recorded run could not be checked. Your intake is kept; try again.');
        },
      });
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
      if (this.freshMode() && Object.hasOwn(this.lastSourceValues(), field.key)) continue;
      if (control && !control.value.trim()) {
        // A one-line field takes a one-line value: an LFX description with
        // paragraph breaks is collapsed to single spaces, since the input
        // would hide the breaks while the control — and the submission —
        // kept them, and the BFF refuses a description that is not one line.
        const fieldValue = field.kind === 'text' ? trimmedValue.replace(/\s+/g, ' ') : trimmedValue;
        control.setValue(fieldValue);
        this.recordPrefill(field.key, fieldValue);
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
      if (!control || control.value.trim() || (this.freshMode() && Object.hasOwn(this.lastSourceValues(), field.key))) {
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

  private startGeneration(retryRequest?: MktgGenerateRequest): void {
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

    if (retryRequest && (retryRequest.projectUid !== projectUid || retryRequest.agentId !== agent.id)) return;
    const answers = retryRequest?.answers ?? this.buildAnswers();
    // Remember what the user typed, keyed by intake field key, so the NEXT
    // agent's form on this project can offer it back instead of asking again.
    // Only the intake's own answers — the auto-attached dependency documents
    // added below are document-sized and resolved from their own source. The
    // FULL state goes in, not the payload: a cleared optional field has to
    // erase its remembered answer rather than leave the old one to be
    // re-offered once this run's 24h record expires.
    if (!retryRequest) this.answerMemory.remember(projectUid, agent.id, this.buildIntakeState());

    this.runFailed.set(false);
    this.errorText.set('');
    this.clearQuestions();
    this.activity.set([]);
    this.recheckingAttempt.set(false);
    this.activityStartedAt.set(Date.now());
    this.writingStretch.set(false);
    this.lastAnswers.set({});
    this.phase.set('running');

    // Re-resolve dependencies at submit time (server-persisted preferred,
    // browser fallback) and overlay the current stored attachments onto the
    // answers. The retired Request changes form sends no feedback here.
    this.generationSub?.unsubscribe();
    this.generationSub = (retryRequest ? of(this.dependencyDocs()) : this.resolveDependenciesForGate(projectUid))
      .pipe(
        switchMap((docs) => {
          this.dependencyDocs.set(docs);
          const attached = retryRequest?.answers ?? (docs ? this.applyAttachments(answers, docs) : null);
          if (!attached) {
            // The stored dependency disappeared between page load and submit,
            // or the check itself failed — surface the honest gate note
            // instead of submitting an invalid run.
            this.errorText.set(this.missingDependencyNote() || 'A required dependency document is no longer available for this project.');
            this.phase.set('form');
            return EMPTY;
          }
          const request: MktgGenerateRequest = retryRequest ?? {
            agentId: agent.id,
            projectUid,
            intake,
            ...(this.freshMode() && { newRun: true }),
            answers: attached,
            documents: this.submittedDocuments(),
            logoFiles: this.submittedLogoFiles(),
          };
          this.activeRequest = request;
          if (!intake.endpoints.answers) {
            this.openPrepared(request);
            return EMPTY;
          }
          return this.runService.generate(request);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (progress) => this.onProgress(progress, projectUid),
        error: () => {
          this.discardPendingNavigation();
          this.navigating.set(false);
          this.recheckingAttempt.set(false);
          this.writingStretch.set(false);
          this.runFailed.set(!!retryRequest);
          this.errorText.set('The agent could not complete this run. Your answers are kept — try again.');
          this.phase.set('form');
        },
      });
  }

  /** Consume entry intent only after acceptance, without changing this visit's Sources state. */
  private consumeFreshEntry(projectUid: string): void {
    const subject = this.userService.user()?.sub;
    if (
      !this.freshMode() ||
      !subject ||
      this.activeRequest?.projectUid !== projectUid ||
      this.projectContext.activeContextUid() !== projectUid ||
      this.route.snapshot.queryParamMap.get('mode') !== MKTG_RUN_NEW_MODE
    )
      return;
    this.consumedFreshProject = projectUid;
    this.consumedFreshSubject = subject;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { mode: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** One handler for the generate stream and the answers stream: they emit the same events. */
  private onProgress(progress: MktgGenerateProgress, projectUid: string): void {
    if (progress.type === 'submitted') {
      this.consumeFreshEntry(projectUid);
      return;
    }
    if (progress.type === 'restored') {
      if (
        this.projectContext.activeContextUid() !== projectUid ||
        progress.pending.request.projectUid !== projectUid ||
        progress.pending.request.agentId !== this.agent?.id
      ) {
        return;
      }
      this.intakeForm.patchValue(progress.pending.request.answers);
      this.writingStretch.set(false);
      this.clearQuestions();
      this.errorText.set(progress.message);
      this.phase.set('form');
      return;
    }
    if (progress.type === 'activity') {
      // The whole feed so far, every time it changed.
      this.activity.set(progress.activity);
      this.recheckingAttempt.set(false);
      if (progress.activity.some((step) => step.kind === 'checking')) this.handoffPostResearch();
      return;
    }
    if (progress.type === 'questions') {
      // The agent read the sources and wants the gaps answered before it
      // writes: a second step on the same run, pre-filled with its
      // suggestions. The stream is over; the answers continue the session.
      this.showQuestions(progress.pending);
      return;
    }
    if (progress.type === 'failed' || progress.type === 'refused') {
      this.discardPendingNavigation();
      this.navigating.set(false);
      this.recheckingAttempt.set(false);
      if (progress.type === 'refused') this.activeRequest = null;
      this.writingStretch.set(false);
      this.clearQuestions();
      this.runFailed.set(progress.type === 'failed');
      this.errorText.set(progress.type === 'failed' ? (progress.failure?.reason ?? MKTG_RUN_FAILURE_REASON) : progress.reply);
      this.phase.set('form');
      return;
    }
    if (progress.type === 'document' || progress.type === 'persisted') {
      const request = this.activeRequest;
      if (projectUid !== this.projectContext.activeContextUid() || (request && (request.projectUid !== projectUid || request.agentId !== this.agent?.id)))
        return;
      this.dependencyService.notifyDocumentsChanged(projectUid);
      if (this.navigation()) return;
      const run = progress.run;
      const attempt = progress.attempt;
      if (!request || !run || !attempt) {
        this.discardPendingNavigation();
        this.navigating.set(false);
        this.writingStretch.set(false);
        this.clearQuestions();
        this.errorText.set('The completed run could not be opened. Your intake is kept — open Documents to check it, or try again.');
        this.phase.set('form');
        return;
      }
      this.writingStretch.set(true);
      const location = progress.documentLocation;
      if (location) {
        const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === request.agentId);
        if (location.agentKey !== type?.agentKey) {
          this.writingStretch.set(false);
          this.phase.set('form');
          this.errorText.set('The receipt belongs to another asset. Open Documents to check this run; no new generation was started.');
          return;
        }
        this.navigation.set({
          projectUid,
          subject: this.userService.user()?.sub ?? '',
          agentKey: location.agentKey,
          documentId: location.documentId,
          revisionId: location.revisionId,
        });
        this.onRetryHandoff();
      } else {
        // It was generated but its write has not landed. Transfer polling of this accepted session, not a fresh submission.
        this.runAttempts.save({
          request,
          attempt,
          state: 'writing',
          updatedAt: new Date().toISOString(),
        });
        this.openPrepared(request, true);
      }
    }
  }

  private activityTitleForStage(): string {
    return this.writingStretch() ? `Writing your ${this.intake?.documentName ?? 'document'}…` : `Researching ${this.projectName()}…`;
  }

  /** Transfer only confirmed post-research progress on this owned attempt, never Generate. */
  private handoffPostResearch(): void {
    const request = this.activeRequest;
    if (!request || this.navigation()) return;
    const pending = this.runAttempts.load(request.projectUid, request.agentId);
    // Terminal failure is tracked before the service emits its last activity.
    if (!pending?.attempt || pending.state === 'failed') return;
    this.writingStretch.set(true);
    this.openPrepared(request, true);
  }

  private openPrepared(request: MktgGenerateRequest, resume = false): void {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === request.agentId);
    if (!type) {
      this.phase.set('form');
      this.errorText.set('This agent has no registered asset view.');
      return;
    }
    const subject = this.userService.user()?.sub;
    if (!subject) {
      this.phase.set('form');
      this.errorText.set('Sign in before opening this run. Your intake is kept.');
      return;
    }
    const generation = this.runAttempts.prepare(request, resume);
    const runId = this.runAttempts.load(request.projectUid, request.agentId)?.attempt?.runId;
    this.navigation.set({ projectUid: request.projectUid, subject, agentKey: type.agentKey, generation, runId });
    this.onRetryHandoff();
  }

  /** Puts the agent's questions on the page; the stepper asks them one at a time. */
  private showQuestions(pending: MktgRunQuestionsPending): void {
    this.recheckingAttempt.set(false);
    this.lastAnswers.set({});
    this.questionsPending.set(pending);
    this.phase.set('questions');
  }

  private clearQuestions(): void {
    this.questionsPending.set(null);
  }
}
