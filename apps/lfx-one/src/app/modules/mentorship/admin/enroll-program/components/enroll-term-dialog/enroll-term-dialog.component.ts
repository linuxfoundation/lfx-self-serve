// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_TERM_NAME_MAX, MENTORSHIP_TERM_YEAR_OPTIONS, MONTH_OPTIONS } from '@lfx-one/shared/constants';
import { MentorshipProgramTerm, MentorshipTermFormDialogData } from '@lfx-one/shared/interfaces';
import { mentorshipMonthYearToStartDate, parseMentorshipDateOnly, parseMentorshipMonthYear, toMentorshipDateOnly } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-mentorship-enroll-term-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, CalendarComponent, InputTextComponent, SelectComponent],
  templateUrl: './enroll-term-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollTermDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipTermFormDialogData>>(DynamicDialogConfig);

  protected readonly data: MentorshipTermFormDialogData = this.dialogConfig.data ?? { mode: 'add' };
  protected readonly monthOptions = MONTH_OPTIONS.map((option) => ({ ...option }));
  protected readonly yearOptions = MENTORSHIP_TERM_YEAR_OPTIONS.map((option) => ({ ...option }));
  protected readonly nameMax = MENTORSHIP_TERM_NAME_MAX;
  protected readonly showErrors = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(MENTORSHIP_TERM_NAME_MAX)] }),
    startMonth: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    startYear: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    endMonth: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    endYear: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    applicationStartDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    applicationEndDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
  });

  private readonly formSnapshot = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly nameLength = computed(() => String(this.formSnapshot().name ?? '').length);
  protected readonly submitLabel = computed(() => (this.data.mode === 'edit' ? 'Save Term' : 'Add Term'));

  public constructor() {
    const term = this.data.term;
    if (!term) return;

    const start = parseMentorshipMonthYear(term.startDate);
    const end = parseMentorshipMonthYear(term.endDate);
    this.form.patchValue({
      name: term.name,
      startMonth: start?.month ?? '',
      startYear: start?.year ?? '',
      endMonth: end?.month ?? '',
      endYear: end?.year ?? '',
      applicationStartDate: parseMentorshipDateOnly(term.applicationStartDate),
      applicationEndDate: parseMentorshipDateOnly(term.applicationEndDate),
    });
  }

  protected onSubmit(): void {
    const name = this.form.controls.name.value.trim();
    if (name.length > MENTORSHIP_TERM_NAME_MAX) {
      this.form.controls.name.setValue(name.slice(0, MENTORSHIP_TERM_NAME_MAX), { emitEvent: false });
    }

    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const applicationStart = value.applicationStartDate;
    const applicationEnd = value.applicationEndDate;
    if (!applicationStart || !applicationEnd) {
      this.showErrors.set(true);
      return;
    }

    const startDate = mentorshipMonthYearToStartDate(value.startMonth, value.startYear);
    const endDate = mentorshipMonthYearToStartDate(value.endMonth, value.endYear);
    if (endDate < startDate) {
      this.showErrors.set(true);
      this.form.controls.endYear.setErrors({ order: true });
      return;
    }

    const applicationStartDate = toMentorshipDateOnly(applicationStart);
    const applicationEndDate = toMentorshipDateOnly(applicationEnd);
    if (applicationEndDate < applicationStartDate) {
      this.showErrors.set(true);
      this.form.controls.applicationEndDate.setErrors({ order: true });
      return;
    }

    const term: MentorshipProgramTerm = {
      id: this.data.term?.id ?? `term-new-${Date.now()}`,
      name: value.name.trim(),
      startDate,
      endDate,
      applicationStartDate,
      applicationEndDate,
    };

    this.dialogRef.close(term);
  }
}
