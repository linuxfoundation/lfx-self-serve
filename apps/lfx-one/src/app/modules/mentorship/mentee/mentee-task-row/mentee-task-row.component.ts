// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import {
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTaskStatusChange,
  MentorshipMenteeTaskStatusOptionsState,
  MentorshipMenteeTaskView,
  MentorshipMenteeUpdatableTaskStatus,
} from '@lfx-one/shared/interfaces';
import {
  getMentorshipMenteeTaskStatusOptions,
  isMentorshipMenteeUpdatableTaskStatus,
  mentorshipMenteeTaskStatusFields,
  normalizeMentorshipMenteeTaskStatus,
} from '@lfx-one/shared/utils';
import { MenteeTaskStatusService } from '@modules/mentorship/services/mentee-task-status.service';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';

/**
 * One task row on the mentee tasks tab, shared by the applicant and accepted
 * phases: status icon, name/description, file actions, status dropdown, and date.
 *
 * The status dropdown saves through `MenteeTaskStatusService`. While a change is saving the select
 * is read-only and a spinner shows beside it; on any failure the control returns to the last saved
 * status. Which options are enabled, and the hint that explains a disabled one, come from the shared
 * `getMentorshipMenteeTaskStatusOptions` util. The hint is wired to the combobox through
 * `ariaLabelledBy`, because PrimeNG marks neither disabled options nor a read-only select for
 * assistive technology.
 *
 * File upload, view and download are not implemented yet, so those actions only fire the Coming Soon
 * toast. The BFF never sends a file, so a task that requires one cannot be submitted from here.
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
  private readonly taskStatusService = inject(MenteeTaskStatusService);

  // ---- 2. Inputs ------------------------------------------------------------
  public readonly task = input.required<MentorshipMenteeTaskView>();
  /** Shared status FormGroup keyed by task id (owned by the phase component). */
  public readonly form = input.required<FormGroup<Record<string, FormControl<string>>>>();
  /** Row padding — applicant rows sit inside a card body (`py-3`), accepted rows own the padding. */
  public readonly paddingClass = input<string>('px-6 py-4');

  // ---- 3. Simple writable signals -------------------------------------------
  /** True while a status change is in flight; blocks the select and shows the spinner. */
  protected readonly saving = signal(false);

  // ---- 4. Computed signals --------------------------------------------------
  /**
   * The change just saved, held until the refreshed task arrives so the options never lag behind the write.
   * Reset whenever the task's status moves off the one it was saved from, so a later reset back to that
   * status (say a reviewer reopening the task) is read as it is, not as `to`.
   */
  private readonly confirmed: WritableSignal<MentorshipMenteeTaskStatusChange | null> = this.initConfirmed();
  /** The task as the mentee last saw it succeed: `task()` with the confirmed status until the refresh lands. */
  protected readonly effectiveTask: Signal<MentorshipMenteeTaskView> = this.initEffectiveTask();
  protected readonly statusState: Signal<MentorshipMenteeTaskStatusOptionsState> = computed(() => getMentorshipMenteeTaskStatusOptions(this.effectiveTask()));
  protected readonly statusLabelId: Signal<string> = computed(() => `mentee-task-status-label-${this.task().id}`);
  protected readonly statusHintId: Signal<string> = computed(() => `mentee-task-status-hint-${this.task().id}`);
  /** Ids the combobox is labelled by: the sr-only name, plus the hint when there is one. */
  protected readonly statusLabelledBy: Signal<string> = computed(() =>
    this.statusState().hint === null ? this.statusLabelId() : `${this.statusLabelId()} ${this.statusHintId()}`
  );

  // ---- 5. Actions -----------------------------------------------------------

  protected onStatusChange(): void {
    // The control keeps the optimistic value while saving; a second change is ignored, not reverted.
    if (this.saving()) {
      return;
    }
    const current = this.effectiveTask();
    const saved = normalizeMentorshipMenteeTaskStatus(current.status);
    const requested = this.form().controls[current.id]?.value;
    if (!isMentorshipMenteeUpdatableTaskStatus(requested) || requested === saved) {
      this.setControl(current.id, saved);
      return;
    }

    this.saving.set(true);
    // No takeUntilDestroyed: the toast and cache invalidation must run even if the row is destroyed mid-flight.
    this.taskStatusService.changeStatus(current.id, requested).subscribe((changed) => this.onStatusSettled(current.id, requested, changed));
  }

  protected onUpload(): void {
    this.comingSoonService.notify(`Upload submission for ${this.task().title}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- fileUrl reserved for the real view endpoint
  protected onViewFile(_fileUrl: string): void {
    this.comingSoonService.notify(`View submission for ${this.task().title}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- fileUrl reserved for the real download endpoint
  protected onDownloadFile(_fileUrl: string): void {
    this.comingSoonService.notify(`Download submission for ${this.task().title}`);
  }

  // ---- 6. Private initializers ----------------------------------------------

  private initConfirmed(): WritableSignal<MentorshipMenteeTaskStatusChange | null> {
    return linkedSignal<MentorshipMenteeTaskStatus, MentorshipMenteeTaskStatusChange | null>({
      source: () => normalizeMentorshipMenteeTaskStatus(this.task().status),
      computation: (status, previous) => (previous?.value && previous.value.from === status ? previous.value : null),
    });
  }

  private initEffectiveTask(): Signal<MentorshipMenteeTaskView> {
    return computed(() => {
      const task = this.task();
      const confirmed = this.confirmed();
      // Ignored once the refreshed task no longer carries the status it was saved from (it also moved while the save was in flight).
      if (confirmed !== null && normalizeMentorshipMenteeTaskStatus(task.status) === confirmed.from) {
        return { ...task, ...mentorshipMenteeTaskStatusFields(confirmed.to) };
      }
      return task;
    });
  }

  // ---- 7. Private helpers ---------------------------------------------------

  private onStatusSettled(taskId: string, to: MentorshipMenteeUpdatableTaskStatus, changed: boolean): void {
    if (changed) {
      // Keyed on the status the task input carries now, not the one this change started from: after a
      // chained change (In Progress, then Submitted before the first refresh lands) the input still holds
      // the original status, and a refresh that landed mid-flight has already moved it on.
      this.confirmed.set({ from: normalizeMentorshipMenteeTaskStatus(this.task().status), to });
    }
    // Read the control and the shown status fresh: the phase component may have rebuilt the FormGroup,
    // and a refresh may have moved the task, while the request was in flight.
    this.setControl(taskId, changed ? to : normalizeMentorshipMenteeTaskStatus(this.effectiveTask().status));
    this.saving.set(false);
  }

  private setControl(taskId: string, status: MentorshipMenteeTaskStatus): void {
    this.form().controls[taskId]?.setValue(status, { emitEvent: false });
  }
}
