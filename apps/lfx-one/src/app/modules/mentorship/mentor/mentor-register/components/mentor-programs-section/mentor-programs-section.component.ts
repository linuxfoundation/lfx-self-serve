// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_MENTOR_PROGRAMS_HELPER,
  MENTORSHIP_MENTOR_PROGRAMS_INTRO,
  MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS,
  MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProgramRequest, MentorshipProgram } from '@lfx-one/shared/interfaces';

/**
 * Program picker for the Become a Mentor form. Picking a program raises a request to that
 * program's admin, so the select acts as a one-shot action rather than a stored value: it
 * clears itself on choose and drops programs already requested from its options.
 *
 * Applying is optional — a mentor may register a profile and come back for programs later
 * — so nothing here is required and the section surfaces no validation error. The parent
 * owns the request list because it, not this section, will POST the registration.
 */
@Component({
  selector: 'lfx-mentorship-mentor-programs-section',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent],
  templateUrl: './mentor-programs-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramsSectionComponent {
  public readonly programs = input.required<MentorshipProgram[]>();
  public readonly requests = input.required<MentorshipMentorProgramRequest[]>();
  public readonly add = output<MentorshipProgram>();
  public readonly withdraw = output<string>();

  protected readonly intro = MENTORSHIP_MENTOR_PROGRAMS_INTRO;
  protected readonly helper = MENTORSHIP_MENTOR_PROGRAMS_HELPER;

  protected readonly pickerForm = new FormGroup({
    programId: new FormControl<string | null>(null),
  });

  protected readonly availablePrograms = this.initAvailablePrograms();
  protected readonly rows = this.initRows();

  public constructor() {
    // Choosing is the whole interaction: hand the program up, then clear so the same
    // program can never look "selected" while its request is already listed below.
    this.pickerForm.controls.programId.valueChanges.pipe(takeUntilDestroyed()).subscribe((programId) => {
      if (!programId) return;
      const program = this.programs().find((item) => item.id === programId);
      this.pickerForm.controls.programId.setValue(null, { emitEvent: false });
      if (program) this.add.emit(program);
    });
  }

  private initAvailablePrograms() {
    return computed(() => {
      const requested = new Set(this.requests().map((item) => item.programId));
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
      }))
    );
  }
}
