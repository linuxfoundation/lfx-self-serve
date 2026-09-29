// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { MENTORSHIP_MENTEE_TASKS_APPLICATION_EMPTY, MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationView } from '@lfx-one/shared/interfaces';

import { MenteeTaskRowComponent } from '../mentee-task-row/mentee-task-row.component';

/** Pending applications on the My Tasks tab — one card per application with its prerequisite tasks. */
@Component({
  selector: 'lfx-mentee-applicant-tasks',
  imports: [NgClass, MenteeTaskRowComponent],
  templateUrl: './mentee-applicant-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplicantTasksComponent {
  /** Pending application cards, in display order. */
  public readonly applications = input.required<MentorshipMenteeApplicationView[]>();

  protected readonly prerequisiteLabel = MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL;
  protected readonly applicationEmptyText = MENTORSHIP_MENTEE_TASKS_APPLICATION_EMPTY;

  protected readonly applicantForm: Signal<FormGroup<Record<string, FormControl<string>>>> = this.initApplicantForm();

  private initApplicantForm(): Signal<FormGroup<Record<string, FormControl<string>>>> {
    return computed(() => {
      const controls: Record<string, FormControl<string>> = {};
      for (const application of this.applications()) {
        for (const task of application.tasks) {
          controls[task.id] = new FormControl(task.status, { nonNullable: true });
        }
      }
      return new FormGroup(controls);
    });
  }
}
