// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ACTIVE_APPLICATION_STATUSES,
  MENTORSHIP_ADD_NOTE_LABEL,
  MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL,
  MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_STATUS_LABELS,
  MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL,
  MENTORSHIP_MENTOR_APPLICANT_STATUS_FILTER_PILLS,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeStatus, MentorshipNoteRequest, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import {
  formatIsoDateLabel,
  matchesMentorshipPersonSearch,
  mentorshipApplicantDisplayStatus,
  mentorshipApplicantHasTasks,
  mentorshipApplicantTaskRows,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
} from '@lfx-one/shared/utils';
import { startWith, tap } from 'rxjs';

import { ApplicantTasksPanelComponent } from '../../../../components/applicant-tasks-panel/applicant-tasks-panel.component';
import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';

/**
 * Mentor-facing Applicants tab — same table shape as the admin tab, but filtering is
 * limited to search plus the raw Pending/Accepted/Declined/All status pills from the
 * design (no term filter, no Decline-by-Term/Download-by-Status actions, no status note).
 */
@Component({
  selector: 'lfx-mentorship-mentor-applicants-tab',
  imports: [ReactiveFormsModule, RouterLink, ApplicantTasksPanelComponent, ButtonComponent, InputTextComponent, PersonCellComponent, TableComponent],
  templateUrl: './mentor-applicants-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorApplicantsTabComponent {
  public readonly applicants = input.required<MentorshipProgramApplicant[]>();
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;
  protected readonly statusPills = MENTORSHIP_MENTOR_APPLICANT_STATUS_FILTER_PILLS;
  protected readonly viewTasksLabel = MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL;
  protected readonly minimizeTasksLabel = MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL;

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
  });

  /**
   * Paginator offset. Tracked so that narrowing the list can send the table back to the
   * first page — PrimeNG keeps its own offset when the value array shrinks underneath it,
   * which would otherwise leave the mentor on a page that no longer exists.
   */
  protected readonly first = signal(0);
  protected readonly statusFilter = signal<MentorshipMenteeStatus | undefined>('pending');

  /** Applicant ids whose tasks sub-table is expanded. */
  protected readonly expandedTaskApplicantIds = signal<Record<string, boolean>>({});

  private readonly search = toSignal(
    this.form.valueChanges.pipe(
      tap(() => this.first.set(0)),
      startWith(this.form.getRawValue())
    ),
    { initialValue: this.form.getRawValue() }
  );

  protected readonly rows = this.initRows();

  protected onStatusPillClick(status: MentorshipMenteeStatus | undefined): void {
    this.statusFilter.set(status);
    this.first.set(0);
  }

  protected onOpenNote(id: string, name: string): void {
    this.noteRequested.emit({ personId: id, personName: name });
  }

  protected toggleTasksExpanded(applicantId: string): void {
    this.expandedTaskApplicantIds.update((current) => ({
      ...current,
      [applicantId]: !current[applicantId],
    }));
  }

  private initRows() {
    return computed(() => {
      const { search } = this.search();
      const status = this.statusFilter();
      return this.applicants()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || person.status === status)
        .map((person) => this.toRow(person));
    });
  }

  private toRow(person: MentorshipProgramApplicant) {
    const displayStatus = mentorshipApplicantDisplayStatus(person);
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[displayStatus],
      statusBadgeClass: MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES[displayStatus],
      createdLabel: formatIsoDateLabel(person.createdOn),
      updatedLabel: formatIsoDateLabel(person.updatedOn),
      // The column is headed "Other Active Applications", so declined and withdrawn ones drop out.
      otherApplications: (person.otherApplications ?? [])
        .filter((application) => MENTORSHIP_ACTIVE_APPLICATION_STATUSES.includes(application.status))
        .map((application) => ({
          ...application,
          statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[mentorshipApplicantDisplayStatus(application)],
        })),
      ...mentorshipNoteDisplay(this.noteDrafts(), person, MENTORSHIP_ADD_NOTE_LABEL),
      hasTasks: mentorshipApplicantHasTasks(person),
      taskRows: mentorshipApplicantTaskRows(person.tasks ?? []),
    };
  }
}
