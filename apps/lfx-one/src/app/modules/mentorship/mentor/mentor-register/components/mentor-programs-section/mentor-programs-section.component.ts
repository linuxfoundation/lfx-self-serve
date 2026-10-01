// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES,
  MENTORSHIP_MENTOR_PROGRAMS_HELPER,
  MENTORSHIP_MENTOR_PROGRAMS_INTRO,
  MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS,
  MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE,
  MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES,
} from '@lfx-one/shared/constants';
import { MentorshipMentorOpenProgram, MentorshipMentorProgramRequest } from '@lfx-one/shared/interfaces';

/**
 * Program picker and request list, shared by the Become a Mentor form and the mentor profile edit
 * drawer. The select acts as a one-shot action rather than a stored value: it hands the program up,
 * clears itself, and drops programs with a pending, accepted or declined request from its options
 * (`MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES`), or with an open invitation (`invitedProgramIds`).
 * A program whose request was withdrawn stays pickable, since asking again reopens it. When the
 * parent could not read the requests, the section says so with a Retry and keeps the select
 * disabled, because it cannot tell which programs are already requested.
 *
 * Applying is optional — a mentor may register a profile and come back for programs later — so
 * nothing here is required and the section surfaces no validation error. The parent owns the list
 * and decides what picking and withdrawing do: the form keeps picks until submit, the drawer sends
 * them right away. Only a pending request can be withdrawn, so only its row offers the button.
 */
@Component({
  selector: 'lfx-mentorship-mentor-programs-section',
  imports: [ButtonComponent, SelectComponent],
  templateUrl: './mentor-programs-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramsSectionComponent {
  public readonly programs = input.required<MentorshipMentorOpenProgram[]>();
  /** While true the select shows a loading state and says so, rather than looking like a program-less platform. */
  public readonly loading = input(false);
  /** When false, the card wrapper (border + padding + rounded corners) is stripped — used inside drawers. */
  public readonly bordered = input(true);

  /** While true the parent is sending a request, so the select is disabled until it settles. */
  public readonly requesting = input(false);
  /** The request being withdrawn, or `null`. Its Withdraw button shows a loading state meanwhile. */
  public readonly withdrawingId = input<string | null>(null);

  public readonly requests = input.required<MentorshipMentorProgramRequest[]>();
  /** Programs the mentor is already invited to; upstream refuses a request for them. */
  public readonly invitedProgramIds = input<string[]>([]);
  /** True when the parent could not read the requests: shows the failure and its Retry instead of the list. */
  public readonly requestsFailed = input(false);
  public readonly add = output<MentorshipMentorOpenProgram>();
  public readonly withdraw = output<string>();
  public readonly retry = output<void>();

  protected readonly intro = MENTORSHIP_MENTOR_PROGRAMS_INTRO;
  protected readonly helper = MENTORSHIP_MENTOR_PROGRAMS_HELPER;
  protected readonly requestsFailedMessage = MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE;

  protected readonly pickerForm = new FormGroup({
    programId: new FormControl<string | null>(null),
  });

  protected readonly availablePrograms = this.initAvailablePrograms();
  protected readonly rows = this.initRows();
  protected readonly wrapperClass = this.initWrapperClass();
  private readonly pickerDisabled = this.initPickerDisabled();

  public constructor() {
    // Choosing is the whole interaction: hand the program up, then clear so the same
    // program can never look "selected" while its request is already listed below.
    this.pickerForm.controls.programId.valueChanges.pipe(takeUntilDestroyed()).subscribe((programId) => {
      if (!programId) return;
      const program = this.programs().find((item) => item.id === programId);
      this.pickerForm.controls.programId.setValue(null, { emitEvent: false });
      if (program) this.add.emit(program);
    });

    toObservable(this.pickerDisabled)
      .pipe(takeUntilDestroyed())
      .subscribe((disabled) => {
        const control = this.pickerForm.controls.programId;
        if (disabled) {
          control.disable({ emitEvent: false });
        } else {
          control.enable({ emitEvent: false });
        }
      });
  }

  private initAvailablePrograms() {
    return computed(() => {
      const requested = new Set([
        ...this.requests()
          .filter((item) => MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES.includes(item.status))
          .map((item) => item.programId),
        ...this.invitedProgramIds(),
      ]);
      return this.programs()
        .filter((program) => !requested.has(program.id))
        .map((program) => ({ label: program.name, value: program.id }));
    });
  }

  private initRows() {
    return computed(() =>
      this.requests().map((request) => ({
        ...request,
        statusLabel: MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS[request.status],
        statusBadgeClass: MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES[request.status],
        canWithdraw: request.status === 'pending',
      }))
    );
  }

  /** The select is off while a request is in flight, and while the requests are unknown after a failed read. */
  private initPickerDisabled() {
    return computed(() => this.requesting() || this.requestsFailed());
  }

  private initWrapperClass() {
    return computed(() => (this.bordered() ? 'flex flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-6 md:p-8' : 'flex flex-col gap-6'));
  }
}
