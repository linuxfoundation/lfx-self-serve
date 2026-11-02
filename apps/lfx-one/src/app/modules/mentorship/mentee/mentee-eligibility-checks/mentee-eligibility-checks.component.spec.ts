// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL,
  MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL,
  MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL,
} from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { MenteeEligibilityChecksComponent } from './mentee-eligibility-checks.component';

describe('MenteeEligibilityChecksComponent', () => {
  let fixture: ComponentFixture<MenteeEligibilityChecksComponent>;
  let form: FormGroup<{
    ageEligible: FormControl<boolean>;
    workAuthorized: FormControl<boolean>;
    noDuplicateProfile: FormControl<boolean>;
  }>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rows = ['age-eligible', 'work-authorized', 'no-duplicate-profile'];

  beforeEach(() => {
    form = new FormGroup({
      ageEligible: new FormControl(false, { nonNullable: true }),
      workAuthorized: new FormControl(false, { nonNullable: true }),
      noDuplicateProfile: new FormControl(false, { nonNullable: true }),
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeEligibilityChecksComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MenteeEligibilityChecksComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('idPrefix', 'mentorship-mentee-apply');
    fixture.detectChanges();
  });

  it('builds every id and test id from the caller-supplied prefix', () => {
    // The apply page's e2e spec looks the rows up by these ids, so the prefix must reach each one.
    for (const row of rows) {
      expect(element().querySelector(`[data-testid="mentorship-mentee-apply-${row}"]`)).not.toBeNull();
      expect(element().querySelector(`[data-testid="mentorship-mentee-apply-${row}-checkbox"]`)).not.toBeNull();
      expect(element().querySelector(`[aria-labelledby="mentorship-mentee-apply-${row}-text"]`)).not.toBeNull();
    }
  });

  it('renders each label from the shared constants, led by the required asterisk', () => {
    const labels = [MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL, MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL, MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL];

    rows.forEach((row, index) => {
      const text = element().querySelector(`#mentorship-mentee-apply-${row}-text`);
      expect(text?.textContent).toContain(labels[index]);
      expect(text?.querySelector('.text-red-500')?.textContent?.trim()).toBe('*');
    });
  });

  it('writes each answer to the caller form under its control name', () => {
    form.setValue({ ageEligible: true, workAuthorized: false, noDuplicateProfile: true });
    fixture.detectChanges();

    const checked = rows.map(
      (row) => element().querySelector<HTMLInputElement>(`[data-testid="mentorship-mentee-apply-${row}-checkbox"] input[type="checkbox"]`)?.checked
    );
    expect(checked).toEqual([true, false, true]);
  });
});
