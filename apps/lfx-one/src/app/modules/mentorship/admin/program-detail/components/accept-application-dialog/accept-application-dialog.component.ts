// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_ADMIN_ACCEPT_ATTENDANCE_LABEL,
  MENTORSHIP_ADMIN_ACCEPT_ATTENDANCE_REQUIRED_MESSAGE,
  MENTORSHIP_ATTENDANCE_TYPE_LABELS,
  MENTORSHIP_ATTENDANCE_TYPES,
} from '@lfx-one/shared/constants';
import { FilterOption, MentorshipAcceptDialogData, MentorshipAttendanceType } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Accept dialog of the Current Mentees tab. Accepting needs an attendance type, so the admin picks one here;
 * the dialog closes with it, or with nothing when dismissed.
 */
@Component({
  selector: 'lfx-mentorship-accept-application-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent],
  templateUrl: './accept-application-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptApplicationDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipAcceptDialogData>>(DynamicDialogConfig);

  protected readonly data: MentorshipAcceptDialogData = this.dialogConfig.data ?? { personName: '' };
  protected readonly attendanceLabel = MENTORSHIP_ADMIN_ACCEPT_ATTENDANCE_LABEL;
  protected readonly requiredMessage = MENTORSHIP_ADMIN_ACCEPT_ATTENDANCE_REQUIRED_MESSAGE;
  protected readonly attendanceOptions: FilterOption<MentorshipAttendanceType>[] = MENTORSHIP_ATTENDANCE_TYPES.map((type) => ({
    label: MENTORSHIP_ATTENDANCE_TYPE_LABELS[type],
    value: type,
  }));

  protected readonly form = new FormGroup({
    attendanceType: new FormControl<MentorshipAttendanceType | null>(null, { validators: [Validators.required] }),
  });

  protected onAccept(): void {
    const attendanceType = this.form.controls.attendanceType.value;
    if (this.form.invalid || !attendanceType) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(attendanceType);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
