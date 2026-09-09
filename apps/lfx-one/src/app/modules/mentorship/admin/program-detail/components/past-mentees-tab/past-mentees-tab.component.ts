// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_ALL_TERMS_OPTION_LABEL,
  MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_PAST_MENTEE_STATUSES,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeStatus, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { matchesMentorshipPersonSearch, mentorshipPersonAvatarClass, mentorshipPersonInitials, mentorshipTermFilterOptions } from '@lfx-one/shared/utils';
import { startWith } from 'rxjs';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { PersonCellComponent } from '../person-cell/person-cell.component';

/**
 * Past mentees tab — replaces Current Mentees once a program is completed. Finished
 * participations are read-only history, so unlike the current-mentee table this one
 * carries no tasks, Create Task, row actions, or reviewer note; it adds the term the
 * mentee took part in and filters by both status and term.
 */
@Component({
  selector: 'lfx-mentorship-past-mentees-tab',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, PersonCellComponent, SelectComponent, TableComponent],
  templateUrl: './past-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PastMenteesTabComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;

  /** Fixed rather than derived from the rows: the statuses a finished mentee can hold. */
  protected readonly statusOptions = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_PAST_MENTEE_STATUSES.map((status) => ({ label: MENTORSHIP_MENTEE_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
    term: new FormControl<string | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly termOptions = this.initTermOptions();

  protected readonly rows = this.initRows();

  protected onAction(summary: string): void {
    this.comingSoon.notify(summary);
  }

  private initTermOptions() {
    return computed(() => mentorshipTermFilterOptions(this.mentees(), MENTORSHIP_ALL_TERMS_OPTION_LABEL));
  }

  private initRows() {
    return computed(() => {
      const { search, status, term } = this.filters();
      return this.mentees()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || person.status === status)
        .filter((person) => !term || person.termName === term)
        .map((person) => this.toRow(person));
    });
  }

  private toRow(person: MentorshipProgramMentee) {
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_MENTEE_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES[person.status],
    };
  }
}
