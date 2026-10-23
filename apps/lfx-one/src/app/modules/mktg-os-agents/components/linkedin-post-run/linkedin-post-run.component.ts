// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  LINKEDIN_ABOUT_FIELDS,
  LINKEDIN_PAGE_LABEL,
  LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY,
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
  MKTG_AGENTS,
  MKTG_RUN_FAILURE_REASON,
  MKTG_RUN_NEW_MODE,
} from '@lfx-one/shared/constants';
import {
  LinkedinContentSource,
  LinkedinEnvelope,
  LinkedinGeneration,
  LinkedinSetup,
  LinkedinStoredProfile,
  LinkedinResult,
  MktgAgentIntake,
  MktgRunAnswer,
  MktgRunQuestion,
  MktgRunActivity,
} from '@lfx-one/shared/interfaces';
import { isLinkedinSetup, normalizeLinkedinShareLink, mktgKitCrumbsFor, mktgKitRootPath } from '@lfx-one/shared/utils';
import { LinkedinPostService } from '@services/linkedin-post.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { FileSelectEvent } from 'primeng/fileupload';
import { catchError, distinctUntilChanged, map, of, Subscription, switchMap, Observable } from 'rxjs';

import { LinkedinPostOptionsComponent } from '../linkedin-post-options/linkedin-post-options.component';
import { MktgBreadcrumbComponent } from '../mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgRunQuestionsComponent } from '../../mktg-run-questions/mktg-run-questions.component';
import { MktgRunActivityComponent } from '../../mktg-run-activity/mktg-run-activity.component';

/** Page-8 profile and three-option layout. Revision/comments deliberately belong to a later item. */
@Component({
  selector: 'lfx-linkedin-post-run',
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FileUploadComponent,
    InputTextComponent,
    TextareaComponent,
    LinkedinPostOptionsComponent,
    MktgBreadcrumbComponent,
    MktgRunQuestionsComponent,
    MktgRunActivityComponent,
  ],
  templateUrl: './linkedin-post-run.component.html',
  styleUrl: './linkedin-post-run.component.scss',
})
export class LinkedinPostRunComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly api = inject(LinkedinPostService);
  private readonly history = inject(MktgAgentRunService);
  private readonly documents = inject(MktgDocumentStoreService);
  protected readonly context = inject(ProjectContextService);
  private readonly projects = inject(ProjectService);
  private readonly user = inject(UserService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

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
  protected readonly aboutFields = LINKEDIN_ABOUT_FIELDS;
  protected readonly voiceFields = LINKEDIN_VOICE_FIELDS;
  protected readonly sources = LINKEDIN_CONTENT_SOURCES;
  protected readonly maxFileBytes = LINKEDIN_SOURCE_MAX_BYTES;
  protected readonly maxProfileChars = LINKEDIN_PROFILE_MAX_FIELD_CHARS;
  protected readonly fileAccept = LINKEDIN_FILE_ACCEPT;
  protected readonly fileTypesLabel = LINKEDIN_FILE_TYPES_LABEL;
  protected readonly maxShareLinkChars = LINKEDIN_SHARE_LINK_MAX_CHARS;
  protected readonly shareLinkHint = LINKEDIN_SHARE_LINK_HINT;
  protected readonly pageLabel = LINKEDIN_PAGE_LABEL;
  protected readonly crumbs = computed(() =>
    mktgKitCrumbsFor(this.intake().agentId, this.projectName(), mktgKitRootPath(this.router.url), this.agent()?.name ?? this.pageLabel)
  );
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
  protected readonly runFailed = signal(false);
  protected readonly editing = signal(false);
  protected readonly saved = signal<LinkedinStoredProfile | null>(null);
  protected readonly profileSaved = signal(false);
  protected readonly setup = signal<LinkedinSetup | null>(null);
  protected readonly source = signal<LinkedinContentSource>('text');
  protected readonly file = signal<File | null>(null);
  protected readonly result = signal<LinkedinEnvelope | null>(null);
  protected readonly run = signal<LinkedinGeneration | null>(null);
  protected readonly voiceSaved = signal(false);
  protected readonly reload = signal(0);
  protected readonly questions = signal<MktgRunQuestion[]>([]);
  protected readonly questionsId = signal('');
  protected readonly questionsProject = signal('');
  protected readonly previousAnswers = signal<Record<string, string>>({});
  protected readonly answering = signal(false);
  protected readonly activity = signal<MktgRunActivity[]>([]);
  protected readonly startedAt = signal(0);
  protected readonly savedShareLink = signal('');
  protected readonly linkSaving = signal(false);
  protected readonly linkStatus = signal('');
  protected readonly linkError = signal('');
  protected readonly projectName = computed(() => this.context.activeContext()?.name ?? '');
  protected readonly agent = computed(() => MKTG_AGENTS.find((entry) => entry.id === this.intake().agentId));
  protected readonly writingAs = computed(() => this.saved()?.profile.about.name ?? this.setup()?.name ?? '');
  private readonly scope$ = toObservable(computed(() => ({ context: this.context.activeContext(), sub: this.user.user()?.sub, reload: this.reload() })));

  private generation: Subscription | null = null;
  private scopeVersion = 0;
  private shareSave: Subscription | null = null;
  private queuedShareLink: string | null = null;
  private openAfterLinkSave = false;
  private draftAfterLinkSave = false;

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
        if (editing) {
          if (!this.editing()) this.fillProfile();
        }
        this.editing.set(editing);
      });
    this.route.queryParamMap
      .pipe(
        map((params) => this.sources.find((source) => source.value === params.get('source'))?.value ?? 'text'),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((source) => {
        if (source !== this.source()) this.applySource(source);
      });
    this.contentForm.controls.url.valueChanges.pipe(takeUntilDestroyed()).subscribe((url) => {
      if (this.source() === 'url' && !this.contentForm.controls.share_link.dirty) this.contentForm.controls.share_link.setValue(url);
    });
    this.scope$
      .pipe(
        distinctUntilChanged((a, b) => a.context?.uid === b.context?.uid && a.sub === b.sub && a.reload === b.reload),
        switchMap(({ context, sub }) => {
          this.scopeVersion++;
          this.generation?.unsubscribe();
          this.shareSave?.unsubscribe();
          this.queuedShareLink = null;
          this.openAfterLinkSave = false;
          this.draftAfterLinkSave = false;
          this.questions.set([]);
          this.questionsId.set('');
          this.questionsProject.set('');
          this.previousAnswers.set({});
          this.answering.set(false);
          this.activity.set([]);
          this.startedAt.set(0);
          this.savedShareLink.set('');
          this.linkSaving.set(false);
          this.linkStatus.set('');
          this.linkError.set('');
          this.busy.set(false);
          this.loading.set(true);
          this.writer.set(false);
          this.historyGrant.set('');
          this.saved.set(null);
          this.profileSaved.set(false);
          this.setup.set(null);
          this.result.set(null);
          this.run.set(null);
          this.runFailed.set(false);
          this.error.set('');
          this.editing.set(false);
          this.file.set(null);
          this.profileForm.reset();
          this.contentForm.reset();
          this.source.set(this.sources.find((source) => source.value === this.route.snapshot.queryParamMap.get('source'))?.value ?? 'text');
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
        if (response) {
          this.fillProfile();
          const editProfile = this.route.snapshot.queryParamMap.get('profile') === 'edit';
          this.editing.set(!response.profile || editProfile);
          const pending = this.api.pending(this.intake(), this.context.activeContextUid());
          if (pending) {
            this.run.set(pending);
            this.consumeFreshMode();
            this.contentForm.controls.share_link.setValue(pending.answers?.[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? '');
            if (!editProfile) {
              this.editing.set(false);
              this.onRetryRun();
            }
          }
        }
      });
  }

  protected onAddLink(): void {
    if (!isPlatformBrowser(this.platform) || this.busy()) return;
    const input = this.host.nativeElement.querySelector<HTMLInputElement>('#linkedin-share-link');
    input?.focus();
    input?.scrollIntoView({ block: 'center' });
  }

  protected onShareLinkEnter(event: Event): void {
    event.preventDefault();
    this.onApplyShareLink();
  }

  protected onApplyShareLink(): void {
    // Automatic source-URL prefill belongs to the NEXT run, never the stored result.
    if (!this.writer() || this.busy() || !this.contentForm.controls.share_link.dirty) return;
    const link = normalizeLinkedinShareLink(this.contentForm.controls.share_link.value);
    if (link === null) {
      this.queuedShareLink = null;
      this.openAfterLinkSave = false;
      this.draftAfterLinkSave = false;
      this.linkError.set('Enter one HTTPS link or leave it empty.');
      return;
    }
    this.linkError.set('');
    this.contentForm.controls.share_link.setValue(link);
    const run = this.run();
    const project = this.context.activeContextUid();
    if (!run || !project || !this.result()) return;
    if (this.linkSaving()) {
      this.queuedShareLink = link;
      return;
    }
    if (link !== this.savedShareLink()) this.saveShareLink(link, run, project);
  }

  protected onEdit(): void {
    this.fillProfile();
    this.error.set('');
    this.editing.set(true);
    void this.router.navigate([], {
      relativeTo: this.route,
      state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: true },
      queryParams: { profile: 'edit', project: this.context.activeContext()?.slug ?? null },
      queryParamsHandling: 'merge',
    });
  }
  protected onCancelEdit(): void {
    this.finishEditing();
    this.error.set(this.runFailed() ? MKTG_RUN_FAILURE_REASON : '');
    if (!this.runFailed() && this.run() && !this.result()) this.onRetryRun();
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
    if (!this.saved() && !this.result()) {
      this.setup.set(answers);
      this.finishEditing(false);
      if (this.runFailed()) this.error.set('Your setup is ready. Retry to draft with your kept source inputs.');
      return;
    }
    this.busy.set(true);
    this.generation = this.api
      .save({ setup: answers })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saved.set(response.profile);
          this.profileSaved.set(true);
          this.setup.set(null);
          this.finishEditing();
          this.busy.set(false);
          if (this.runFailed()) this.error.set(MKTG_RUN_FAILURE_REASON);
          else if (this.run() && !this.result()) this.onRetryRun();
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
  protected onFile(event: FileSelectEvent): void {
    this.file.set(event.files[0] ?? null);
    this.contentForm.markAsDirty();
    this.error.set('');
  }
  protected async onDraft(): Promise<void> {
    const project = this.context.activeContextUid();
    if (
      !project ||
      !this.writer() ||
      this.busy() ||
      this.editing() ||
      this.questions().length ||
      this.answering() ||
      this.lastIntakeLoading() ||
      this.lastIntakeDenied()
    )
      return;
    // Draft takes the field value for a NEW document; it must never PATCH the old result.
    // Retain H1 only when an explicit, dirty blur/Enter save is already in flight.
    if (this.linkSaving() && this.contentForm.controls.share_link.dirty) {
      this.draftAfterLinkSave = true;
      this.openAfterLinkSave = false;
      return;
    }
    this.busy.set(true);
    this.startedAt.set(Date.now());
    this.profileSaved.set(false);
    this.activity.set([]);
    this.questionsId.set('');
    this.questionsProject.set('');
    this.previousAnswers.set({});
    this.error.set('');
    this.voiceSaved.set(false);
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
      // Only retire A's save after B's inputs (including asynchronous file reading) are valid.
      this.shareSave?.unsubscribe();
      this.linkSaving.set(false);
      this.queuedShareLink = null;
      this.openAfterLinkSave = false;
      this.draftAfterLinkSave = false;
      this.result.set(null);
      this.linkError.set('');
      this.linkStatus.set('');
      this.run.set(null);
      this.runFailed.set(false);
      this.generation = this.api
        .start(this.intake(), project, answers, this.setup() ?? undefined)
        .pipe(
          switchMap((run) => {
            this.run.set(run);
            this.consumeFreshMode();
            return this.waitForRun(project, run);
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe({ next: (response) => this.handleResult(response), error: (error: unknown) => this.failedRun(error) });
    } catch (error) {
      if (version === this.scopeVersion) {
        this.busy.set(false);
        this.error.set(error instanceof Error ? error.message : 'Content could not be read.');
      }
    }
  }
  protected onRetryRun(): void {
    const run = this.run();
    const project = this.context.activeContextUid();
    if (!run || !project || this.busy() || this.questions().length) return;
    if (this.runFailed() || !this.startedAt()) this.startedAt.set(Date.now());
    this.busy.set(true);
    this.error.set('');
    const inputs = run.retryInputs;
    if (this.runFailed() && !this.saved() && !inputs?.setup && !this.setup()) {
      this.busy.set(false);
      this.profileForm.reset();
      this.editing.set(true);
      this.error.set("Your setup answers aren't kept in the browser — enter them again to draft");
      return;
    }
    if (this.runFailed() && inputs?.requiresSource) {
      const source = this.sources.find((candidate) => candidate.value === inputs.answers['content_source'])?.value ?? 'text';
      this.busy.set(false);
      this.source.set(source);
      this.file.set(null);
      this.contentForm.controls.text.setValue('');
      this.contentForm.controls.url.setValue('');
      this.run.set(null);
      this.runFailed.set(false);
      if (source === 'file') this.error.set("Your source isn't kept in the browser — choose the file again to draft");
      else if (source === 'url') this.error.set("Your source isn't kept in the browser — enter the link again to draft");
      else this.error.set("Your source isn't kept in the browser — paste it again to draft");
      return;
    }
    if (this.runFailed() && !inputs) {
      this.busy.set(false);
      this.error.set('This failed run cannot be resumed. Your inputs are kept — draft again to start a new run.');
      return;
    }
    const outcome =
      this.runFailed() && inputs
        ? this.api.start(this.intake(), project, inputs.answers, inputs.setup ?? this.setup() ?? undefined).pipe(
            switchMap((fresh) => {
              this.run.set(fresh);
              this.consumeFreshMode();
              this.runFailed.set(false);
              return this.waitForRun(project, fresh);
            })
          )
        : this.waitForRun(project, run);
    this.generation = outcome
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (response) => this.handleResult(response), error: (error: unknown) => this.failedRun(error) });
  }
  protected onOpenDocument(): void {
    this.onApplyShareLink();
    if (this.linkError()) return;
    if (this.linkSaving()) {
      this.openAfterLinkSave = true;
      this.draftAfterLinkSave = false;
      return;
    }
    const run = this.run();
    if (run) this.navigateToDocument(run);
  }
  protected onAnswers(answers: MktgRunAnswer[]): void {
    const run = this.run();
    const project = this.context.activeContextUid();
    const questionsId = this.questionsId();
    if (!run || !project || !questionsId || !this.questions().length || this.answering()) return;
    this.previousAnswers.set(Object.fromEntries(answers.map((answer) => [answer.key, answer.text])));
    this.answering.set(true);
    this.error.set('');
    this.generation = this.api
      .answer(this.intake(), project, run, questionsId, answers)
      .pipe(
        switchMap(() => {
          const resumed = { ...run, answeredQuestionsId: questionsId };
          this.run.set(resumed);
          this.questions.set([]);
          this.answering.set(false);
          this.busy.set(true);
          this.startedAt.set(Date.now());
          return this.waitForRun(project, resumed);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => this.handleResult(response),
        error: (error: unknown) => {
          this.answering.set(false);
          this.busy.set(false);
          if (this.questions().length)
            this.error.set(
              extractErrorMessage(error instanceof HttpErrorResponse ? error : undefined, 'Your answers could not be sent. They are kept — try again.')
            );
          else this.failedRun();
        },
      });
  }

  protected onSaveVoice(): void {
    const result = this.result();
    if (!result?.profile_update_note || this.busy()) return;
    this.busy.set(true);
    this.generation = this.api
      .profile()
      .pipe(
        switchMap(({ profile }) => {
          if (!profile) throw new Error('The saved profile is unavailable.');
          return this.api.save({ profile: { ...profile.profile, voice: result.profile.voice } });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => {
          this.saved.set(response.profile);
          this.voiceSaved.set(true);
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.error.set('The updated voice could not be saved. Try again.');
        },
      });
  }
  private consumeFreshMode(): void {
    if (this.freshMode())
      void this.router.navigate([], {
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
        pending: !!this.run(),
      }))
    )
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(({ project, sub, writer, fresh, grant, ready, pending }) => {
          this.lastIntakeDenied.set(false);
          this.lastIntakeNote.set('');
          this.lastIntakeLoading.set(false);
          if (!project || !sub || !writer || !fresh || !ready || pending || grant !== JSON.stringify([project, sub])) return of(null);
          this.contentForm.reset();
          this.file.set(null);
          this.source.set(this.sources.find((item) => item.value === this.route.snapshot.queryParamMap.get('source'))?.value ?? 'text');
          this.lastIntakeLoading.set(true);
          return this.history.lastIntake(project, this.intake().agentId).pipe(
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
        const source = this.sources.find((item) => item.value === answers['content_source'])?.value ?? 'text';
        this.source.set(source);
        this.contentForm.patchValue(
          { text: answers['content_text'] ?? '', url: answers['content_url'] ?? '', share_link: answers[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? '' },
          { emitEvent: false }
        );
        if (source === 'file') this.lastIntakeNote.set('The last run used a file — choose it again to draft.');
        else if (source === 'text' && !Object.hasOwn(answers, 'content_text'))
          this.lastIntakeNote.set('Last source text was not kept — paste it again to draft.');
      });
  }

  private waitForRun(project: string, run: LinkedinGeneration): Observable<LinkedinResult> {
    return this.api.wait(this.intake(), project, run, (response) => this.activity.set(response.activity ?? []));
  }

  private handleResult(response: LinkedinResult): void {
    this.activity.set(response.activity ?? []);
    if (response.status === 'failed') {
      this.busy.set(false);
      this.questions.set([]);
      this.runFailed.set(true);
      // An idle failureText is a raw final reply, not requester-safe provider diagnostics.
      this.error.set(response.failure?.reason ?? MKTG_RUN_FAILURE_REASON);
      return;
    }
    if (response.status === 'questions' && response.questions?.length && response.questionsId) {
      this.busy.set(false);
      this.questions.set(response.questions);
      this.questionsId.set(response.questionsId);
      this.questionsProject.set(response.questionsProject ?? this.projectName());
      return;
    }
    this.questions.set([]);
    this.complete(response.envelope, response.profileSaved);
    if (response.envelope?.profile_source === 'first_run_setup' && response.profileSaved === false)
      this.error.set('Your post is saved, but your profile is not saved. Edit profile to save the settings explicitly when writes are available.');
  }

  private saveShareLink(link: string, run: LinkedinGeneration, project: string): void {
    const version = this.scopeVersion;
    const owner = this.user.user()?.sub;
    this.linkSaving.set(true);
    this.linkStatus.set('Saving…');
    this.shareSave = this.documents
      .saveLinkedinShareLink(project, run.documentId, link)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (version !== this.scopeVersion || owner !== this.user.user()?.sub || this.run()?.documentId !== run.documentId) return;
          this.savedShareLink.set(response.share_link);
          if (normalizeLinkedinShareLink(this.contentForm.controls.share_link.value) === response.share_link)
            this.contentForm.controls.share_link.markAsPristine();
          const updatedRun = { ...run, answers: { ...run.answers, [LINKEDIN_SHARE_LINK_ANSWER_KEY]: response.share_link } };
          this.run.set(updatedRun);
          this.api.rememberShareLink(project, updatedRun, response.share_link);
          this.linkSaving.set(false);
          this.linkStatus.set('Link saved');
          const queued = this.queuedShareLink;
          this.queuedShareLink = null;
          if (queued !== null && queued !== response.share_link) this.saveShareLink(queued, updatedRun, project);
          else if (this.draftAfterLinkSave && !this.linkError()) {
            this.draftAfterLinkSave = false;
            void this.onDraft();
          } else if (this.openAfterLinkSave && !this.linkError()) {
            this.openAfterLinkSave = false;
            this.navigateToDocument(updatedRun);
          }
        },
        error: () => {
          if (version !== this.scopeVersion || owner !== this.user.user()?.sub || this.run()?.documentId !== run.documentId) return;
          this.queuedShareLink = null;
          this.openAfterLinkSave = false;
          this.draftAfterLinkSave = false;
          this.linkSaving.set(false);
          this.linkStatus.set('');
          this.linkError.set('The link could not be saved. Your saved post is unchanged. Try again, or restore the saved link.');
        },
      });
  }

  private navigateToDocument(run: LinkedinGeneration): void {
    void this.router.navigate(['..', 'documents', this.intake().agentId, run.documentId], {
      relativeTo: this.route,
      queryParams: { profile: null },
      queryParamsHandling: 'merge',
    });
  }

  private applySource(source: LinkedinContentSource): void {
    if (source !== this.source()) this.file.set(null);
    this.source.set(source);
    this.contentForm.controls.share_link.setValue(source === 'url' ? this.contentForm.controls.url.value : '');
    this.contentForm.controls.share_link.markAsPristine();
    this.error.set('');
  }

  private finishEditing(returnToOrigin = true): void {
    this.editing.set(false);
    if (this.route.snapshot.queryParamMap.get('profile') !== 'edit') return;
    if (returnToOrigin && this.editEntryWasPushed()) {
      this.location.back();
      return;
    }
    // Cold entries and setup-only submissions must stay here; setup is not persisted yet.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { profile: null, project: this.context.activeContext()?.slug ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private editEntryWasPushed(): boolean {
    const state = this.location.getState();
    return !!state && typeof state === 'object' && LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY in state && state[LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY] === true;
  }

  private fillProfile(): void {
    this.profileForm.reset();
    const profile = this.saved()?.profile;
    const setup = this.setup();
    if (profile) this.profileForm.patchValue({ ...profile.about, ...profile.voice });
    else if (setup) this.profileForm.patchValue(setup);
    else this.profileForm.patchValue({ name: this.user.user()?.name ?? '' });
  }
  private complete(envelope?: LinkedinEnvelope, profileSaved = false): void {
    this.busy.set(false);
    if (!envelope) {
      this.failedRun();
      return;
    }
    this.result.set(envelope);
    this.profileSaved.set(profileSaved);
    this.savedShareLink.set(
      normalizeLinkedinShareLink(this.run()?.answers?.[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? this.contentForm.controls.share_link.value) ?? ''
    );
    if (normalizeLinkedinShareLink(this.contentForm.controls.share_link.value) === this.savedShareLink()) this.contentForm.controls.share_link.markAsPristine();
    if (envelope.profile_source === 'first_run_setup' && !this.saved()) {
      if (profileSaved) {
        this.saved.set({ profile: envelope.profile, profile_markdown: envelope.profile_markdown });
        this.setup.set(null);
      } else if (!this.setup()) this.setup.set({ ...envelope.profile.about, ...envelope.profile.voice });
    }
  }
  private failedRun(error?: unknown): void {
    this.busy.set(false);
    this.error.set(
      extractErrorMessage(
        error instanceof HttpErrorResponse ? error : undefined,
        'The draft could not be completed and stored. Your inputs are kept. Retry finishing this run, or draft again.'
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
