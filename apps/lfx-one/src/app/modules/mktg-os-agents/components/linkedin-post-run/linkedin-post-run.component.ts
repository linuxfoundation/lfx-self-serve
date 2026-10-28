// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  LINKEDIN_ABOUT_FIELDS,
  LINKEDIN_INTAKE_LABEL,
  LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY,
  LINKEDIN_PROFILE_EDIT_ORIGINS,
  LINKEDIN_SOURCE_LINK_HINT,
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
  MKTG_RUN_ACTIVE_DIALOG_KEYS,
  MKTG_RUN_RESUME_QUERY_CLEAR,
} from '@lfx-one/shared/constants';
import {
  LinkedinContentSource,
  LinkedinSetup,
  LinkedinStoredProfile,
  MktgAgentIntake,
  MktgGenerateRequest,
  MktgDocumentReadCycle,
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
  mktgActiveRunConflictHeading,
} from '@lfx-one/shared/utils';
import { LinkedinPostService } from '@services/linkedin-post.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { FileSelectEvent } from 'primeng/fileupload';
import { ConfirmationService, ConfirmEventType } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, distinctUntilChanged, map, of, Subscription, switchMap, take } from 'rxjs';

import { MktgBreadcrumbComponent } from '../mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgRunQuestionsComponent } from '../../mktg-run-questions/mktg-run-questions.component';
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
  ],
  templateUrl: './linkedin-post-run.component.html',
  styleUrl: './linkedin-post-run.component.scss',
})
export class LinkedinPostRunComponent {
  private readonly api = inject(LinkedinPostService);
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
  protected readonly freshMode = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('mode') === MKTG_RUN_NEW_MODE)), { initialValue: false });
  private readonly historyGrant = signal('');
  protected readonly lastIntakeLoading = signal(false);
  protected readonly lastIntakeDenied = signal(false);
  protected readonly lastIntakeNote = signal('');
  protected readonly loading = signal(true);
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
  protected readonly checkingPending = signal(false);
  protected readonly recordedDocumentId = computed(() => this.recordedPending()?.request.documentId ?? this.recordedPending()?.attempt?.documentId ?? '');
  protected readonly recordedRunId = computed(() => this.recordedPending()?.attempt?.runId ?? '');
  protected readonly previousAnswers = signal<Record<string, string>>({});
  protected readonly answering = signal(false);
  protected readonly linkError = signal('');
  protected readonly explicitProfileSave = signal(false);
  protected readonly acceptedRequest = signal<MktgGenerateRequest | null>(null);
  protected readonly pendingNotice = signal<ReturnType<MktgRunAttemptService['latestPending']>>(null);
  protected readonly projectName = computed(() => this.context.activeContext()?.name ?? '');
  protected readonly writingAs = computed(() => this.saved()?.profile.about.name ?? this.setup()?.name ?? '');
  private readonly scope$ = toObservable(computed(() => ({ context: this.context.activeContext(), sub: this.user.user()?.sub, reload: this.reload() })));

  private generation: Subscription | null = null;
  private scopeVersion = 0;
  private sourceReentry = '';
  private questionsPending: MktgPendingGeneration | null = null;

  public constructor() {
    if (!isPlatformBrowser(this.platform)) return;
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
          this.checkingPending.set(false);
          this.acceptedRequest.set(null);
          this.pendingNotice.set(null);
          this.explicitProfileSave.set(false);
          this.questions.set([]);
          this.previousAnswers.set({});
          this.answering.set(false);
          this.busy.set(false);
          this.loading.set(true);
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
          if (!context || !sub) {
            this.error.set(context ? 'Sign in to load your LinkedIn profile.' : 'Select a project to continue.');
            this.loading.set(false);
            return of(null);
          }
          return this.projects.getProject(context.slug, false).pipe(
            switchMap((project) => {
              if (!project) throw new Error('Project unavailable');
              this.writer.set(!!project.writer);
              this.historyGrant.set(project.writer ? JSON.stringify([context.uid, sub]) : '');
              return project.writer ? this.api.profile() : of(null);
            }),
            catchError(() => {
              this.error.set('Your profile or project could not be loaded. Try again.');
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
        this.pendingNotice.set(latest);
        const pending = prepared?.pending ?? (latest ? this.attempts.load(this.context.activeContextUid(), this.intake().agentId, latest.documentId) : null);
        if (pending && (pending.request.documentId || pending.attempt?.documentId) && pending.state !== 'failed') {
          this.checkingPending.set(true);
          this.recordedPending.set(pending);
        } else if (pending?.pendingQuestions && pending.state !== 'failed') {
          this.questionsPending = pending;
          this.questions.set(pending.pendingQuestions.questions);
          this.editing.set(false);
        } else if (prepared?.pending.state === 'failed') {
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
  }

  protected onRecordedProgress(cycle: MktgDocumentReadCycle): void {
    const pending = this.recordedPending();
    if (!pending || cycle.detail.progressUnavailable || cycle.detail.project !== this.context.activeContextUid()) return;
    this.checkingPending.set(false);
    if (this.answering()) return;
    const run = cycle.detail.runs?.find((row) => row.runId === this.recordedRunId());
    if (run?.state === 'questions' || (!run && !cycle.detail.revisions.length)) {
      if (pending.pendingQuestions && !this.questions().length) {
        this.questionsPending = pending;
        this.questions.set(pending.pendingQuestions.questions);
        this.editing.set(false);
      }
      return;
    }
    this.questionsPending = null;
    this.questions.set([]);
    this.pendingNotice.set(null);
    if (this.acceptedRequest() === pending.request) return;
    this.acceptedRequest.set(pending.request);
    void this.returnToDocument(pending.request, null);
  }

  protected onRecordedReadError(): void {
    this.checkingPending.set(false);
    this.questions.set([]);
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
      const start = (discard?: string) => {
        if (!current()) return;
        this.busy.set(true);
        const call = discard
          ? this.api.startForDocument(this.intake(), project, answers, setup, discard)
          : this.api.startForDocument(this.intake(), project, answers, setup);
        this.generation = call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (session) => {
            if (!current()) return;
            const request = { agentId: this.intake().agentId, intake: this.intake(), projectUid: project, documentId: session.documentId, answers };
            this.acceptedRequest.set(request);
            void this.returnToDocument(request, this.attempts.prepareAccepted(request, session));
          },
          error: (error: unknown) => {
            if (!current()) return;
            const conflict = error instanceof HttpErrorResponse && error.status === 409 ? readMktgActiveRunConflict(error.error, this.intake().agentId) : null;
            if (!conflict) {
              this.failedRun(error);
              return;
            }
            this.busy.set(false);
            let decided = false;
            this.confirmation.confirm({
              key: this.conflictKey,
              header: mktgActiveRunConflictHeading(conflict),
              message: 'Its questions and progress will be lost.',
              acceptLabel: 'Discard and start over',
              rejectLabel: 'Open it',
              rejectButtonProps: { text: true },
              accept: () => {
                if (decided || !current()) return;
                decided = true;
                start(conflict.activeRunId);
              },
              reject: (reason: ConfirmEventType) => {
                if (decided) return;
                decided = true;
                if (reason === ConfirmEventType.REJECT && current())
                  void this.router.navigate([mktgKitRootPath(this.router.url), 'documents', conflict.agentKey, conflict.documentId], {
                    queryParams: { project: this.context.activeContext()?.slug, ...MKTG_RUN_RESUME_QUERY_CLEAR, run: conflict.activeRunId },
                  });
              },
            });
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
    if (!pending?.pendingQuestions || this.answering()) return;
    this.previousAnswers.set(Object.fromEntries(answers.map((answer) => [answer.key, answer.text])));
    this.answering.set(true);
    this.error.set('');
    this.generation = this.runs
      .answerQuestions(pending.request, pending.pendingQuestions, answers)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => {
          if (progress.type !== 'submitted') return;
          this.questions.set([]);
          this.answering.set(false);
          this.pendingNotice.set(null);
          this.acceptedRequest.set(pending.request);
          void this.returnToDocument(pending.request);
        },
        error: (error: unknown) => {
          this.answering.set(false);
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
        queryParams: {
          project: this.context.activeContext()?.slug ?? null,
          ...MKTG_RUN_RESUME_QUERY_CLEAR,
          profile: null,
          profileDocument: null,
          source: parseLinkedinContentSource(request.answers['content_source'] ?? this.route.snapshot.queryParamMap.get('source')),
          generation,
        },
      });
    } catch {
      // Acceptance is durable; expose Open rather than pretending the server run failed.
    } finally {
      if (!this.destroyRef.destroyed && version === this.scopeVersion) this.busy.set(false);
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
        ready: !this.loading(),
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
