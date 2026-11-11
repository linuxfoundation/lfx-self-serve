// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTraineeDetailRow, OrgTraineeOutsideLearner, OrgTraineeRow, OrgTraineesResponse, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_DOMAIN, SYNTHETIC_ORG_LEGAL_NAME, SYNTHETIC_ORG_NAME } from '../fixtures/mock-data/synthetic-org.mock';

export const ORG_TRAINING_URL = '/org/training';
export const DATA_LOAD_TIMEOUT = 30_000;
export const MOCK_ACCOUNT_ID = SYNTHETIC_ORG_ACCOUNT_ID;

export function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Let malformed URLs fail naturally.
  }
}

export async function seedSelectedOrgCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'lfx-selected-account',
      value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

export async function stubOrgTrainingRoutes(page: Page): Promise<void> {
  // #2961: Org pages wait for the role grants before rendering; stub them so the page does not wait on the
  // live dev lookup. The seeded organization is held, so no contractor read check is owed.
  await page.route('**/api/orgs/me/role-grants*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: [MOCK_ACCOUNT_ID],
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        isStaff: false,
        isContractor: false,
        degraded: false,
        lookupOutcome: 'ok',
        staffCheck: 'ok',
        username: 'e2e-org-page',
        loaded_at: new Date().toISOString(),
      }),
    })
  );

  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          {
            accountId: MOCK_ACCOUNT_ID,
            accountName: SYNTHETIC_ORG_NAME,
            membershipTier: '',
            uid: MOCK_ACCOUNT_ID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          accountId: MOCK_ACCOUNT_ID,
          accountName: SYNTHETIC_ORG_NAME,
          membershipTier: 'Gold',
        },
      ]),
    })
  );

  const trainingPath = `/api/orgs/${MOCK_ACCOUNT_ID}/lens/training`;
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(
    (url) => url.pathname === `${trainingPath}/stats`,
    (route) =>
      route.fulfill(
        json({
          range: '730d',
          asOf: '2026-10-30T09:48:21.094Z',
          rosterMembers: 40,
          rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
          peopleWithTrainingActivity: 25,
          learnersOutsidePeopleList: 3,
          coursesTaken: 30,
          certifications: 18,
          certifiedPeople: 12,
          trainingsCompleted: 4,
          completionRatePct: 73,
          coursesInProgress: 8,
          peopleInTraining: 7,
        } satisfies OrgTrainingStats)
      )
  );

  await page.route(
    (url) => url.pathname === `${trainingPath}/filter-options`,
    (route) =>
      route.fulfill(
        json({
          foundations: [{ label: 'CNCF', value: 'foundation-1' }],
          projects: [],
          courses: [{ label: 'CKA — Certified Kubernetes Administrator', value: 'CKA — Certified Kubernetes Administrator' }],
          levels: [{ label: 'Advanced', value: 'Advanced' }],
          formats: [{ label: 'Online', value: 'Online' }],
        })
      )
  );

  await page.route(
    (url) => url.pathname === `${trainingPath}/groups`,
    (route) => {
      const tab = new URL(route.request().url()).searchParams.get('tab');
      return route.fulfill(
        json(
          tab === 'trainings'
            ? {
                data: [
                  {
                    key: 'LFS258 — Kubernetes Fundamentals',
                    label: 'LFS258 — Kubernetes Fundamentals',
                    people: 6,
                    coursesTaken: 7,
                    completed: 4,
                    inProgress: 3,
                    level: 'Beginner',
                    foundation: 'Linux Foundation',
                    logoUrl: null,
                  },
                ],
                total: 1,
                totals: { people: 6, coursesTaken: 7, completed: 4, inProgress: 3 },
              }
            : {
                data: [
                  {
                    key: 'CKA — Certified Kubernetes Administrator',
                    label: 'CKA — Certified Kubernetes Administrator',
                    people: 7,
                    coursesTaken: 9,
                    completed: 5,
                    inProgress: 2,
                    level: 'Advanced',
                    foundation: 'CNCF',
                    logoUrl: null,
                  },
                ],
                total: 1,
                totals: { people: 7, coursesTaken: 9, completed: 18, inProgress: 2 },
              }
        )
      );
    }
  );

  await page.route(
    (url) => url.pathname === `${trainingPath}/groups/employees`,
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      const trainings = params.get('tab') === 'trainings';
      return route.fulfill(
        json({
          groupBy: 'course',
          groupValue: params.get('groupValue'),
          label: params.get('groupValue'),
          tab: params.get('tab'),
          status: params.get('status'),
          total: trainings ? 4 : 5,
          data: trainings
            ? [{ contactId: 'trainee@example.org', name: 'Training Graduate', jobTitle: 'Developer' }]
            : [{ contactId: 'certified@example.org', name: 'Certified Engineer', jobTitle: 'SRE' }],
        })
      );
    }
  );
}

export async function gotoOrgTrainingPage(page: Page, url: string = ORG_TRAINING_URL): Promise<void> {
  await seedSelectedOrgCookie(page);
  await stubOrgTrainingRoutes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
}

// ─── Synthetic Trainees / paging fixtures (no warehouse, no real people) ───────────────────────────────────────────────

export const SYNTHETIC_TRAINEE_COUNT = 60;
export const SYNTHETIC_OUTSIDE_LEARNER_COUNT = 55;
export const SYNTHETIC_FORMER_ON_LIST = { people: 2, pairs: 3 };
const SYNTHETIC_FOUNDATION_ID = 'foundation-1';

const pad = (index: number): string => String(index).padStart(3, '0');

/** Current employees on the people list with training in the range: `Trainee 001` … */
export function syntheticTrainees(count: number = SYNTHETIC_TRAINEE_COUNT): OrgTraineeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    personKey: `person-${pad(index + 1)}`,
    lfid: `trainee${pad(index + 1)}`,
    cdpMemberId: null,
    name: `Trainee ${pad(index + 1)}`,
    title: 'Engineer',
    email: `trainee${pad(index + 1)}@example.org`,
  }));
}

/** One course per trainee, alternating certified and enrolled, all under one foundation so a foundation pick keeps every row. */
export function syntheticTraineeDetails(trainees: readonly OrgTraineeRow[] = syntheticTrainees()): OrgTraineeDetailRow[] {
  return trainees.map((trainee, index) => ({
    personKey: trainee.personKey,
    status: index % 2 === 0 ? 'Certified' : 'Enrolled',
    courseOrCertId: `${index % 2 === 0 ? 'certified' : 'enrolled'}:course-${index % 5}`,
    courseId: `course-${index % 5}`,
    courseName: `Synthetic Course ${index % 5}`,
    foundationId: SYNTHETIC_FOUNDATION_ID,
    foundationName: 'CNCF',
    projectId: 'project-1',
    projectName: 'Synthetic Project',
    courseLevel: 'Advanced',
    productType: index % 4 === 0 ? 'Certification' : 'Training',
    courseFormat: 'Online',
    activityTs: new Date(Date.UTC(2026, 9, 1 + (index % 28))).toISOString(),
  }));
}

/** Learners outside the people list: opaque keys, name and status only. */
export function syntheticOutsideLearners(count: number = SYNTHETIC_OUTSIDE_LEARNER_COUNT): OrgTraineeOutsideLearner[] {
  return Array.from({ length: count }, (_, index) => ({
    personKey: `outside:${pad(index + 1)}`,
    name: `Outside Learner ${pad(index + 1)}`,
    status: index % 3 === 0 ? 'Certified' : 'Enrolled',
  }));
}

/** The stats strip for the fixtures above: people = the trainees, the outside tile = the outside list. */
export function syntheticTrainingStats(range: OrgTrainingStats['range'] = '730d'): OrgTrainingStats {
  const trainees = SYNTHETIC_TRAINEE_COUNT;
  return {
    range,
    asOf: '2026-10-30T09:48:21.094Z',
    rosterMembers: 400,
    rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
    peopleWithTrainingActivity: trainees + SYNTHETIC_FORMER_ON_LIST.people,
    learnersOutsidePeopleList: SYNTHETIC_OUTSIDE_LEARNER_COUNT,
    coursesTaken: trainees + SYNTHETIC_FORMER_ON_LIST.pairs,
    certifications: 10,
    certifiedPeople: 9,
    trainingsCompleted: 20,
    completionRatePct: 46,
    coursesInProgress: 33,
    peopleInTraining: 31,
  };
}

export interface OrgTrainingApiGuard {
  /** `/lens/training/*` and `/lens/people/trainees` requests no stub answered (must stay empty), and every other unstubbed /api request. */
  readonly unstubbedTrainingRequests: string[];
  readonly unstubbedApiRequests: string[];
}

/**
 * Registers the lowest-precedence `/api/**` fallback (Playwright runs the LAST registered matching route first, so register this
 * BEFORE the stubs): a request no stub answers is recorded and answered 503, so it never reaches the BFF or the warehouse.
 */
export async function guardUnstubbedApi(page: Page): Promise<OrgTrainingApiGuard> {
  const guard: OrgTrainingApiGuard = { unstubbedTrainingRequests: [], unstubbedApiRequests: [] };
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const entry = `${route.request().method()} ${url.pathname}${url.search}`;
    (/\/lens\/(training|people\/trainees)/.test(url.pathname) ? guard.unstubbedTrainingRequests : guard.unstubbedApiRequests).push(entry);
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'unstubbed in e2e' }) });
  });
  return guard;
}

export interface TraineesStubOptions {
  trainees?: OrgTraineeRow[];
  details?: OrgTraineeDetailRow[];
  outsideLearners?: OrgTraineeOutsideLearner[];
}

/** Answers `/lens/people/trainees` (echoing the requested range) and replaces the stats with the synthetic ones above. */
export async function stubOrgTraineesRoutes(page: Page, options: TraineesStubOptions = {}): Promise<void> {
  const trainees = options.trainees ?? syntheticTrainees();
  const details = options.details ?? syntheticTraineeDetails(trainees);
  const outsideLearners = options.outsideLearners ?? syntheticOutsideLearners();
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(
    (url) => url.pathname === `/api/orgs/${MOCK_ACCOUNT_ID}/lens/people/trainees`,
    (route) => {
      const range = (new URL(route.request().url()).searchParams.get('range') ?? '730d') as OrgTraineesResponse['timeRange'];
      return route.fulfill(
        json({
          accountId: MOCK_ACCOUNT_ID,
          timeRange: range,
          trainees,
          details,
          outsideLearners,
          formerOnPeopleList: SYNTHETIC_FORMER_ON_LIST,
          asOf: '2026-10-30T09:48:21.094Z',
        } satisfies OrgTraineesResponse)
      );
    }
  );

  await page.route(
    (url) => url.pathname === `/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/stats`,
    (route) => route.fulfill(json(syntheticTrainingStats((new URL(route.request().url()).searchParams.get('range') ?? '730d') as OrgTrainingStats['range'])))
  );
}

/** Opens `url` with the default training stubs, then the Trainees/stats overrides, behind the unstubbed-request guard. */
export async function gotoOrgPageWithTrainees(page: Page, url: string, options: TraineesStubOptions = {}): Promise<OrgTrainingApiGuard> {
  await seedSelectedOrgCookie(page);
  const guard = await guardUnstubbedApi(page);
  // The org selector bootstraps from this list; a 503 from the guard would clear the selected organization.
  await page.route('**/api/nav/org-items*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            uid: MOCK_ACCOUNT_ID,
            accountId: MOCK_ACCOUNT_ID,
            name: SYNTHETIC_ORG_LEGAL_NAME,
            logoUrl: null,
            primaryDomain: SYNTHETIC_ORG_DOMAIN,
            isMember: true,
          },
        ],
        next_page_token: null,
        upstream_failed: false,
        total: 1,
      }),
    })
  );
  await stubOrgTrainingRoutes(page);
  await stubOrgTraineesRoutes(page, options);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  return guard;
}
