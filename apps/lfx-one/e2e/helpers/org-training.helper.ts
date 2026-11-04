// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../fixtures/mock-data/synthetic-org.mock';

export const ORG_TRAINING_URL = '/company/training';
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
