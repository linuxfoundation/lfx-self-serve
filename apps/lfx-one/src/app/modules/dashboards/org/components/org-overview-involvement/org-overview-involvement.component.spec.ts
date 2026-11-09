// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  ORG_DEFAULT_PROJECT_SCOPE_LABEL,
  ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE,
  ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE,
  ORG_EVENTS_SPEAKERS_CAPTION_PHRASE,
  ORG_LENS_DEFAULT_VIEW_PHRASE,
  ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION,
  ORG_OVERVIEW_EVENT_ATTENDEES_SUBTITLE,
  ORG_OVERVIEW_EVENTS_DISTINCT_PEOPLE_NOTE,
  ORG_OVERVIEW_MAINTAINER_ROLES_DEFINITION,
  ORG_TRAINING_STAT_DEFINITIONS,
} from '@lfx-one/shared/constants';
import type { Account, DashboardMetricCard, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { buildOrgTrainingStatTiles } from '@lfx-one/shared/utils';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgInvolvementAnalyticsService } from '@services/org-involvement-analytics.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgOverviewInvolvementComponent } from './org-overview-involvement.component';

const ACCOUNT_ID = 'acc-1';

const TRAINING_STATS: OrgTrainingStats = {
  range: '730d',
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
  };

  TestBed.configureTestingModule({
    imports: [OrgOverviewInvolvementComponent],
    providers: [
      { provide: AccountContextService, useValue: { selectedAccount, selectedUrlSegment: signal('acme') } },
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

function certifiedCard(metrics: DashboardMetricCard[]): DashboardMetricCard {
  const card = metrics.find((metric) => metric.title === ORG_TRAINING_STAT_DEFINITIONS.certifiedPeople.label);
  if (!card) {
    throw new Error('Certified card missing');
  }
  return card;
}

function peopleCard(metrics: DashboardMetricCard[]): DashboardMetricCard {
  const card = metrics.find((metric) => metric.testId === 'org-overview-involvement-card-people-with-training-activity');
  if (!card) {
    throw new Error('People with training activity card missing');
  }
  return card;
}

function trainingCard(metrics: DashboardMetricCard[]): DashboardMetricCard {
  const card = metrics.find((metric) => metric.title === ORG_TRAINING_STAT_DEFINITIONS.coursesTaken.label);
  if (!card) {
    throw new Error('Training card missing');
  }
  return card;
}

describe('OrgOverviewInvolvementComponent training tile', () => {
  // lfx-self-serve#4290: both Education tiles show the Training page's numbers for its default state (Past 2 years, no filters).
  it('headlines courses taken for Past 2 years, as the shared stat tile does, with unit, window and the as-of date, instead of the year-to-date enrollment total', async () => {
    const metrics = await buildMetrics();
    const card = trainingCard(metrics);

    expect(card.value).toBe('400');
    expect(card.subtitle).toBe('Person-course pairs · Past 2 years · as of Mar 5, 2030');
    expect(card.tooltipText).toContain('Mar 5, 2030');
    expect(card.tooltipText).toContain('Past 2 years');
    expect(card.title).not.toMatch(/this year/i);
  });

  it('headlines certified people for Past 2 years with the certifications (person-course pairs) in the subtitle, instead of the monthly table totals', async () => {
    const metrics = await buildMetrics();
    const card = certifiedCard(metrics);

    expect(card.value).toBe('140');
    expect(card.subtitle).toBe('190 certifications · Past 2 years · as of Mar 5, 2030');
    expect(card.tooltipText).toContain('Past 2 years');
    expect(card.tooltipText).toContain('Mar 5, 2030');
    expect(card.value).not.toContain('employees');
  });

  it('headlines the people on the people list with training activity for Past 2 years, equal to the Training page tile, first of the three Education cards', async () => {
    const metrics = await buildMetrics();
    const card = peopleCard(metrics);
    const pageTile = buildOrgTrainingStatTiles(TRAINING_STATS, '730d').find((tile) => tile.key === 'peopleWithTrainingActivity')!;

    expect(card.title).toBe('People with training activity');
    expect(card.value).toBe('1,830');
    expect(card.value).toBe(pageTile.display);
    expect(card.subtitle).toBe('People · Past 2 years · as of Mar 5, 2030');
    expect(card.subtitle).toBe(pageTile.caption);
    expect(card.tooltipText).toBe(pageTile.tooltip);
    expect(card.tooltipText).toContain('people list');
    // The learners outside the people list are not part of the headline.
    expect(card.value).not.toBe((TRAINING_STATS.peopleWithTrainingActivity + (TRAINING_STATS.learnersOutsidePeopleList ?? 0)).toLocaleString('en-US'));
    expect(metrics.filter((metric) => metric.category === 'education').map((metric) => metric.testId)).toEqual([
      'org-overview-involvement-card-people-with-training-activity',
      'org-overview-involvement-card-certified-employees',
      'org-overview-involvement-card-training-enrollments',
    ]);
  });

  it('renders the three Education tiles as stat-only cards: no chart, no chart caption, no chart data', async () => {
    const metrics = await buildMetrics();

    for (const card of [peopleCard(metrics), trainingCard(metrics), certifiedCard(metrics)]) {
      expect(card.hideChart).toBe(true);
      expect(card.chartData).toBeUndefined();
      expect(card.chartCaption).toBeUndefined();
    }
    // The other cards keep their charts.
    expect(metrics.filter((metric) => metric.hideChart)).toHaveLength(3);
  });

  it('opens Training & Certification with no query when an Education tile is clicked', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await buildMetrics();
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    fixture.componentInstance.openTraining();

    expect(navigate).toHaveBeenCalledWith(['/org', 'acme', 'training']);
    navigate.mockRestore();
  });

  it('shows a dash, not zero, when the training stats cannot load', async () => {
    const metrics = await buildMetrics(
      undefined,
      throwError(() => new Error('boom'))
    );

    expect(trainingCard(metrics).value).toBe('—');
    expect(trainingCard(metrics).loading).toBe(false);
    // As on the strip: no number, so no as-of date in the subtitle or the tooltip.
    expect(trainingCard(metrics).subtitle).toBe('Person-course pairs · Past 2 years');
    expect(certifiedCard(metrics).value).toBe('—');
    expect(trainingCard(metrics).tooltipText).not.toMatch(/as of|as-of/i);
    expect(peopleCard(metrics).value).toBe('—');
    expect(peopleCard(metrics).loading).toBe(false);
    expect(peopleCard(metrics).subtitle).toBe('People · Past 2 years');
    expect(peopleCard(metrics).tooltipText).not.toMatch(/as of|as-of/i);
  });

  it('shows dashes, and does not throw, for a legacy-shaped stats payload that lacks the newer fields (rolling deployment)', async () => {
    const legacy = { range: '730d', peopleWithTrainingActivity: 1830 } as unknown as OrgTrainingStats;
    const metrics = await buildMetrics(undefined, of(legacy));

    expect(trainingCard(metrics).value).toBe('—');
    expect(certifiedCard(metrics).value).toBe('—');
    expect(trainingCard(metrics).loading).toBe(false);
    // The legacy payload does carry the people number: it is shown, as on the Training page strip.
    expect(peopleCard(metrics).value).toBe('1,830');
    expect(peopleCard(metrics).loading).toBe(false);
  });

  it("never shows the previous organization's number while the next organization's stats load", async () => {
    const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
    const pending = new Subject<OrgTrainingStats>();
    const getTrainingStats = vi.fn((uid: string) => (uid === 'org-uid-1' ? of(TRAINING_STATS) : pending));
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
          },
        },
        { provide: OrgLensTrainingService, useValue: { getTrainingStats } },
      ],
    });
    TestBed.overrideComponent(OrgOverviewInvolvementComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    await fixture.whenStable();
    expect(trainingCard(fixture.componentInstance.primaryMetrics()).value).toBe('400');

    selectedAccount.set({ accountId: 'acc-2', accountName: 'Other Org', membershipTier: '', uid: 'org-uid-2', slug: 'other' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getTrainingStats).toHaveBeenCalledWith('org-uid-1', { range: '730d', foundation: null, project: null, course: null, level: null, format: null });
    expect(getTrainingStats).toHaveBeenLastCalledWith('org-uid-2', { range: '730d', foundation: null, project: null, course: null, level: null, format: null });
    const card = trainingCard(fixture.componentInstance.primaryMetrics());
    expect(card.value).toBe('—');
    expect(card.subtitle).not.toContain('Mar 5, 2030');

    pending.next({ ...TRAINING_STATS, coursesTaken: 7 });
    pending.complete();
    await fixture.whenStable();

    expect(trainingCard(fixture.componentInstance.primaryMetrics()).value).toBe('7');
  });

  it('marks the loading state on the people card too, and clears it once the read settles', async () => {
    const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
    const pending = new Subject<OrgTrainingStats>();
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
          },
        },
        { provide: OrgLensTrainingService, useValue: { getTrainingStats: () => pending } },
      ],
    });
    TestBed.overrideComponent(OrgOverviewInvolvementComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    await fixture.whenStable();

    expect(peopleCard(fixture.componentInstance.primaryMetrics())).toMatchObject({ loading: true, value: '—' });

    pending.next(TRAINING_STATS);
    pending.complete();
    await fixture.whenStable();

    expect(peopleCard(fixture.componentInstance.primaryMetrics())).toMatchObject({ loading: false, value: '1,830' });
  });
});

// The real template, without the chart cards jsdom cannot draw: each Education card is clickable and opens Training & Certification
// with no query. The card's own Enter/Space entry point is covered by the metric-card spec.
describe('OrgOverviewInvolvementComponent Education cards in the template', () => {
  it('binds clickable on all three Education cards (and no other) and opens Training & Certification from each card click', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
    TestBed.configureTestingModule({
      imports: [OrgOverviewInvolvementComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount, selectedUrlSegment: signal('acme') } },
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
          },
        },
        { provide: OrgLensTrainingService, useValue: { getTrainingStats: () => of(TRAINING_STATS) } },
      ],
    });
    TestBed.overrideComponent(OrgOverviewInvolvementComponent, { remove: { imports: [MetricCardComponent] }, add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('lfx-metric-card')] as (HTMLElement & { testId: string; clickable: boolean })[];
    const clickable = cards.filter((card) => card.clickable).map((card) => card.testId);
    expect(clickable).toEqual([
      'org-overview-involvement-card-people-with-training-activity',
      'org-overview-involvement-card-certified-employees',
      'org-overview-involvement-card-training-enrollments',
    ]);

    for (const card of cards.filter((entry) => entry.clickable)) {
      navigate.mockClear();
      card.dispatchEvent(new Event('cardClick'));
      expect(navigate).toHaveBeenCalledWith(['/org', 'acme', 'training']);
    }
    navigate.mockRestore();
  });
});

describe('OrgOverviewInvolvementComponent maintainer roles', () => {
  it('names the default view under the headline and shows the roles held per month as the trend', async () => {
    const metrics = await buildMetrics();
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
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, maintainerRoles: null, monthlyData: [], monthlyLabels: [] });

    expect(metrics.find((metric) => metric.title === 'Maintainer roles')?.value).toBe('—');
  });

  it('shows zero when the account holds no maintainer roles', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] });

    expect(metrics.find((metric) => metric.title === 'Maintainer roles')?.value).toBe('0');
  });

  it('states no chart window when there is no trend', async () => {
    const metrics = await buildMetrics({ accountId: ACCOUNT_ID, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] });

    expect(metrics.find((metric) => metric.title === 'Maintainer roles')?.chartCaption).toBeUndefined();
  });
});

describe('OrgOverviewInvolvementComponent events', () => {
  it('says registered or attended, counts distinct people and explains the headline is not the sum of the monthly points', async () => {
    const metrics = await buildMetrics();
    const attendees = metrics.find((metric) => metric.title === 'Event Attendees');
    const speakers = metrics.find((metric) => metric.title === 'Event Speakers');

    expect(attendees?.value).toBe('200');
    expect(attendees?.subtitle).toBe(ORG_OVERVIEW_EVENT_ATTENDEES_SUBTITLE);
    expect(attendees?.subtitle).toBe('Employees who registered or attended foundation events');
    expect(attendees?.tooltipText).toContain(ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE.all);
    expect(attendees?.tooltipText).toContain(ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE.verified);
    expect(attendees?.tooltipText).toContain(ORG_OVERVIEW_EVENTS_DISTINCT_PEOPLE_NOTE);
    expect(attendees?.tooltipText).not.toContain(ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE.self_reported);
    expect(attendees?.chartCaption).toContain('Distinct people per month');
    expect(speakers?.value).toBe('40');
    expect(speakers?.subtitle).toBe('Employee speakers accepted at foundation events');
    expect(speakers?.tooltipText).toContain(ORG_EVENTS_SPEAKERS_CAPTION_PHRASE);
    expect(speakers?.tooltipText).toContain(ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE.verified);
    expect(speakers?.tooltipText).toContain(ORG_OVERVIEW_EVENTS_DISTINCT_PEOPLE_NOTE);
  });
});

describe('OrgOverviewInvolvementComponent active contributors', () => {
  it('names the default view and the company under the headline and states the trend window under the chart', async () => {
    const metrics = await buildMetrics();
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
