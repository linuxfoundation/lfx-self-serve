// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { RedditDemographicsDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { RedditDemographicsComponent } from './reddit-demographics.component';

// The rules (the choices, the added window, the cap, the refusal, draft reads) are tested in `campaign-reddit-demographics.utils.spec.ts`; this tests the wiring.
describe('RedditDemographicsComponent', () => {
  let fixture: ComponentFixture<RedditDemographicsComponent>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const emit = (testId: string, event: string, value: unknown): void => {
    fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).triggerEventHandler(event, value);
    fixture.detectChanges();
  };
  const click = (testId: string): void => {
    query(testId)?.querySelector('button')?.click();
    fixture.detectChanges();
  };
  const demographics = (): RedditDemographicsDraft => fixture.componentInstance.demographics();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RedditDemographicsComponent] }).compileComponents();
    fixture = TestBed.createComponent(RedditDemographicsComponent);
    fixture.componentRef.setInput('demographics', { gender: '', languages: [], schedule: [] });
    fixture.detectChanges();
  });

  it('sets the gender and languages, adds, edits and removes a window, and shows the refusal', () => {
    emit('reddit-demographics-gender', 'valueChange', 'FEMALE');
    emit('reddit-demographics-languages', 'valuesChange', ['EN', 'DE']);
    click('reddit-demographics-add-window');
    click('reddit-demographics-add-window');
    emit('reddit-demographics-window-1-end-hour', 'valueChange', '20');
    expect(demographics()).toEqual({
      gender: 'FEMALE',
      languages: ['EN', 'DE'],
      schedule: [
        { startDay: 1, startHour: 9, endDay: 1, endHour: 17 },
        { startDay: 2, startHour: 9, endDay: 2, endHour: 20 },
      ],
    });

    click('reddit-demographics-window-0-remove');
    expect(demographics().schedule).toEqual([{ startDay: 2, startHour: 9, endDay: 2, endHour: 20 }]);
    expect(query('reddit-demographics-error')).toBeNull();
    fixture.componentRef.setInput('refusal', 'Window 1 starts where it ends. Give it a different end.');
    fixture.detectChanges();
    expect(query('reddit-demographics-error')?.textContent).toContain('Window 1 starts where it ends');
  });
});
