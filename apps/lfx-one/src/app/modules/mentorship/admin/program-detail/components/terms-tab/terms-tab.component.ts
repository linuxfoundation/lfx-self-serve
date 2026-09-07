// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import {
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
import { ConfirmationService, MenuItem } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { EnrollTermDialogComponent } from '../../../enroll-program/components/enroll-term-dialog/enroll-term-dialog.component';

/**
 * Terms tab — lifecycle table plus the documented term actions
 * (edit / close / re-open / delete). Create and edit reuse the enroll dialog.
 */
@Component({
  selector: 'lfx-mentorship-terms-tab',
  imports: [ButtonComponent, MenuComponent, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './terms-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsTabComponent {
  public readonly terms = input.required<MentorshipProgramTermRow[]>();
  public readonly termsChange = output<MentorshipProgramTermRow[]>();

  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly maxTermsMessage = MENTORSHIP_MAX_OPEN_TERMS_MESSAGE;
  protected readonly shouldCloseWarning = MENTORSHIP_TERM_SHOULD_CLOSE_WARNING;
  protected readonly cannotCloseMessage = MENTORSHIP_TERM_CANNOT_CLOSE_MESSAGE;

  protected readonly draftTerms = linkedSignal(() => this.terms());
  protected readonly canAddTerm = computed(() => mentorshipOpenTermCount(this.draftTerms()) < MENTORSHIP_MAX_OPEN_TERMS);

  protected readonly rows = computed(() =>
    this.draftTerms().map((term) => {
      const ended = isMentorshipTermEnded(term.endDate);
      const shouldClose = term.status === 'open' && ended;
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
        menuItems: this.menuItemsFor(term, ended),
      };
    })
  );

  protected onCreateTerm(): void {
    if (!this.canAddTerm()) return;
    this.openTermDialog({ mode: 'add' });
  }

  protected onEditTerm(id: string): void {
    const term = this.draftTerms().find((item) => item.id === id);
    if (!term) return;
    this.openTermDialog({ mode: 'edit', term: this.toFormTerm(term) });
  }

  private menuItemsFor(term: MentorshipProgramTermRow, ended: boolean): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Edit', icon: 'fa-light fa-pen', command: () => this.onEditTerm(term.id) }];

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
    const term = this.draftTerms().find((item) => item.id === id);
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
      accept: () => {
        this.setTerms(
          this.draftTerms().map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'closed',
                  declined: item.declined + item.pending,
                  pending: 0,
                }
              : item
          )
        );
      },
    });
  }

  private onReopenTerm(id: string): void {
    if (!this.canAddTerm()) return;
    const term = this.draftTerms().find((item) => item.id === id);
    if (!term || term.status !== 'closed' || isMentorshipTermEnded(term.endDate)) return;

    this.confirmationService.confirm({
      header: 'Re-Open Term',
      message: MENTORSHIP_TERM_REOPEN_CONFIRM,
      icon: 'fa-light fa-lock-open',
      acceptLabel: 'Re-Open Term',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.setTerms(this.draftTerms().map((item) => (item.id === id ? { ...item, status: 'open' } : item)));
      },
    });
  }

  private onDeleteTerm(id: string): void {
    const term = this.draftTerms().find((item) => item.id === id);
    if (!term || mentorshipTermHasApplications(term)) return;

    this.confirmationService.confirm({
      header: 'Delete Term',
      message: MENTORSHIP_ENROLL_DELETE_TERM_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Delete Term',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.setTerms(this.draftTerms().filter((item) => item.id !== id));
      },
    });
  }

  private openTermDialog(data: MentorshipTermFormDialogData): void {
    const dialogRef = this.dialogService.open(EnrollTermDialogComponent, {
      header: data.mode === 'edit' ? 'Edit Term' : '',
      width: '36rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: MentorshipProgramTerm | undefined) => {
      if (!result) return;
      const next =
        data.mode === 'edit'
          ? this.draftTerms().map((term) => (term.id === result.id ? { ...term, ...result } : term))
          : [...this.draftTerms(), this.toNewRow(result)];
      this.setTerms(next);
    });
  }

  private setTerms(next: MentorshipProgramTermRow[]): void {
    this.draftTerms.set(next);
    this.termsChange.emit(next);
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

  private toNewRow(term: MentorshipProgramTerm): MentorshipProgramTermRow {
    return {
      ...term,
      status: 'open',
      pending: 0,
      declined: 0,
      accepted: 0,
      graduated: 0,
    };
  }
}
