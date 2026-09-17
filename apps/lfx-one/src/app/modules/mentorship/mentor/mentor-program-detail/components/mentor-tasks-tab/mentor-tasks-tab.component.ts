// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTOR_TASK_APPROVE_LABEL,
  MENTORSHIP_MENTOR_TASK_COMPLETED_VERB,
  MENTORSHIP_MENTOR_TASK_FILTER_PILLS,
  MENTORSHIP_MENTOR_TASK_OPEN_SUBMISSION_LABEL,
  MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL,
  MENTORSHIP_MENTOR_TASK_SUBMITTED_VERB,
  MENTORSHIP_MENTOR_TASKS_EMPTY_ALL,
  MENTORSHIP_MENTOR_TASKS_EMPTY_APPROVED,
  MENTORSHIP_MENTOR_TASKS_EMPTY_AWAITING,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskReviewStatus, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { formatMentorshipReviewUpdatedLabel, mentorshipMentorReviewTasks, mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';

/**
 * Mentor-facing Tasks tab — submitted work awaiting review, plus already-approved
 * (completed) tasks. Approve / Request Changes / Open Submission toast only until
 * the write endpoints land.
 */
@Component({
  selector: 'lfx-mentorship-mentor-tasks-tab',
  imports: [AvatarComponent, ButtonComponent],
  templateUrl: './mentor-tasks-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorTasksTabComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();

  protected readonly statusPills = MENTORSHIP_MENTOR_TASK_FILTER_PILLS;
  protected readonly approveLabel = MENTORSHIP_MENTOR_TASK_APPROVE_LABEL;
  protected readonly requestChangesLabel = MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL;
  protected readonly openSubmissionLabel = MENTORSHIP_MENTOR_TASK_OPEN_SUBMISSION_LABEL;

  protected readonly statusFilter = signal<MentorshipMentorTaskReviewStatus | undefined>('submitted');
  protected readonly rows = this.initRows();
  protected readonly emptyMessage = computed(() => {
    const status = this.statusFilter();
    if (status === 'submitted') return MENTORSHIP_MENTOR_TASKS_EMPTY_AWAITING;
    if (status === 'completed') return MENTORSHIP_MENTOR_TASKS_EMPTY_APPROVED;
    return MENTORSHIP_MENTOR_TASKS_EMPTY_ALL;
  });

  protected onStatusPillClick(status: MentorshipMentorTaskReviewStatus | undefined): void {
    this.statusFilter.set(status);
  }

  protected onApprove(row: { id: string; menteeName: string; taskName: string }): void {
    this.comingSoon.notify(`Approve "${row.taskName}" for ${row.menteeName}`);
  }

  protected onRequestChanges(row: { id: string; menteeName: string; taskName: string }): void {
    this.comingSoon.notify(`Request changes on "${row.taskName}" for ${row.menteeName}`);
  }

  protected onOpenSubmission(row: { id: string; menteeName: string; taskName: string }): void {
    this.comingSoon.notify(`Open submission for "${row.taskName}" from ${row.menteeName}`);
  }

  private initRows() {
    return computed(() => {
      const status = this.statusFilter();
      return mentorshipMentorReviewTasks(this.mentees())
        .filter((task) => !status || task.status === status)
        .map((task) => ({
          ...task,
          initials: mentorshipPersonInitials(task.menteeName),
          avatarStyleClass: mentorshipPersonAvatarClass(task.menteeName),
          updatedLabel: formatMentorshipReviewUpdatedLabel(task.updatedOn),
          verb: task.status === 'completed' ? MENTORSHIP_MENTOR_TASK_COMPLETED_VERB : MENTORSHIP_MENTOR_TASK_SUBMITTED_VERB,
        }));
    });
  }
}
