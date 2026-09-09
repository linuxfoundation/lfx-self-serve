// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_NOTE_DIALOG_HEADER } from '@lfx-one/shared/constants';
import { MentorshipNoteRequest, MentorshipProgramDetail, MentorshipProgramDetailTab } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { filter, map, switchMap, take, tap } from 'rxjs';

import { ApplicantsTabComponent } from './components/applicants-tab/applicants-tab.component';
import { CurrentMenteesTabComponent } from './components/current-mentees-tab/current-mentees-tab.component';
import { MenteeNoteDialogComponent } from './components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorsTabComponent } from './components/mentors-tab/mentors-tab.component';
import { PastMenteesTabComponent } from './components/past-mentees-tab/past-mentees-tab.component';
import { ProgramDetailHeaderComponent } from './components/program-detail-header/program-detail-header.component';
import { TermsTabComponent } from './components/terms-tab/terms-tab.component';
import { MentorshipComingSoonService } from './services/mentorship-coming-soon.service';

/**
 * Admin program-detail page. Loads a program by id (default) or slug and hosts
 * the four underline tabs (mentees, applicants, mentors, terms). The mentees tab
 * shows current mentees for a live program and past mentees once it is completed.
 *
 * Reviewer notes are owned here rather than in the tabs: the tab panel is an
 * `@switch`, so a tab component is destroyed the moment the admin looks at another
 * tab, and note drafts held inside one would not survive the trip back.
 */
@Component({
  selector: 'lfx-mentorship-program-detail',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
    ProgramDetailHeaderComponent,
    CurrentMenteesTabComponent,
    PastMenteesTabComponent,
    ApplicantsTabComponent,
    MentorsTabComponent,
    TermsTabComponent,
  ],
  templateUrl: './program-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly dialogService = inject(DialogService);
  private readonly comingSoon = inject(MentorshipComingSoonService);

  protected readonly isLoading = signal(true);
  protected readonly activeTab = signal<MentorshipProgramDetailTab>('mentees');

  /**
   * Notes edited this session, keyed by person id. Local until a write endpoint
   * exists; a person absent from the map falls back to the note their row arrived with.
   */
  protected readonly noteDrafts = signal<Record<string, string>>({});

  protected readonly programId = toSignal(this.route.paramMap.pipe(map((params) => params.get('programId') ?? '')), { initialValue: '' });
  protected readonly detail: Signal<MentorshipProgramDetail | null> = this.initDetail();
  protected readonly terms = computed(() => this.detail()?.terms ?? []);
  protected readonly mentees = computed(() => this.detail()?.mentees ?? []);
  protected readonly applicants = computed(() => this.detail()?.applicants ?? []);
  protected readonly mentors = computed(() => this.detail()?.mentors ?? []);
  protected readonly tabCounts = computed(() => this.detail()?.tabCounts ?? { mentees: 0, applicants: 0, mentors: 0, terms: 0 });

  /** A completed program has no enrolled mentees, so the first tab shows past ones. */
  protected readonly isCompleted = computed(() => this.detail()?.program.status === 'completed');

  protected onTabChange(tab: MentorshipProgramDetailTab): void {
    this.activeTab.set(tab);
  }

  protected onEditProgram(): void {
    this.comingSoon.notify('Edit program');
  }

  protected onNoteRequested(request: MentorshipNoteRequest): void {
    // `open()` returns null when a dialog of the same component is still registered,
    // which a quick second click on another row's note can do.
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(MenteeNoteDialogComponent, {
      header: MENTORSHIP_NOTE_DIALOG_HEADER,
      width: '34rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { menteeId: request.personId, menteeName: request.personName, note: this.noteFor(request.personId) },
    });
    if (!dialogRef) return;

    dialogRef.onClose.pipe(take(1)).subscribe((note: string | undefined) => {
      // Dismissing the dialog resolves to `undefined` and must leave the note untouched;
      // an empty string is an explicit clear.
      if (note === undefined) return;
      this.noteDrafts.update((drafts) => ({ ...drafts, [request.personId]: note }));
    });
  }

  private initDetail(): Signal<MentorshipProgramDetail | null> {
    return toSignal(
      toObservable(this.programId).pipe(
        filter((programId) => !!programId),
        tap(() => this.isLoading.set(true)),
        switchMap((programId) => this.mentorshipService.getProgram(programId).pipe(tap(() => this.isLoading.set(false))))
      ),
      { initialValue: null }
    );
  }

  /** The draft if this session edited one, otherwise whatever the row arrived with. */
  private noteFor(personId: string): string {
    const draft = this.noteDrafts()[personId];
    if (draft !== undefined) return draft;

    const person = [...this.mentees(), ...this.applicants()].find((candidate) => candidate.id === personId);
    return person?.note ?? '';
  }
}
