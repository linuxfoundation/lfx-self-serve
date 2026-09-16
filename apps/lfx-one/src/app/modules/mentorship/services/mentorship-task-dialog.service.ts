// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MENTORSHIP_TASK_CREATE_DIALOG_HEADER, MENTORSHIP_TASK_EDIT_DIALOG_HEADER } from '@lfx-one/shared/constants';
import { MentorshipApplicantTask, MentorshipTaskDialogAssignee, MentorshipTaskFormDialogData, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, Observable } from 'rxjs';

import { TaskFormDialogComponent } from '../components/task-form-dialog/task-form-dialog.component';

/**
 * Thin wrapper over `DialogService.open` for the task-form dialog. Centralises the
 * dialog config so the two entry points — admin's Create Task on Current Mentees, and
 * the Edit action on the applicant tasks panel — don't drift on width/behavior. The
 * future Mentees-tab multi-select flow will call `openCreate` with more than one mentee.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipTaskDialogService {
  private readonly dialogService = inject(DialogService);

  /**
   * Open the dialog in create mode. Pass a single mentee for the per-row Create Task
   * flow (assignee list is hidden, that mentee is pre-selected). Pass multiple to open
   * the multi-select list.
   */
  public openCreate(
    mentee: MentorshipTaskDialogAssignee,
    extraMentees: readonly MentorshipTaskDialogAssignee[] = []
  ): Observable<MentorshipTaskFormValue | undefined> {
    const mentees = [mentee, ...extraMentees];
    return this.open(
      {
        mode: 'create',
        mentees,
        preselectedMenteeIds: [mentee.id],
      },
      MENTORSHIP_TASK_CREATE_DIALOG_HEADER
    );
  }

  /**
   * Open the dialog in edit mode. Seeds the form from the passed task; the assignee
   * section is hidden — a task's assignee is not editable here.
   */
  public openEdit(task: MentorshipApplicantTask): Observable<MentorshipTaskFormValue | undefined> {
    return this.open(
      {
        mode: 'edit',
        mentees: [],
        preselectedMenteeIds: [],
        task: {
          id: task.id,
          name: task.name,
          description: task.description,
          dueOn: task.dueOn,
          requiresFileSubmission: !!task.requiresFileSubmission,
          status: task.status,
        },
      },
      MENTORSHIP_TASK_EDIT_DIALOG_HEADER
    );
  }

  private open(data: MentorshipTaskFormDialogData, header: string): Observable<MentorshipTaskFormValue | undefined> {
    const dialogRef = this.dialogService.open(TaskFormDialogComponent, {
      header,
      // Wider than the note dialog to fit the two-column top row plus the multi-select
      // assignee list without wrapping labels.
      width: '40rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    });
    // `DialogService.open` returns null when a dialog of the same component is still
    // mounted — collapse that to `EMPTY` so callers can subscribe unconditionally.
    return dialogRef?.onClose ?? EMPTY;
  }
}
