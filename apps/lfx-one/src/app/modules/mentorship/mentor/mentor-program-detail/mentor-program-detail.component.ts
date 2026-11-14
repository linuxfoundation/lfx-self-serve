// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, linkedSignal, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { isBffValidationError, serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_NOTE_DIALOG_HEADER } from '@lfx-one/shared/constants';
import {
  MentorshipApplicantTask,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramDetailTab,
  MentorshipTaskCreateRequest,
  MentorshipMentorTaskReviewRequest,
  MentorshipNoteRequest,
} from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, distinctUntilChanged, EMPTY, filter, finalize, map, of, switchMap, take, tap } from 'rxjs';

import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorNoteSaveService } from '../../services/mentor-note-save.service';
import { MentorTaskReviewService } from '../../services/mentor-task-review.service';
import { MentorshipTaskCreateService } from '../../services/mentorship-task-create.service';
import { MentorApplicantsTabComponent } from './components/mentor-applicants-tab/mentor-applicants-tab.component';
import { MentorMenteesTabComponent } from './components/mentor-mentees-tab/mentor-mentees-tab.component';
import { MentorProgramDetailHeaderComponent } from './components/mentor-program-detail-header/mentor-program-detail-header.component';
import { MentorTasksTabComponent } from './components/mentor-tasks-tab/mentor-tasks-tab.component';

/**
 * Mentor-facing program-detail page — mounts at `mentor/programs/:programId`, outside
 * `MentorPageComponent`'s shell (own H1, own back link) so it can carry the full
 * program title/subtitle/tab-bar header shown in the design. Tasks, Mentees, and
 * Applicants are implemented. A reviewer note is saved when its dialog closes, and the row shows it once saved.
 * A task created from the Mentees tab re-reads the detail in the background, so both tabs list it. A task
 * approved or sent back from the Tasks tab re-reads it too, so the tab and its count show the new status. A task
 * edited, or given a status, from an Applicants or Mentees row is written into both lists at once and then re-read
 * the same way, so the progress, the counts and the Tasks tab follow.
 */
@Component({
  selector: 'lfx-mentorship-mentor-program-detail',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
    MentorProgramDetailHeaderComponent,
    MentorApplicantsTabComponent,
    MentorMenteesTabComponent,
    MentorTasksTabComponent,
  ],
  templateUrl: './mentor-program-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly dialogService = inject(DialogService);
  private readonly noteSaveService = inject(MentorNoteSaveService);
  private readonly taskCreateService = inject(MentorshipTaskCreateService);
  private readonly taskReviewService = inject(MentorTaskReviewService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly activeTab = signal<MentorshipMentorProgramDetailTab>('tasks');
  /**
   * Tasks being reviewed, held until the latest re-read after the review settles, so a stale row is not sent twice.
   * A failed re-read releases them on the old rows; the BFF's 409 then refuses a second review of the task.
   */
  protected readonly reviewingTaskIds = signal<readonly string[]>([]);

  /**
   * `distinctUntilChanged` guards against route-reuse strategies that re-emit the same
   * paramMap object after a same-route navigation — without it, `combineLatest` below
   * would treat the "same id, again" emission as a change and refire the HTTP request.
   * When a *distinct* id is emitted (cross-program link), the tab resets to the default
   * so the new program always opens on Tasks, not whatever tab was last active.
   */
  protected readonly programId = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get('programId') ?? ''),
      distinctUntilChanged(),
      tap(() => this.activeTab.set('tasks'))
    ),
    { initialValue: '' }
  );

  /**
   * Retry trigger. Must be declared before `loadedDetail` below — `initDetail()` runs during
   * field initialization and passes `this.reload` to `toObservable()`; if `reload` were
   * declared later, `this.reload` would still be `undefined` at that moment,
   * `toObservable(undefined)` would error on subscribe, `combineLatest` would never
   * emit, and the page would sit on the loading spinner forever.
   */
  private readonly reload = signal(0);

  private readonly loadedDetail: Signal<MentorshipMentorProgramDetail | null> = this.initDetail();

  /** The loaded detail with each note saved since written into its rows. A reload replaces it. */
  protected readonly detail = linkedSignal(() => this.loadedDetail());
  protected readonly mentees = computed(() => this.detail()?.mentees ?? []);
  protected readonly applicants = computed(() => this.detail()?.applicants ?? []);
  protected readonly tabCounts = computed(() => this.detail()?.tabCounts ?? { tasks: 0, mentees: 0, applicants: 0 });

  /** Applications whose note is being saved. Their dialog stays shut until the save settles, so it never opens on a stale note. */
  private readonly savingNoteIds = new Set<string>();
  /** Counts the background re-reads, so only the latest one writes the rows. */
  private refreshGeneration = 0;
  /** Callbacks waiting on the latest re-read, so a re-read that a newer one supersedes releases nothing. */
  private pendingSettles: (() => void)[] = [];

  /**
   * Writes a task saved from an expanded row into both lists, then re-reads the detail in the background so the
   * progress, the counts and the Tasks tab follow. Passed to the tabs, and on to their task panels, as a callback
   * rather than an output, so a save that lands after its row collapsed or its tab closed still reaches the page.
   */
  protected readonly patchSavedTask = (applicationId: string, task: MentorshipApplicantTask): void => {
    this.detail.update((detail) => detail && this.withTask(detail, applicationId, task));
    this.refreshDetail(this.programId());
  };

  protected onTabChange(tab: MentorshipMentorProgramDetailTab): void {
    this.activeTab.set(tab);
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  protected onNoteRequested(request: MentorshipNoteRequest): void {
    // The mentor tabs' row id, and so the request's `personId`, is the application id.
    const applicationId = request.personId;
    if (this.savingNoteIds.has(applicationId)) return;
    const current = this.noteFor(applicationId);
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(MenteeNoteDialogComponent, {
      header: MENTORSHIP_NOTE_DIALOG_HEADER,
      width: '34rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { personName: request.personName, note: current },
    });
    if (!dialogRef) return;
    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((note: string | undefined) => {
      // `undefined` is a dismissed dialog; an unchanged note needs no save. The dialog trims, so compare trimmed.
      if (note === undefined || note === current.trim()) return;
      this.saveNote(applicationId, note);
    });
  }

  /**
   * Not tied to the page: a create, and its toast, finish even if the mentor leaves first. The detail is re-read
   * whatever the outcome, since a failed create (a timeout, a 5xx) may still have made the task upstream.
   */
  protected onTaskCreateRequested(request: MentorshipTaskCreateRequest): void {
    const programId = this.programId();
    const menteeNames = Object.fromEntries(this.mentees().map((mentee) => [mentee.id, mentee.name]));
    this.taskCreateService.create(request, menteeNames).subscribe(() => this.refreshDetail(programId));
  }

  /**
   * Not tied to the page: a review, and its toast, finish even if the mentor leaves first. The detail is re-read
   * whatever the outcome: a 409 means the task is no longer awaiting review, and a 403 or 404 that the row is stale.
   */
  protected onTaskReviewRequested(request: MentorshipMentorTaskReviewRequest): void {
    const { taskId, status } = request;
    if (this.reviewingTaskIds().includes(taskId)) return;
    const programId = this.programId();
    this.reviewingTaskIds.update((taskIds) => [...taskIds, taskId]);
    const settle = (): void => this.reviewingTaskIds.update((taskIds) => taskIds.filter((id) => id !== taskId));
    this.taskReviewService.review(taskId, status).subscribe(() => this.refreshDetail(programId, settle));
  }

  /** Not tied to the page: a save, and its toast, finish even if the mentor leaves first. */
  private saveNote(applicationId: string, note: string): void {
    this.savingNoteIds.add(applicationId);
    this.noteSaveService
      .save(applicationId, note)
      .pipe(finalize(() => this.savingNoteIds.delete(applicationId)))
      .subscribe((saved) => {
        if (saved) this.detail.update((detail) => detail && this.withNote(detail, applicationId, note));
      });
  }

  /** A mentee is listed on both tabs under one application id, so both lists take the note. An empty note clears it. */
  private withNote(detail: MentorshipMentorProgramDetail, applicationId: string, note: string): MentorshipMentorProgramDetail {
    const apply = <T extends { id: string; note?: string }>(person: T): T => (person.id === applicationId ? { ...person, note: note || undefined } : person);
    return { ...detail, mentees: detail.mentees.map(apply), applicants: detail.applicants.map(apply) };
  }

  /** A mentee is listed on both tabs under one application id, so both lists take the saved task. */
  private withTask(detail: MentorshipMentorProgramDetail, applicationId: string, task: MentorshipApplicantTask): MentorshipMentorProgramDetail {
    const apply = <T extends { id: string; tasks?: MentorshipApplicantTask[] }>(person: T): T =>
      person.id === applicationId && person.tasks ? { ...person, tasks: person.tasks.map((current) => (current.id === task.id ? task : current)) } : person;
    return { ...detail, mentees: detail.mentees.map(apply), applicants: detail.applicants.map(apply) };
  }

  /**
   * Re-reads the detail without the loading state, so a created or reviewed task shows on every tab. Dropped if the
   * mentor has left the page or moved to another program, or if a later re-read has started, so a slow one cannot
   * overwrite a newer one; a failed read keeps the rows on screen, since the toast already said how the write went.
   * `onSettled` runs once the latest re-read is done, whether it was applied or failed, so a dropped re-read hands
   * it on to the newer one rather than releasing a row that is still stale.
   */
  private refreshDetail(programId: string, onSettled: () => void = () => undefined): void {
    if (programId !== this.programId()) {
      onSettled();
      return;
    }
    const generation = ++this.refreshGeneration;
    this.pendingSettles.push(onSettled);
    this.mentorService
      .getMentorProgram(programId)
      .pipe(
        catchError(() => EMPTY),
        finalize(() => {
          if (generation === this.refreshGeneration) this.settlePending();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((detail) => {
        if (programId === this.programId() && generation === this.refreshGeneration) this.detail.set(detail);
      });
  }

  private initDetail(): Signal<MentorshipMentorProgramDetail | null> {
    return toSignal(
      combineLatest([toObservable(this.programId), toObservable(this.reload)]).pipe(
        map(([programId]) => programId),
        filter((programId) => !!programId),
        tap(() => {
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap((programId) =>
          this.mentorService.getMentorProgram(programId).pipe(
            tap(() => this.hasLoaded.set(true)),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              // A 404 means the id is unknown and the BFF's own 400 that it is not a program id at
              // all (an old slug URL, say) — surface the dedicated "Program not found" empty state
              // (which offers a back-to-list CTA) rather than the generic Retry banner. Retrying
              // either will just fail again and the empty state gives the user a working exit. A
              // 400 relayed from upstream is a failed read, so it keeps the Retry banner.
              if (error?.status === 404 || isBffValidationError(error)) {
                this.loadError.set(null);
                return of(null);
              }
              this.loadError.set(serverAuthoredMessage(error, 'We could not load this program. Please retry.'));
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private settlePending(): void {
    const settles = this.pendingSettles;
    this.pendingSettles = [];
    settles.forEach((settle) => settle());
  }

  private noteFor(applicationId: string): string {
    const person = [...this.mentees(), ...this.applicants()].find((candidate) => candidate.id === applicationId);
    return person?.note ?? '';
  }
}
