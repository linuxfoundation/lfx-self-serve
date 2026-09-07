// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_PERSON_STATUS_BADGE_CLASSES,
  MENTORSHIP_PERSON_STATUS_LABELS,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
  MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
} from '@lfx-one/shared/constants';
import { MentorshipPersonStatus, MentorshipProgramPerson } from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, matchesMentorshipPersonSearch, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { startWith } from 'rxjs';

/**
 * Mentors tab — invitation status, dates, and profile-created flag.
 */
@Component({
  selector: 'lfx-mentorship-mentors-tab',
  imports: [ReactiveFormsModule, AvatarComponent, ButtonComponent, InputTextComponent, SelectComponent],
  templateUrl: './mentors-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorsTabComponent {
  public readonly mentors = input.required<MentorshipProgramPerson[]>();

  private readonly messageService = inject(MessageService);

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipPersonStatus | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly statusOptions = computed(() => {
    const statuses = [...new Set(this.mentors().map((person) => person.status))];
    return [
      { label: 'All statuses', value: null },
      ...statuses.map((status) => ({
        label: MENTORSHIP_PERSON_STATUS_LABELS[status],
        value: status,
      })),
    ];
  });

  protected readonly rows = computed(() => {
    const { search, status } = this.filters();
    return this.mentors()
      .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
      .filter((person) => !status || person.status === status)
      .map((person) => this.toRow(person));
  });

  protected onInviteMentor(): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Invite mentor',
      detail: MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
      life: 4000,
    });
  }

  private toRow(person: MentorshipProgramPerson) {
    const seed = person.name.length > 0 ? person.name.charCodeAt(0) : 0;
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: MENTORSHIP_PROGRAM_AVATAR_PALETTE[seed % MENTORSHIP_PROGRAM_AVATAR_PALETTE.length],
      statusLabel: MENTORSHIP_PERSON_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_PERSON_STATUS_BADGE_CLASSES[person.status],
      invitedOnLabel: person.invitedOn ? formatIsoDateLabel(person.invitedOn) : '—',
      profileCreatedLabel: person.profileCreated ? 'Yes' : 'No',
    };
  }
}
