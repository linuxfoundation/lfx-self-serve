// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate, isPlatformBrowser } from '@angular/common';
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
} from '@lfx-one/shared/constants';
import { readMktgActiveRunConflict, readMktgRunAnsweredConflict, mktgActiveRunConflictHeading, mktgKitRootPath } from '@lfx-one/shared/utils';
import { ConfirmationService, ConfirmEventType } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import {
  Member360Envelope,
  Member360GenerateRequest,
  Member360TrackerUpload,
  MktgDocumentListItem,
  MktgPendingGeneration,
  Member360Result,
  MktgRunAnswer,
} from '@lfx-one/shared/interfaces';
import { Member360Service } from '@services/member-360.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgRunQuestionsComponent } from '../mktg-run-questions/mktg-run-questions.component';
import { MktgRunActivityComponent } from '../mktg-run-activity/mktg-run-activity.component';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { catchError, distinctUntilChanged, firstValueFrom, map, of, switchMap, tap, EMPTY, expand, timer, finalize, take } from 'rxjs';

@Component({
  selector: 'lfx-member-360-run',
  imports: [
    ConfirmDialogModule,
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    SelectComponent,
    FileUploadComponent,
    MessageComponent,
    MktgBreadcrumbComponent,
    MktgRunQuestionsComponent,
    MktgRunActivityComponent,
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly confirmation = inject(ConfirmationService);
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
  private readonly accepted = signal<[string, MktgPendingGeneration | null]>(['', null]);
  private readonly resultContext = signal<[MktgPendingGeneration | null, Member360Result | null]>([null, null]);
  protected readonly answering = signal(false);
  protected readonly stillRunning = signal(false);
  protected readonly startedAt = signal(0);
  protected readonly pollRetry = signal(0);
  protected readonly pending = computed(() => {
    const [subject, pending] = this.accepted();
    return this.context.canWrite() && subject === this.users.user()?.sub && pending?.request.projectUid === this.context.activeContextUid() ? pending : null;
  });
  protected readonly trackers = toSignal(this.form.controls.trackers.valueChanges, { initialValue: this.form.controls.trackers.value });
  protected readonly result = computed(() => (this.resultContext()[0] === this.pending() ? this.resultContext()[1] : null));
  protected readonly questions = computed(() => {
    const result = this.result();
    return result?.status === 'needs_input' && !!result.questionsId && result.questionsId !== this.pending()?.answeredQuestionsId
      ? (result.questions ?? [])
      : [];
  });
  protected readonly progressNote = computed(() => {
    if (this.stillRunning()) return 'Still running — checking the same run less often.';
    const turn = this.result();
    if (turn?.status === 'needs_input' && (!turn.questionsId || !turn.questions?.length) && turn.questionsId !== this.pending()?.answeredQuestionsId)
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
  private uploadSequence = 0;
  private nextTrackerId = 0;
  private readonly scope$ = toObservable(
    computed(() => ({ project: this.context.activeContextUid(), user: this.users.user()?.sub ?? '', retry: this.historyRetry() }))
  );

  public constructor() {
    this.destroyRef.onDestroy(() => this.uploadSequence++);
    if (isPlatformBrowser(this.platformId)) {
      this.watchRun();
      this.scope$
        .pipe(
          distinctUntilChanged((a, b) => a.project === b.project && a.user === b.user && a.retry === b.retry),
          tap(({ project, user }) => {
            const scope = JSON.stringify([project, user]);
            if (scope !== this.lastScope) {
              this.confirmation.close();
              const latest = this.attempts.latestPending(project, 'member-360');
              const pending = latest ? this.attempts.load(project, 'member-360', latest.documentId) : null;
              this.accepted.set([user, pending]);
              this.startedAt.set(pending ? Date.parse(pending.updatedAt) : 0);
              this.form.controls.trackers.setValue([]);
              this.chooser()?.clear();
              this.error.set('');
              this.answersNotice.set('');
              this.submitting.set(false);
              this.uploadSequence++;
              this.uploading.set(false);
            }
            this.lastScope = scope;
            this.history.set([]);
            this.latest.set(null);
            this.historyError.set('');
            this.historyLoading.set(true);
            this.form.controls.compare.disable({ emitEvent: false });
          }),
          switchMap(({ project }) =>
            project
              ? this.documents.listDocuments(project).pipe(
                  switchMap((result) => {
                    const group = result.groups.find((candidate) => candidate.type.agentKey === 'member-360');
                    const last = group?.documents[0];
                    if (!group || !last) return of([]);
                    return this.documents.getRevision(project, group.type.agentKey, last.documentId, last.latestRevisionId).pipe(
                      map((view) => {
                        this.latest.set(view.member360 ?? null);
                        if (!view.member360) this.historyError.set('Previous run details could not be loaded. Retry before comparing.');
                        return group.documents;
                      })
                    );
                  }),
                  catchError(() => {
                    this.historyError.set('Run history could not be loaded. Retry before comparing with the previous run.');
                    return of([]);
                  })
                )
              : of([])
          ),
          takeUntilDestroyed()
        )
        .subscribe((history) => {
          this.history.set(history);
          if (!this.latest() && !this.historyError()) this.form.controls.compare.setValue(false, { emitEvent: false });
          this.historyLoading.set(false);
          this.form.controls.compare.enable({ emitEvent: false });
        });
    }
  }

  protected retryHistory(): void {
    this.historyRetry.update((value) => value + 1);
  }

  protected run(): void {
    const project = this.context.activeContextUid();
    const user = this.users.user()?.sub;
    if (!project || !this.context.canWrite() || this.submitting() || this.pending()) return;
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
    const current = () => !this.destroyRef.destroyed && project === this.context.activeContextUid() && user === this.users.user()?.sub;
    const start = (discard?: string) => {
      if (!current()) return;
      this.submitting.set(true);
      this.api
        .generate(discard ? { ...body, discard } : body)
        .pipe(take(1))
        .subscribe({
          next: (session) => {
            if (!current()) return;
            const pending = this.attempts.load(project, 'member-360', session.documentId);
            this.submitting.set(false);
            this.startedAt.set(Date.now());
            this.accepted.set([user ?? '', pending]);
            if (!pending) this.error.set('The run started, but its creator capability could not be restored. Open it from run history.');
          },
          error: (error: HttpErrorResponse) => {
            if (!current()) return;
            this.submitting.set(false);
            const conflict = error.status === 409 ? readMktgActiveRunConflict(error.error, 'member-360') : null;
            if (conflict) {
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
    if (!pending || !questionsId || this.answering() || !this.context.canWrite()) return;
    const subject = this.users.user()?.sub ?? '';
    this.answering.set(true);
    this.error.set('');
    this.api
      .answer(pending, questionsId, answers)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.answering.set(false))
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
            this.attempts.save(writing, subject);
            this.accepted.set([subject, writing]);
            return;
          }
          if (error.status === 409) this.pollRetry.update((value) => value + 1);
          this.error.set(error.status === 409 ? 'The questions changed — refreshed.' : 'Your answers could not be sent. They are kept — try again.');
        },
      });
  }

  private watchRun(): void {
    toObservable(computed(() => ({ pending: this.pending(), retry: this.pollRetry() })))
      .pipe(
        switchMap(({ pending }) => {
          this.resultContext.set([null, null]);
          this.stillRunning.set(false);
          if (!pending?.attempt) return EMPTY;
          const read = () =>
            this.api.questions(pending).pipe(
              tap(() => this.error.set('')),
              catchError(() => {
                this.error.set('The run could not be checked. Try again; no new run is started.');
                return EMPTY;
              })
            );
          return timer(MKTG_RUN_POLL.initialDelayMs).pipe(
            switchMap(read),
            expand((result) => {
              const questions =
                result.status === 'needs_input' && !!result.questionsId && result.questions?.length && result.questionsId !== pending.answeredQuestionsId;
              if (questions || result.status === 'failed' || (result.status === 'ready' && (result.stored || result.persistence))) return EMPTY;
              this.stillRunning.set(Date.now() - this.startedAt() >= MEMBER_360_RUN_CEILING_MS);
              const delay = this.stillRunning() ? MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS : MKTG_RUN_POLL.intervalMs;
              return timer(delay).pipe(switchMap(read));
            }),
            tap((result) => {
              if (pending !== this.pending()) return;
              this.resultContext.set([pending, result]);
              if (result.status === 'failed' || (result.status === 'ready' && (result.stored || result.persistence))) {
                this.attempts.clear(pending.request.projectUid, 'member-360', this.users.user()?.sub ?? '', pending.request.documentId);
                void this.router.navigate(['../documents/member-360', pending.request.documentId], {
                  relativeTo: this.route,
                  queryParams: { revision: null, generation: null, run: pending.attempt?.runId ?? null },
                  queryParamsHandling: 'merge',
                });
              }
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
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
