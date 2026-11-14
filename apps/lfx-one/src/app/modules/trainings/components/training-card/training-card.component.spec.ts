// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CERTIFICATION_PRODUCT_TYPE, TRAINING_PRODUCT_TYPE } from '@lfx-one/shared/constants';
import { TrainingEnrollment } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { ButtonComponent } from '@components/button/button.component';

import { TrainingCardComponent } from './training-card.component';

const activeExam: TrainingEnrollment = {
  id: 'enrollment-1',
  name: 'Exam course',
  description: '',
  imageUrl: '',
  issuedBy: '',
  level: 'Intermediate',
  courseSlug: 'exam-course',
  enrolledDate: null,
  totalTime: null,
  status: 'not-started',
  isActiveEnrollment: true,
  productType: CERTIFICATION_PRODUCT_TYPE,
};

describe('TrainingCardComponent', () => {
  let fixture: ComponentFixture<TrainingCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TrainingCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(TrainingCardComponent);
  });

  function render(training: TrainingEnrollment): void {
    fixture.componentRef.setInput('training', training);
    fixture.detectChanges();
  }

  function byTestId(id: string) {
    return fixture.debugElement.query(By.css(`[data-testid="${id}"]`));
  }

  function buttonLabel(id: string): string | undefined {
    return (byTestId(id).componentInstance as ButtonComponent).label();
  }

  it('tags an active exam and labels its button Go to Exam', () => {
    render(activeExam);

    expect(byTestId('training-card-level-badge')).not.toBeNull();
    expect(byTestId('training-card-exam-tag').nativeElement.textContent.trim()).toBe('Certification Exam');
    expect(byTestId('training-card-exam-tag-mobile')).not.toBeNull();
    expect(buttonLabel('training-card-continue-btn')).toBe('Go to Exam');
    expect(buttonLabel('training-card-continue-btn-mobile')).toBe('Go to Exam');
  });

  it('keeps an active training untagged with Continue Learning', () => {
    render({ ...activeExam, productType: TRAINING_PRODUCT_TYPE });

    expect(byTestId('training-card-exam-tag')).toBeNull();
    expect(byTestId('training-card-exam-tag-mobile')).toBeNull();
    expect(buttonLabel('training-card-continue-btn')).toBe('Continue Learning');
  });

  it('shows an expired exam like an expired training', () => {
    render({ ...activeExam, isActiveEnrollment: false });

    expect(byTestId('training-card-exam-tag')).toBeNull();
    expect(byTestId('training-card-exam-tag-mobile')).toBeNull();
    expect(byTestId('training-card-continue-btn')).toBeNull();
    expect(byTestId('training-card-expired-badge')).not.toBeNull();
    expect(byTestId('training-card-enroll-again-btn')).not.toBeNull();
  });

  it('shows the enrollment date only when the enrollment has one', () => {
    render(activeExam);
    expect(byTestId('training-card-enrolled-date')).toBeNull();

    render({ ...activeExam, enrolledDate: '2026-01-15T12:00:00' });
    expect(byTestId('training-card-enrolled-date').nativeElement.textContent.trim()).toBe('Jan 15, 2026');
  });
});
