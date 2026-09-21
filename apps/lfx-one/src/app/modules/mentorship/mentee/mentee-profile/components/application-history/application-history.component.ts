// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import {
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_SUBTITLE,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_TITLE,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_TITLE,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_VIEW_LABEL,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationHistoryEntry } from '@lfx-one/shared/interfaces';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';

/**
 * Application History for the mentee profile page. Each row is an `applications`
 * record with `role = mentee` (mentees are not `program_members`). Status values
 * are the stored enum; the trash control is withdraw (`pending → withdrawn`), not
 * a hard delete — Mentorship has no application delete.
 *
 * Row-level display fields (badge label + Tailwind classes + whether withdraw is
 * legal) are resolved in a single `computed` so the template only reads
 * pre-formatted rows.
 */
@Component({
  selector: 'lfx-mentorship-application-history',
  templateUrl: './application-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationHistoryComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly entries = input.required<MentorshipMenteeApplicationHistoryEntry[]>();

  protected readonly title = MENTORSHIP_MENTEE_APPLICATION_HISTORY_TITLE;
  protected readonly emptyTitle = MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_TITLE;
  protected readonly emptySubtitle = MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_SUBTITLE;
  protected readonly viewLabel = MENTORSHIP_MENTEE_APPLICATION_HISTORY_VIEW_LABEL;
  protected readonly withdrawLabel = MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL;

  protected readonly rows = this.initRows();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- row reserved for real application navigation
  protected onView(_entry: MentorshipMenteeApplicationHistoryEntry): void {
    this.comingSoon.notify(this.viewLabel);
  }

  protected onWithdraw(entry: MentorshipMenteeApplicationHistoryEntry): void {
    if (entry.status !== 'pending') return;
    this.comingSoon.notify(this.withdrawLabel);
  }

  private initRows(): Signal<
    (MentorshipMenteeApplicationHistoryEntry & {
      statusLabel: string;
      statusBadgeClass: string;
      canWithdraw: boolean;
    })[]
  > {
    const labels: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS;
    const badgeClasses: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES;

    return computed(() =>
      this.entries().map((entry) => ({
        ...entry,
        statusLabel: labels[entry.status] ?? entry.status,
        statusBadgeClass: badgeClasses[entry.status] ?? MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES.declined,
        // Applicant self-withdraw is `pending → withdrawn` only. Declined cannot re-apply;
        // accepted/graduated/hold/withdrawn are not self-withdrawable.
        canWithdraw: entry.status === 'pending',
      }))
    );
  }
}
