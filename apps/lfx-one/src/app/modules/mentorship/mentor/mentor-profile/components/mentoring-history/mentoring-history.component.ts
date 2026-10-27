// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  MENTORSHIP_MENTORING_HISTORY_EMPTY_SUBTITLE,
  MENTORSHIP_MENTORING_HISTORY_EMPTY_TITLE,
  MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS,
  MENTORSHIP_MENTORING_HISTORY_TITLE,
} from '@lfx-one/shared/constants';
import { MentorshipMentoringHistoryEntry } from '@lfx-one/shared/interfaces';

import { ProgramLinkComponent } from '../../../../components/program-link/program-link.component';

/**
 * Read-only mentoring history list for the mentor profile page. Each row is a
 * program the mentor has supported: program name, term, mentee count, and the
 * lifecycle badge. The program name links to the program's public page when the
 * row carries its id.
 *
 * Row-level display fields (badge label + Tailwind classes) are resolved from
 * the shared status maps in a single `computed` so the template only reads
 * pre-formatted rows.
 */
@Component({
  selector: 'lfx-mentorship-mentoring-history',
  imports: [ProgramLinkComponent],
  templateUrl: './mentoring-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentoringHistoryComponent {
  public readonly entries = input.required<MentorshipMentoringHistoryEntry[]>();

  protected readonly title = MENTORSHIP_MENTORING_HISTORY_TITLE;
  protected readonly emptyTitle = MENTORSHIP_MENTORING_HISTORY_EMPTY_TITLE;
  protected readonly emptySubtitle = MENTORSHIP_MENTORING_HISTORY_EMPTY_SUBTITLE;

  protected readonly rows = computed(() =>
    this.entries().map((entry) => ({
      ...entry,
      menteesLabel: `${entry.menteesCount} ${entry.menteesCount === 1 ? 'mentee' : 'mentees'}`,
      statusLabel: MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS[entry.status],
      statusBadgeClass: MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES[entry.status],
    }))
  );
}
