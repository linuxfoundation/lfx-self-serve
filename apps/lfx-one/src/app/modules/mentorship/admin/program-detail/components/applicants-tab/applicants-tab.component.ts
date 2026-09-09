// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
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
  MENTORSHIP_ADD_NOTE_LABEL,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_ALL_TERMS_OPTION_LABEL,
  MENTORSHIP_APPLICANT_ACTION_ICONS,
  MENTORSHIP_APPLICANT_ACTION_LABELS,
  MENTORSHIP_APPLICANT_DISPLAY_STATUSES,
  MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_STATUS_LABELS,
  MENTORSHIP_APPLICANT_STATUS_NOTE,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import { MentorshipApplicantDisplayStatus, MentorshipNoteRequest, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import {
  formatIsoDateLabel,
  matchesMentorshipPersonSearch,
  mentorshipApplicantActionsFor,
  mentorshipApplicantDisplayStatus,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipTermFilterOptions,
} from '@lfx-one/shared/utils';
import { MenuItem } from 'primeng/api';
import { startWith } from 'rxjs';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';

/**
 * Applicants tab — one row per application, filtered by search, display status, and term.
 * Row actions (accept / decline / withdraw), Decline by Term, and the status export all
 * stub to a "coming soon" toast until the backend lands. The reviewer note is the one
 * action that takes effect; the parent owns its state, so it outlives a tab switch.
 */
@Component({
  selector: 'lfx-mentorship-applicants-tab',
  imports: [ReactiveFormsModule, RouterLink, AvatarComponent, ButtonComponent, InputTextComponent, MenuComponent, SelectComponent, TableComponent],
  templateUrl: './applicants-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicantsTabComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly applicants = input.required<MentorshipProgramApplicant[]>();
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;
  protected readonly statusNote = MENTORSHIP_APPLICANT_STATUS_NOTE;

  /** Fixed rather than derived from the rows: every status an application can display as. */
  protected readonly statusOptions = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
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

  protected readonly termOptions = this.initTermOptions();

  protected readonly rows = this.initRows();

  protected onOpenNote(id: string, name: string): void {
    this.noteRequested.emit({ personId: id, personName: name });
  }

  protected onAction(summary: string): void {
    this.comingSoon.notify(summary);
  }

  private initTermOptions() {
    return computed(() => mentorshipTermFilterOptions(this.applicants(), MENTORSHIP_ALL_TERMS_OPTION_LABEL));
  }

  private initRows() {
    return computed(() => {
      const { search, status, term } = this.filters();
      return this.applicants()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || mentorshipApplicantDisplayStatus(person) === status)
        .filter((person) => !term || person.termName === term)
        .map((person) => this.toRow(person));
    });
  }

  private menuItemsFor(person: MentorshipProgramApplicant): MenuItem[] {
    return mentorshipApplicantActionsFor(person.status).map((action) => ({
      label: MENTORSHIP_APPLICANT_ACTION_LABELS[action],
      icon: MENTORSHIP_APPLICANT_ACTION_ICONS[action],
      command: () => this.comingSoon.notify(`${MENTORSHIP_APPLICANT_ACTION_LABELS[action]} ${person.name}`),
    }));
  }

  private toRow(person: MentorshipProgramApplicant) {
    const displayStatus = mentorshipApplicantDisplayStatus(person);
    const note = (this.noteDrafts()[person.id] ?? person.note ?? '').trim();
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
        statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[mentorshipApplicantDisplayStatus(application)],
      })),
      hasNote: note.length > 0,
      noteLabel: note.length > 0 ? note : MENTORSHIP_ADD_NOTE_LABEL,
      menuItems: this.menuItemsFor(person),
    };
  }
}
