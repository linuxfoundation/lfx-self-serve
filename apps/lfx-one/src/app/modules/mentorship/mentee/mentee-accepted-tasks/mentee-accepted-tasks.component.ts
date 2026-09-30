// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal, Signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationView, MentorshipMenteeTaskStatus, MentorshipMenteeTaskView } from '@lfx-one/shared/interfaces';

import { MenteeTaskRowComponent } from '../mentee-task-row/mentee-task-row.component';

/**
 * The accepted application on the My Tasks tab — a program card with overall progress, then
 * its non-prerequisite tasks behind status filter chips.
 */
@Component({
  selector: 'lfx-mentee-accepted-tasks',
  imports: [NgClass, MenteeTaskRowComponent],
  templateUrl: './mentee-accepted-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeAcceptedTasksComponent {
  /** The accepted application card; its `tasks` are the non-prerequisite tasks. */
  public readonly application = input.required<MentorshipMenteeApplicationView>();

  protected readonly filterOptions = MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS;

  protected readonly activeFilter = signal<MentorshipMenteeTaskStatus | null>(null);

  protected readonly filteredTaskViews: Signal<MentorshipMenteeTaskView[]> = this.initFilteredTaskViews();
  /** True when the application has any tasks at all — distinguishes empty-all from an empty filter result. */
  protected readonly hasAnyTasks = computed(() => this.application().tasks.length > 0);
  protected readonly acceptedForm: Signal<FormGroup<Record<string, FormControl<string>>>> = this.initAcceptedForm();

  protected onFilterChange(filterValue: MentorshipMenteeTaskStatus | null): void {
    this.activeFilter.set(filterValue);
  }

  private initFilteredTaskViews(): Signal<MentorshipMenteeTaskView[]> {
    return computed(() => {
      const views = this.application().tasks;
      const active = this.activeFilter();
      // View statuses are already normalised (pending | in_progress | submitted),
      // so a direct equality match covers every filter chip — no alias branches needed.
      return active === null ? views : views.filter((view) => view.status === active);
    });
  }

  private initAcceptedForm(): Signal<FormGroup<Record<string, FormControl<string>>>> {
    return computed(() => {
      const controls: Record<string, FormControl<string>> = {};
      for (const task of this.application().tasks) {
        controls[task.id] = new FormControl(task.status, { nonNullable: true });
      }
      return new FormGroup(controls);
    });
  }
}
