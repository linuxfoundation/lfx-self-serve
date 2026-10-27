// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { MenteeBeforeYouApplyComponent } from './mentee-before-you-apply.component';

describe('MenteeBeforeYouApplyComponent', () => {
  let fixture: ComponentFixture<MenteeBeforeYouApplyComponent>;
  let component: MenteeBeforeYouApplyComponent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeBeforeYouApplyComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MenteeBeforeYouApplyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts with five confirmations remaining', () => {
    expect(component.remaining()).toBe(5);
  });

  it('reports zero remaining once every confirmation is checked', () => {
    component['form'].setValue({
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();

    expect(component.remaining()).toBe(0);
  });

  it('marks every eligibility and compliance confirmation as required', () => {
    const element = fixture.nativeElement as HTMLElement;

    for (const row of ['age-eligible', 'work-authorized', 'no-duplicate-profile', 'compliance']) {
      expect(element.querySelector(`#mentorship-mentee-apply-${row}-text .text-red-500`)?.textContent?.trim()).toBe('*');
    }
  });
});
