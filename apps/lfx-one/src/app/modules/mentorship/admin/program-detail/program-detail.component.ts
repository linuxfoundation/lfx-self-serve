// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_ADMIN_PROGRAM_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_MESSAGE,
  MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_TITLE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_PROGRAM_HIDDEN_MESSAGE,
  MENTORSHIP_PROGRAM_HIDE_BLOCKED_MESSAGE,
  MENTORSHIP_PROGRAM_UNHIDDEN_MESSAGE,
  MENTORSHIP_PROGRAM_UNHIDE_BLOCKED_MESSAGE,
  MENTORSHIP_PROGRAM_VISIBILITY_FAILED_MESSAGE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminProgramPage, MentorshipProgramDetailTab, MentorshipProgramVisibilityAction } from '@lfx-one/shared/interfaces';
import { getMentorshipProgramDetailTabs } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { catchError, map, of, switchMap, take, tap } from 'rxjs';

import { CurrentMenteesTabComponent } from './components/current-mentees-tab/current-mentees-tab.component';
import { MentorsTabComponent } from './components/mentors-tab/mentors-tab.component';
import { PastMenteesTabComponent } from './components/past-mentees-tab/past-mentees-tab.component';
import { ProgramDetailHeaderComponent } from './components/program-detail-header/program-detail-header.component';
import { TermsTabComponent } from './components/terms-tab/terms-tab.component';

/** Why the page could not be shown: the caller may not manage the program, it does not exist, or the read failed. */
type ProgramPageError = 'no-access' | 'not-found' | 'failed';

/**
 * Admin program-detail page. Loads a program by id and hosts the underline tabs (current mentees, past mentees,
 * mentors, terms); a pending program has no mentees or mentors yet, so it shows Terms only. The header, the four
 * counts and the term options come from one BFF read; Current Mentees then reads its own pages. A failed read shows
 * an inline error with Retry, or a no-access or not-found state for a 403 or a 404. Past Mentees, Mentors and Terms
 * each read their own pages.
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messageService = inject(MessageService);

  protected readonly isLoading = signal(true);
  protected readonly page = signal<MentorshipAdminProgramPage | null>(null);
  protected readonly pageError = signal<ProgramPageError | null>(null);
  protected readonly visibilityBusy = signal(false);
  protected readonly noAccessTitle = MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_TITLE;
  protected readonly noAccessMessage = MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_MESSAGE;
  protected readonly loadErrorMessage = MENTORSHIP_ADMIN_PROGRAM_LOAD_ERROR_MESSAGE;

  private readonly reloadCount = signal(0);
  /** Bumped by every page read and silent refresh; only the latest one may write the page. */
  private pageRequest = 0;

  protected readonly programId = toSignal(this.route.paramMap.pipe(map((params) => params.get('programId') ?? '')), { initialValue: '' });
  protected readonly terms = computed(() => this.page()?.terms ?? []);
  protected readonly tabCounts = computed(() => this.page()?.tabCounts ?? { currentMentees: null, pastMentees: null, mentors: null, terms: null });
  /** The loaded program and the tabs it shows: all four, or Terms only for a pending program. */
  private readonly tabSource = computed(() => {
    const page = this.page();
    return { programId: page?.program.id ?? '', tabs: getMentorshipProgramDetailTabs(page?.program.status ?? 'open').map((tab) => tab.value) };
  });
  /**
   * Opens on the program's first tab: Current Mentees, or Terms for a pending program. A read of the same program keeps
   * the open tab while the program still shows it, so a status change on refresh only moves the admin off a tab that is
   * gone. Another program, reached by a route change that reuses this page, opens on its own first tab.
   */
  protected readonly activeTab = linkedSignal({
    source: this.tabSource,
    computation: ({ programId, tabs }, previous): MentorshipProgramDetailTab =>
      previous && previous.source.programId === programId && tabs.includes(previous.value) ? previous.value : tabs[0],
  });
  /** Handed to Current Mentees, which may call it after it has been destroyed; once this page is gone it reads nothing. */
  protected readonly countsRefresh: () => void = this.refreshCounts.bind(this);

  public constructor() {
    this.initPageReads();
  }

  protected onTabChange(tab: MentorshipProgramDetailTab): void {
    this.activeTab.set(tab);
  }

  /** Opens the enroll wizard in edit mode for this program. */
  protected onEditProgram(): void {
    void this.router.navigate(['/mentorship/admin/enroll'], { queryParams: { programId: this.programId() } });
  }

  /**
   * Hides or unhides the program, then reads the header again so the status badge follows. A 409 (a hide meeting active
   * applications, or a status that no longer allows the change) shows why and reads the header again too; an impersonation
   * 403 shows the server's text; anything else shows a generic failure. The write is not tied to this page, so leaving it
   * after the confirm still lands the change and its toast, as the tabs' writes do.
   */
  protected onVisibilityChange(action: MentorshipProgramVisibilityAction): void {
    const programId = this.programId();
    if (!programId || this.visibilityBusy()) return;
    this.visibilityBusy.set(true);
    this.mentorshipAdminService.setProgramVisibility(programId, action).subscribe({
      next: () => {
        this.visibilityBusy.set(false);
        this.showToast('success', 'Success', action === 'hide' ? MENTORSHIP_PROGRAM_HIDDEN_MESSAGE : MENTORSHIP_PROGRAM_UNHIDDEN_MESSAGE);
        this.refreshCounts();
      },
      error: (err: unknown) => {
        this.visibilityBusy.set(false);
        this.onVisibilityError(action, err);
      },
    });
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

  private onVisibilityError(action: MentorshipProgramVisibilityAction, err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      this.refreshCounts();
      this.showToast('error', 'Error', action === 'hide' ? MENTORSHIP_PROGRAM_HIDE_BLOCKED_MESSAGE : MENTORSHIP_PROGRAM_UNHIDE_BLOCKED_MESSAGE);
      return;
    }
    const isImpersonation = status === 403 && (err as HttpErrorResponse).error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE;
    this.showToast(
      'error',
      'Error',
      isImpersonation ? serverAuthoredMessage(err, MENTORSHIP_PROGRAM_VISIBILITY_FAILED_MESSAGE) : MENTORSHIP_PROGRAM_VISIBILITY_FAILED_MESSAGE
    );
  }

  private showToast(severity: 'success' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: severity === 'error' ? 5000 : 3000 });
  }

  private errorKind(error: HttpErrorResponse): ProgramPageError {
    if (error.status === 403) return 'no-access';
    if (error.status === 404) return 'not-found';
    return 'failed';
  }
}
