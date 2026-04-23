// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '@app/shared/services/user.service';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { ACCOMMODATION_PAID_BY_OPTIONS, ATTENDEE_TYPE_OPTIONS, COUNTRIES } from '@lfx-one/shared/constants';
import { AttendeeAccommodationPaidBy, AttendeeType, VisaRequestApplicantInfo } from '@lfx-one/shared/interfaces';
import { notFutureDateValidator, notPastDateValidator } from '@lfx-one/shared/validators';
import { startWith } from 'rxjs';
import { OrgSearchFieldComponent } from '../org-search-field/org-search-field.component';

@Component({
  selector: 'lfx-visa-request-apply-form',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, TextareaComponent, CalendarComponent, OrgSearchFieldComponent],
  templateUrl: './visa-request-apply-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisaRequestApplyFormComponent {
  private readonly userService = inject(UserService);
  private readonly fb = inject(NonNullableFormBuilder);

  public readonly formValidityChange = output<boolean>();
  public readonly formChange = output<VisaRequestApplicantInfo>();

  public readonly today = startOfDay(new Date());

  public readonly form = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: [''],
    passportNumber: ['', Validators.required],
    citizenshipCountry: ['', Validators.required],
    passportExpiryDate: [null as Date | null, [Validators.required, notPastDateValidator(this.today)]],
    birthDate: [null as Date | null, [Validators.required, notFutureDateValidator(this.today)]],
    embassyCity: ['', Validators.required],
    company: ['', Validators.required],
    organizationID: ['', Validators.required],
    mailingAddress: ['', Validators.required],
    attendeeType: ['' as AttendeeType, Validators.required],
    attendeeAccommodationPaidBy: ['' as AttendeeAccommodationPaidBy, Validators.required],
  });

  public readonly countryOptions = [...COUNTRIES];
  public readonly attendeeTypeOptions = ATTENDEE_TYPE_OPTIONS;
  public readonly accommodationOptions = ACCOMMODATION_PAID_BY_OPTIONS;

  public constructor() {
    this.form.get('email')?.disable();

    const user = this.userService.user();
    if (user) {
      this.form.patchValue({
        firstName: user.given_name ?? '',
        lastName: user.family_name ?? '',
        email: user.email ?? '',
      });
    }

    this.form.statusChanges.pipe(startWith(this.form.status), takeUntilDestroyed()).subscribe(() => {
      this.formValidityChange.emit(this.form.valid);
    });

    this.form.valueChanges.pipe(startWith(this.form.getRawValue()), takeUntilDestroyed()).subscribe(() => {
      this.formChange.emit(this.buildFormValue());
    });
  }

  private buildFormValue(): VisaRequestApplicantInfo {
    return this.form.getRawValue() as VisaRequestApplicantInfo;
  }
}

function startOfDay(date: Date): Date {
  date.setHours(0, 0, 0, 0);
  return date;
}
