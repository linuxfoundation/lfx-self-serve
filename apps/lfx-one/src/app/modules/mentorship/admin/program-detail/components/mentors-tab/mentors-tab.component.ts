// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES, MENTORSHIP_MENTOR_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipInvitableUser, MentorshipProgramMentor } from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, matchesMentorshipPersonSearch, mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { map, startWith } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';

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
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly mentorshipService = inject(MentorshipService);

  public readonly mentors = input.required<MentorshipProgramMentor[]>();

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    invitee: new FormControl<string | null>(null),
  });

  private readonly filters = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  private readonly invitableUsers = this.initInvitableUsers();

  protected readonly inviteOptions = this.initInviteOptions();

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
    const invitee = this.invitableUsers().find((user) => user.id === inviteeId);
    this.comingSoon.notify(`Invite ${invitee?.name ?? 'mentor'}`);
    this.form.controls.invitee.reset(null);
  }

  protected onAcceptMentor(name: string): void {
    this.comingSoon.notify(`Accept ${name}`);
  }

  protected onDeclineMentor(name: string): void {
    this.comingSoon.notify(`Decline ${name}`);
  }

  protected onDeleteMentor(name: string): void {
    this.comingSoon.notify(`Remove ${name}`);
  }

  private toRow(person: MentorshipProgramMentor) {
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_MENTOR_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES[person.status],
      invitationLabel: person.invitedOn ? formatIsoDateLabel(person.invitedOn) : '—',
      profileCreatedLabel: person.profileCreated ? 'Yes' : 'No',
      profileCreatedClass: person.profileCreated ? 'text-emerald-600' : 'text-red-600',
      canAccept: person.status === 'pending' || person.status === 'declined',
      canDecline: person.status === 'pending' || person.status === 'accepted',
    };
  }

  /** LFX users that can be invited as mentors, served by the BFF. Not program-scoped. */
  private initInvitableUsers(): Signal<MentorshipInvitableUser[]> {
    return toSignal(this.mentorshipService.getInvitableUsers().pipe(map((response) => response.data)), { initialValue: [] });
  }

  /**
   * Invitable users minus anyone already in this program's mentors list (matched by
   * email — the mock sources don't expose stable ids across both). The pool is global,
   * so the per-program exclusion is a UI concern and stays here.
   */
  private initInviteOptions() {
    return computed(() => {
      const existingEmails = new Set(this.mentors().map((mentor) => mentor.email.toLowerCase()));
      return this.invitableUsers()
        .filter((user) => !existingEmails.has(user.email.toLowerCase()))
        .map((user) => ({
          label: user.name,
          value: user.id,
          email: user.email,
        }));
    });
  }
}
