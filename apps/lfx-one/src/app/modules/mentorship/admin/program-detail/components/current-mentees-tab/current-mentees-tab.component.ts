// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_CURRENT_MENTEE_STATUSES,
  MENTORSHIP_MENTEE_ACTION_ICONS,
  MENTORSHIP_MENTEE_ACTION_LABELS,
  MENTORSHIP_MENTEE_PAGE_SIZE,
  MENTORSHIP_MENTEE_ROWS_PER_PAGE_OPTIONS,
  MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
  MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeStatus, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { formatMentorshipTaskProgress, matchesMentorshipPersonSearch, mentorshipMenteeActionsFor, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, take } from 'rxjs';

import { MenteeNoteDialogComponent } from '../mentee-note-dialog/mentee-note-dialog.component';

/**
 * Current mentees tab — task progress plus the reviewer note, filtered by search and
 * status (accepted / graduated, the only statuses this tab lists). Row actions
 * (withdraw / decline / graduate), Create Task, View Tasks, and the status export all
 * stub to a "coming soon" toast until the backend lands; the reviewer note is the one
 * action that takes effect, held locally.
 */
@Component({
  selector: 'lfx-mentorship-current-mentees-tab',
  imports: [ReactiveFormsModule, AvatarComponent, ButtonComponent, InputTextComponent, MenuComponent, SelectComponent, TableComponent],
  templateUrl: './current-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentMenteesTabComponent {
  public readonly mentees = input.required<MentorshipProgramMentee[]>();

  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  protected readonly pageSize = MENTORSHIP_MENTEE_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_MENTEE_ROWS_PER_PAGE_OPTIONS;

  /** Fixed rather than derived from the rows: the two statuses this tab can list. */
  protected readonly statusOptions = [
    { label: 'All statuses', value: null },
    ...MENTORSHIP_CURRENT_MENTEE_STATUSES.map((status) => ({ label: MENTORSHIP_MENTEE_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /**
   * Reviewer notes are local until a write endpoint exists, so a re-emission of the
   * same upstream mentees must keep them. Only a genuinely different set resets.
   */
  protected readonly draftMentees = linkedSignal<MentorshipProgramMentee[], MentorshipProgramMentee[]>({
    source: this.mentees,
    computation: (mentees, previous) => (previous && this.sameMenteeIds(previous.source, mentees) ? previous.value : mentees),
  });

  protected readonly rows = this.initRows();

  protected onOpenNote(id: string): void {
    const mentee = this.draftMentees().find((person) => person.id === id);
    if (!mentee) return;

    const dialogRef = this.dialogService.open(MenteeNoteDialogComponent, {
      header: 'Reviewer note',
      width: '34rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { menteeId: mentee.id, menteeName: mentee.name, note: mentee.note ?? '' },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((note: string | undefined) => {
      // Dismissing the dialog resolves to `undefined` and must leave the note untouched;
      // an empty string is an explicit clear.
      if (note === undefined) return;
      this.draftMentees.set(this.draftMentees().map((person) => (person.id === id ? { ...person, note: note || undefined } : person)));
    });
  }

  protected onCreateTask(name: string): void {
    this.toastComingSoon(`Create a task for ${name}`);
  }

  protected onViewTasks(name: string): void {
    this.toastComingSoon(`View tasks for ${name}`);
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

  private sameMenteeIds(a: MentorshipProgramMentee[], b: MentorshipProgramMentee[]): boolean {
    return a.length === b.length && a.every((mentee, index) => mentee.id === b[index].id);
  }

  private menuItemsFor(person: MentorshipProgramMentee): MenuItem[] {
    return mentorshipMenteeActionsFor(person.status).map((action) => ({
      label: MENTORSHIP_MENTEE_ACTION_LABELS[action],
      icon: MENTORSHIP_MENTEE_ACTION_ICONS[action],
      command: () => this.toastComingSoon(`${MENTORSHIP_MENTEE_ACTION_LABELS[action]} ${person.name}`),
    }));
  }

  private initRows() {
    return computed(() => {
      const { search, status } = this.filters();
      return this.draftMentees()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || person.status === status)
        .map((person) => this.toRow(person));
    });
  }

  private toRow(person: MentorshipProgramMentee) {
    const seed = person.name.length > 0 ? person.name.charCodeAt(0) : 0;
    const note = person.note?.trim() ?? '';
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: MENTORSHIP_PROGRAM_AVATAR_PALETTE[seed % MENTORSHIP_PROGRAM_AVATAR_PALETTE.length],
      statusLabel: MENTORSHIP_MENTEE_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES[person.status],
      taskLabel: formatMentorshipTaskProgress(person.tasksSubmitted, person.tasksTotal),
      hasNote: note.length > 0,
      noteLabel: note.length > 0 ? note : 'Add note',
      menuItems: this.menuItemsFor(person),
    };
  }
}
