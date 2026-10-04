// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_NOTE_DIALOG_HEADER } from '@lfx-one/shared/constants';
import { MentorshipNoteRequest, MentorshipProgramDetail, MentorshipProgramDetailTab } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { filter, map, switchMap, take, tap } from 'rxjs';

import { CurrentMenteesTabComponent } from './components/current-mentees-tab/current-mentees-tab.component';
import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorsTabComponent } from './components/mentors-tab/mentors-tab.component';
import { PastMenteesTabComponent } from './components/past-mentees-tab/past-mentees-tab.component';
import { ProgramDetailHeaderComponent } from './components/program-detail-header/program-detail-header.component';
import { TermsTabComponent } from './components/terms-tab/terms-tab.component';
import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';

/**
 * Admin program-detail page. Loads a program by id (default) or slug and hosts
 * the four underline tabs (current mentees, past mentees, mentors, terms). The two
 * mentee tabs split the program's applications by their term's status: an open
 * term's rows are current, a closed term's are past.
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
    MentorsTabComponent,
    TermsTabComponent,
  ],
  templateUrl: './program-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly dialogService = inject(DialogService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isLoading = signal(true);
  protected readonly activeTab = signal<MentorshipProgramDetailTab>('current-mentees');

  /**
   * Notes edited this session, keyed by person id. Local until a write endpoint
   * exists; a person absent from the map falls back to the note their row arrived with.
   */
  protected readonly noteDrafts = signal<Record<string, string>>({});

  protected readonly programId = toSignal(this.route.paramMap.pipe(map((params) => params.get('programId') ?? '')), { initialValue: '' });
  protected readonly detail: Signal<MentorshipProgramDetail | null> = this.initDetail();
  protected readonly terms = computed(() => this.detail()?.terms ?? []);
  protected readonly currentMentees = computed(() => this.detail()?.currentMentees ?? []);
  protected readonly pastMentees = computed(() => this.detail()?.pastMentees ?? []);
  protected readonly mentors = computed(() => this.detail()?.mentors ?? []);
  protected readonly tabCounts = computed(() => this.detail()?.tabCounts ?? { currentMentees: 0, pastMentees: 0, mentors: 0, terms: 0 });

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
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { personName: request.personName, note: this.noteFor(request.personId) },
    });
    if (!dialogRef) return;

    // `takeUntilDestroyed` as well as `take(1)`: this is a long-lived page, so navigating
    // away mid-edit would otherwise leave the handler alive to write to a destroyed host.
    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((note: string | undefined) => {
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
        switchMap((programId) => this.mentorshipAdminService.getProgram(programId).pipe(tap(() => this.isLoading.set(false))))
      ),
      { initialValue: null }
    );
  }

  /** The draft if this session edited one, otherwise whatever the row arrived with. */
  private noteFor(personId: string): string {
    const draft = this.noteDrafts()[personId];
    if (draft !== undefined) return draft;

    // Only the Current Mentees tab offers a note, so only its rows can be asked for one.
    const person = this.currentMentees().find((candidate) => candidate.id === personId);
    return person?.note ?? '';
  }
}
