// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_ADMIN_PROGRAM_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_MESSAGE,
  MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_TITLE,
  MENTORSHIP_NOTE_DIALOG_HEADER,
} from '@lfx-one/shared/constants';
import { MentorshipAdminProgramPage, MentorshipNoteRequest, MentorshipProgramDetailTab } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, map, of, switchMap, take, tap } from 'rxjs';

import { CurrentMenteesTabComponent } from './components/current-mentees-tab/current-mentees-tab.component';
import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorsTabComponent } from './components/mentors-tab/mentors-tab.component';
import { PastMenteesTabComponent } from './components/past-mentees-tab/past-mentees-tab.component';
import { ProgramDetailHeaderComponent } from './components/program-detail-header/program-detail-header.component';
import { TermsTabComponent } from './components/terms-tab/terms-tab.component';
import { AdminNoteSaveService } from '../../services/admin-note-save.service';
import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';

/** Why the page could not be shown: the caller may not manage the program, it does not exist, or the read failed. */
type ProgramPageError = 'no-access' | 'not-found' | 'failed';

/**
 * Admin program-detail page. Loads a program by id and hosts the four underline tabs (current mentees, past
 * mentees, mentors, terms). The header, the four counts and the term options come from one BFF read; Current
 * Mentees then reads its own pages. A failed read shows an inline error with Retry, or a no-access or not-found
 * state for a 403 or a 404. Past Mentees, Mentors and Terms each read their own pages.
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
  private readonly noteSave = inject(AdminNoteSaveService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isLoading = signal(true);
  protected readonly activeTab = signal<MentorshipProgramDetailTab>('current-mentees');
  protected readonly page = signal<MentorshipAdminProgramPage | null>(null);
  protected readonly pageError = signal<ProgramPageError | null>(null);
  protected readonly noAccessTitle = MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_TITLE;
  protected readonly noAccessMessage = MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_MESSAGE;
  protected readonly loadErrorMessage = MENTORSHIP_ADMIN_PROGRAM_LOAD_ERROR_MESSAGE;

  /**
   * Notes saved this session, keyed by person id, so a tab shows one without reading its rows again;
   * a person absent from the map falls back to the note their row arrived with.
   */
  protected readonly noteDrafts = signal<Record<string, string>>({});
  /** Rows whose note is being saved; a second save for one waits for the first. */
  private readonly savingNoteIds = signal<ReadonlySet<string>>(new Set());

  private readonly reloadCount = signal(0);
  /** Bumped by every page read and silent refresh; only the latest one may write the page. */
  private pageRequest = 0;

  protected readonly programId = toSignal(this.route.paramMap.pipe(map((params) => params.get('programId') ?? '')), { initialValue: '' });
  protected readonly terms = computed(() => this.page()?.terms ?? []);
  protected readonly tabCounts = computed(() => this.page()?.tabCounts ?? { currentMentees: null, pastMentees: null, mentors: null, terms: null });
  /** Handed to Current Mentees, which may call it after it has been destroyed; once this page is gone it reads nothing. */
  protected readonly countsRefresh: () => void = this.refreshCounts.bind(this);

  public constructor() {
    this.initPageReads();
  }

  protected onTabChange(tab: MentorshipProgramDetailTab): void {
    this.activeTab.set(tab);
  }

  protected onEditProgram(): void {
    this.comingSoon.notify('Edit program');
  }

  /** Reads the page again, keeping the tab the admin is on. */
  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  /**
   * Reads the header, counts and terms again without the loading state, so the open tab keeps its page, filters and
   * toasts. A failed read keeps the numbers on screen; the next decision or Retry reads them again. An answer is
   * dropped once a later refresh, a Retry or a route change to another program has started its own read.
   */
  protected refreshCounts(): void {
    const programId = this.programId();
    if (!programId) return;
    const request = ++this.pageRequest;
    this.mentorshipAdminService
      .getProgram(programId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (request === this.pageRequest && programId === this.programId()) this.page.set(page);
        },
        error: () => undefined,
      });
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
      data: { personName: request.personName, note: this.noteFor(request) },
    });
    if (!dialogRef) return;

    // `takeUntilDestroyed` as well as `take(1)`: this is a long-lived page, so navigating
    // away mid-edit would otherwise leave the handler alive to write to a destroyed host.
    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((note: string | undefined) => {
      // Dismissing the dialog resolves to `undefined` and must leave the note untouched;
      // an empty string is an explicit clear.
      if (note === undefined) return;
      this.saveNote(request, note);
    });
  }

  /**
   * Saves the note, then keeps it in `noteDrafts` so every tab shows it without a read. An unchanged note is not sent,
   * and a second save for the same row waits for the first. The save is not tied to the page, so leaving it mid-save
   * still lands the note. A failed save toasts and leaves the row's note as it was.
   */
  private saveNote(request: MentorshipNoteRequest, note: string): void {
    const personId = request.personId;
    const trimmed = note.trim();
    if (this.savingNoteIds().has(personId)) return;
    if (trimmed === this.noteFor(request).trim()) return;

    this.savingNoteIds.update((ids) => new Set(ids).add(personId));
    this.noteSave
      .save(personId, trimmed)
      .pipe(take(1))
      .subscribe((saved) => {
        this.savingNoteIds.update((ids) => {
          const next = new Set(ids);
          next.delete(personId);
          return next;
        });
        if (saved) this.noteDrafts.update((drafts) => ({ ...drafts, [personId]: trimmed }));
      });
  }

  /** Reads the page for the route's program, again on a retry; a read still in flight is dropped. */
  private initPageReads(): void {
    const query = computed(() => ({ programId: this.programId(), reload: this.reloadCount() }));

    toObservable(query)
      .pipe(
        tap(() => {
          this.pageRequest++;
          this.isLoading.set(true);
          this.pageError.set(null);
        }),
        switchMap(({ programId }) => {
          if (!programId) return of({ page: null, error: 'not-found' as ProgramPageError });
          return this.mentorshipAdminService.getProgram(programId).pipe(
            map((page) => ({ page, error: null })),
            catchError((error: HttpErrorResponse) => of({ page: null, error: this.errorKind(error) }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ page, error }) => {
        this.page.set(page);
        this.pageError.set(error);
        this.isLoading.set(false);
      });
  }

  private errorKind(error: HttpErrorResponse): ProgramPageError {
    if (error.status === 403) return 'no-access';
    if (error.status === 404) return 'not-found';
    return 'failed';
  }

  /** The draft if this session edited one, otherwise the note the row arrived with. */
  private noteFor(request: MentorshipNoteRequest): string {
    return this.noteDrafts()[request.personId] ?? request.note ?? '';
  }
}
