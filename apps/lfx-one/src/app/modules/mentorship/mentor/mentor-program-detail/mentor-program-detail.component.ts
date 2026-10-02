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
import { MentorshipMentorProgramDetail, MentorshipMentorProgramDetailTab, MentorshipNoteRequest } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, switchMap, take, tap } from 'rxjs';

import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorNoteSaveService } from '../../services/mentor-note-save.service';
import { MentorApplicantsTabComponent } from './components/mentor-applicants-tab/mentor-applicants-tab.component';
import { MentorMenteesTabComponent } from './components/mentor-mentees-tab/mentor-mentees-tab.component';
import { MentorProgramDetailHeaderComponent } from './components/mentor-program-detail-header/mentor-program-detail-header.component';
import { MentorTasksTabComponent } from './components/mentor-tasks-tab/mentor-tasks-tab.component';

/**
 * Mentor-facing program-detail page — mounts at `mentor/programs/:programId`, outside
 * `MentorPageComponent`'s shell (own H1, own back link) so it can carry the full
 * program title/subtitle/tab-bar header shown in the design. Tasks, Mentees, and
 * Applicants are implemented. A reviewer note is saved when its dialog closes, and the row shows it once saved.
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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly activeTab = signal<MentorshipMentorProgramDetailTab>('tasks');

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

  private noteFor(applicationId: string): string {
    const person = [...this.mentees(), ...this.applicants()].find((candidate) => candidate.id === applicationId);
    return person?.note ?? '';
  }
}
