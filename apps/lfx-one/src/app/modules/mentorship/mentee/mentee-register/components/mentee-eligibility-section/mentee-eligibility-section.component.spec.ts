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

import { MenteeEligibilitySectionComponent } from './mentee-eligibility-section.component';

describe('MenteeEligibilitySectionComponent', () => {
  let fixture: ComponentFixture<MenteeEligibilitySectionComponent>;
  let form: FormGroup<{
    ageEligible: FormControl<boolean>;
    workAuthorized: FormControl<boolean>;
    noDuplicateProfile: FormControl<boolean>;
  }>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const errorText = (testId: string): string | null => element().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null;

  beforeEach(() => {
    form = new FormGroup({
      ageEligible: new FormControl(false, { nonNullable: true }),
      workAuthorized: new FormControl(false, { nonNullable: true }),
      noDuplicateProfile: new FormControl(false, { nonNullable: true }),
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeEligibilitySectionComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MenteeEligibilitySectionComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('renders every eligibility question with its verbatim LFXV2 label', () => {
    // The labels are legal/consent copy — swapping the wording is a policy change, so the
    // section must render each label byte-for-byte from the shared constants.
    expect(element().querySelector('#mentorship-mentee-age-eligible-text')?.textContent?.trim()).toContain(MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL);
    expect(element().querySelector('#mentorship-mentee-work-authorized-text')?.textContent?.trim()).toContain(MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL);
    expect(element().querySelector('#mentorship-mentee-no-duplicate-profile-text')?.textContent?.trim()).toContain(
      MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL
    );
  });

  it('keeps error banners hidden until the parent passes an `errors` object', () => {
    // An empty form is invalid from the outset, but surfacing errors before the mentee
    // acts would be noise. The parent controls when to reveal them.
    expect(errorText('mentorship-mentee-age-eligible-error')).toBeNull();
    expect(errorText('mentorship-mentee-work-authorized-error')).toBeNull();
    expect(errorText('mentorship-mentee-no-duplicate-profile-error')).toBeNull();
  });

  it('surfaces the parent-provided error text on each row when submission fails', () => {
    fixture.componentRef.setInput('errors', {
      ageEligible: 'Please confirm you are 18 years of age or older.',
      workAuthorized: 'Please confirm you are authorized to work in your country of residence.',
      noDuplicateProfile: 'Please confirm you do not already have a mentee profile.',
    });
    fixture.detectChanges();

    expect(errorText('mentorship-mentee-age-eligible-error')).toBe('Please confirm you are 18 years of age or older.');
    expect(errorText('mentorship-mentee-work-authorized-error')).toBe('Please confirm you are authorized to work in your country of residence.');
    expect(errorText('mentorship-mentee-no-duplicate-profile-error')).toBe('Please confirm you do not already have a mentee profile.');
  });

  it('announces each error with role="alert", so screen readers pick it up on show', () => {
    fixture.componentRef.setInput('errors', { ageEligible: 'Please confirm you are 18 years of age or older.' });
    fixture.detectChanges();

    const error = element().querySelector('[data-testid="mentorship-mentee-age-eligible-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
  });

  it('marks each checkbox as required through the red asterisk that leads every label', () => {
    // The rest of the register page uses the same visual marker for required fields — the
    // section must not silently drop it, or a mentee scanning the form would think
    // eligibility is optional.
    for (const row of ['mentorship-mentee-age-eligible-text', 'mentorship-mentee-work-authorized-text', 'mentorship-mentee-no-duplicate-profile-text']) {
      expect(element().querySelector(`#${row} .text-red-500`)?.textContent?.trim()).toBe('*');
    }
  });
});
