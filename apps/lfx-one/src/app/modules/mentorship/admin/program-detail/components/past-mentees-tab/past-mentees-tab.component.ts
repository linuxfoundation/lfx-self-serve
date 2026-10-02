// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ALL_CLOSED_TERMS_OPTION_LABEL,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_MENTEE_STATUSES,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import { FilterOption, MentorshipMenteeStatus, MentorshipProgramMentee, MentorshipProgramTermRow } from '@lfx-one/shared/interfaces';
import { matchesMentorshipPersonSearch, mentorshipPersonAvatarClass, mentorshipPersonInitials, mentorshipTermFilterOptions } from '@lfx-one/shared/utils';
import { startWith, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';

/**
 * Past mentees tab — every application in one of the program's closed terms, whatever
 * status it was left in. A closed term is read-only history, so unlike the Current
 * Mentees table this one carries no tasks, row actions, or reviewer note; it filters by
 * status and closed term.
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
  /** The program's terms; only the closed ones feed the term filter. */
  public readonly terms = input<MentorshipProgramTermRow[]>([]);

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;

  /**
   * Fixed rather than derived from the rows: every status a mentee can hold. A term
   * closes on whatever status each application was left in, so none is ruled out.
   */
  protected readonly statusOptions: FilterOption<MentorshipMenteeStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_MENTEE_STATUSES.map((status) => ({ label: MENTORSHIP_MENTEE_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
    term: new FormControl<string | null>(null),
  });

  /**
   * Paginator offset. Tracked so that narrowing the list can send the table back to the
   * first page — PrimeNG keeps its own offset when the value array shrinks underneath it,
   * which would otherwise leave the admin on a page that no longer exists.
   */
  protected readonly first = signal(0);

  private readonly filters = toSignal(
    this.form.valueChanges.pipe(
      tap(() => this.first.set(0)),
      startWith(this.form.getRawValue())
    ),
    { initialValue: this.form.getRawValue() }
  );

  protected readonly termOptions = this.initTermOptions();

  protected readonly rows = this.initRows();

  protected onAction(summary: string): void {
    this.comingSoon.notify(summary);
  }

  private initTermOptions() {
    return computed(() => mentorshipTermFilterOptions(this.terms(), 'closed', MENTORSHIP_ALL_CLOSED_TERMS_OPTION_LABEL));
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
