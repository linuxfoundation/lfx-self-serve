// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { SurveyReviewComponent } from './survey-review.component';

describe('SurveyReviewComponent survey template label (#5124)', () => {
  let fixture: ComponentFixture<SurveyReviewComponent>;

  const render = async (surveyTemplate: string): Promise<SurveyReviewComponent> => {
    fixture = TestBed.createComponent(SurveyReviewComponent);
    fixture.componentRef.setInput('form', new FormGroup({ surveyTemplate: new FormControl(surveyTemplate), committees: new FormControl([]) }));
    fixture.componentRef.setInput('templateOptions', [
      { label: 'Board Satisfaction Survey', value: '514744416' },
      { label: 'Maintainer Survey', value: '519292663' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SurveyReviewComponent] });
  });

  it('shows the matching option label', async () => {
    const component = await render('519292663');

    expect(component.surveyTemplateLabel()).toBe('Maintainer Survey');
  });

  it('falls back to the raw ID for a template missing from the loaded list', async () => {
    const component = await render('999999999');

    expect(component.surveyTemplateLabel()).toBe('999999999');
  });

  it('reads "Not selected" when no template is chosen', async () => {
    const component = await render('');

    expect(component.surveyTemplateLabel()).toBe('Not selected');
  });
});
