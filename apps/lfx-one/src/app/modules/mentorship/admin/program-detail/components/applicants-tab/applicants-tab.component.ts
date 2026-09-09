// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_APPLICANT_ACTION_ICONS,
  MENTORSHIP_APPLICANT_ACTION_LABELS,
  MENTORSHIP_APPLICANT_DISPLAY_STATUSES,
  MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_STATUS_LABELS,
  MENTORSHIP_APPLICANT_STATUS_NOTE,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
  MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
} from '@lfx-one/shared/constants';
import { MentorshipApplicantDisplayStatus, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import {
  formatIsoDateLabel,
  matchesMentorshipPersonSearch,
  mentorshipApplicantActionsFor,
  mentorshipApplicantDisplayStatus,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
} from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, take } from 'rxjs';

import { MenteeNoteDialogComponent } from '../mentee-note-dialog/mentee-note-dialog.component';

/**
 * Applicants tab — one row per application, filtered by search, display status, and term.
 * Row actions (accept / decline / withdraw), Decline by Term, and the status export all
 * stub to a "coming soon" toast until the backend lands; the reviewer note is the one
 * action that takes effect, held locally.
 */
@Component({
  selector: 'lfx-mentorship-applicants-tab',
  imports: [ReactiveFormsModule, RouterLink, AvatarComponent, ButtonComponent, InputTextComponent, MenuComponent, SelectComponent, TableComponent],
  templateUrl: './applicants-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicantsTabComponent {
  public readonly applicants = input.required<MentorshipProgramApplicant[]>();

  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;
  protected readonly statusNote = MENTORSHIP_APPLICANT_STATUS_NOTE;

  /** Fixed rather than derived from the rows: every status an application can display as. */
  protected readonly statusOptions = [
    { label: 'All statuses', value: null },
    ...MENTORSHIP_APPLICANT_DISPLAY_STATUSES.map((status) => ({ label: MENTORSHIP_APPLICANT_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipApplicantDisplayStatus | null>(null),
    term: new FormControl<string | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /**
   * Reviewer notes are local until a write endpoint exists, so a re-emission of the
   * same upstream applicants must keep them. Only a genuinely different set resets.
   */
  protected readonly draftApplicants = linkedSignal<MentorshipProgramApplicant[], MentorshipProgramApplicant[]>({
    source: this.applicants,
    computation: (applicants, previous) => (previous && this.sameApplicantIds(previous.source, applicants) ? previous.value : applicants),
  });

  protected readonly termOptions = this.initTermOptions();

  protected readonly rows = this.initRows();

  protected onOpenNote(id: string): void {
    const applicant = this.draftApplicants().find((person) => person.id === id);
    if (!applicant) return;

    const dialogRef = this.dialogService.open(MenteeNoteDialogComponent, {
      header: 'Reviewer note',
      width: '34rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { menteeId: applicant.id, menteeName: applicant.name, note: applicant.note ?? '' },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((note: string | undefined) => {
      // Dismissing the dialog resolves to `undefined` and must leave the note untouched;
      // an empty string is an explicit clear.
      if (note === undefined) return;
      this.draftApplicants.set(this.draftApplicants().map((person) => (person.id === id ? { ...person, note: note || undefined } : person)));
    });
  }

  protected onDeclineByTerm(): void {
    this.toastComingSoon('Decline by term');
  }

  protected onDownloadByStatus(): void {
    this.toastComingSoon('Download by status');
  }

  private toastComingSoon(summary: string): void {
    this.messageService.add({
      severity: 'info',
      summary,
      detail: MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
      life: 4000,
    });
  }

  private sameApplicantIds(a: MentorshipProgramApplicant[], b: MentorshipProgramApplicant[]): boolean {
    return a.length === b.length && a.every((applicant, index) => applicant.id === b[index].id);
  }

  private menuItemsFor(person: MentorshipProgramApplicant): MenuItem[] {
    return mentorshipApplicantActionsFor(person.status).map((action) => ({
      label: MENTORSHIP_APPLICANT_ACTION_LABELS[action],
      icon: MENTORSHIP_APPLICANT_ACTION_ICONS[action],
      command: () => this.toastComingSoon(`${MENTORSHIP_APPLICANT_ACTION_LABELS[action]} ${person.name}`),
    }));
  }

  private initTermOptions() {
    return computed(() => {
      const terms = [...new Set(this.draftApplicants().map((person) => person.termName))];
      return [{ label: 'All terms', value: null }, ...terms.map((term) => ({ label: term, value: term }))];
    });
  }

  private initRows() {
    return computed(() => {
      const { search, status, term } = this.filters();
      return this.draftApplicants()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || mentorshipApplicantDisplayStatus(person) === status)
        .filter((person) => !term || person.termName === term)
        .map((person) => this.toRow(person));
    });
  }

  private toRow(person: MentorshipProgramApplicant) {
    const displayStatus = mentorshipApplicantDisplayStatus(person);
    const note = person.note?.trim() ?? '';
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[displayStatus],
      statusBadgeClass: MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES[displayStatus],
      createdLabel: formatIsoDateLabel(person.createdOn),
      updatedLabel: formatIsoDateLabel(person.updatedOn),
      otherApplications: (person.otherApplications ?? []).map((application) => ({
        ...application,
        statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[application.status],
      })),
      hasNote: note.length > 0,
      noteLabel: note.length > 0 ? note : 'Add note',
      menuItems: this.menuItemsFor(person),
    };
  }
}
