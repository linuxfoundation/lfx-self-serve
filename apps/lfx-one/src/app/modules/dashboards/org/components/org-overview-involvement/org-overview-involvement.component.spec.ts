// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Account, DashboardMetricCard, OrgTrainingEnrollmentsResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgInvolvementAnalyticsService } from '@services/org-involvement-analytics.service';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { OrgOverviewInvolvementComponent } from './org-overview-involvement.component';

const ACCOUNT_ID = 'acc-1';

async function buildMetrics(training: OrgTrainingEnrollmentsResponse): Promise<DashboardMetricCard[]> {
  const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
  const analytics = {
    getFoundationCoverage: () => of({ accountId: ACCOUNT_ID, foundationCount: 1, foundations: [] }),
    getContributorsMonthly: () => of({ accountId: ACCOUNT_ID, totalActiveContributors: 11, monthlyData: [3], monthlyLabels: ['Oct 2026'] }),
    getMaintainersMonthly: () =>
      of({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', totalMaintainersYearly: 5, totalProjectsYearly: 6, monthlyData: [5], monthlyLabels: ['Oct 2026'] }),
    getEventAttendanceMonthly: () =>
      of({
        accountId: ACCOUNT_ID,
        accountName: 'Acme Motors',
        totalAttended: 85,
        totalSpeakers: 1,
        attendeesMonthlyData: [8],
        speakersMonthlyData: [0],
        monthlyLabels: ['Oct 2026'],
      }),
    getCertifiedEmployeesMonthly: () =>
      of({ accountId: ACCOUNT_ID, totalCertifications: 19, totalCertifiedEmployees: 13, monthlyData: [1], monthlyLabels: ['Oct 2026'] }),
    getTrainingEnrollments: () => of(training),
  };

  TestBed.configureTestingModule({
    imports: [OrgOverviewInvolvementComponent],
    providers: [
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgInvolvementAnalyticsService, useValue: analytics },
    ],
  });
  // The cards' state lives in `primaryMetrics`; the template only renders it (and needs a canvas for charts).
  TestBed.overrideComponent(OrgOverviewInvolvementComponent, { set: { template: '', imports: [] } });

  const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
  // `toObservable(selectedAccount)` emits on the first change-detection pass, which starts the loads.
  await fixture.whenStable();
  return fixture.componentInstance.primaryMetrics();
}

function trainingCard(metrics: DashboardMetricCard[]): DashboardMetricCard {
  const card = metrics.find((metric) => metric.title === 'Training Enrollments');
  if (!card) {
    throw new Error('Training Enrollments card missing');
  }
  return card;
}

describe('OrgOverviewInvolvementComponent training enrollments', () => {
  it('formats YYYY-MM-DD enrollment dates as chart labels', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, totalEnrollments: 1, dailyData: [{ date: '2026-01-02', count: 1, cumulativeCount: 1 }] });

    expect(trainingCard(metrics).chartData?.labels).toEqual(['Jan 2, 2026']);
  });

  // #4223: a cache entry written before the date-only fix carries an ISO timestamp. Throwing here froze
  // every card in the carousel on its skeleton, so the label falls back to the raw value instead.
  it('keeps every card building when an enrollment date is not YYYY-MM-DD', async () => {
    const metrics = await buildMetrics({
      accountId: ACCOUNT_ID,
      totalEnrollments: 1,
      dailyData: [{ date: '2026-01-02T00:00:00.000Z', count: 1, cumulativeCount: 1 }],
    });

    expect(trainingCard(metrics).chartData?.labels).toEqual(['2026-01-02T00:00:00.000Z']);
    expect(metrics.map((metric) => metric.loading)).toEqual([false, false, false, false, false, false]);
    expect(trainingCard(metrics).value).toBe('1');
  });
});
