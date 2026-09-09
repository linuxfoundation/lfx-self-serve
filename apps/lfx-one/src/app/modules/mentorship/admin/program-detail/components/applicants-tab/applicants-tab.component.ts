// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES, MENTORSHIP_MENTEE_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMenteeStatus, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, matchesMentorshipPersonSearch, mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { startWith } from 'rxjs';

/**
 * Applicants tab — pending / declined applications with search + status filter.
 */
@Component({
  selector: 'lfx-mentorship-applicants-tab',
  imports: [ReactiveFormsModule, AvatarComponent, InputTextComponent, SelectComponent],
  templateUrl: './applicants-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicantsTabComponent {
  public readonly applicants = input.required<MentorshipProgramMentee[]>();

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly statusOptions = computed(() => {
    const statuses = [...new Set(this.applicants().map((person) => person.status))];
    return [
      { label: 'All statuses', value: null },
      ...statuses.map((status) => ({
        label: MENTORSHIP_MENTEE_STATUS_LABELS[status],
        value: status,
      })),
    ];
  });

  protected readonly rows = computed(() => {
    const { search, status } = this.filters();
    return this.applicants()
      .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
      .filter((person) => !status || person.status === status)
      .map((person) => this.toRow(person));
  });

  private toRow(person: MentorshipProgramMentee) {
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_MENTEE_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES[person.status],
      appliedOnLabel: person.appliedOn ? formatIsoDateLabel(person.appliedOn) : '—',
    };
  }
}
