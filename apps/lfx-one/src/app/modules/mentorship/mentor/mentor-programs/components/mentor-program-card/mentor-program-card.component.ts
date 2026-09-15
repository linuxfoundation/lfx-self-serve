// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import {
  MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProgram } from '@lfx-one/shared/interfaces';
import { stableKeyIndex } from '@lfx-one/shared/utils';

/**
 * Compact card for the mentor My Programs list. Mirrors `ProgramCardComponent`
 * shape: avatar tile on the left, project-line + term badge + title in the
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

  protected readonly seasonLine = computed(() => {
    const program = this.program();
    return `${program.projectName} · ${program.term}`;
  });

  protected readonly termStatusLabel = computed(() => MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS[this.program().termStatus]);
  protected readonly termStatusBadgeClass = computed(() => MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES[this.program().termStatus]);

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
