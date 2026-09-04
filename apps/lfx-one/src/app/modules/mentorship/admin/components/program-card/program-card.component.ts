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
 * program slug so the parent can drive navigation.
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

  /** Two-letter initials pulled from the first two whitespace-delimited tokens of the title (e.g. "GridFlow: Time" → "GT"). */
  protected readonly initials = computed(() => {
    const tokens = this.program().name.trim().split(/\s+/);
    if (tokens.length === 0 || tokens[0].length === 0) return '?';
    const first = tokens[0][0];
    const second = tokens[1]?.[0] ?? tokens[0][1] ?? '';
    return (first + second).toUpperCase();
  });

  protected onCardClick(): void {
    this.cardClick.emit(this.program().slug);
  }
}
