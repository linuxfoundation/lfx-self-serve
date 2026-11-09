// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ORG_TRAINING_STAT_TILES, EMPTY_ORG_TRAINEES_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgTraineeDetailRow, OrgTraineesResponse, OrgTrainingGroupsResponse, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { countOrgTraineePairs, matchesOrgTrainingFilters, parseOrgTrainingViewState, resolveOrgTraineePairs } from '@lfx-one/shared/utils';
import { OrgTrainingComponent } from '@modules/dashboards/org/org-training/org-training.component';
import { TraineesComponent } from '@modules/dashboards/org/org-people/components/trainees/trainees.component';
import { TraineesService } from '@modules/dashboards/org/org-people/services/trainees.service';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { OrgOverviewInvolvementComponent } from '@modules/dashboards/org/components/org-overview-involvement/org-overview-involvement.component';
import { OrgInvolvementAnalyticsService } from '@shared/services/org-involvement-analytics.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

// Parity of the shared view (lfx-self-serve#4285): one filter set + range gives the same numbers, labels and tooltips on
// the Training page strip and the Trainees cards; Trainees' client-side per-person counts add up to those cards; the
// identity coursesTaken = certifications + trainingsCompleted + coursesInProgress holds; and the Certifications-tab
// footer total is the Certified tile. All fixtures are synthetic.

const ACME: Account = { accountId: 'acc-1', accountName: 'Synthetic Org', membershipTier: '', uid: 'org-uid-1', slug: 'synthetic' };
const QUERY = '?range=all&trainingProject=proj-k8s';

/** Six course pairs over three people, all in project `proj-k8s`: 2 certifications, 1 training completed, 3 in progress. */
const DETAILS: OrgTraineeDetailRow[] = [
  row('p-1', 'cka', 'Certified', 'Certification'),
  row('p-1', 'cka', 'Enrolled', 'Certification'), // re-enrollment of the same course: one pair, Certified wins
  row('p-1', 'k8s-intro', 'Enrolled', 'Training'),
  row('p-2', 'cka', 'Certified', 'Certification'),
  row('p-2', 'k8s-intro', 'Certified', 'Training'),
  row('p-3', 'k8s-intro', 'Enrolled', 'Training'),
  row('p-3', 'lfs-ci', 'Enrolled', 'Training'),
];

function row(personKey: string, courseId: string, status: OrgTraineeDetailRow['status'], productType: string): OrgTraineeDetailRow {
  return {
    personKey,
    status,
    courseOrCertId: `${status}:${personKey}:${courseId}`,
    courseId,
    courseName: courseId,
    foundationId: 'foundation-a',
    foundationName: 'Foundation A',
    projectId: 'proj-k8s',
    projectName: 'Project K',
    courseLevel: 'Beginner',
    productType,
    courseFormat: 'E-Learning',
    activityTs: '2026-09-01T00:00:00.000Z',
  };
}

const PEOPLE = ['p-1', 'p-2', 'p-3'].map((personKey, index) => ({
  personKey,
  lfid: null,
  cdpMemberId: null,
  name: `Trainee ${index + 1}`,
  title: null,
  email: null,
}));

/** What the BFF's stats call returns for DETAILS under the QUERY filters. */
const STATS: OrgTrainingStats = {
  range: 'all',
  asOf: '2026-10-30T09:48:21.094Z',
  rosterMembers: 25,
  rosterMembersAsOf: '2026-10-30T09:48:21.094Z',
  peopleWithTrainingActivity: 3,
  learnersOutsidePeopleList: 0,
  coursesTaken: 6,
  certifications: 2,
  certifiedPeople: 2,
  trainingsCompleted: 1,
  completionRatePct: 50,
  coursesInProgress: 3,
  peopleInTraining: 2,
};

const CERTIFICATIONS_TAB: OrgTrainingGroupsResponse = {
  data: [{ key: 'cka', label: 'cka', people: 2, coursesTaken: 2, completed: 2, inProgress: 0, level: 'Beginner', foundation: 'Foundation A', logoUrl: null }],
  total: 1,
  totals: { people: 2, coursesTaken: 2, completed: 2, inProgress: 0 },
};
const TRAININGS_TAB: OrgTrainingGroupsResponse = {
  data: [
    {
      key: 'k8s-intro',
      label: 'k8s-intro',
      people: 3,
      coursesTaken: 3,
      completed: 1,
      inProgress: 2,
      level: 'Beginner',
      foundation: 'Foundation A',
      logoUrl: null,
    },
    { key: 'lfs-ci', label: 'lfs-ci', people: 1, coursesTaken: 1, completed: 0, inProgress: 1, level: 'Beginner', foundation: 'Foundation A', logoUrl: null },
  ],
  total: 2,
  totals: { people: 3, coursesTaken: 4, completed: 1, inProgress: 3 },
};

interface TileSnapshot {
  testId: string;
  value: string;
  label: string;
  caption: string;
  ariaLabel: string;
}

function snapshotTiles(host: HTMLElement): TileSnapshot[] {
  const strip = host.querySelector('lfx-org-training-stats')!;
  return ORG_TRAINING_STAT_TILES.map(({ testId }) => {
    const text = (part: string): string => strip.querySelector(`[data-testid="${testId}-${part}"]`)?.textContent?.trim() ?? '';
    return {
      testId,
      value: text('value'),
      label: text('label'),
      caption: text('caption'),
      ariaLabel: strip.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-label') ?? '',
    };
  });
}

const trainingService = (stats: OrgTrainingStats = STATS) => ({
  getTrainingStats: vi.fn(() => of(stats)),
  getFilterOptions: vi.fn(() => of({ foundations: [], projects: [{ label: 'Project K', value: 'proj-k8s' }], courses: [], levels: [], formats: [] })),
  getGroups: vi.fn(() => of(CERTIFICATIONS_TAB)),
  getGroupEmployees: vi.fn(() => of({ total: 0, data: [] })),
});

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function renderTrainingPage(
  query: Record<string, string> = { range: 'all', trainingProject: 'proj-k8s' },
  service = trainingService()
): Promise<HTMLElement> {
  const pageState = signal(null);
  const params = convertToParamMap(query);
  await TestBed.configureTestingModule({
    imports: [OrgTrainingComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } },
      { provide: AccountContextService, useValue: { selectedAccount: signal(ACME) } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady: signal(true),
          settled: signal(true),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      { provide: OrgLensTrainingService, useValue: service },
      {
        provide: PersonDetailDrawerService,
        useValue: {
          isOpen: signal(false),
          activeContext: signal(null),
          activeTab: signal('events'),
          loading: signal(false),
          error: signal(false),
          emailError: signal(false),
          emailsLoading: signal(false),
          identityUnavailable: signal(false),
          companyEmailsResolved: signal(false),
          detail: signal(null),
          companyEmails: signal([]),
          open: vi.fn(),
          close: vi.fn(),
          setTab: vi.fn(),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(OrgTrainingComponent);
  await settle(fixture);
  return fixture.nativeElement;
}

async function renderTraineesPage(
  details: OrgTraineeDetailRow[] = DETAILS,
  query: string = QUERY,
  stats: OrgTrainingStats = STATS,
  formerOnPeopleList: OrgTraineesResponse['formerOnPeopleList'] = { people: 0, pairs: 0 },
  outsideLearners: OrgTraineesResponse['outsideLearners'] = [],
  openOutside = false
): Promise<HTMLElement> {
  const response: OrgTraineesResponse = {
    ...EMPTY_ORG_TRAINEES_RESPONSE,
    accountId: ACME.accountId,
    timeRange: 'all',
    trainees: PEOPLE,
    details,
    formerOnPeopleList,
    outsideLearners,
    asOf: STATS.asOf,
  };
  await TestBed.configureTestingModule({
    imports: [TraineesComponent],
    providers: [
      provideRouter([]),
      { provide: AccountContextService, useValue: { selectedAccount: signal(ACME) } },
      { provide: TraineesService, useValue: { getTrainees: vi.fn(() => of(response)) } },
      { provide: OrgLensTrainingService, useValue: trainingService(stats) },
      { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl(`/${query}`);
  const fixture = TestBed.createComponent(TraineesComponent);
  await settle(fixture);
  if (openOutside) {
    // The list of learners not on the people list starts collapsed.
    fixture.nativeElement.querySelector('[data-testid="org-people-trainees-outside-toggle"]')!.click();
    await settle(fixture);
  }
  return fixture.nativeElement;
}

describe('Training strip and Trainees cards (one stats component, one stats call)', () => {
  it('show identical values, labels, captions and tooltips for the same range and filters', async () => {
    const training = snapshotTiles(await renderTrainingPage());
    TestBed.resetTestingModule();
    const trainees = snapshotTiles(await renderTraineesPage());

    expect(training).toHaveLength(ORG_TRAINING_STAT_TILES.length);
    expect(trainees).toEqual(training);
    expect(training.find((tile) => tile.testId === 'org-training-stat-courses-taken')?.value).toBe('6');
    expect(training.every((tile) => tile.ariaLabel.includes(tile.label))).toBe(true);
  });
});

describe('Learners not on the people list: tile vs the Trainees list', () => {
  const OUTSIDE = [
    { personKey: 'outside:1', name: 'Outside One', status: 'Certified' as const },
    { personKey: 'outside:2', name: 'Outside Two', status: 'Enrolled' as const },
    { personKey: 'outside:3', name: null, status: 'Enrolled' as const },
  ];
  const UNFILTERED_STATS: OrgTrainingStats = { ...STATS, learnersOutsidePeopleList: OUTSIDE.length };

  it('shows a tile value equal to the Trainees outside list length, and keeps it out of the people tile', async () => {
    const host = await renderTraineesPage(DETAILS, '?range=all', UNFILTERED_STATS, { people: 0, pairs: 0 }, OUTSIDE, true);
    const tiles = snapshotTiles(host);
    const outsideTile = tiles.find((tile) => tile.testId === 'org-training-stat-learners-outside-people-list')!;
    const peopleTile = tiles.find((tile) => tile.testId === 'org-training-stat-people-with-training-activity')!;

    expect(outsideTile.label).toBe('Learners not on the people list');
    expect(Number(outsideTile.value)).toBe(host.querySelectorAll('[data-testid="org-people-trainees-outside"] li').length);
    expect(outsideTile.value).toBe('3');
    // The people tile is the people-list people (the Trainees table rows), without the outside learners.
    expect(peopleTile.value).toBe('3');
    expect(Number(peopleTile.value)).toBe(new Set(resolveOrgTraineePairs(DETAILS).map((pair) => pair.personKey)).size);
  });
});

describe('Trainees client-derived per-person counts vs the cards', () => {
  it('sum, over the listed people, to the card values', async () => {
    const host = await renderTraineesPage();
    const cards = Object.fromEntries(snapshotTiles(host).map((tile) => [tile.testId, tile.value]));

    // columns: chevron, name, status, courses, certs, trainings, in progress, recent
    const sums = [3, 4, 5, 6].map((index) =>
      [...host.querySelectorAll('tbody tr[role="button"]')].reduce((sum, tr) => sum + (Number(tr.querySelectorAll('td')[index].textContent?.trim()) || 0), 0)
    );

    expect(sums).toEqual([
      Number(cards['org-training-stat-courses-taken']),
      Number(cards['org-training-stat-certifications']),
      Number(cards['org-training-stat-trainings-completed']),
      Number(cards['org-training-stat-courses-in-progress']),
    ]);
  });

  it('group the fixture rows into pairs (Certified wins, product-type split) that equal the stats payload', () => {
    const pairs = resolveOrgTraineePairs(DETAILS);
    const counts = countOrgTraineePairs(pairs);

    expect(pairs).toHaveLength(6);
    expect(counts).toEqual({
      coursesTaken: STATS.coursesTaken,
      certifications: STATS.certifications,
      trainingsCompleted: STATS.trainingsCompleted,
      inProgress: STATS.coursesInProgress,
    });
    expect(new Set(pairs.map((pair) => pair.personKey)).size).toBe(STATS.peopleWithTrainingActivity);
    expect(new Set(pairs.filter((pair) => pair.status === 'Certified' && pair.productType === 'Certification').map((pair) => pair.personKey)).size).toBe(
      STATS.certifiedPeople
    );
    expect(new Set(pairs.filter((pair) => pair.status === 'Enrolled').map((pair) => pair.personKey)).size).toBe(STATS.peopleInTraining);
  });
});

// One pair whose rows disagree: the enrollment is Beginner / no format / the lower project id, the later certificate is
// Intermediate / Certification Exam / the higher project id. The pair rule resolves the attributes across both rows BEFORE
// any filter applies, so the pair is Intermediate / Certification Exam / proj-b everywhere, and a filter keeps or drops it whole.
const MIXED_DETAILS: OrgTraineeDetailRow[] = [
  {
    ...row('p-1', 'cka', 'Enrolled', 'Certification'),
    courseLevel: 'Beginner',
    courseFormat: null,
    projectId: 'proj-a',
    projectName: 'Project A',
    activityTs: '2026-03-01T00:00:00.000Z',
  },
  {
    ...row('p-1', 'cka', 'Certified', 'Certification'),
    courseLevel: 'Intermediate',
    courseFormat: 'Certification Exam',
    projectId: 'proj-b',
    projectName: 'Project B',
    activityTs: '2026-04-01T00:00:00.000Z',
  },
  { ...row('p-2', 'k8s-intro', 'Enrolled', 'Training'), courseLevel: 'Beginner', courseFormat: 'E-Learning', projectId: 'proj-a', projectName: 'Project A' },
];

/** The stats the BFF's SQL pair rule yields for a filter set, computed through the shared util (the rule both sides pin). */
function statsForFilters(query: string): OrgTrainingStats {
  const filters = parseOrgTrainingViewState((key) => new URLSearchParams(query).get(key));
  const pairs = resolveOrgTraineePairs(MIXED_DETAILS).filter((pair) => matchesOrgTrainingFilters(pair, filters));
  const counts = countOrgTraineePairs(pairs);
  const completed = counts.certifications + counts.trainingsCompleted;
  return {
    ...STATS,
    range: 'all',
    peopleWithTrainingActivity: new Set(pairs.map((pair) => pair.personKey)).size,
    coursesTaken: counts.coursesTaken,
    certifications: counts.certifications,
    trainingsCompleted: counts.trainingsCompleted,
    coursesInProgress: counts.inProgress,
    completionRatePct: counts.coursesTaken > 0 ? Math.round((completed / counts.coursesTaken) * 100) : 0,
    certifiedPeople: new Set(pairs.filter((pair) => pair.status === 'Certified' && pair.productType === 'Certification').map((pair) => pair.personKey)).size,
    peopleInTraining: new Set(pairs.filter((pair) => pair.status === 'Enrolled').map((pair) => pair.personKey)).size,
  };
}

describe('Mixed-attribute pair: Training strip, Trainees cards and Trainees table counts agree under every filter set', () => {
  // [filters, courses taken, certifications, trainings completed, in progress] — pinned so the pair rule cannot drift.
  it.each<[string, number, number, number, number]>([
    ['range=all', 2, 1, 0, 1],
    ['range=all&level=Intermediate', 1, 1, 0, 0],
    ['range=all&level=Beginner', 1, 0, 0, 1],
    ['range=all&trainingProject=proj-b', 1, 1, 0, 0],
    ['range=all&trainingProject=proj-a', 1, 0, 0, 1],
    ['range=all&format=Certification%20Exam', 1, 1, 0, 0],
    ['range=all&format=E-Learning', 1, 0, 0, 1],
    ['range=all&level=Intermediate&format=Certification%20Exam&trainingProject=proj-b', 1, 1, 0, 0],
    ['range=all&level=Beginner&trainingProject=proj-b', 0, 0, 0, 0],
  ])('%s', async (query, coursesTaken, certifications, trainingsCompleted, inProgress) => {
    const stats = statsForFilters(query);
    expect([stats.coursesTaken, stats.certifications, stats.trainingsCompleted, stats.coursesInProgress]).toEqual([
      coursesTaken,
      certifications,
      trainingsCompleted,
      inProgress,
    ]);

    const training = snapshotTiles(await renderTrainingPage(Object.fromEntries(new URLSearchParams(query)), trainingService(stats)));
    TestBed.resetTestingModule();
    const traineesHost = await renderTraineesPage(MIXED_DETAILS, `?${query}`, stats);
    const trainees = snapshotTiles(traineesHost);

    expect(trainees).toEqual(training);
    // columns: chevron, name, status, courses, certs, trainings, in progress, recent
    const sums = [3, 4, 5, 6].map((index) =>
      [...traineesHost.querySelectorAll('tbody tr[role="button"]')].reduce(
        (sum, tr) => sum + (Number(tr.querySelectorAll('td')[index].textContent?.trim()) || 0),
        0
      )
    );
    expect(sums).toEqual([coursesTaken, certifications, trainingsCompleted, inProgress]);
    TestBed.resetTestingModule();
  });
});

// A former employee still on the people list: their rows count in the stats call (cards) but the table lists current
// employees only, so the response carries no detail rows for them, only the counts of `formerOnPeopleList`.
const FORMER_DETAILS: OrgTraineeDetailRow[] = [row('p-gone', 'cka', 'Certified', 'Certification'), row('p-gone', 'lfs-ci', 'Enrolled', 'Training')];

describe('Former employee on the people list: cards = table-derived sums + former counts', () => {
  const formerPairs = resolveOrgTraineePairs(FORMER_DETAILS);
  const former = countOrgTraineePairs(formerPairs);
  const formerOnPeopleList = { people: new Set(formerPairs.map((pair) => pair.personKey)).size, pairs: formerPairs.length };
  const allPairs = resolveOrgTraineePairs([...DETAILS, ...FORMER_DETAILS]);
  const all = countOrgTraineePairs(allPairs);
  const withFormerStats: OrgTrainingStats = {
    ...STATS,
    peopleWithTrainingActivity: new Set(allPairs.map((pair) => pair.personKey)).size,
    coursesTaken: all.coursesTaken,
    certifications: all.certifications,
    trainingsCompleted: all.trainingsCompleted,
    coursesInProgress: all.inProgress,
  };

  it('counts the former employee once as a person and per pair in formerOnPeopleList', () => {
    expect(formerOnPeopleList).toEqual({ people: 1, pairs: 2 });
  });

  it('shows cards equal to the table sums plus the former pairs, and a note with the former people count', async () => {
    // No filter: the former count is the range's, so the note (and this equality) holds while no filter narrows the cards.
    const host = await renderTraineesPage(DETAILS, '?range=all', withFormerStats, formerOnPeopleList);
    const cards = Object.fromEntries(snapshotTiles(host).map((tile) => [tile.testId, Number(tile.value)]));
    // columns: chevron, name, status, courses, certs, trainings, in progress, recent
    const sums = [3, 4, 5, 6].map((index) =>
      [...host.querySelectorAll('tbody tr[role="button"]')].reduce((sum, tr) => sum + (Number(tr.querySelectorAll('td')[index].textContent?.trim()) || 0), 0)
    );

    expect(host.querySelectorAll('tbody tr[role="button"]')).toHaveLength(PEOPLE.length);
    expect([
      cards['org-training-stat-courses-taken'],
      cards['org-training-stat-certifications'],
      cards['org-training-stat-trainings-completed'],
      cards['org-training-stat-courses-in-progress'],
    ]).toEqual([sums[0] + former.coursesTaken, sums[1] + former.certifications, sums[2] + former.trainingsCompleted, sums[3] + former.inProgress]);
    expect(cards['org-training-stat-courses-taken']).toBe(sums[0] + formerOnPeopleList.pairs);
    expect(cards['org-training-stat-people-with-training-activity']).toBe(PEOPLE.length + formerOnPeopleList.people);
    expect(host.querySelector('[data-testid="org-people-trainees-former-note"]')?.textContent).toContain('1 former employee on the people list');
  });

  it("hides the note while a filter narrows the cards, since the former count is the range's unfiltered one", async () => {
    const host = await renderTraineesPage(DETAILS, QUERY, withFormerStats, formerOnPeopleList);

    expect(host.querySelector('[data-testid="org-people-trainees-former-note"]')).toBeNull();
  });
});

describe('stat identities', () => {
  it('courses taken = certifications + trainings completed + courses in progress, as numbers and as rendered', async () => {
    expect(STATS.coursesTaken).toBe(STATS.certifications + STATS.trainingsCompleted + STATS.coursesInProgress);

    const tiles = snapshotTiles(await renderTraineesPage());
    const value = (testId: string): number => Number(tiles.find((tile) => tile.testId === testId)!.value.replace(/,/g, ''));
    expect(value('org-training-stat-courses-taken')).toBe(
      value('org-training-stat-certifications') + value('org-training-stat-trainings-completed') + value('org-training-stat-courses-in-progress')
    );
  });

  it('the Certified tile equals the Certifications tab footer total, and the Trainings tab and in-progress totals close the rest', () => {
    expect(CERTIFICATIONS_TAB.totals.completed).toBe(STATS.certifications);
    expect(TRAININGS_TAB.totals.completed).toBe(STATS.trainingsCompleted);
    expect(CERTIFICATIONS_TAB.totals.inProgress + TRAININGS_TAB.totals.inProgress).toBe(STATS.coursesInProgress);
    expect(CERTIFICATIONS_TAB.totals.coursesTaken + TRAININGS_TAB.totals.coursesTaken).toBe(STATS.coursesTaken);
  });

  it('the rendered Certifications tile shows the Certifications tab footer total', async () => {
    const tiles = snapshotTiles(await renderTraineesPage());

    expect(tiles.find((tile) => tile.testId === 'org-training-stat-certifications')?.value).toBe(String(CERTIFICATIONS_TAB.totals.completed));
  });
});

describe('Overview Education tiles vs the Training page in its default state', () => {
  const DEFAULT_QUERY = { range: '730d', foundation: null, project: null, course: null, level: null, format: null };
  const DEFAULT_STATS: OrgTrainingStats = {
    ...STATS,
    range: '730d',
    certifiedPeople: 857,
    certifications: 1134,
    coursesTaken: 9660,
    trainingsCompleted: 2373,
    coursesInProgress: 6153,
  };

  async function renderOverview(service: ReturnType<typeof trainingService>) {
    const analytics = {
      getFoundationCoverage: () => of({ accountId: ACME.accountId, foundationCount: 0, foundations: [] }),
      getContributorsMonthly: () => of({ accountId: ACME.accountId, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] }),
      getMaintainersMonthly: () => of({ accountId: ACME.accountId, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] }),
      getEventAttendanceMonthly: () =>
        of({
          accountId: ACME.accountId,
          accountName: '',
          totalAttended: 0,
          totalSpeakers: 0,
          attendeesMonthlyData: [],
          speakersMonthlyData: [],
          monthlyLabels: [],
        }),
    };
    TestBed.configureTestingModule({
      imports: [OrgOverviewInvolvementComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal(ACME) } },
        { provide: OrgInvolvementAnalyticsService, useValue: analytics },
        { provide: OrgLensTrainingService, useValue: service },
      ],
    });
    TestBed.overrideComponent(OrgOverviewInvolvementComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(OrgOverviewInvolvementComponent);
    await fixture.whenStable();
    return fixture.componentInstance.primaryMetrics();
  }

  it('reads the same stats query as the Training page without URL params, and shows the page tiles numbers', async () => {
    const pageService = trainingService(DEFAULT_STATS);
    const host = await renderTrainingPage({}, pageService);
    const page = snapshotTiles(host);
    TestBed.resetTestingModule();

    const overviewService = trainingService(DEFAULT_STATS);
    const cards = await renderOverview(overviewService);

    expect(pageService.getTrainingStats).toHaveBeenCalledWith('org-uid-1', DEFAULT_QUERY);
    expect(overviewService.getTrainingStats).toHaveBeenCalledWith('org-uid-1', DEFAULT_QUERY);
    const certified = cards.find((card) => card.testId === 'org-overview-involvement-card-certified-employees')!;
    const enrollments = cards.find((card) => card.testId === 'org-overview-involvement-card-training-enrollments')!;
    const tile = (testId: string) => page.find((entry) => entry.testId === testId)!;
    expect(certified.value).toBe(tile('org-training-stat-certified-people').value);
    expect(certified.value).toBe('857');
    expect(certified.subtitle).toContain(`${tile('org-training-stat-certifications').value} certifications`);
    expect(enrollments.value).toBe(tile('org-training-stat-courses-taken').value);
    expect(enrollments.value).toBe('9,660');
    expect(enrollments.subtitle).toBe(tile('org-training-stat-courses-taken').caption);
    const people = cards.find((card) => card.testId === 'org-overview-involvement-card-people-with-training-activity')!;
    expect(people.value).toBe(tile('org-training-stat-people-with-training-activity').value);
    expect(people.value).toBe('3');
    expect(people.subtitle).toBe(tile('org-training-stat-people-with-training-activity').caption);
    expect(people.title).toBe(tile('org-training-stat-people-with-training-activity').label);
    expect(cards.filter((card) => card.category === 'education').map((card) => card.testId)).toEqual([
      'org-overview-involvement-card-people-with-training-activity',
      'org-overview-involvement-card-certified-employees',
      'org-overview-involvement-card-training-enrollments',
    ]);
    expect(certified.title).toBe(tile('org-training-stat-certified-people').label);
    expect(enrollments.title).toBe(tile('org-training-stat-courses-taken').label);
  });
});
