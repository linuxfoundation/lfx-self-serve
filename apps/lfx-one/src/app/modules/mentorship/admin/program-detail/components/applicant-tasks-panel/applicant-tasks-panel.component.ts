// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { MENTORSHIP_APPLICANT_TASKS_HIDE_PREREQUISITE_LABEL } from '@lfx-one/shared/constants';
import { MentorshipApplicantTaskRow } from '@lfx-one/shared/interfaces';
import { filterMentorshipApplicantTasks } from '@lfx-one/shared/utils';
import { startWith } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';

/**
 * Expanded tasks sub-table for an Applicants or Current Mentees row.
 * Submission view/download stub to the shared coming-soon toast until the
 * mentorship write endpoints land. Task status is read-only for admins.
 */
@Component({
  selector: 'lfx-mentorship-applicant-tasks-panel',
  imports: [ReactiveFormsModule, CheckboxComponent],
  templateUrl: './applicant-tasks-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicantTasksPanelComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly applicantId = input.required<string>();
  public readonly applicantName = input.required<string>();
  public readonly tasks = input.required<MentorshipApplicantTaskRow[]>();

  protected readonly filterForm = new FormGroup({
    hidePrerequisite: new FormControl(true, { nonNullable: true }),
  });

  protected readonly hidePrerequisiteLabel = MENTORSHIP_APPLICANT_TASKS_HIDE_PREREQUISITE_LABEL;

  private readonly hidePrerequisite = toSignal(
    this.filterForm.controls.hidePrerequisite.valueChanges.pipe(startWith(this.filterForm.controls.hidePrerequisite.value)),
    { initialValue: this.filterForm.controls.hidePrerequisite.value }
  );

  protected readonly visibleTasks = computed(() => {
    const filteredIds = new Set(filterMentorshipApplicantTasks(this.tasks(), this.hidePrerequisite()).map((task) => task.id));
    return this.tasks().filter((task) => filteredIds.has(task.id));
  });

  protected readonly panelTitle = computed(() => `Tasks Assigned to ${this.applicantName()}`);

  protected onViewTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`View ${task.name} for ${this.applicantName()}`);
  }

  protected onDownloadTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`Download ${task.name} for ${this.applicantName()}`);
  }
}
