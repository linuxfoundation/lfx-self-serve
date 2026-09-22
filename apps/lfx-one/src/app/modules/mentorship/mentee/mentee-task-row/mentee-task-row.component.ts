// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS,
  MENTORSHIP_MENTEE_TASKS_TAB_STATUS_CHANGE_TOAST_SUMMARY,
  MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeTaskView } from '@lfx-one/shared/interfaces';
import { normalizeMentorshipMenteeTaskStatus } from '@lfx-one/shared/utils';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';

/**
 * One task row on the mentee tasks tab, shared by the applicant and accepted
 * phases: status icon, name/description, file actions, status dropdown, and date.
 *
 * The row owns its own Coming Soon actions. Persistence is not wired yet, so a
 * status change fires the toast and then reverts the dropdown to the task's real
 * status, and file actions only surface the toast.
 */
@Component({
  selector: 'lfx-mentee-task-row',
  imports: [NgClass, DatePipe, SelectComponent],
  templateUrl: './mentee-task-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mentee-task-row.component.scss',
})
export class MenteeTaskRowComponent {
  // ---- 1. DI ----------------------------------------------------------------
  private readonly comingSoonService = inject(MentorshipComingSoonService);

  // ---- 2. Inputs ------------------------------------------------------------
  public readonly task = input.required<MentorshipMenteeTaskView>();
  /** Shared status FormGroup keyed by task id (owned by the phase component). */
  public readonly form = input.required<FormGroup<Record<string, FormControl<string>>>>();
  /** Row padding — applicant rows sit inside a card body (`py-3`), accepted rows own the padding. */
  public readonly paddingClass = input<string>('px-6 py-4');

  // ---- 3. Template constants ------------------------------------------------
  protected readonly taskStatusOptions = MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS;

  // ---- 4. Actions -----------------------------------------------------------

  protected onStatusChange(): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_STATUS_CHANGE_TOAST_SUMMARY);
    // Persistence isn't wired yet — revert the control so the dropdown never
    // displays an unsaved selection that disagrees with the task's real status.
    const current = this.task();
    const control = this.form().controls[current.id];
    control?.setValue(normalizeMentorshipMenteeTaskStatus(current.status), { emitEvent: false });
  }

  protected onUpload(): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onViewFile(_fileUrl: string): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onDownloadFile(_fileUrl: string): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY);
  }
}
