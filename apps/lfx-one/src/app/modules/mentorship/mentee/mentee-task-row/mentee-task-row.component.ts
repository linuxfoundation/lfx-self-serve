// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_MENTEE_TASK_FILE_ACCEPT, NODE_MAX_TIMER_DELAY_MS } from '@lfx-one/shared/constants';
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
  isMentorshipTaskPastDue,
  mentorshipMenteeTaskStatusFields,
  mentorshipTaskDueCutoffMs,
  normalizeMentorshipMenteeTaskStatus,
} from '@lfx-one/shared/utils';
import { MenteeTaskStatusService } from '@modules/mentorship/services/mentee-task-status.service';
import { MentorshipTaskFileService } from '@modules/mentorship/services/mentorship-task-file.service';
import { concat, defer, Observable, of, switchMap, timer } from 'rxjs';

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
 * File actions go through `MentorshipTaskFileService`. A task that needs a file shows Upload until one is
 * stored, and Submitted stays disabled until then. A stored file can be downloaded; it can be replaced
 * until the reviewer completes the task, and removed only before the task is submitted, as upstream allows.
 * Once a task is past due (the end of its due date's UTC day), Submitted and every file change are closed.
 * The row re-reads the clock whenever the due date changes and again at its cutoff, so a page left open
 * across it locks without a reload.
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
  private readonly taskFileService = inject(MentorshipTaskFileService);
  private readonly taskStatusService = inject(MenteeTaskStatusService);
  private readonly platformId = inject(PLATFORM_ID);

  // ---- 2. Inputs ------------------------------------------------------------
  public readonly task = input.required<MentorshipMenteeTaskView>();
  /** Shared status FormGroup keyed by task id (owned by the phase component). */
  public readonly form = input.required<FormGroup<Record<string, FormControl<string>>>>();
  /** Row padding — applicant rows sit inside a card body (`py-3`), accepted rows own the padding. */
  public readonly paddingClass = input<string>('px-6 py-4');

  // ---- 3. Simple writable signals -------------------------------------------
  /** True while a status change is in flight; blocks the select and shows the spinner. */
  protected readonly saving = signal(false);
  /** True while a file upload or removal is in flight; blocks the file actions and shows a spinner. */
  protected readonly fileSaving = signal(false);
  protected readonly fileAccept = MENTORSHIP_MENTEE_TASK_FILE_ACCEPT;

  // ---- 4. Computed signals --------------------------------------------------
  /**
   * The clock `pastDue` is judged against. In the browser it is re-read whenever the due date changes and
   * again at its cutoff; on the server it is the render time.
   */
  private readonly now: Signal<number> = this.initNow();
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
  /** Upload is closed once the task is past due; the status hint, which then shows, says why. */
  protected readonly uploadBlocked: Signal<boolean> = computed(() => this.effectiveTask().pastDue);
  /** A stored file can be replaced until the reviewer completes the task or it is past due. */
  protected readonly canReplaceFile: Signal<boolean> = computed(() => {
    const task = this.effectiveTask();
    return task.hasUploadedFile && !task.fileLocked && !task.pastDue;
  });
  /** A stored file can be removed only before the task is submitted; after that upstream takes only a replacement. */
  protected readonly canRemoveFile: Signal<boolean> = computed(() => {
    const task = this.effectiveTask();
    return task.hasUploadedFile && !task.submitted && !task.pastDue;
  });
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

  /** Uploads the picked file, which replaces any stored one. The input is cleared so the same file can be picked again. */
  protected onFileSelected(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.fileSaving()) return;
    this.fileSaving.set(true);
    // No takeUntilDestroyed: the toast and cache invalidation must run even if the row is destroyed mid-flight.
    this.taskFileService.upload(this.task().id, file).subscribe(() => this.fileSaving.set(false));
  }

  protected onRemoveFile(): void {
    if (this.fileSaving()) return;
    this.fileSaving.set(true);
    this.taskFileService.remove(this.task().id).subscribe(() => this.fileSaving.set(false));
  }

  protected onDownloadFile(): void {
    this.taskFileService.download(this.task().id);
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
      // The view's `pastDue` is fixed when it is built, and the applications are cached, so judge it against the live clock.
      const task = { ...this.task(), pastDue: isMentorshipTaskPastDue(this.task().dueDate, this.now()) };
      const confirmed = this.confirmed();
      // Ignored once the refreshed task no longer carries the status it was saved from (it also moved while the save was in flight).
      if (confirmed !== null && normalizeMentorshipMenteeTaskStatus(task.status) === confirmed.from) {
        return { ...task, ...mentorshipMenteeTaskStatusFields(confirmed.to) };
      }
      return task;
    });
  }

  private initNow(): Signal<number> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal(Date.now()).asReadonly();
    }
    const cutoff = computed(() => mentorshipTaskDueCutoffMs(this.task().dueDate));
    // A new cutoff re-reads the clock and re-arms the timer from it, never from the time the row was built.
    return toSignal(toObservable(cutoff).pipe(switchMap((ms) => this.clockUntil(ms))), { initialValue: Date.now() });
  }

  // ---- 7. Private helpers ---------------------------------------------------

  /** Emits the time now, then again at `cutoff`. A cutoff beyond the longest timer delay is reached in steps. */
  private clockUntil(cutoff: number | null): Observable<number> {
    return defer(() => {
      const now = Date.now();
      if (cutoff === null || now >= cutoff) {
        return of(now);
      }
      return concat(of(now), timer(Math.min(cutoff - now, NODE_MAX_TIMER_DELAY_MS)).pipe(switchMap(() => this.clockUntil(cutoff))));
    });
  }

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
