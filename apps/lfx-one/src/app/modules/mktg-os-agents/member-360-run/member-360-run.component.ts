// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, formatDate, isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { MessageComponent } from '@components/message/message.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import {
  MEMBER_360_INTRO,
  MKTG_RUN_ACTIVE_DIALOG_KEYS,
  MKTG_RUN_RESUME_QUERY_CLEAR,
  MEMBER_360_MAX_BYTES,
  MEMBER_360_MAX_TRACKERS,
  MEMBER_360_WINDOW_OPTIONS,
  MEMBER_360_COMPARISON_UNAVAILABLE,
  MEMBER_360_TRACKER_FILENAME_REGEX,
  MEMBER_360_TRACKER_TYPE_ERROR,
  MEMBER_360_TRACKER_FILENAME_ERROR,
  MEMBER_360_TRACKER_EXTENSION_REGEX,
  MEMBER_360_RUN_CEILING_MS,
  MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS,
  MKTG_RUN_POLL,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_AGENT_INTAKES,
} from '@lfx-one/shared/constants';
import { readMktgActiveRunConflict, readMktgRunAnsweredConflict, mktgKitRootPath } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import {
  Member360Envelope,
  Member360GenerateRequest,
  Member360Session,
  Member360TrackerUpload,
  MktgDocumentListItem,
  MktgPendingGeneration,
  Member360Result,
  MktgRunAnswer,
  MktgDocumentRunProgress,
  MktgDocumentsResponse,
  MktgDocumentDetailResponse,
} from '@lfx-one/shared/interfaces';
import { Member360Service } from '@services/member-360.service';
import { MktgActiveRunGuardService } from '@services/mktg-active-run-guard.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';
import { MktgRunProgressComponent } from '../components/mktg-run-progress/mktg-run-progress.component';
import { MktgSkeletonComponent } from '@components/mktg-skeleton/mktg-skeleton.component';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { catchError, distinctUntilChanged, firstValueFrom, map, of, switchMap, tap, EMPTY, timer, finalize, take, Observable, startWith, filter } from 'rxjs';

@Component({
  selector: 'lfx-member-360-run',
  imports: [
    ConfirmDialogModule,
    DatePipe,
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    SelectComponent,
    FileUploadComponent,
    MessageComponent,
    MktgBreadcrumbComponent,
    MktgRunQuestionsComponent,
    MktgRunProgressComponent,
    MktgSkeletonComponent,
  ],
  templateUrl: './member-360-run.component.html',
  styleUrl: './member-360-run.component.scss',
})
export class Member360RunComponent {
  private readonly chooser = viewChild(FileUploadComponent);
  private readonly api = inject(Member360Service);
  private readonly attempts = inject(MktgRunAttemptService);
  private readonly documents = inject(MktgDocumentStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly doc = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly activeRunGuard = inject(MktgActiveRunGuardService);
  protected readonly conflictKey = MKTG_RUN_ACTIVE_DIALOG_KEYS.member360;
  protected readonly context = inject(ProjectContextService);
  protected readonly intro = MEMBER_360_INTRO;
  protected readonly trackerMaxBytes = MEMBER_360_MAX_BYTES;
  protected readonly windowOptions = MEMBER_360_WINDOW_OPTIONS.map((option) => ({
    ...option,
    label: option.value === 'year' ? `Calendar year ${new Date().getUTCFullYear()}` : option.label,
  }));
  public readonly form = new FormGroup({
    window: new FormControl<NonNullable<Member360GenerateRequest['window']>>('12', { nonNullable: true }),
    compare: new FormControl(true, { nonNullable: true }),
    trackers: new FormControl<Member360TrackerUpload[]>([], { nonNullable: true }),
  });
  protected readonly latest = signal<Member360Envelope | null>(null);
  protected readonly history = signal<MktgDocumentListItem[]>([]);
  protected readonly historyLoading = signal(true);
  protected readonly historyError = signal('');
  protected readonly error = signal('');
  protected readonly answersNotice = signal('');
  protected readonly uploading = signal(false);
  protected readonly submitting = signal(false);
  private readonly historyRetry = signal(0);
  private readonly confirmedScope = signal('');
  private readonly checkedHistoryScope = signal('');
  private readonly deniedScope = signal('');
  private readonly loadingIssue = signal<[string, string]>(['', '']);
  private readonly accepted = signal<[string, MktgPendingGeneration | null]>(['', null]);
  private readonly ownedContext = signal<[string, MktgDocumentRunProgress | null]>(['', null]);
  private readonly ownedRun = computed(() => (this.ownedContext()[0] === this.screenScope() ? this.ownedContext()[1] : null));
  private readonly resultContext = signal<[MktgPendingGeneration | null, Member360Result | null]>([null, null]);
  private readonly progressContext = signal<[MktgPendingGeneration | null, MktgDocumentDetailResponse | null]>([null, null]);
  protected readonly progressSnapshot = computed(() => (this.progressContext()[0] === this.pending() ? this.progressContext()[1] : null));
  protected readonly progressRunId = computed(() => this.ownedRun()?.runId ?? this.pending()?.attempt?.runId ?? '');
  protected readonly answering = signal(false);
  protected readonly stillRunning = signal(false);
  protected readonly startedAt = signal(0);
  protected readonly pollRetry = signal(0);
  private readonly screenScope = computed(() =>
    JSON.stringify([this.context.activeContextUid(), this.users.user()?.sub, this.context.canWrite(), !!this.context.activeProject()])
  );
  protected readonly serverDenied = computed(() => this.deniedScope() === this.screenScope());
  protected readonly loading = computed(() => {
    if (this.serverDenied() || (this.context.activeContextUid() && this.context.activeProject() && !this.context.canWrite())) return false;
    return this.confirmedScope() !== this.screenScope();
  });
  protected readonly loadingError = computed(() => (this.loadingIssue()[0] === this.screenScope() ? this.loadingIssue()[1] : ''));
  protected readonly pending = computed(() => {
    const [subject, pending] = this.accepted();
    return this.context.canWrite() && subject === this.users.user()?.sub && pending?.request.projectUid === this.context.activeContextUid() ? pending : null;
  });
  protected readonly trackers = toSignal(this.form.controls.trackers.valueChanges, { initialValue: this.form.controls.trackers.value });
  protected readonly result = computed(() => (this.resultContext()[0] === this.pending() ? this.resultContext()[1] : null));
  protected readonly questions = computed(() => {
    const result = this.result();
    return result?.status === 'needs_input' && result.questionsId ? (result.questions ?? []) : [];
  });
  protected readonly progressNote = computed(() => {
    if (this.stillRunning()) return 'Still running — checking the same run less often.';
    const turn = this.result();
    if (turn?.status === 'needs_input' && (!turn.questionsId || !turn.questions?.length))
      return 'The questions are not available yet. Checking the same run again.';
    return 'The document will open here when it is ready.';
  });
  protected readonly latestPeriod = computed(() => this.latest()?.period.label.replace(/^(\d{4})-(Q[1-4])$/, '$2 $1') ?? '');
  protected readonly compareOptions = this.initCompareOptions();
  protected readonly projectParams = computed(() => ({ project: this.context.activeContext()?.slug ?? null }));
  protected readonly projectQuery = computed((): Record<string, string> => {
    const project = this.context.activeContext()?.slug;
    return project ? { project } : {};
  });
  private lastScope = '';
  private scopeVersion = 0;
  private lastHistoryRevision = '';
  private uploadSequence = 0;
  private answerSequence = 0;
  private nextTrackerId = 0;
  private readonly scope$ = toObservable(
    computed(() => ({ key: this.screenScope(), project: this.context.activeContextUid(), user: this.users.user()?.sub ?? '', retry: this.historyRetry() }))
  );

  public constructor() {
    this.destroyRef.onDestroy(() => this.uploadSequence++);
    if (isPlatformBrowser(this.platformId)) {
      this.watchRun();
      this.watchHistory();
    }
  }

  protected retryHistory(): void {
    this.historyRetry.update((value) => value + 1);
  }

  protected run(): void {
    const project = this.context.activeContextUid();
    const user = this.users.user()?.sub;
    if (!project || !this.context.canWrite() || this.loading() || this.submitting() || this.pending()) return;
    if (this.uploading()) {
      this.error.set('Wait for your trackers to finish parsing, then create Member 360.');
      return;
    }
    if (this.historyLoading()) {
      this.error.set('Wait for run history to finish loading, then create Member 360.');
      return;
    }
    if (this.form.controls.compare.value && (this.historyError() || !this.latest())) {
      this.error.set(
        this.historyError()
          ? 'The previous run could not be read. Choose No comparison or retry history.'
          : 'There is no previous run to compare with. Choose No comparison to create Member 360.'
      );
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    const body: Member360GenerateRequest = {
      project,
      window: this.form.controls.window.value,
      compare: this.form.controls.compare.value,
      trackers: this.trackers().map((upload) => upload.tracker),
    };
    const version = this.scopeVersion;
    const current = () =>
      version === this.scopeVersion && !this.destroyRef.destroyed && project === this.context.activeContextUid() && user === this.users.user()?.sub;
    const onSession = (session: Member360Session) => {
      if (!current()) return;
      const pending = this.attempts.load(project, 'member-360', session.documentId);
      this.submitting.set(false);
      this.startedAt.set(Date.now());
      this.ownedContext.set([this.screenScope(), null]);
      this.accepted.set([user ?? '', pending]);
      if (!pending) this.error.set('The run started, but its creator capability could not be restored. Open it from run history.');
    };
    const start = (discard?: string) => {
      if (!current()) return;
      this.submitting.set(true);
      this.api
        .generate(discard ? { ...body, discard } : body)
        .pipe(take(1))
        .subscribe({
          next: onSession,
          error: (error: HttpErrorResponse) => {
            if (!current()) return;
            this.submitting.set(false);
            const conflict = error.status === 409 ? readMktgActiveRunConflict(error.error, 'member-360') : null;
            if (conflict) {
              this.activeRunGuard.open(
                this.confirmation,
                {
                  conflict,
                  current,
                  recheck: () => this.api.generate(body),
                  classify: (failure) =>
                    failure instanceof HttpErrorResponse && failure.status === 409 ? readMktgActiveRunConflict(failure.error, 'member-360') : null,
                  onValue: onSession,
                  onDiscard: (fresh) => start(fresh.activeRunId),
                  onOpen: (fresh) => {
                    void this.router.navigate([mktgKitRootPath(this.router.url), 'documents', fresh.agentKey, fresh.documentId], {
                      queryParams: { project: this.context.activeContext()?.slug, ...MKTG_RUN_RESUME_QUERY_CLEAR, run: fresh.activeRunId },
                    });
                  },
                  onError: () => {
                    this.submitting.set(false);
                    this.error.set('The start could not be confirmed. Check Documents before trying again.');
                  },
                },
                this.destroyRef,
                this.conflictKey
              );
              return;
            }
            let message = 'The run could not be started. Your trackers are still here; try again.';
            if (error.status === 403) message = 'You need write access to this project to run Member 360.';
            if (error.error?.code === MEMBER_360_COMPARISON_UNAVAILABLE) message = 'The previous run could not be read. Turn off comparison or retry.';
            this.error.set(message);
          },
        });
    };
    start();
  }

  protected rejectUnsupportedTrackers(selected: ArrayLike<File>): boolean {
    const files = Array.from(selected);
    const invalidType = files.some((file) => !MEMBER_360_TRACKER_EXTENSION_REGEX.test(file.name));
    const invalidName = files.some((file) => !MEMBER_360_TRACKER_FILENAME_REGEX.test(file.name));
    if (!invalidType && !invalidName) return false;
    this.error.set(invalidType ? MEMBER_360_TRACKER_TYPE_ERROR : MEMBER_360_TRACKER_FILENAME_ERROR);
    this.chooser()?.clear(true);
    return true;
  }

  protected async upload(selected: File[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.rejectUnsupportedTrackers(selected)) return;
    const files = [...selected];
    const attempt = ++this.uploadSequence;
    this.uploading.set(true);
    this.error.set('');
    try {
      if (files.length + this.trackers().length > MEMBER_360_MAX_TRACKERS) throw new Error(`Upload at most ${MEMBER_360_MAX_TRACKERS} tracker files.`);
      const project = this.context.activeContextUid();
      const parsed: Member360TrackerUpload[] = [];
      for (const file of files) {
        if (attempt !== this.uploadSequence) return;
        if (file.size > MEMBER_360_MAX_BYTES) throw new Error('Each tracker must be smaller than 5 MB.');
        const tracker = await firstValueFrom(this.api.parseTracker(project, file));
        parsed.push({
          id: ++this.nextTrackerId,
          tracker,
          format: /\.xlsx$/i.test(file.name) ? 'XLSX' : 'CSV',
          summary: Object.keys(tracker.rows[0] ?? {})
            .slice(0, 3)
            .join(', '),
        });
      }
      const combined = [...this.trackers(), ...parsed];
      if (new TextEncoder().encode(JSON.stringify(combined.map((upload) => upload.tracker))).length > MEMBER_360_MAX_BYTES)
        throw new Error('The parsed trackers together must be smaller than 5 MB.');
      if (attempt === this.uploadSequence) this.form.controls.trackers.setValue(combined);
    } catch (error) {
      let message = 'The tracker could not be parsed.';
      if (error instanceof Error) message = error.message;
      if (error instanceof HttpErrorResponse)
        message = getHttpErrorDetail(error, 'The tracker could not be parsed. Check its format and limits, and try again.');
      if (attempt === this.uploadSequence) this.error.set(message);
    } finally {
      if (attempt === this.uploadSequence) {
        this.uploading.set(false);
        this.chooser()?.clear(true);
      }
    }
  }

  protected remove(id: number): void {
    this.form.controls.trackers.setValue(this.trackers().filter((upload) => upload.id !== id));
  }
  protected onAnswers(answers: MktgRunAnswer[]): void {
    const pending = this.pending();
    const questionsId = this.result()?.questionsId;
    if (!pending || !questionsId || this.loading() || this.answering() || !this.context.canWrite()) return;
    const subject = this.users.user()?.sub ?? '';
    const answerSequence = ++this.answerSequence;
    this.answering.set(true);
    this.error.set('');
    const runId = this.ownedRun()?.runId;
    const request = runId ? this.api.answer(pending, questionsId, answers, runId) : this.api.answer(pending, questionsId, answers);
    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (answerSequence === this.answerSequence) this.answering.set(false);
        })
      )
      .subscribe({
        next: () => {
          if (pending !== this.pending()) return;
          this.accepted.set([subject, { ...pending, state: 'writing', answeredQuestionsId: questionsId }]);
        },
        error: (error: HttpErrorResponse) => {
          if (pending !== this.pending()) return;
          const answered = error.status === 409 ? readMktgRunAnsweredConflict(error.error) : null;
          if (answered) {
            this.error.set('');
            this.answersNotice.set(`${answered.answeredBy} already answered these — the agent is writing`);
            const writing: MktgPendingGeneration = { ...pending, state: 'writing', answeredQuestionsId: questionsId };
            if (writing.attempt) this.attempts.save(writing, subject);
            this.accepted.set([subject, writing]);
            return;
          }
          if (error.status === 409) this.pollRetry.update((value) => value + 1);
          this.error.set(error.status === 409 ? 'The questions changed — refreshed.' : 'Your answers could not be sent. They are kept — try again.');
        },
      });
  }

  /** The filtered server roster chooses a run; local proof can only enrich that choice. */
  private restoreServerRun(key: string, project: string, user: string, response: MktgDocumentsResponse): void {
    const active = response.runs?.find(
      (row) => row.project === project && row.agentKey === 'member-360' && (row.state === 'writing' || row.state === 'questions' || row.state === 'storing')
    );
    const previous = this.ownedRun();
    const pending = this.pending();
    if (active) {
      if (!previous || previous.runId !== active.runId || previous.state !== active.state || previous.startedAt !== active.startedAt)
        this.ownedContext.set([key, active]);
      if (pending?.request.documentId === active.documentId && (previous?.runId === active.runId || pending.attempt?.runId === active.runId)) {
        const phase = this.result()?.status;
        if ((active.state === 'questions' && phase === 'pending') || (active.state !== 'questions' && phase === 'needs_input'))
          this.pollRetry.update((value) => value + 1);
        return;
      }
      const hint = this.validLocalHint(project, active.documentId);
      this.confirmedScope.set('');
      this.accepted.set([
        user,
        hint?.attempt?.runId === active.runId
          ? hint
          : {
              request: { projectUid: project, agentId: 'member-360', documentId: active.documentId, intake: MKTG_AGENT_INTAKES['member-360'], answers: {} },
              state: active.state === 'questions' ? 'questions' : 'writing',
              updatedAt: active.startedAt,
            },
      ]);
      return;
    }
    if (pending) {
      if (previous) this.pollRetry.update((value) => value + 1);
      return;
    }
    const latest = this.attempts.latestPending(project, 'member-360');
    const hint = latest ? this.validLocalHint(project, latest.documentId) : null;
    if (hint) this.accepted.set([user, hint]); // A completed/missing hinted run still needs one authoritative read.
  }

  private validLocalHint(project: string, documentId: string): MktgPendingGeneration | null {
    const hint = this.attempts.load(project, 'member-360', documentId);
    return hint?.attempt?.runId &&
      hint.request.projectUid === project &&
      hint.request.agentId === 'member-360' &&
      hint.attempt.documentId === documentId &&
      !!hint.attempt.session?.sessionId &&
      !!hint.attempt.session?.ownerToken &&
      MKTG_STARTED_RUN_ID_REGEX.test(hint.attempt.runId) &&
      hint.request.documentId === documentId &&
      MKTG_DOCUMENT_ID_REGEX.test(documentId) &&
      documentId !== MKTG_LIVING_DOCUMENT_ID
      ? hint
      : null;
  }

  private watchHistory(): void {
    this.scope$
      .pipe(
        distinctUntilChanged((a, b) => a.key === b.key && a.retry === b.retry),
        tap(({ key, project, user }) => {
          if (key !== this.lastScope) {
            this.scopeVersion++;
            this.confirmation.close();
            this.confirmedScope.set('');
            this.checkedHistoryScope.set('');
            this.deniedScope.set('');
            this.loadingIssue.set(['', '']);
            this.history.set([]);
            this.latest.set(null);
            this.lastHistoryRevision = '';
            this.accepted.set([user, null]);
            this.ownedContext.set([key, null]);
            this.startedAt.set(0); // Local timestamps do not decide the server's run budget.
            this.form.controls.trackers.setValue([]);
            this.chooser()?.clear();
            this.error.set('');
            this.answersNotice.set('');
            this.answerSequence++;
            this.answering.set(false);
            this.submitting.set(false);
            this.uploadSequence++;
            this.uploading.set(false);
          }
          this.lastScope = key;
          this.historyLoading.set(true);
          this.historyError.set('');
          this.form.controls.compare.disable({ emitEvent: false });
        }),
        switchMap(({ key, project, user, retry }) => {
          const current = () => key === this.screenScope() && retry === this.historyRetry();
          const fetch = (): Observable<MktgDocumentListItem[]> => {
            if (!project || !user || !this.context.canWrite()) return of([]);
            return this.documents.listDocuments(project, true, true).pipe(
              tap((response) => {
                if (current()) {
                  if (response.project !== project || response.progressUnavailable) throw new Error('Owned run state is not confirmed.');
                  this.restoreServerRun(key, project, user, response);
                  this.checkedHistoryScope.set(key);
                  this.deniedScope.set('');
                  this.historyError.set('');
                }
              }),
              switchMap((result) => {
                const group = result.groups.find((candidate) => candidate.type.agentKey === 'member-360');
                const last = group?.documents[0];
                if (!group || !last) {
                  if (current()) {
                    this.latest.set(null);
                    this.lastHistoryRevision = '';
                  }
                  return of([]);
                }
                if (last.latestRevisionId === this.lastHistoryRevision && this.latest()) return of(group.documents);
                return this.documents.getRevision(project, group.type.agentKey, last.documentId, last.latestRevisionId).pipe(
                  map((view) => {
                    if (current()) {
                      this.latest.set(view.member360 ?? null);
                      this.lastHistoryRevision = view.member360 ? last.latestRevisionId : '';
                      if (!view.member360) this.historyError.set('Previous run details could not be loaded. Retry before comparing.');
                    }
                    return group.documents;
                  })
                );
              })
            );
          };
          return createVisibilityPoll(this.doc, fetch, {
            intervalMs: MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS,
            backoffBaseMs: MKTG_RUN_POLL.intervalMs,
            backoffMaxMs: MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS,
            shouldContinue: () => !!project && !!user && this.context.canWrite(),
          }).pipe(filter(current));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        const key = this.screenScope();
        this.historyLoading.set(false);
        this.form.controls.compare.enable({ emitEvent: false });
        if (event.kind === 'error') {
          this.historyError.set('Run history could not be loaded. Retry before comparing with the previous run.');
          this.loadingIssue.set([key, 'The run state could not be checked. Refresh to try again.']);
          if (event.error instanceof HttpErrorResponse && (event.error.status === 401 || event.error.status === 403)) this.deniedScope.set(key);
        } else {
          this.history.set(event.value);
          if (!this.latest() && !this.historyError()) this.form.controls.compare.setValue(false, { emitEvent: false });
        }
        const noProject = !this.context.activeContextUid() && !this.route.snapshot.queryParamMap.get('project');
        if (!this.pending() && (this.checkedHistoryScope() === key || noProject)) this.confirmedScope.set(key);
      });
  }

  /** A creator result is displayed only after the recorded run confirms its phase. */
  private readVerifiedRun(pending: MktgPendingGeneration, runId: string): Observable<Member360Result | null> {
    const documentId = pending.request.documentId;
    if (!documentId) return of(null);
    const result = this.ownedRun()?.runId === runId ? this.api.questions(pending, runId) : this.api.questions(pending);
    return result.pipe(
      switchMap((result) => {
        const canonical = result.documentId ?? result.persistence?.document_location?.document_id;
        if (
          result.status === 'ready' &&
          (result.stored || result.persistence) &&
          canonical &&
          MKTG_DOCUMENT_ID_REGEX.test(canonical) &&
          canonical !== MKTG_LIVING_DOCUMENT_ID
        )
          return of({ ...result, documentId: canonical });
        return this.documents.getDocument(pending.request.projectUid, 'member-360', documentId, true, undefined, true, runId).pipe(
          map((detail): Member360Result | null => {
            if (
              detail.project !== pending.request.projectUid ||
              detail.type.agentKey !== 'member-360' ||
              detail.documentId !== documentId ||
              detail.progressUnavailable
            )
              throw new Error('Run progress is not confirmed.');
            if (pending === this.pending()) this.progressContext.set([pending, detail]);
            if (detail.revisions.length) return { ...result, status: 'ready', stored: true, documentId: detail.documentId };
            const run = detail.runs?.find((value) => value.runId === runId && value.agentKey === 'member-360' && value.documentId === documentId);
            if (!run) return null;
            if (run.state === 'discarded' || run.state === 'superseded') return null;
            const start = Date.parse(run.startedAt);
            if (!Number.isFinite(start) || !['writing', 'questions', 'storing', 'failed'].includes(run.state)) throw new Error('Run phase is not confirmed.');
            if (pending === this.pending()) this.startedAt.set(start);
            if (run.state === 'failed' || result.status === 'failed') return { ...result, status: 'failed', documentId };
            if (run.state === 'questions')
              return {
                ...result,
                status: 'needs_input',
                questions: result.status === 'needs_input' ? result.questions : undefined,
                questionsId: result.status === 'needs_input' ? result.questionsId : undefined,
                documentId,
              };
            return { status: 'pending', activity: result.activity, documentId };
          }),
          catchError((error: unknown) => {
            if (error instanceof HttpErrorResponse && error.status === 404 && error.error?.code === 'MKTG_DOCUMENT_NOT_FOUND') return of(null);
            throw error;
          })
        );
      })
    );
  }

  private watchRun(): void {
    const slow$ = toObservable(this.startedAt).pipe(
      switchMap((start) => {
        const wait = start > 0 ? Math.max(0, start + MEMBER_360_RUN_CEILING_MS - Date.now()) : MEMBER_360_RUN_CEILING_MS;
        return wait === 0
          ? of(true)
          : timer(wait).pipe(
              map(() => true),
              startWith(false)
            );
      }),
      distinctUntilChanged()
    );
    toObservable(
      computed(() => ({
        pending: this.pending(),
        runId: this.ownedRun()?.runId ?? this.pending()?.attempt?.runId,
        state: this.ownedRun()?.state,
        retry: this.pollRetry(),
      }))
    )
      .pipe(
        switchMap(({ pending, runId, state: recordedState }) => {
          if (this.resultContext()[0] !== pending) this.resultContext.set([null, null]);
          this.stillRunning.set(false);
          if (!pending || !runId) return EMPTY;
          return slow$.pipe(
            switchMap((slow) => {
              this.stillRunning.set(slow);
              return createVisibilityPoll(this.doc, () => this.readVerifiedRun(pending, runId), {
                intervalMs: slow ? MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS : MKTG_RUN_POLL.intervalMs,
                backoffBaseMs: MKTG_RUN_POLL.intervalMs,
                backoffMaxMs: MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS,
                shouldContinue: (result) =>
                  !!result &&
                  result.status !== 'failed' &&
                  !(result.status === 'ready' && (result.stored || result.persistence)) &&
                  !(result.status === 'needs_input' && result.questions?.length && result.questionsId),
              });
            }),
            tap((event) => {
              if (pending !== this.pending() || (this.ownedRun() && (runId !== this.ownedRun()?.runId || recordedState !== this.ownedRun()?.state))) return;
              const key = this.screenScope();
              if (event.kind === 'error') {
                this.loadingIssue.set([key, 'The run state could not be checked. Refresh to try again.']);
                this.error.set('The run could not be checked. Try again; no new run is started.');
                if (event.error instanceof HttpErrorResponse && [400, 401, 403, 404].includes(event.error.status)) {
                  this.confirmedScope.set('');
                  this.checkedHistoryScope.set('');
                  this.forgetAttempt(pending);
                  this.historyRetry.update((value) => value + 1);
                }
                return;
              }
              this.loadingIssue.set(['', '']);
              this.error.set('');
              const result = event.value;
              if (!result) {
                this.forgetAttempt(pending);
                this.confirmedScope.set(key);
                return;
              }
              if (result.status === 'failed' || (result.status === 'ready' && (result.stored || result.persistence))) {
                this.openVerifiedDocument(pending, result);
                return;
              }
              // Rechecking the same turn must not reset a requester's in-progress form edits.
              const previous = this.result();
              const value =
                result.status === 'needs_input' && previous && previous.questionsId === result.questionsId
                  ? { ...result, questions: previous.questions }
                  : result;
              this.resultContext.set([pending, value]);
              if (value.status === 'needs_input') this.answersNotice.set('');
              if (value.status === 'needs_input' && (!value.questionsId || !value.questions?.length) && this.confirmedScope() !== key) {
                this.loadingIssue.set([key, 'The questions are not available yet. Checking the same run again.']);
                return;
              }
              this.confirmedScope.set(key);
              const state = result.status === 'needs_input' ? 'questions' : 'writing';
              if (pending.attempt) this.attempts.save({ ...pending, state, pendingQuestions: undefined, answered: undefined });
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private forgetAttempt(pending: MktgPendingGeneration): void {
    this.attempts.clear(pending.request.projectUid, 'member-360', this.users.user()?.sub ?? '', pending.request.documentId);
    this.accepted.set([this.users.user()?.sub ?? '', null]);
    this.resultContext.set([null, null]);
    this.ownedContext.set([this.screenScope(), null]);
  }

  private openVerifiedDocument(pending: MktgPendingGeneration, result: Member360Result): void {
    const documentId = result.documentId;
    if (!documentId) return;
    this.attempts.clear(pending.request.projectUid, 'member-360', this.users.user()?.sub ?? '', pending.request.documentId);
    const fallback = () => {
      if (pending !== this.pending() || this.destroyRef.destroyed) return;
      this.resultContext.set([pending, result]);
      this.confirmedScope.set(this.screenScope());
      this.error.set('The run could not be opened. Use its Open link to try again.');
    };
    void this.router
      .navigate(['../documents/member-360', documentId], {
        relativeTo: this.route,
        queryParams: { revision: null, generation: null, run: null },
        queryParamsHandling: 'merge',
      })
      .then((opened) => {
        if (!opened) fallback();
      })
      .catch(fallback);
  }

  private initCompareOptions() {
    return computed(() => {
      const latest = this.latest();
      let label = 'No previous run yet';
      if (this.historyLoading()) label = 'Loading previous run…';
      if (this.historyError()) label = 'Previous run details unavailable';
      if (latest) label = `Previous run: ${this.latestPeriod()} (${formatDate(latest.generated_at, 'd MMM', 'en-US', 'UTC')}) — trend arrows`;
      return [
        { value: true, label },
        { value: false, label: 'No comparison' },
      ];
    });
  }
}
