// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { NEVER } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

import { HealthMetricsOverviewComponent } from './health-metrics-overview.component';

describe('HealthMetricsOverviewComponent', () => {
  it('lays out every card in the design order, each loading on its own', async () => {
    const pending = () => NEVER;
    await TestBed.configureTestingModule({
      imports: [HealthMetricsOverviewComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        {
          provide: AnalyticsService,
          useValue: {
            getOverviewParticipatingOrgs: pending,
            getOverviewNps: pending,
            getOverviewChurn: pending,
            getOverviewOutstandingBalance: pending,
            getOverviewEvents: pending,
            getEventsAtAGlance: pending,
            getEventsSponsorship: pending,
            getTrainingEnrollment: pending,
            getOverviewCode: pending,
            getOverviewBoard: pending,
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }), selectedFoundationSfid: signal(null) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HealthMetricsOverviewComponent);
    fixture.detectChanges();

    const loading = [...fixture.nativeElement.querySelectorAll('[data-testid$="-loading"]')].map((element: Element) => element.getAttribute('data-testid'));
    expect(loading).toEqual([
      'overview-orgs-loading',
      'overview-nps-loading',
      'overview-churn-loading',
      'overview-balance-loading',
      'overview-events-loading',
      'overview-training-loading',
      'overview-code-loading',
      'overview-board-loading',
    ]);
  });
});
