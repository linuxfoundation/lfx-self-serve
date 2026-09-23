// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipMenteeDemographics } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MenteeApplyDemographicsComponent } from './mentee-apply-demographics.component';

describe('MenteeApplyDemographicsComponent', () => {
  let fixture: ComponentFixture<MenteeApplyDemographicsComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const fieldText = (answerControl: string): string =>
    element().querySelector(`[data-testid="mentorship-mentee-apply-demographics-${answerControl}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  const setup = (demographics?: MentorshipMenteeDemographics): void => {
    fixture = TestBed.createComponent(MenteeApplyDemographicsComponent);
    fixture.componentRef.setInput('demographics', demographics);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplyDemographicsComponent],
      providers: [provideNoopAnimations()],
    });
  });

  it('shows the option label for a saved answer and Not provided for the rest', () => {
    setup({ age: '20-39', education: 'college', gender: 'preferNotToSay' });

    expect(fieldText('age')).toContain('20-39');
    expect(fieldText('education')).toContain('Completed college');
    expect(fieldText('gender')).toContain('Not provided');
    expect(fieldText('raceEthnicity')).toContain('Not provided');
    expect(fieldText('income')).toContain('Not provided');
  });

  it('treats a missing demographics payload as all not provided', () => {
    setup();

    expect(fieldText('age')).toContain('Not provided');
    expect(fieldText('education')).toContain('Not provided');
  });
});
