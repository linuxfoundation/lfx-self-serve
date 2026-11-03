// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ORG_DEFAULT_PROJECT_SCOPE_LABEL,
  ORG_LENS_DEFAULT_VIEW_PHRASE,
  ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION,
  ORG_OVERVIEW_MAINTAINER_ROLES_DEFINITION,
  ORG_TRAINING_STAT_DEFINITIONS,
} from '@lfx-one/shared/constants';
import type { Account, DashboardMetricCard, OrgTrainingEnrollmentsResponse, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgInvolvementAnalyticsService } from '@services/org-involvement-analytics.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgOverviewInvolvementComponent } from './org-overview-involvement.component';

const ACCOUNT_ID = 'acc-1';

const TRAINING_STATS: OrgTrainingStats = {
  range: 'all',
  asOf: '2030-03-05T09:48:21.094Z',
  rosterMembers: 1250,
  rosterMembersAsOf: '2030-03-04T23:00:00.000Z',
  peopleWithTrainingActivity: 1830,
  learnersOutsidePeopleList: 12,
  coursesTaken: 400,
  certifications: 190,
  certifiedPeople: 140,
  trainingsCompleted: 60,
  completionRatePct: 63,
  coursesInProgress: 150,
  peopleInTraining: 25,
};

async function buildMetrics(
  training: OrgTrainingEnrollmentsResponse,
  maintainers: object = { accountId: ACCOUNT_ID, maintainerRoles: 20, monthlyData: [12, 15], monthlyLabels: ['Jan 2030', 'Feb 2030'] },
  trainingStats: Observable<OrgTrainingStats> = of(TRAINING_STATS)
): Promise<DashboardMetricCard[]> {
  const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
  const analytics = {
    getFoundationCoverage: () => of({ accountId: ACCOUNT_ID, foundationCount: 1, foundations: [] }),
    getContributorsMonthly: () => of({ accountId: ACCOUNT_ID, totalActiveContributors: 100, monthlyData: [10], monthlyLabels: ['Jan 2030'] }),
    getMaintainersMonthly: () => of(maintainers),
    getEventAttendanceMonthly: () =>
      of({
        accountId: ACCOUNT_ID,
        accountName: 'Acme Motors',
        totalAttended: 200,
        totalSpeakers: 40,
        attendeesMonthlyData: [50],
        speakersMonthlyData: [10],
        monthlyLabels: ['Jan 2030'],
      }),
    getCertifiedEmployeesMonthly: () =>
      of({ accountId: ACCOUNT_ID, totalCertifications: 60, totalCertifiedEmployees: 50, monthlyData: [10], monthlyLabels: ['Jan 2030'] }),
    getTrainingEnrollments: () => of(training),
  };

  TestBed.configureTestingModule({
    imports: [OrgOverviewInvolvementComponent],
    providers: [
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgInvolvementAnalyticsService, useValue: analytics },
      { provide: OrgLensTrainingService, useValue: { getTrainingStats: () => trainingStats } },
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
  const card = metrics.find((metric) => metric.title === ORG_TRAINING_STAT_DEFINITIONS.peopleWithTrainingActivity.label);
  if (!card) {
    throw new Error('Training card missing');
  }
  return card;
}

describe('OrgOverviewInvolvementComponent training tile', () => {
  it('formats YYYY-MM-DD enrollment dates as chart labels', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, totalEnrollments: 7, dailyData: [{ date: '2030-03-04', count: 7, cumulativeCount: 7 }] });

    expect(trainingCard(metrics).chartData?.labels).toEqual(['Mar 4, 2030']);
    expect(trainingCard(metrics).chartCaption).toContain('Mar 4, 2030');
  });

  // #4223: a cache entry written before the date-only fix carries an ISO timestamp. Throwing here froze
  // every card in the carousel on its skeleton, so the label falls back to the raw value instead.
  it('keeps every card building when an enrollment date is not YYYY-MM-DD', async () => {
    const metrics = await buildMetrics({
      accountId: ACCOUNT_ID,
      totalEnrollments: 7,
      dailyData: [{ date: '2030-03-04T00:00:00.000Z', count: 7, cumulativeCount: 7 }],
    });

    expect(trainingCard(metrics).chartData?.labels).toEqual(['2030-03-04T00:00:00.000Z']);
    expect(metrics.map((metric) => metric.loading)).toEqual([false, false, false, false, false, false]);
  });

  // lfx-self-serve#4290: the tile shows the Training page's number for the same definition, not this year's enrollments.
  it('headlines people with training activity, all time, as the shared stat tile does, with the as-of date, instead of the year-to-date enrollment total', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, totalEnrollments: 7, dailyData: [{ date: '2030-03-04', count: 7, cumulativeCount: 7 }] });
    const card = trainingCard(metrics);

    expect(card.value).toBe('1,830');
    expect(card.subtitle).toContain('all time');
    expect(card.subtitle).toContain('Mar 5, 2030');
    expect(card.tooltipText).toContain('Mar 5, 2030');
  });

  it('shows a dash, not zero, when the training stats cannot load', async () => {
    const metrics = await buildMetrics(
      { accountId: ACCOUNT_ID, totalEnrollments: 7, dailyData: [] },
      undefined,
      throwError(() => new Error('boom'))
    );

    expect(trainingCard(metrics).value).toBe('—');
    expect(trainingCard(metrics).loading).toBe(false);
    // As on the strip: no number, so no as-of date in the subtitle or the tooltip.
    expect(trainingCard(metrics).subtitle).toBe('People · all time');
    expect(trainingCard(metrics).tooltipText).not.toMatch(/as of|as-of/i);
  });

  it("never shows the previous organization's number while the next organization's stats load", async () => {
    const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
    const pending = new Subject<OrgTrainingStats>();
    const getTrainingStats = vi.fn((uid: string) => (uid === 'org-uid-1' ? of(TRAINING_STATS) : pending));
    const empty = () => of({ accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] });
    TestBed.configureTestingModule({
      imports: [OrgOverviewInvolvementComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount } },
        {
          provide: OrgInvolvementAnalyticsService,
          useValue: {
            getFoundationCoverage: () => of({ accountId: ACCOUNT_ID, foundationCount: 0, foundations: [] }),
            getContributorsMonthly: () => of({ accountId: ACCOUNT_ID, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] }),
            getMaintainersMonthly: () => of({ accountId: ACCOUNT_ID, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] }),
            getEventAttendanceMonthly: () =>
              of({
                accountId: ACCOUNT_ID,
                accountName: '',
                totalAttended: 0,
                totalSpeakers: 0,
                attendeesMonthlyData: [],
                speakersMonthlyData: [],
                monthlyLabels: [],
              }),
            getCertifiedEmployeesMonthly: () =>
              of({ accountId: ACCOUNT_ID, totalCertifications: 0, totalCertifiedEmployees: 0, monthlyData: [], monthlyLabels: [] }),
            getTrainingEnrollments: empty,
          },
        },
        { provide: OrgLensTrainingService, useValue: { getTrainingStats } },
      ],
    });
    TestBed.overrideComponent(OrgOverviewInvolvementComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    await fixture.whenStable();
    expect(trainingCard(fixture.componentInstance.primaryMetrics()).value).toBe('1,830');

    selectedAccount.set({ accountId: 'acc-2', accountName: 'Other Org', membershipTier: '', uid: 'org-uid-2', slug: 'other' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getTrainingStats).toHaveBeenLastCalledWith('org-uid-2', { range: 'all', foundation: null, project: null, course: null, level: null, format: null });
    const card = trainingCard(fixture.componentInstance.primaryMetrics());
    expect(card.value).toBe('—');
    expect(card.subtitle).not.toContain('Mar 5, 2030');

    pending.next({ ...TRAINING_STATS, peopleWithTrainingActivity: 7 });
    pending.complete();
    await fixture.whenStable();

    expect(trainingCard(fixture.componentInstance.primaryMetrics()).value).toBe('7');
  });
});

describe('OrgOverviewInvolvementComponent maintainer roles', () => {
  it('names the default view under the headline and shows the roles held per month as the trend', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] });
    const card = metrics.find((metric) => metric.title === 'Maintainer roles');

    expect(card).toMatchObject({
      value: '20',
      tooltipText: ORG_OVERVIEW_MAINTAINER_ROLES_DEFINITION,
      loading: false,
    });
    expect(card?.subtitle).toBe(ORG_LENS_DEFAULT_VIEW_PHRASE);
    expect(card?.subtitle).not.toMatch(/employee/i);
    expect(card?.chartCaption).toContain('Jan 2030');
    expect(card?.chartCaption).toContain('Feb 2030');
    expect(card?.chartData?.labels).toEqual(['Jan 2030', 'Feb 2030']);
    expect(card?.chartData?.datasets[0]?.data).toEqual([12, 15]);
  });

  it('shows a dash, not zero, when the maintainer roles are unavailable', async () => {
    const metrics = await buildMetrics(
      { accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] },
      { accountId: ACCOUNT_ID, maintainerRoles: null, monthlyData: [], monthlyLabels: [] }
    );

    expect(metrics.find((metric) => metric.title === 'Maintainer roles')?.value).toBe('—');
  });

  it('shows zero when the account holds no maintainer roles', async () => {
    const metrics = await buildMetrics(
      { accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] },
      { accountId: ACCOUNT_ID, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] }
    );

    expect(metrics.find((metric) => metric.title === 'Maintainer roles')?.value).toBe('0');
  });

  it('states no chart window when there is no trend', async () => {
    const metrics = await buildMetrics(
      { accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] },
      { accountId: ACCOUNT_ID, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] }
    );

    expect(metrics.find((metric) => metric.title === 'Maintainer roles')?.chartCaption).toBeUndefined();
  });
});

describe('OrgOverviewInvolvementComponent active contributors', () => {
  it('names the default view and the company under the headline and states the trend window under the chart', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] });
    const card = metrics.find((metric) => metric.title === 'Active Contributors');

    expect(card).toMatchObject({ value: '100', tooltipText: ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION, loading: false });
    expect(card?.subtitle).toContain(ORG_LENS_DEFAULT_VIEW_PHRASE);
    expect(card?.subtitle).toContain('Acme Motors');
    expect(card?.chartCaption).toContain('Jan 2030');
    expect(card?.chartCaption).toContain(ORG_DEFAULT_PROJECT_SCOPE_LABEL);
  });
});

// lfx-self-serve-ops#1219: the Overview has no organization scope picker and always counts the default scope.
describe('OrgOverviewInvolvementComponent organization scope', () => {
  it('shows no organization scope picker and asks for the Active Contributors without a scope, the BFF default', async () => {
    const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
    const getContributorsMonthly = vi.fn(() => of({ accountId: ACCOUNT_ID, totalActiveContributors: 100, monthlyData: [], monthlyLabels: [] }));
    TestBed.configureTestingModule({
      imports: [OrgOverviewInvolvementComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount } },
        {
          provide: OrgInvolvementAnalyticsService,
          useValue: {
            getFoundationCoverage: () => of({ accountId: ACCOUNT_ID, foundationCount: 1, foundations: [] }),
            getContributorsMonthly,
            getMaintainersMonthly: () => of({ accountId: ACCOUNT_ID, maintainerRoles: 1, monthlyData: [], monthlyLabels: [] }),
            getEventAttendanceMonthly: () =>
              of({
                accountId: ACCOUNT_ID,
                accountName: '',
                totalAttended: 0,
                totalSpeakers: 0,
                attendeesMonthlyData: [],
                speakersMonthlyData: [],
                monthlyLabels: [],
              }),
            getCertifiedEmployeesMonthly: () =>
              of({ accountId: ACCOUNT_ID, totalCertifications: 0, totalCertifiedEmployees: 0, monthlyData: [], monthlyLabels: [] }),
            getTrainingEnrollments: () => of({ accountId: ACCOUNT_ID, totalEnrollments: 0, dailyData: [] }),
          },
        },
        { provide: OrgLensTrainingService, useValue: { getTrainingStats: () => of(TRAINING_STATS) } },
      ],
    });
    // The real template, without the chart cards jsdom cannot draw.
    TestBed.overrideComponent(OrgOverviewInvolvementComponent, { remove: { imports: [MetricCardComponent] }, add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="dashboard-organization-involvement-section"]')).not.toBeNull();
    expect(element.querySelector('lfx-org-scope-select')).toBeNull();
    expect(element.querySelector('[data-test="dashboard-involvement-org-scope-filter"]')).toBeNull();
    expect(getContributorsMonthly).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(getContributorsMonthly.mock.calls.every((call: unknown[]) => call.length === 1)).toBe(true);
  });
});
