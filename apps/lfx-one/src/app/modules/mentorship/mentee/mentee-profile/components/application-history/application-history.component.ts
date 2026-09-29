// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import {
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_SUBTITLE,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_TITLE,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_UNKNOWN_BADGE_CLASS,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_TITLE,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_VIEW_LABEL,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL,
  MENTORSHIP_MENTEE_FIND_PROGRAM_URL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationHistoryEntry } from '@lfx-one/shared/interfaces';

/**
 * Application History for the mentee profile page. Each row is an `applications`
 * record with `role = mentee` (mentees are not `program_members`). Status values
 * are the stored enum; the trash control is withdraw (`pending → withdrawn`), not
 * a hard delete — Mentorship has no application delete. The row emits `withdraw` with
 * the application id and the parent page runs the confirm and the write.
 *
 * View opens the program's page on the public Mentorship site in a new tab.
 *
 * Row-level display fields (badge label + Tailwind classes + whether withdraw is
 * legal + the program link) are resolved in a single `computed` so the template only reads
 * pre-formatted rows.
 */
@Component({
  selector: 'lfx-mentorship-application-history',
  templateUrl: './application-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationHistoryComponent {
  public readonly entries = input.required<MentorshipMenteeApplicationHistoryEntry[]>();
  /** The application the parent is withdrawing; every Withdraw button is disabled while set. */
  public readonly withdrawingId = input<string | null>(null);

  public readonly withdraw = output<string>();

  protected readonly title = MENTORSHIP_MENTEE_APPLICATION_HISTORY_TITLE;
  protected readonly emptyTitle = MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_TITLE;
  protected readonly emptySubtitle = MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_SUBTITLE;
  protected readonly viewLabel = MENTORSHIP_MENTEE_APPLICATION_HISTORY_VIEW_LABEL;
  protected readonly withdrawLabel = MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL;

  protected readonly rows = this.initRows();

  protected onWithdraw(entry: MentorshipMenteeApplicationHistoryEntry): void {
    if (entry.status !== 'pending') return;
    this.withdraw.emit(entry.id);
  }

  private initRows(): Signal<
    (MentorshipMenteeApplicationHistoryEntry & {
      statusLabel: string;
      statusBadgeClass: string;
      canWithdraw: boolean;
      programUrl: string | null;
    })[]
  > {
    const labels: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS;
    const badgeClasses: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES;

    return computed(() =>
      this.entries().map((entry) => ({
        ...entry,
        statusLabel: labels[entry.status] ?? entry.status,
        statusBadgeClass: badgeClasses[entry.status] ?? MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_UNKNOWN_BADGE_CLASS,
        // Applicant self-withdraw is `pending → withdrawn` only. Declined cannot re-apply;
        // accepted/graduated/hold/withdrawn are not self-withdrawable.
        canWithdraw: entry.status === 'pending',
        // No program id means there is no page to open, so the row shows no View link.
        programUrl: entry.programId ? `${MENTORSHIP_MENTEE_FIND_PROGRAM_URL}/${encodeURIComponent(entry.programId)}` : null,
      }))
    );
  }
}
