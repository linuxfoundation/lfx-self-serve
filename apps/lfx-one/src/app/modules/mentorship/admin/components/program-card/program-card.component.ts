// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MENTORSHIP_PROGRAM_AVATAR_PALETTE, MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES, MENTORSHIP_PROGRAM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipProgram } from '@lfx-one/shared/interfaces';

/**
 * Compact card for the mentorship admin list. Mirrors `InitiativeCardComponent`
 * shape: avatar tile on the left, project-line + status badge + title in the
 * middle, three-column metrics on the right, plus a chevron. Click emits the
 * program id so the parent can drive navigation.
 */
@Component({
  selector: 'lfx-mentorship-program-card',
  imports: [AvatarComponent],
  templateUrl: './program-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramCardComponent {
  public readonly program = input.required<MentorshipProgram>();
  public readonly cardClick = output<string>();

  protected readonly seasonLine = computed(() => {
    const p = this.program();
    return `${p.projectName} · ${p.term}`;
  });

  protected readonly statusLabel = computed(() => MENTORSHIP_PROGRAM_STATUS_LABELS[this.program().status]);
  protected readonly statusBadgeClass = computed(() => MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES[this.program().status]);

  /** Deterministic avatar tint based on the program title so repeat renders don't shuffle colors. */
  protected readonly avatarStyleClass = computed(() => {
    const key = this.program().name;
    const seed = key.length > 0 ? key.charCodeAt(0) : 0;
    const idx = seed % MENTORSHIP_PROGRAM_AVATAR_PALETTE.length;
    return MENTORSHIP_PROGRAM_AVATAR_PALETTE[idx];
  });

  /** First letter of the title. `AvatarComponent.displayLabel` only renders `label.charAt(0)`. */
  protected readonly initials = computed(() => {
    const name = this.program().name.trim();
    return name.length > 0 ? name[0].toUpperCase() : '?';
  });

  protected onCardClick(): void {
    this.cardClick.emit(this.program().id);
  }
}
