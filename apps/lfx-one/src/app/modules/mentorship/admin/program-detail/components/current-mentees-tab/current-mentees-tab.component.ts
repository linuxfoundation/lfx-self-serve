// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ADD_NOTE_LABEL,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_CURRENT_MENTEE_STATUSES,
  MENTORSHIP_MENTEE_ACTION_ICONS,
  MENTORSHIP_MENTEE_ACTION_LABELS,
  MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import { FilterOption, MentorshipMenteeStatus, MentorshipNoteRequest, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import {
  formatMentorshipTaskProgress,
  matchesMentorshipPersonSearch,
  mentorshipMenteeActionsFor,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipRowActions,
} from '@lfx-one/shared/utils';
import { startWith, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { PersonCellComponent } from '../person-cell/person-cell.component';
import { RowActionsComponent } from '../row-actions/row-actions.component';

/**
 * Current mentees tab — task progress plus the reviewer note. Lists only the enrolled
 * statuses (accepted / graduated); everyone else belongs to the Applicants tab, and the
 * status filter offers exactly the two it lists. Row actions (withdraw / decline /
 * graduate), Create Task, View Tasks, and the status export all stub to a "coming soon"
 * toast until the backend lands. The reviewer note is the one action that takes effect;
 * the parent owns its state, so it outlives a tab switch.
 */
@Component({
  selector: 'lfx-mentorship-current-mentees-tab',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, PersonCellComponent, RowActionsComponent, SelectComponent, TableComponent],
  templateUrl: './current-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentMenteesTabComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;

  /** Fixed rather than derived from the rows: the two statuses this tab can list. */
  protected readonly statusOptions: FilterOption<MentorshipMenteeStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_CURRENT_MENTEE_STATUSES.map((status) => ({ label: MENTORSHIP_MENTEE_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
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

  protected readonly rows = this.initRows();

  protected onOpenNote(id: string, name: string): void {
    this.noteRequested.emit({ personId: id, personName: name });
  }

  protected onAction(summary: string): void {
    this.comingSoon.notify(summary);
  }

  private initRows() {
    return computed(() => {
      const { search, status } = this.filters();
      return this.mentees()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || person.status === status)
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
      taskLabel: formatMentorshipTaskProgress(person.tasksSubmitted, person.tasksTotal),
      ...mentorshipNoteDisplay(this.noteDrafts(), person, MENTORSHIP_ADD_NOTE_LABEL),
      actions: mentorshipRowActions(mentorshipMenteeActionsFor(person.status), MENTORSHIP_MENTEE_ACTION_LABELS, MENTORSHIP_MENTEE_ACTION_ICONS),
    };
  }
}
