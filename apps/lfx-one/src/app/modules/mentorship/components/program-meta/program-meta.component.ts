// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { MentorshipProgramSubmitter } from '@lfx-one/shared/interfaces';
import { mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';

/**
 * The line under a program's title on the admin program page and the review page: when the program was created or
 * submitted, and the program admin who submitted it, with their avatar and a mailto link. Either half is left out
 * when it is unknown, and the line is left out when both are.
 *
 * The avatar is drawn here rather than with `lfx-avatar`, which shows one letter: the design shows two initials.
 */
@Component({
  selector: 'lfx-mentorship-program-meta',
  imports: [DatePipe],
  templateUrl: './program-meta.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramMetaComponent {
  /** The date's label, e.g. "Created" on the admin page and "Submitted" on the review page. */
  public readonly dateLabel = input.required<string>();
  /** ISO timestamp; `null` leaves the date out. */
  public readonly date = input<string | null>(null);
  /** `null` leaves the program admin out. */
  public readonly submitter = input<MentorshipProgramSubmitter | null>(null);

  /** Set when the avatar image fails to load, so the initials show instead; reset when the submitter changes. */
  protected readonly avatarFailed = linkedSignal<MentorshipProgramSubmitter | null, boolean>({ source: this.submitter, computation: () => false });
  protected readonly initials = computed(() => mentorshipPersonInitials(this.submitter()?.name ?? ''));
  protected readonly avatarStyleClass = computed(() => mentorshipPersonAvatarClass(this.submitter()?.name ?? ''));
}
