// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MktgSkeletonComponent } from '@components/mktg-skeleton/mktg-skeleton.component';
import {
  LINKEDIN_ABOUT_FIELDS,
  LINKEDIN_INTAKE_LABEL,
  LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY,
  LINKEDIN_PROFILE_EDIT_ORIGINS,
  LINKEDIN_SOURCE_LINK_HINT,
  MKTG_DRIVE_SHARING_HINT,
  LINKEDIN_CONTENT_SOURCES,
  LINKEDIN_FILE_ACCEPT,
  LINKEDIN_FILE_TYPES_LABEL,
  LINKEDIN_PROFILE_MAX_FIELD_CHARS,
  LINKEDIN_SOURCE_MAX_BYTES,
  LINKEDIN_SHARE_LINK_ANSWER_KEY,
  LINKEDIN_SHARE_LINK_MAX_CHARS,
  LINKEDIN_SHARE_LINK_HINT,
  LINKEDIN_VOICE_FIELDS,
  MKTG_RUN_NEW_MODE,
  MKTG_DOCUMENT_TYPES,
  MKTG_RUN_POLL,
  MKTG_RUN_ACTIVE_DIALOG_KEYS,
  MKTG_RUN_RESUME_QUERY_CLEAR,
} from '@lfx-one/shared/constants';
import {
  LinkedinContentSource,
  LinkedinGeneration,
  LinkedinSetup,
  LinkedinStoredProfile,
  MktgAgentIntake,
  MktgGenerateRequest,
  MktgDocumentReadCycle,
  MktgDocumentRunProgress,
  MktgDocumentsResponse,
  MktgPendingGeneration,
  MktgRunAnswer,
  MktgRunQuestion,
} from '@lfx-one/shared/interfaces';
import {
  isLinkedinSetup,
  normalizeLinkedinShareLink,
  mktgKitRootPath,
  parseLinkedinContentSource,
  readMktgActiveRunConflict,
  mktgRunAnsweredBy,
  mktgLinkWarnings,
  readMktgRetiredRunHint,
} from '@lfx-one/shared/utils';
import { LinkedinPostService } from '@services/linkedin-post.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgActiveRunGuardService } from '@services/mktg-active-run-guard.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { FileSelectEvent } from 'primeng/fileupload';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, distinctUntilChanged, EMPTY, map, of, Subscription, switchMap, take } from 'rxjs';

import { MktgBreadcrumbComponent } from '../mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgRunQuestionsComponent } from '../../mktg-run-questions/mktg-run-questions.component';
import { MKTG_NONE_ALLOWED_QUESTION_IDS } from '@lfx-one/shared/constants/mktg-run.constants';
import { MktgRunProgressComponent } from '../mktg-run-progress/mktg-run-progress.component';

/** Profile/source intake only. Accepted runs and their results belong to the shared document receiver. */
@Component({
  selector: 'lfx-linkedin-post-run',
  imports: [
    ConfirmDialogModule,
    ReactiveFormsModule,
    ButtonComponent,
    FileUploadComponent,
    InputTextComponent,
    TextareaComponent,
    MktgBreadcrumbComponent,
    MktgRunQuestionsComponent,
    MktgRunProgressComponent,
    MktgSkeletonComponent,
  ],
  templateUrl: './linkedin-post-run.component.html',
  styleUrl: './linkedin-post-run.component.scss',
})
export class LinkedinPostRunComponent {
  private readonly api = inject(LinkedinPostService);
  private readonly documents = inject(MktgDocumentStoreService);
  private readonly document = inject(DOCUMENT);
  private readonly attempts = inject(MktgRunAttemptService);
  private readonly runs = inject(MktgAgentRunService);
  protected readonly context = inject(ProjectContextService);
  private readonly projects = inject(ProjectService);
  private readonly user = inject(UserService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messages = inject(MessageService);
  private readonly recordedProgress = viewChild(MktgRunProgressComponent);
  private readonly activeRunGuard = inject(MktgActiveRunGuardService);
  protected readonly conflictKey = MKTG_RUN_ACTIVE_DIALOG_KEYS.linkedin;

  public readonly intake = input.required<MktgAgentIntake>();
  protected readonly profileForm = new FormGroup(
    Object.fromEntries(
      [...LINKEDIN_ABOUT_FIELDS, ...LINKEDIN_VOICE_FIELDS].map((field) => [
        field.key,
        new FormControl('', { nonNullable: true, validators: [Validators.maxLength(LINKEDIN_PROFILE_MAX_FIELD_CHARS)] }),
      ])
    )
  );
  protected readonly contentForm = new FormGroup({
    text: new FormControl('', { nonNullable: true }),
    url: new FormControl('', { nonNullable: true }),
    share_link: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(LINKEDIN_SHARE_LINK_MAX_CHARS)] }),
  });
  protected readonly noneAllowedQuestionIds = MKTG_NONE_ALLOWED_QUESTION_IDS;
  protected readonly intakeLabel = LINKEDIN_INTAKE_LABEL;
  protected readonly aboutFields = LINKEDIN_ABOUT_FIELDS;
  protected readonly voiceFields = LINKEDIN_VOICE_FIELDS;
  protected readonly sources = LINKEDIN_CONTENT_SOURCES;
  protected readonly maxFileBytes = LINKEDIN_SOURCE_MAX_BYTES;
  protected readonly maxProfileChars = LINKEDIN_PROFILE_MAX_FIELD_CHARS;
  protected readonly fileAccept = LINKEDIN_FILE_ACCEPT;
  protected readonly fileTypesLabel = LINKEDIN_FILE_TYPES_LABEL;
  protected readonly maxShareLinkChars = LINKEDIN_SHARE_LINK_MAX_CHARS;
  protected readonly shareLinkHint = LINKEDIN_SHARE_LINK_HINT;
  protected readonly sourceLinkHint = LINKEDIN_SOURCE_LINK_HINT;
  protected readonly driveSharingHint = MKTG_DRIVE_SHARING_HINT;
  protected readonly freshMode = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('mode') === MKTG_RUN_NEW_MODE)), { initialValue: false });
  private readonly historyGrant = signal('');
  protected readonly lastIntakeLoading = signal(false);
  protected readonly lastIntakeDenied = signal(false);
  protected readonly lastIntakeNote = signal('');
  protected readonly loading = signal(true);
  protected readonly profileResolved = signal(false);
  protected readonly writer = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly editing = signal(false);
  protected readonly saved = signal<LinkedinStoredProfile | null>(null);
  protected readonly setup = signal<LinkedinSetup | null>(null);
  protected readonly source = signal<LinkedinContentSource>('text');
  protected readonly file = signal<File | null>(null);
  protected readonly reload = signal(0);
  protected readonly questions = signal<MktgRunQuestion[]>([]);
  protected readonly recordedPending = signal<MktgPendingGeneration | null>(null);
  protected readonly serverRun = signal<MktgDocumentRunProgress | null>(null);
  protected readonly recordedRequest = signal<MktgGenerateRequest | null>(null);
  protected readonly runLookupFailed = signal(false);
  protected readonly runWarning = signal('');
  protected readonly intakeNote = computed(() => {
    if (this.runWarning()) return this.runWarning();
    if (this.lastIntakeLoading()) return 'Loading last run inputs…';
    return this.lastIntakeNote();
  });
  private readonly ownRunsSeed = signal<MktgDocumentsResponse | null>(null);
  private ownRunsSubject = '';
  protected readonly checkingPending = signal(false);
  protected readonly recordedDocumentId = computed(() => this.serverRun()?.documentId ?? '');
  protected readonly recordedRunId = computed(() => this.serverRun()?.runId ?? '');
  protected readonly previousAnswers = signal<Record<string, string>>({});
  protected readonly answering = signal(false);
  protected readonly linkError = signal('');
  protected readonly explicitProfileSave = signal(false);
  protected readonly acceptedRequest = signal<MktgGenerateRequest | null>(null);
  protected readonly pendingNotice = signal<ReturnType<MktgRunAttemptService['latestPending']>>(null);
  private readonly contentUrl = signal(this.contentForm.controls.url.value);
  protected readonly linkWarning = computed(() => mktgLinkWarnings({ url: this.contentUrl() })['url']);
  protected readonly projectName = computed(() => this.context.activeContext()?.name ?? '');
  protected readonly documentsLink = computed(() => [mktgKitRootPath(this.router.url), 'documents']);
  protected readonly writingAs = computed(() => this.saved()?.profile.about.name ?? this.setup()?.name ?? '');
  private readonly scope$ = toObservable(computed(() => ({ context: this.context.activeContext(), sub: this.user.user()?.sub, reload: this.reload() })));

  private generation: Subscription | null = null;
  private scopeVersion = 0;
  private sourceReentry = '';
  private questionsPending: MktgPendingGeneration | null = null;

  public constructor() {
    if (!isPlatformBrowser(this.platform)) return;
    this.contentForm.controls.url.valueChanges.pipe(takeUntilDestroyed()).subscribe((url) => this.contentUrl.set(url));
    this.initLastIntakeRestore();
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('profile') === 'edit'),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((editing) => {
        if (this.loading() || (!this.saved() && !this.setup())) return;
        if (editing && !this.editing()) this.fillProfile();
        this.editing.set(editing);
      });
    this.route.queryParamMap
      .pipe(
        map((params) => parseLinkedinContentSource(params.get('source'))),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((source) => {
        if (source !== this.source()) this.applySource(source);
      });
    this.contentForm.valueChanges
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed()
      )
      .subscribe(() => this.acceptedRequest.set(null));
    this.contentForm.controls.url.valueChanges.pipe(takeUntilDestroyed()).subscribe((url) => {
      if (this.source() === 'url' && !this.contentForm.controls.share_link.dirty) this.contentForm.controls.share_link.setValue(url);
    });
    this.scope$
      .pipe(
        distinctUntilChanged((a, b) => a.context?.uid === b.context?.uid && a.sub === b.sub && a.reload === b.reload),
        switchMap(({ context, sub }) => {
          this.scopeVersion++;
          this.confirmation.close();
          this.sourceReentry = '';
          this.generation?.unsubscribe();
          this.questionsPending = null;
          this.recordedPending.set(null);
          this.serverRun.set(null);
          this.recordedRequest.set(null);
          this.runLookupFailed.set(false);
          this.runWarning.set('');
          this.ownRunsSeed.set(null);
          this.ownRunsSubject = '';
          this.checkingPending.set(false);
          this.acceptedRequest.set(null);
          this.pendingNotice.set(null);
          this.explicitProfileSave.set(false);
          this.questions.set([]);
          this.previousAnswers.set({});
          this.answering.set(false);
          this.busy.set(false);
          this.loading.set(true);
          this.profileResolved.set(false);
          this.writer.set(false);
          this.historyGrant.set('');
          this.saved.set(null);
          this.setup.set(null);
          this.error.set('');
          this.linkError.set('');
          this.editing.set(false);
          this.file.set(null);
          this.profileForm.reset();
          this.contentForm.reset();
          this.source.set(parseLinkedinContentSource(this.route.snapshot.queryParamMap.get('source')));
          if (!context) {
            this.error.set('Select a project to continue.');
            this.loading.set(false);
            return of(null);
          }
          if (!sub) return EMPTY;
          return this.projects.getProject(context.slug, false).pipe(
            switchMap((project) => {
              if (!project) throw new Error('Project unavailable');
              this.writer.set(!!project.writer);
              this.historyGrant.set(project.writer ? JSON.stringify([context.uid, sub]) : '');
              if (!project.writer) return of(null);
              return this.documents.listDocuments(context.uid, true, true).pipe(
                switchMap((snapshot) => {
                  if (snapshot.progressUnavailable) this.runWarning.set('Recorded runs could not be checked. Your inputs are available; checking again.');
                  return this.api.profile().pipe(map((profile) => ({ ...profile, snapshot })));
                })
              );
            }),
            catchError(() => {
              this.runLookupFailed.set(true);
              this.error.set('Your profile, project or recorded run could not be loaded. Try again.');
              return of(null);
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((response) => {
        this.loading.set(false);
        this.saved.set(response?.profile ?? null);
        if (!response) return;
        this.profileResolved.set(true);
        const params = this.route.snapshot.queryParamMap;
        const editProfile = params.get('profile') === 'edit';
        const profileDocument = params.get('profileDocument');
        this.explicitProfileSave.set(editProfile && !!profileDocument);
        if (this.explicitProfileSave() && !response.profile) {
          this.setup.set(this.api.setupForDocument(this.context.activeContextUid(), profileDocument ?? ''));
          if (!this.setup()) this.error.set("Your setup answers aren't kept in the browser — enter them again to draft");
        } else if (!response.profile) {
          this.setup.set(this.api.setupForDocument(this.context.activeContextUid()));
        }
        this.fillProfile();
        this.editing.set(!response.profile || editProfile);
        const token = params.get('questions');
        const prepared = token && !editProfile ? this.attempts.consumeQuestions(token, this.context.activeContextUid(), this.intake().agentId) : null;
        const latest =
          !this.freshMode() && !prepared && !editProfile ? this.attempts.latestPending(this.context.activeContextUid(), this.intake().agentId) : null;
        const pending = prepared?.pending ?? (latest ? this.attempts.load(this.context.activeContextUid(), this.intake().agentId, latest.documentId) : null);
        this.reconcileOwnRuns(response.snapshot, pending);
        this.ownRunsSubject = this.user.user()?.sub ?? '';
        this.ownRunsSeed.set(response.snapshot);
        if (prepared?.pending.state === 'failed' && !this.serverRun()) {
          let action = 'paste it again';
          if (this.source() === 'file') action = 'choose the file again';
          if (this.source() === 'url') action = 'enter the link again';
          this.sourceReentry = `Your source isn't kept in the browser — ${action} to draft`;
          this.error.set(this.sourceReentry);
          if (!response.profile) {
            this.setup.set(null);
            this.profileForm.reset();
            this.error.set(`${this.sourceReentry}. Your setup answers aren't kept in the browser — enter them again to draft`);
          }
        }
      });
    toObservable(computed(() => ({ seed: this.ownRunsSeed(), project: this.context.activeContextUid(), subject: this.user.user()?.sub ?? '' })))
      .pipe(
        switchMap(({ seed, project, subject }) => {
          if (!seed || seed.project !== project || !subject || subject !== this.ownRunsSubject) return EMPTY;
          let initial = true;
          return createVisibilityPoll(
            this.document,
            () => {
              if (initial) {
                initial = false;
                return of(seed);
              }
              return this.documents.listDocuments(project, true, true);
            },
            {
              intervalMs: MKTG_RUN_POLL.questionsIntervalMs,
              backoffBaseMs: MKTG_RUN_POLL.intervalMs,
              backoffMaxMs: MKTG_RUN_POLL.questionsIntervalMs,
              shouldContinue: () => !this.serverRun(),
            }
          ).pipe(map((event) => ({ event, project, subject })));
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ event, project, subject }) => {
        if (project !== this.context.activeContextUid() || subject !== this.user.user()?.sub) return;
        if (event.kind === 'error' || event.value.progressUnavailable) {
          this.runWarning.set('Recorded runs could not be checked. Showing available inputs; checking again.');
          return;
        }
        this.runWarning.set('');
        this.reconcileOwnRuns(event.value);
      });
  }

  protected onRecordedProgress(cycle: MktgDocumentReadCycle): void {
    const pending = this.recordedPending();
    const request = this.recordedRequest();
    if (
      !request ||
      cycle.detail.project !== this.context.activeContextUid() ||
      cycle.detail.documentId !== this.recordedDocumentId() ||
      cycle.detail.type.agentKey !== this.serverRun()?.agentKey
    )
      return;
    if (cycle.detail.progressUnavailable) {
      this.onRecordedReadError();
      return;
    }
    if (this.runLookupFailed()) {
      this.runLookupFailed.set(false);
      this.error.set('');
    }
    const run = cycle.detail.runs?.find((row) => row.runId === this.recordedRunId());
    if (readMktgRetiredRunHint(run) && this.acceptedRequest() !== request) {
      this.generation?.unsubscribe();
      this.answering.set(false);
      this.questionsPending = null;
      this.questions.set([]);
      this.pendingNotice.set(null);
      this.acceptedRequest.set(request);
      void this.returnToDocument(request, null);
      return;
    }
    if (this.answering() || this.acceptedRequest() === request) return;
    if (run?.state === 'questions' && pending?.pendingQuestions) {
      this.checkingPending.set(false);
      this.pendingNotice.set({ documentId: run.documentId, state: 'questions' });
      if (!this.questions().length) {
        this.questionsPending = pending;
        this.questions.set(pending.pendingQuestions.questions);
        this.editing.set(false);
      }
      return;
    }
    this.questionsPending = null;
    this.questions.set([]);
    this.pendingNotice.set(null);
    if (pending?.pendingQuestions && run && run.state !== 'questions') {
      this.attempts.save({ ...pending, pendingQuestions: undefined, state: run.state === 'failed' ? 'failed' : 'writing' });
    }
    if (!run && !cycle.detail.revisions.length) {
      this.attempts.clear(this.context.activeContextUid(), this.intake().agentId, this.attempts.subject(), this.recordedDocumentId());
      this.recordedPending.set(null);
      this.recordedRequest.set(null);
      this.serverRun.set(null);
      this.checkingPending.set(false);
      this.ownRunsSeed.update((snapshot) => (snapshot ? { ...snapshot, runs: [] } : null));
      return;
    }
    this.acceptedRequest.set(request);
    void this.returnToDocument(request, null);
  }

  protected onRecordedReadError(): void {
    this.checkingPending.set(false);
    this.runLookupFailed.set(true);
    // Keep the last confirmed question DOM/draft during a transient read; only submission is paused.
    this.error.set('The recorded run could not be checked. Open its document or try again before answering.');
  }

  protected onShareLinkEnter(event: Event): void {
    event.preventDefault();
    this.onApplyShareLink();
  }
  protected onApplyShareLink(): void {
    const link = normalizeLinkedinShareLink(this.contentForm.controls.share_link.value);
    this.linkError.set(link === null ? 'Enter one HTTPS link or leave it empty.' : '');
    if (link !== null) this.contentForm.controls.share_link.setValue(link);
  }
  protected onEdit(): void {
    this.fillProfile();
    this.error.set('');
    this.editing.set(true);
    void this.router.navigate([], {
      relativeTo: this.route,
      state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: LINKEDIN_PROFILE_EDIT_ORIGINS.run },
      queryParams: { profile: 'edit', project: this.context.activeContext()?.slug ?? null },
      queryParamsHandling: 'merge',
    });
  }
  protected onCancelEdit(): void {
    this.finishEditing();
    this.error.set('');
  }
  protected onProfileSubmit(): void {
    if (this.busy() || !this.writer()) return;
    const answers = Object.fromEntries(
      Object.entries(this.profileForm.getRawValue())
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value)
    );
    if (!isLinkedinSetup(answers) || this.profileForm.invalid) {
      this.error.set(`Complete name, role, focus areas and primary audience (up to ${this.maxProfileChars.toLocaleString('en-US')} characters each).`);
      return;
    }
    this.error.set('');
    if (!this.saved() && !this.explicitProfileSave()) {
      this.setup.set(answers);
      this.finishEditing(false);
      this.error.set(this.sourceReentry);
      return;
    }
    this.busy.set(true);
    this.generation = this.api
      .save({ setup: answers })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saved.set(response.profile);
          this.setup.set(null);
          this.finishEditing();
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.error.set('Profile could not be saved. Your changes are kept — try again.');
        },
      });
  }
  protected onSource(source: LinkedinContentSource): void {
    this.applySource(source);
    this.contentForm.markAsDirty();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { source: source === 'text' ? null : source, project: this.context.activeContext()?.slug ?? null },
      queryParamsHandling: 'merge',
    });
  }
  protected onFile(event?: FileSelectEvent): void {
    this.acceptedRequest.set(null);
    this.file.set(event?.files[0] ?? null);
    this.contentForm.markAsDirty();
    this.error.set('');
  }
  protected async onDraft(): Promise<void> {
    const project = this.context.activeContextUid();
    if (!project || this.busy() || this.editing() || this.questions().length || this.answering()) return;
    if (!this.writer()) {
      this.error.set('Only project writers can draft a post.');
      return;
    }
    if (this.lastIntakeLoading()) {
      this.error.set('Loading your last run inputs — try again in a moment.');
      return;
    }
    if (this.lastIntakeDenied()) {
      this.error.set(this.lastIntakeNote() || 'Your last run inputs could not be read; paste text, a link or a file to draft.');
      return;
    }
    if (this.acceptedRequest()) {
      this.error.set('Your draft is already started — use Open draft above.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const version = this.scopeVersion;
    const owner = this.user.user()?.sub;
    try {
      const link = normalizeLinkedinShareLink(this.contentForm.controls.share_link.value);
      if (link === null) throw new Error('Enter one HTTPS link to share, or leave it empty.');
      const answers: Record<string, string> = { content_source: this.source(), [LINKEDIN_SHARE_LINK_ANSWER_KEY]: link };
      if (this.source() === 'text') answers['content_text'] = this.contentForm.controls.text.value.trim();
      else if (this.source() === 'url') answers['content_url'] = this.contentForm.controls.url.value.trim();
      else {
        const file = this.file();
        if (!file || file.size > this.maxFileBytes) throw new Error(`Choose a text file up to ${this.maxFileBytes.toLocaleString('en-US')} bytes.`);
        answers['content_file_name'] = file.name;
        answers['content_file_base64'] = await this.readFile(file);
      }
      if (version !== this.scopeVersion || this.destroyRef.destroyed || owner !== this.user.user()?.sub || project !== this.context.activeContextUid()) return;
      if ((this.source() === 'text' && !answers['content_text']) || (this.source() === 'url' && !/^https:\/\/\S+$/i.test(answers['content_url'])))
        throw new Error('Supply pasted text or one public HTTPS link.');
      const savedSetup = this.setup();
      const setup = savedSetup ? { ...savedSetup } : undefined;
      const current = () =>
        version === this.scopeVersion && !this.destroyRef.destroyed && owner === this.user.user()?.sub && project === this.context.activeContextUid();
      const onSession = (session: LinkedinGeneration) => {
        if (!current()) return;
        const request = { agentId: this.intake().agentId, intake: this.intake(), projectUid: project, documentId: session.documentId, answers };
        this.acceptedRequest.set(request);
        void this.returnToDocument(request, this.attempts.prepareAccepted(request, session));
      };
      const start = (discard?: string) => {
        if (!current()) return;
        this.busy.set(true);
        const call = discard
          ? this.api.startForDocument(this.intake(), project, answers, setup, discard)
          : this.api.startForDocument(this.intake(), project, answers, setup);
        // An accepted POST outlives this view; only its bounded ACK is observed here.
        call.pipe(take(1)).subscribe({
          next: onSession,
          error: (error: unknown) => {
            if (!current()) return;
            const conflict = error instanceof HttpErrorResponse && error.status === 409 ? readMktgActiveRunConflict(error.error, this.intake().agentId) : null;
            if (!conflict) {
              this.failedRun(error);
              return;
            }
            this.busy.set(false);
            this.activeRunGuard.open(
              this.confirmation,
              {
                conflict,
                current,
                recheck: () => this.api.startForDocument(this.intake(), project, answers, setup),
                classify: (failure) =>
                  failure instanceof HttpErrorResponse && failure.status === 409 ? readMktgActiveRunConflict(failure.error, this.intake().agentId) : null,
                onValue: onSession,
                onDiscard: (fresh) => start(fresh.activeRunId),
                onOpen: (fresh) => {
                  void this.router.navigate([mktgKitRootPath(this.router.url), 'documents', fresh.agentKey, fresh.documentId], {
                    queryParams: { project: this.context.activeContext()?.slug, ...MKTG_RUN_RESUME_QUERY_CLEAR, run: fresh.activeRunId },
                  });
                },
                onError: (failure) => this.failedRun(failure),
              },
              this.destroyRef,
              this.conflictKey
            );
          },
        });
      };
      start();
    } catch (error) {
      if (version === this.scopeVersion) {
        this.busy.set(false);
        this.error.set(error instanceof Error ? error.message : 'Content could not be read.');
      }
    }
  }
  protected onAnswers(answers: MktgRunAnswer[]): void {
    const pending = this.questionsPending;
    if (!pending?.pendingQuestions || this.answering() || this.runLookupFailed()) return;
    const version = this.scopeVersion;
    const owner = this.user.user()?.sub;
    const project = this.context.activeContextUid();
    const current = () => version === this.scopeVersion && owner === this.user.user()?.sub && project === this.context.activeContextUid();
    this.previousAnswers.set(Object.fromEntries(answers.map((answer) => [answer.key, answer.text])));
    this.answering.set(true);
    this.error.set('');
    this.generation = this.runs
      .answerQuestions(pending.request, pending.pendingQuestions, answers)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => {
          if (!current() || progress.type !== 'submitted') return;
          this.questionsPending = null;
          this.questions.set([]);
          this.answering.set(false);
          this.pendingNotice.set(null);
          this.acceptedRequest.set(pending.request);
          void this.returnToDocument(pending.request);
        },
        error: (error: unknown) => {
          if (!current()) return;
          this.answering.set(false);
          const runId = pending.attempt?.runId ?? this.recordedRunId();
          const answeredBy =
            error instanceof HttpErrorResponse && error.status === 409
              ? mktgRunAnsweredBy(error.error, runId, pending.pendingQuestions?.questionsId ?? '')
              : null;
          if (answeredBy) {
            this.questionsPending = null;
            this.questions.set([]);
            this.pendingNotice.set(null);
            this.error.set('');
            this.attempts.save({ ...pending, state: 'writing', pendingQuestions: undefined, answeredQuestionsId: pending.pendingQuestions?.questionsId });
            this.acceptedRequest.set(pending.request);
            this.messages.add({ severity: 'info', summary: `${answeredBy} already answered these — the agent is writing.` });
            this.recordedProgress()?.acknowledgeAnswers(pending.pendingQuestions?.questionsId ?? '', '', runId);
            void this.returnToDocument(pending.request, null);
            return;
          }
          if (error instanceof HttpErrorResponse && (error.status === 409 || error.status === 412)) {
            this.questionsPending = null;
            this.questions.set([]);
            this.pendingNotice.set(null);
            this.error.set('');
            this.attempts.save({ ...pending, state: 'questions', pendingQuestions: undefined });
            this.acceptedRequest.set(pending.request);
            void this.returnToDocument(pending.request, null);
            return;
          }
          this.error.set(
            extractErrorMessage(error instanceof HttpErrorResponse ? error : undefined, 'Your answers could not be sent. They are kept — try again.')
          );
        },
      });
  }

  protected onOpenPending(): void {
    const pending = this.pendingNotice();
    if (!pending || !this.writer() || this.busy()) return;
    void this.router.navigate([mktgKitRootPath(this.router.url), 'documents', this.intake().agentId, pending.documentId], {
      queryParams: {
        project: this.context.activeContext()?.slug ?? null,
        ...MKTG_RUN_RESUME_QUERY_CLEAR,
        profile: null,
        profileDocument: null,
      },
      replaceUrl: true,
    });
  }

  protected onOpenAccepted(): void {
    const request = this.acceptedRequest();
    if (request && !this.busy()) void this.returnToDocument(request, null); // Public server record needs no browser capability.
  }

  /** The ownRuns projection, not private storage or activity/name inference, chooses this writer's run. */
  private reconcileOwnRuns(snapshot: MktgDocumentsResponse, hint: MktgPendingGeneration | null = null): void {
    const project = this.context.activeContextUid();
    if (snapshot.project !== project || snapshot.progressUnavailable || this.route.snapshot.queryParamMap.get('profile') === 'edit') return;
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === this.intake().agentId);
    const selected = this.route.snapshot.queryParamMap.get('run');
    const candidates =
      snapshot.runs?.filter(
        (run) =>
          run.project === project &&
          run.agentKey === type?.agentKey &&
          (selected ? run.runId === selected : run.state === 'writing' || run.state === 'storing' || run.state === 'questions')
      ) ?? [];
    const row = candidates.find((candidate) => {
      if (snapshot.creatorScoped === true) return true;
      const owned = hint ?? this.attempts.load(project, this.intake().agentId, candidate.documentId);
      return (
        owned?.request.projectUid === project &&
        owned.request.agentId === this.intake().agentId &&
        owned.attempt?.runId === candidate.runId &&
        (owned.request.documentId ?? owned.attempt.documentId) === candidate.documentId
      );
    });
    if (!row && candidates.length) {
      this.runWarning.set('Your active drafts could not be verified. Your inputs are available; check Documents before drafting.');
      this.checkingPending.set(false);
      return;
    }
    if (!row) {
      if (hint?.pendingQuestions && !this.serverRun()) {
        // Retain input hints, never a questions turn/capability contradicted by a successful server lookup.
        this.attempts.save({ request: hint.request, state: 'draft', requiresReattachment: true, updatedAt: new Date().toISOString() });
      }
      if (this.serverRun()) this.recordedProgress()?.recheck();
      else if (selected) {
        this.runLookupFailed.set(true);
        this.error.set('This recorded run could not be found. Open Documents to check its current state.');
      }
      return;
    }
    if (this.recordedRunId() === row.runId) {
      this.serverRun.set(row);
      if (row.state !== 'questions' && this.questions().length) {
        this.questionsPending = null;
        this.questions.set([]);
        this.checkingPending.set(true);
        this.recordedProgress()?.recheck();
      }
      return;
    }
    const pending = hint ?? this.attempts.load(project, this.intake().agentId, row.documentId);
    const matched =
      pending && pending.attempt && pending.attempt.runId === row.runId && (pending.request.documentId ?? pending.attempt.documentId) === row.documentId
        ? pending
        : null;
    this.recordedPending.set(matched);
    this.recordedRequest.set(
      matched?.request ?? { projectUid: project, agentId: this.intake().agentId, intake: this.intake(), documentId: row.documentId, answers: {} }
    );
    this.serverRun.set(row);
    this.questionsPending = null;
    this.questions.set([]);
    this.pendingNotice.set(null);
    this.checkingPending.set(true);
  }

  private async returnToDocument(request: MktgGenerateRequest, generation: string | null = this.attempts.prepare(request, true)): Promise<void> {
    if (!request.documentId || generation === '') {
      this.busy.set(false);
      return;
    }
    const version = this.scopeVersion;
    this.busy.set(true);
    try {
      // Replace the entry before pushing its accepted document: Back must not restore mode=new.
      if (this.freshMode()) await this.consumeFreshMode();
      if (this.destroyRef.destroyed || version !== this.scopeVersion) return;
      await this.router.navigate([mktgKitRootPath(this.router.url), 'documents', request.agentId, request.documentId], {
        ...(generation === null && this.serverRun() && { replaceUrl: true }),
        queryParams: {
          project: this.context.activeContext()?.slug ?? null,
          ...MKTG_RUN_RESUME_QUERY_CLEAR,
          profile: null,
          profileDocument: null,
          source: parseLinkedinContentSource(request.answers['content_source'] ?? this.route.snapshot.queryParamMap.get('source')),
          generation,
          run: generation === null ? this.recordedRunId() || null : null,
        },
      });
    } catch {
      // Acceptance is durable; expose Open rather than pretending the server run failed.
    } finally {
      if (!this.destroyRef.destroyed && version === this.scopeVersion) {
        this.busy.set(false);
        this.checkingPending.set(false);
      }
    }
  }
  private async consumeFreshMode(): Promise<void> {
    if (this.freshMode())
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { mode: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
  }

  /** Entry-only source restoration; independent of accepted-start navigation and run ownership. */
  private initLastIntakeRestore(): void {
    toObservable(
      computed(() => ({
        project: this.context.activeContextUid(),
        sub: this.user.user()?.sub,
        writer: this.writer(),
        fresh: this.freshMode(),
        grant: this.historyGrant(),
        reload: this.reload(),
        ready: !this.loading() && !this.checkingPending() && !this.serverRun() && !this.runLookupFailed(),
      }))
    )
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(({ project, sub, writer, fresh, grant, ready }) => {
          this.lastIntakeDenied.set(false);
          this.lastIntakeNote.set('');
          this.lastIntakeLoading.set(false);
          if (!project || !sub || !writer || !fresh || !ready || grant !== JSON.stringify([project, sub])) return of(null);
          this.contentForm.reset();
          this.file.set(null);
          this.source.set(parseLinkedinContentSource(this.route.snapshot.queryParamMap.get('source')));
          this.lastIntakeLoading.set(true);
          return this.runs.lastIntake(project, this.intake().agentId).pipe(
            catchError((error: unknown) => {
              this.lastIntakeDenied.set(error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403));
              this.lastIntakeNote.set(
                this.lastIntakeDenied()
                  ? 'You need write access to run this project’s agents.'
                  : 'Last run inputs could not be loaded. Enter the source to draft.'
              );
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((intake) => {
        this.lastIntakeLoading.set(false);
        if (!intake || this.contentForm.dirty) return;
        const answers = intake.answers;
        const source = parseLinkedinContentSource(answers['content_source'] ?? null);
        this.source.set(source);
        this.contentForm.patchValue(
          { text: answers['content_text'] ?? '', url: answers['content_url'] ?? '', share_link: answers[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? '' },
          { emitEvent: false }
        );
        // Restore silently to preserve share-link ownership, but refresh advisory state.
        this.contentUrl.set(this.contentForm.controls.url.value);
        if (source === 'url' && this.contentForm.controls.share_link.value !== this.contentForm.controls.url.value)
          this.contentForm.controls.share_link.markAsDirty();
        if (source === 'file') this.lastIntakeNote.set('The last run used a file — choose it again to draft.');
        else if (source === 'text' && !Object.hasOwn(answers, 'content_text'))
          this.lastIntakeNote.set('Last source text was not kept — paste it again to draft.');
      });
  }

  private applySource(source: LinkedinContentSource): void {
    if (source !== this.source()) this.acceptedRequest.set(null);
    this.sourceReentry = '';
    if (source !== this.source()) this.file.set(null);
    this.source.set(source);
    this.contentForm.controls.share_link.setValue(source === 'url' ? this.contentForm.controls.url.value : '');
    this.contentForm.controls.share_link.markAsPristine();
    this.error.set('');
  }
  private finishEditing(returnToOrigin = true): void {
    this.editing.set(false);
    if (this.route.snapshot.queryParamMap.get('profile') !== 'edit') return;
    const origin = this.editEntryOrigin();
    if (origin && (returnToOrigin || origin === LINKEDIN_PROFILE_EDIT_ORIGINS.run)) {
      this.location.back();
      return;
    }
    // A document-origin setup has no persisted profile yet; cold entries also stay here.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        profile: null,
        project: this.context.activeContext()?.slug ?? null,
        ...(this.route.snapshot.queryParamMap.has('profileDocument') && { profileDocument: null }),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private editEntryOrigin(): string | null {
    const state = this.location.getState();
    if (!state || typeof state !== 'object' || !(LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY in state)) return null;
    const marker = state[LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY];
    if (marker === LINKEDIN_PROFILE_EDIT_ORIGINS.run) return marker;
    // Legacy boolean entries stay conservative for setup-only submissions.
    if (marker === true || marker === LINKEDIN_PROFILE_EDIT_ORIGINS.document) return LINKEDIN_PROFILE_EDIT_ORIGINS.document;
    return null;
  }
  private fillProfile(): void {
    this.profileForm.reset();
    const profile = this.saved()?.profile;
    const setup = this.setup();
    if (profile) this.profileForm.patchValue({ ...profile.about, ...profile.voice });
    else if (setup) this.profileForm.patchValue(setup);
    else this.profileForm.patchValue({ name: this.user.user()?.name ?? '' });
  }
  private failedRun(error?: unknown): void {
    this.busy.set(false);
    this.error.set(
      extractErrorMessage(
        error instanceof HttpErrorResponse ? error : undefined,
        'The draft could not be completed and stored. Your inputs are kept — try again.'
      )
    );
  }
  private readFile(file: File): Promise<string> {
    if (!isPlatformBrowser(this.platform)) return Promise.reject(new Error('File reading is browser-only.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
  }
}
