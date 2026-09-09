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
  MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTOR_STATUS_LABELS,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
  MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
  MOCK_MENTORSHIP_INVITABLE_USERS,
} from '@lfx-one/shared/constants';
import { MentorshipProgramMentor } from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, matchesMentorshipPersonSearch, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { startWith } from 'rxjs';

/**
 * Mentors tab — invitation status, dates, and profile-created flag. The toolbar
 * pairs a row search with a single-select invitee picker + Invite button; rows
 * expose Accept / Decline / Delete actions gated by the mentor's current status.
 * All mutating actions stub to a "coming soon" toast until the backend lands.
 */
@Component({
  selector: 'lfx-mentorship-mentors-tab',
  imports: [ReactiveFormsModule, AvatarComponent, ButtonComponent, InputTextComponent, SelectComponent],
  templateUrl: './mentors-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorsTabComponent {
  public readonly mentors = input.required<MentorshipProgramMentor[]>();

  private readonly messageService = inject(MessageService);

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    invitee: new FormControl<string | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /**
   * Invitable users minus anyone already in this program's mentors list (matched
   * by email — the mock upstream doesn't expose stable ids across sources). Once
   * the real user-search endpoint lands this becomes a server-driven query and
   * the exclusion happens on the backend.
   */
  protected readonly inviteOptions = computed(() => {
    const existingEmails = new Set(this.mentors().map((mentor) => mentor.email.toLowerCase()));
    return MOCK_MENTORSHIP_INVITABLE_USERS.filter((user) => !existingEmails.has(user.email.toLowerCase())).map((user) => ({
      label: user.name,
      value: user.id,
      email: user.email,
    }));
  });

  protected readonly canInvite = computed(() => !!this.filters().invitee);

  protected readonly rows = computed(() => {
    const { search } = this.filters();
    return this.mentors()
      .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
      .map((person) => this.toRow(person));
  });

  protected onInviteMentor(): void {
    const inviteeId = this.form.controls.invitee.value;
    if (!inviteeId) return;
    const invitee = MOCK_MENTORSHIP_INVITABLE_USERS.find((user) => user.id === inviteeId);
    this.toastComingSoon(`Invite ${invitee?.name ?? 'mentor'}`);
    this.form.controls.invitee.reset(null);
  }

  protected onAcceptMentor(name: string): void {
    this.toastComingSoon(`Accept ${name}`);
  }

  protected onDeclineMentor(name: string): void {
    this.toastComingSoon(`Decline ${name}`);
  }

  protected onDeleteMentor(name: string): void {
    this.toastComingSoon(`Remove ${name}`);
  }

  private toastComingSoon(summary: string): void {
    this.messageService.add({
      severity: 'info',
      summary,
      detail: MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
      life: 4000,
    });
  }

  private toRow(person: MentorshipProgramMentor) {
    const seed = person.name.length > 0 ? person.name.charCodeAt(0) : 0;
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: MENTORSHIP_PROGRAM_AVATAR_PALETTE[seed % MENTORSHIP_PROGRAM_AVATAR_PALETTE.length],
      statusLabel: MENTORSHIP_MENTOR_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES[person.status],
      invitationLabel: person.invitedOn ? formatIsoDateLabel(person.invitedOn) : '—',
      profileCreatedLabel: person.profileCreated ? 'Yes' : 'No',
      profileCreatedClass: person.profileCreated ? 'text-emerald-600' : 'text-red-600',
      canAccept: person.status === 'pending' || person.status === 'declined',
      canDecline: person.status === 'pending' || person.status === 'accepted',
    };
  }
}
