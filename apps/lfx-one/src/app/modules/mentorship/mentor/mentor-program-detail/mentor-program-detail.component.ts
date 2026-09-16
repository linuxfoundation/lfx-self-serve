// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_NOTE_DIALOG_HEADER } from '@lfx-one/shared/constants';
import { MentorshipMentorProgramDetail, MentorshipMentorProgramDetailTab, MentorshipNoteRequest } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, switchMap, take, tap } from 'rxjs';

import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorApplicantsTabComponent } from './components/mentor-applicants-tab/mentor-applicants-tab.component';
import { MentorProgramDetailHeaderComponent } from './components/mentor-program-detail-header/mentor-program-detail-header.component';

/**
 * Mentor-facing program-detail page — mounts at `mentor/programs/:programId`, outside
 * `MentorPageComponent`'s shell (own H1, own back link) so it can carry the full
 * program title/subtitle/tab-bar header shown in the design. Tasks and Mentees tabs
 * are stubbed pending future work; only Applicants is fully implemented.
 */
@Component({
  selector: 'lfx-mentorship-mentor-program-detail',
  imports: [ButtonComponent, EmptyStateComponent, RouteLoadingComponent, MentorProgramDetailHeaderComponent, MentorApplicantsTabComponent],
  templateUrl: './mentor-program-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly activeTab = signal<MentorshipMentorProgramDetailTab>('applicants');
  protected readonly noteDrafts = signal<Record<string, string>>({});

  /**
   * `distinctUntilChanged` guards against route-reuse strategies that re-emit the same
   * paramMap object after a same-route navigation — without it, `combineLatest` below
   * would treat the "same id, again" emission as a change and refire the HTTP request.
   */
  protected readonly programId = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get('programId') ?? ''),
      distinctUntilChanged()
    ),
    { initialValue: '' }
  );

  /**
   * Retry trigger. Must be declared before `detail` below — `initDetail()` runs during
   * field initialization and passes `this.reload` to `toObservable()`; if `reload` were
   * declared later, `this.reload` would still be `undefined` at that moment,
   * `toObservable(undefined)` would error on subscribe, `combineLatest` would never
   * emit, and the page would sit on the loading spinner forever.
   */
  private readonly reload = signal(0);

  protected readonly detail: Signal<MentorshipMentorProgramDetail | null> = this.initDetail();
  protected readonly mentees = computed(() => this.detail()?.mentees ?? []);
  protected readonly applicants = computed(() => this.detail()?.applicants ?? []);
  protected readonly tabCounts = computed(() => this.detail()?.tabCounts ?? { tasks: 0, mentees: 0, applicants: 0 });

  protected onTabChange(tab: MentorshipMentorProgramDetailTab): void {
    this.activeTab.set(tab);
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  protected onNoteRequested(request: MentorshipNoteRequest): void {
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(MenteeNoteDialogComponent, {
      header: MENTORSHIP_NOTE_DIALOG_HEADER,
      width: '34rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { personName: request.personName, note: this.noteFor(request.personId) },
    });
    if (!dialogRef) return;
    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((note: string | undefined) => {
      if (note === undefined) return;
      this.noteDrafts.update((drafts) => ({ ...drafts, [request.personId]: note }));
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
          this.mentorshipService.getMentorProgram(programId).pipe(
            tap(() => this.hasLoaded.set(true)),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              // A 404 means the id is unknown — surface the dedicated "Program not found"
              // empty state (which offers a back-to-list CTA) rather than the generic
              // Retry banner. Retrying a 404 will just 404 again and the empty state
              // gives the user a working exit.
              if (error?.status === 404) {
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

  private noteFor(personId: string): string {
    const draft = this.noteDrafts()[personId];
    if (draft !== undefined) return draft;
    const person = [...this.mentees(), ...this.applicants()].find((candidate) => candidate.id === personId);
    return person?.note ?? '';
  }
}
