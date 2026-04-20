// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '@app/shared/services/user.service';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COUNTRIES, WHOLE_NUMBER_PATTERN, YES_NO_OPTIONS } from '@lfx-one/shared/constants';
import { TravelFundAboutMe } from '@lfx-one/shared/interfaces';
import { startWith } from 'rxjs';
import { OrgSearchFieldComponent } from '../org-search-field/org-search-field.component';

@Component({
  selector: 'lfx-about-me-form',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, TextareaComponent, CheckboxComponent, OrgSearchFieldComponent],
  templateUrl: './about-me-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutMeFormComponent {
  private readonly userService = inject(UserService);
  private readonly fb = inject(NonNullableFormBuilder);

  public readonly formValidityChange = output<boolean>();
  public readonly formChange = output<TravelFundAboutMe>();

  public readonly form = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: [''],
    citizenshipCountry: ['', Validators.required],
    profileLink: ['', Validators.required],
    company: ['', Validators.required],
    organizationID: ['', Validators.required],
    canReceiveFunds: ['', Validators.required],
    travelFromCountry: ['', Validators.required],
    accommodationNumberOfNights: ['', [Validators.required, Validators.min(0), Validators.max(4), Validators.pattern(WHOLE_NUMBER_PATTERN)]],
    openSourceInvolvement: ['', Validators.required],
    isLgbtqia: [false],
    isWoman: [false],
    isPersonWithDisability: [false],
    isDiversityOther: [false],
    preferNotToAnswer: [false],
    attendingForCompany: ['', Validators.required],
    willingToBlog: ['', Validators.required],
  });

  public readonly countryOptions = [...COUNTRIES];
  public readonly yesNoOptions = YES_NO_OPTIONS;

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

  private buildFormValue(): TravelFundAboutMe {
    const raw = this.form.getRawValue();
    const rawNights = String(raw.accommodationNumberOfNights).trim();
    return {
      ...raw,
      accommodationNumberOfNights: WHOLE_NUMBER_PATTERN.test(rawNights) ? Number(rawNights) : Number.NaN,
    };
  }
}
