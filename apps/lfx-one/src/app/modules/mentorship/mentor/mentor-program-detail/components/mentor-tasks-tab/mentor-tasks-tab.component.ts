// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTOR_TASK_APPROVE_LABEL,
  MENTORSHIP_MENTOR_TASK_CHANGES_DIALOG_HEADER,
  MENTORSHIP_MENTOR_TASK_COMPLETED_VERB,
  MENTORSHIP_MENTOR_TASK_FILTER_PILLS,
  MENTORSHIP_MENTOR_TASK_OPEN_SUBMISSION_LABEL,
  MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL,
  MENTORSHIP_MENTOR_TASK_SUBMITTED_VERB,
  MENTORSHIP_MENTOR_TASK_VIEW_SUBMISSION_LABEL,
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
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { MentorshipTaskFileService } from '../../../../services/mentorship-task-file.service';
import { TaskChangesDialogComponent } from '../task-changes-dialog/task-changes-dialog.component';

/**
 * Mentor-facing Tasks tab — submitted work awaiting review, plus already-approved
 * (completed) tasks. Approve asks the page to review the task; Request Changes first asks the mentor
 * for a reason in a dialog, which upstream emails to the mentee. Both stay disabled while the page is reviewing it. View Submission opens the mentee's file in a new tab; Download
 * Submission saves it.
 */
@Component({
  selector: 'lfx-mentorship-mentor-tasks-tab',
  imports: [AvatarComponent, ButtonComponent],
  templateUrl: './mentor-tasks-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorTasksTabComponent {
  private readonly taskFile = inject(MentorshipTaskFileService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();
  /** Upstream task ids the page is reviewing; their buttons stay disabled until the page has re-read the program. */
  public readonly reviewingTaskIds = input<readonly string[]>([]);

  public readonly reviewRequested = output<MentorshipMentorTaskReviewRequest>();

  protected readonly statusPills = MENTORSHIP_MENTOR_TASK_FILTER_PILLS;
  protected readonly approveLabel = MENTORSHIP_MENTOR_TASK_APPROVE_LABEL;
  protected readonly requestChangesLabel = MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL;
  protected readonly openSubmissionLabel = MENTORSHIP_MENTOR_TASK_OPEN_SUBMISSION_LABEL;
  protected readonly viewSubmissionLabel = MENTORSHIP_MENTOR_TASK_VIEW_SUBMISSION_LABEL;

  protected readonly statusFilter = signal<MentorshipMentorTaskReviewStatus | undefined>('submitted');
  protected readonly rows = this.initRows();
  protected readonly emptyMessage = this.initEmptyMessage();

  protected onStatusPillClick(status: MentorshipMentorTaskReviewStatus | undefined): void {
    this.statusFilter.set(status);
  }

  protected onApprove(row: Pick<MentorshipMentorReviewTask, 'taskId'>): void {
    this.requestReview(row.taskId, 'complete');
  }

  /** Asks for the reason first; a dismissed dialog sends nothing. */
  protected onRequestChanges(row: Pick<MentorshipMentorReviewTask, 'taskId' | 'menteeName' | 'taskName'>): void {
    if (this.reviewingTaskIds().includes(row.taskId)) return;
    // `open()` returns null when a dialog of the same component is still registered.
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(TaskChangesDialogComponent, {
      header: MENTORSHIP_MENTOR_TASK_CHANGES_DIALOG_HEADER,
      width: '34rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { menteeName: row.menteeName, taskName: row.taskName },
    });
    if (!dialogRef) return;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((reason: string | undefined) => {
      if (reason) this.requestReview(row.taskId, 'incomplete', reason);
    });
  }

  protected onOpenSubmission(row: Pick<MentorshipMentorReviewTask, 'taskId'>): void {
    this.taskFile.download(row.taskId);
  }

  protected onViewSubmission(row: Pick<MentorshipMentorReviewTask, 'taskId'>): void {
    this.taskFile.view(row.taskId);
  }

  private requestReview(taskId: string, status: MentorshipMentorTaskReviewDecision, reason?: string): void {
    if (this.reviewingTaskIds().includes(taskId)) return;
    this.reviewRequested.emit(reason ? { taskId, status, reason } : { taskId, status });
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
