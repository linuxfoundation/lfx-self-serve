// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import {
  MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
  MENTORSHIP_ADMIN_TERMS_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_TERMS_MAX_PAGES,
  MENTORSHIP_ENROLL_DELETE_TERM_CONFIRM,
  MENTORSHIP_MAX_OPEN_TERMS,
  MENTORSHIP_MAX_OPEN_TERMS_MESSAGE,
  MENTORSHIP_TERM_CANNOT_CLOSE_MESSAGE,
  MENTORSHIP_TERM_CLOSE_CONFIRM,
  MENTORSHIP_TERM_REOPEN_CONFIRM,
  MENTORSHIP_TERM_ROW_STATUS_BADGE_CLASSES,
  MENTORSHIP_TERM_ROW_STATUS_LABELS,
  MENTORSHIP_TERM_SHOULD_CLOSE_WARNING,
} from '@lfx-one/shared/constants';
import { MentorshipProgramTerm, MentorshipProgramTermRow, MentorshipTermFormDialogData } from '@lfx-one/shared/interfaces';
import {
  formatIsoDateLabel,
  formatMentorshipShortMonthYear,
  isMentorshipTermEnded,
  mentorshipOpenTermCount,
  mentorshipTermHasApplications,
} from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, EMPTY, expand, map, Observable, of, reduce, switchMap, take, tap } from 'rxjs';

import { EnrollTermDialogComponent } from '../../../enroll-program/components/enroll-term-dialog/enroll-term-dialog.component';
import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';

/**
 * Terms tab — the program's terms with their application counts, read live. Every page is read before the table
 * shows, so the open-term limit counts every term. The documented term
 * actions (edit / close / re-open / delete) confirm as designed and then stub to a "coming soon" toast until the
 * write endpoints land. Create and edit reuse the enroll dialog.
 */
@Component({
  selector: 'lfx-mentorship-terms-tab',
  imports: [ButtonComponent, MenuComponent, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './terms-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsTabComponent {
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly programId = input.required<string>();

  protected readonly maxTermsMessage = MENTORSHIP_MAX_OPEN_TERMS_MESSAGE;
  protected readonly shouldCloseWarning = MENTORSHIP_TERM_SHOULD_CLOSE_WARNING;
  protected readonly cannotCloseMessage = MENTORSHIP_TERM_CANNOT_CLOSE_MESSAGE;
  protected readonly loadErrorMessage = MENTORSHIP_ADMIN_TERMS_LOAD_ERROR_MESSAGE;

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  private readonly termRows = signal<MentorshipProgramTermRow[]>([]);
  private readonly reloadCount = signal(0);

  /** The open-term count is only known once a read has landed, so neither flag holds while loading or after a failed read. */
  private readonly termsLoaded = computed(() => !this.loading() && !this.loadFailed());
  protected readonly atMaxOpenTerms = computed(() => this.termsLoaded() && mentorshipOpenTermCount(this.termRows()) >= MENTORSHIP_MAX_OPEN_TERMS);
  protected readonly canAddTerm = computed(() => this.termsLoaded() && mentorshipOpenTermCount(this.termRows()) < MENTORSHIP_MAX_OPEN_TERMS);

  protected readonly rows = computed(() =>
    this.termRows().map((term) => {
      const ended = isMentorshipTermEnded(term.endDate);
      const shouldClose = term.status === 'open' && ended;
      const canEdit = this.canEditTerm(term, ended);
      return {
        ...term,
        statusLabel: MENTORSHIP_TERM_ROW_STATUS_LABELS[term.status],
        statusBadgeClass: MENTORSHIP_TERM_ROW_STATUS_BADGE_CLASSES[term.status],
        startLabel: formatMentorshipShortMonthYear(term.startDate),
        endLabel: formatMentorshipShortMonthYear(term.endDate),
        applicationStartLabel: formatIsoDateLabel(term.applicationStartDate),
        applicationEndLabel: formatIsoDateLabel(term.applicationEndDate),
        shouldClose,
        cannotClose: shouldClose && term.accepted > 0,
        menuItems: this.menuItemsFor(term, ended, canEdit),
      };
    })
  );

  public constructor() {
    this.initTermReads();
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  protected onCreateTerm(): void {
    if (!this.canAddTerm()) return;
    this.openTermDialog({ mode: 'add' });
  }

  protected onEditTerm(id: string): void {
    const term = this.termRows().find((item) => item.id === id);
    if (!term || !this.canEditTerm(term, isMentorshipTermEnded(term.endDate))) return;
    this.openTermDialog({ mode: 'edit', term: this.toFormTerm(term) });
  }

  /** Terms that are both closed and past their end date are historical and locked. */
  private canEditTerm(term: MentorshipProgramTermRow, ended: boolean): boolean {
    return term.status !== 'closed' || !ended;
  }

  private menuItemsFor(term: MentorshipProgramTermRow, ended: boolean, canEdit: boolean): MenuItem[] {
    const items: MenuItem[] = [];

    if (canEdit) {
      items.push({ label: 'Edit', icon: 'fa-light fa-pen', command: () => this.onEditTerm(term.id) });
    }

    if (term.status === 'open') {
      items.push({ label: 'Close', icon: 'fa-light fa-lock', command: () => this.onCloseTerm(term.id) });
    }

    if (term.status === 'closed' && !ended) {
      items.push({
        label: 'Re-Open',
        icon: 'fa-light fa-lock-open',
        disabled: !this.canAddTerm(),
        command: () => this.onReopenTerm(term.id),
      });
    }

    if (!mentorshipTermHasApplications(term)) {
      items.push({ label: 'Delete', icon: 'fa-light fa-trash-can', styleClass: 'text-red-500', command: () => this.onDeleteTerm(term.id) });
    }

    return items;
  }

  private onCloseTerm(id: string): void {
    const term = this.termRows().find((item) => item.id === id);
    if (!term || term.status !== 'open') return;

    if (term.accepted > 0) {
      this.confirmationService.confirm({
        header: 'Cannot Close Term',
        message: MENTORSHIP_TERM_CANNOT_CLOSE_MESSAGE,
        icon: 'fa-light fa-circle-exclamation',
        acceptLabel: 'Ok',
        rejectVisible: false,
      });
      return;
    }

    this.confirmationService.confirm({
      header: 'Close Term',
      message: MENTORSHIP_TERM_CLOSE_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Close Term',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.comingSoon.notify('Close term'),
    });
  }

  private onReopenTerm(id: string): void {
    if (!this.canAddTerm()) return;
    const term = this.termRows().find((item) => item.id === id);
    if (!term || term.status !== 'closed' || isMentorshipTermEnded(term.endDate)) return;

    this.confirmationService.confirm({
      header: 'Re-Open Term',
      message: MENTORSHIP_TERM_REOPEN_CONFIRM,
      icon: 'fa-light fa-lock-open',
      acceptLabel: 'Re-Open Term',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.comingSoon.notify('Re-open term'),
    });
  }

  private onDeleteTerm(id: string): void {
    const term = this.termRows().find((item) => item.id === id);
    if (!term || mentorshipTermHasApplications(term)) return;

    this.confirmationService.confirm({
      header: 'Delete Term',
      message: MENTORSHIP_ENROLL_DELETE_TERM_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Delete Term',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.comingSoon.notify('Delete term'),
    });
  }

  private openTermDialog(data: MentorshipTermFormDialogData): void {
    const dialogRef = this.dialogService.open(EnrollTermDialogComponent, {
      header: data.mode === 'edit' ? 'Edit Term' : 'Add Term',
      width: '36rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MentorshipProgramTerm | undefined) => {
      if (!result) return;
      this.comingSoon.notify(data.mode === 'edit' ? 'Edit term' : 'Create term');
    });
  }

  /** Reads the terms for the program, again on a retry; a read still in flight is dropped. */
  private initTermReads(): void {
    const query = computed(() => ({ programId: this.programId(), reload: this.reloadCount() }));

    toObservable(query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadFailed.set(false);
        }),
        switchMap(({ programId }) =>
          this.readAllTerms(programId).pipe(
            map((terms) => ({ terms })),
            catchError(() => of({ terms: null }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ terms }) => {
        this.loading.set(false);
        this.termRows.set(terms ?? []);
        this.loadFailed.set(!terms);
      });
  }

  /**
   * Every term of the program, read a page at the upstream maximum until `total` is covered. The next page is decided
   * from `total`, not the page's row count, because the BFF drops terms that are neither open nor closed.
   */
  private readAllTerms(programId: string): Observable<MentorshipProgramTermRow[]> {
    const limit = MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT;
    const readPage = (offset: number) => this.mentorshipAdminService.getProgramTerms(programId, { offset, limit });

    return readPage(0).pipe(
      expand((page, index) => {
        const nextOffset = (index + 1) * limit;
        return nextOffset < page.total && index + 1 < MENTORSHIP_ADMIN_TERMS_MAX_PAGES ? readPage(nextOffset) : EMPTY;
      }),
      reduce((rows, page) => [...rows, ...page.data], [] as MentorshipProgramTermRow[])
    );
  }

  private toFormTerm(term: MentorshipProgramTermRow): MentorshipProgramTerm {
    return {
      id: term.id,
      name: term.name,
      startDate: term.startDate,
      endDate: term.endDate,
      applicationStartDate: term.applicationStartDate,
      applicationEndDate: term.applicationEndDate,
    };
  }
}
