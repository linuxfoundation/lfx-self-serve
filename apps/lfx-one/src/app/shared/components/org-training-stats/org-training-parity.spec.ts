// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ORG_TRAINING_STAT_TILES, EMPTY_ORG_TRAINEES_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgTraineeDetailRow, OrgTraineesResponse, OrgTrainingGroupsResponse, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { countOrgTraineePairs, groupOrgTraineePairs } from '@lfx-one/shared/utils';
import { OrgTrainingComponent } from '@modules/dashboards/org/org-training/org-training.component';
import { TraineesComponent } from '@modules/dashboards/org/org-people/components/trainees/trainees.component';
import { TraineesService } from '@modules/dashboards/org/org-people/services/trainees.service';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

// Parity of the shared view (lfx-self-serve#4285): one filter set + range gives the same numbers, labels and tooltips on
// the Training page strip and the Trainees cards; Trainees' client-side per-person counts add up to those cards; the
// identity coursesTaken = certifications + trainingsCompleted + coursesInProgress holds; and the Certifications-tab
// footer total is the Certified tile. All fixtures are synthetic.

const ACME: Account = { accountId: 'acc-1', accountName: 'Synthetic Org', membershipTier: '', uid: 'org-uid-1', slug: 'synthetic' };
const QUERY = '?range=all&project=proj-k8s';

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

const trainingService = () => ({
  getTrainingStats: vi.fn(() => of(STATS)),
  getFilterOptions: vi.fn(() => of({ foundations: [], projects: [{ label: 'Project K', value: 'proj-k8s' }], courses: [], levels: [], formats: [] })),
  getGroups: vi.fn(() => of(CERTIFICATIONS_TAB)),
  getGroupEmployees: vi.fn(() => of({ total: 0, data: [] })),
});

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function renderTrainingPage(): Promise<HTMLElement> {
  const pageState = signal(null);
  const params = convertToParamMap({ range: 'all', project: 'proj-k8s' });
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
      { provide: OrgLensTrainingService, useValue: trainingService() },
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

async function renderTraineesPage(details: OrgTraineeDetailRow[] = DETAILS): Promise<HTMLElement> {
  const response: OrgTraineesResponse = {
    ...EMPTY_ORG_TRAINEES_RESPONSE,
    accountId: ACME.accountId,
    timeRange: 'all',
    trainees: PEOPLE,
    details,
    asOf: STATS.asOf,
  };
  await TestBed.configureTestingModule({
    imports: [TraineesComponent],
    providers: [
      provideRouter([]),
      { provide: AccountContextService, useValue: { selectedAccount: signal(ACME) } },
      { provide: TraineesService, useValue: { getTrainees: vi.fn(() => of(response)) } },
      { provide: OrgLensTrainingService, useValue: trainingService() },
      { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl(`/${QUERY}`);
  const fixture = TestBed.createComponent(TraineesComponent);
  await settle(fixture);
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
    const pairs = groupOrgTraineePairs(DETAILS);
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
