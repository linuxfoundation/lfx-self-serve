// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
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
import {
  MentorshipMentorReviewTask,
  MentorshipMentorTaskReviewDecision,
  MentorshipMentorTaskReviewRequest,
  MentorshipMentorTaskReviewStatus,
  MentorshipProgramMentee,
} from '@lfx-one/shared/interfaces';
import { formatMentorshipReviewUpdatedLabel, mentorshipMentorReviewTasks, mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';

import { MentorshipTaskFileService } from '../../../../services/mentorship-task-file.service';

/**
 * Mentor-facing Tasks tab — submitted work awaiting review, plus already-approved
 * (completed) tasks. Approve and Request Changes ask the page to review the task, and
 * stay disabled while the page is reviewing it. Download Submission saves the mentee's file.
 */
@Component({
  selector: 'lfx-mentorship-mentor-tasks-tab',
  imports: [AvatarComponent, ButtonComponent],
  templateUrl: './mentor-tasks-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorTasksTabComponent {
  private readonly taskFile = inject(MentorshipTaskFileService);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();
  /** Upstream task ids the page is reviewing; their buttons stay disabled until the page has re-read the program. */
  public readonly reviewingTaskIds = input<readonly string[]>([]);

  public readonly reviewRequested = output<MentorshipMentorTaskReviewRequest>();

  protected readonly statusPills = MENTORSHIP_MENTOR_TASK_FILTER_PILLS;
  protected readonly approveLabel = MENTORSHIP_MENTOR_TASK_APPROVE_LABEL;
  protected readonly requestChangesLabel = MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL;
  protected readonly openSubmissionLabel = MENTORSHIP_MENTOR_TASK_OPEN_SUBMISSION_LABEL;

  protected readonly statusFilter = signal<MentorshipMentorTaskReviewStatus | undefined>('submitted');
  protected readonly rows = this.initRows();
  protected readonly emptyMessage = this.initEmptyMessage();

  protected onStatusPillClick(status: MentorshipMentorTaskReviewStatus | undefined): void {
    this.statusFilter.set(status);
  }

  protected onApprove(row: Pick<MentorshipMentorReviewTask, 'taskId'>): void {
    this.requestReview(row.taskId, 'complete');
  }

  /** No comment goes with the request: upstream has no field for one. */
  protected onRequestChanges(row: Pick<MentorshipMentorReviewTask, 'taskId'>): void {
    this.requestReview(row.taskId, 'incomplete');
  }

  protected onOpenSubmission(row: Pick<MentorshipMentorReviewTask, 'taskId'>): void {
    this.taskFile.download(row.taskId);
  }

  private requestReview(taskId: string, status: MentorshipMentorTaskReviewDecision): void {
    if (this.reviewingTaskIds().includes(taskId)) return;
    this.reviewRequested.emit({ taskId, status });
  }

  private initEmptyMessage() {
    return computed(() => {
      const status = this.statusFilter();
      if (status === 'submitted') return MENTORSHIP_MENTOR_TASKS_EMPTY_AWAITING;
      if (status === 'completed') return MENTORSHIP_MENTOR_TASKS_EMPTY_APPROVED;
      return MENTORSHIP_MENTOR_TASKS_EMPTY_ALL;
    });
  }

  private initRows() {
    return computed(() => {
      const status = this.statusFilter();
      const reviewingTaskIds = this.reviewingTaskIds();
      return mentorshipMentorReviewTasks(this.mentees())
        .filter((task) => !status || task.status === status)
        .map((task) => ({
          ...task,
          initials: mentorshipPersonInitials(task.menteeName),
          avatarStyleClass: mentorshipPersonAvatarClass(task.menteeName),
          updatedLabel: formatMentorshipReviewUpdatedLabel(task.updatedOn),
          verb: task.status === 'completed' ? MENTORSHIP_MENTOR_TASK_COMPLETED_VERB : MENTORSHIP_MENTOR_TASK_SUBMITTED_VERB,
          reviewing: reviewingTaskIds.includes(task.taskId),
        }));
    });
  }
}
