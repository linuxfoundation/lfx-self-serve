// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { TrainingService } from '@shared/services/training.service';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { TrainingsDashboardComponent } from './trainings-dashboard.component';

function activeTabFor(queryParams: Record<string, string>): string {
  TestBed.configureTestingModule({
    providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      { provide: TrainingService, useValue: { getUnifiedCertifications: () => of([]), getEnrollments: () => of([]), getCertifications: () => of([]) } },
    ],
  });
  const component = TestBed.runInInjectionContext(() => new TrainingsDashboardComponent());
  return (component as unknown as { activeTab: Signal<string> }).activeTab();
}

describe('TrainingsDashboardComponent — ?tab= deep link', () => {
  it('opens the Rewards tab for ?tab=rewards', () => {
    expect(activeTabFor({ tab: 'rewards' })).toBe('rewards');
  });

  it('falls back to Certifications without a tab or with an unknown one', () => {
    expect(activeTabFor({})).toBe('certifications');
    TestBed.resetTestingModule();
    expect(activeTabFor({ tab: 'coupons' })).toBe('certifications');
  });
});
