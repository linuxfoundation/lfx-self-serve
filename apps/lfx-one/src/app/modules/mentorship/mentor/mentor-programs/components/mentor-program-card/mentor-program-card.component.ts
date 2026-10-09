// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MENTORSHIP_PROGRAM_AVATAR_PALETTE, MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES, MENTORSHIP_PROGRAM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProgram } from '@lfx-one/shared/interfaces';
import { stableKeyIndex } from '@lfx-one/shared/utils';

/**
 * Compact card for the mentor My Programs list. Mirrors `ProgramCardComponent`
 * shape: avatar tile on the left, project-line + status badge + title in the
 * middle, three-column metrics on the right, plus a chevron.
 */
@Component({
  selector: 'lfx-mentorship-mentor-program-card',
  imports: [AvatarComponent],
  templateUrl: './mentor-program-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramCardComponent {
  public readonly program = input.required<MentorshipMentorProgram>();
  public readonly cardClick = output<string>();

  protected readonly statusLabel = computed(() => MENTORSHIP_PROGRAM_STATUS_LABELS[this.program().status]);
  protected readonly statusBadgeClass = computed(() => MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES[this.program().status]);

  protected readonly avatarStyleClass = computed(
    () => MENTORSHIP_PROGRAM_AVATAR_PALETTE[stableKeyIndex(this.program().name, MENTORSHIP_PROGRAM_AVATAR_PALETTE.length)]
  );

  protected readonly initials = computed(() => {
    const name = this.program().name.trim();
    return name.length > 0 ? name[0].toUpperCase() : '?';
  });

  protected onCardClick(): void {
    this.cardClick.emit(this.program().id);
  }
}
