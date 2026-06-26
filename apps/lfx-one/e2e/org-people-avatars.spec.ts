// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Avatar consistency across Org Lens People surfaces.
 *
 * Asserts the same person shows the same avatar treatment on a People tab (Committee roster row) and
 * in a reassign picker (the Reassign Committee Roles modal's employee combobox) — both rendered by the
 * shared `lfx-person-avatar` component. Deterministic via route mocks; no committee-service dependency.
 */

import { expect, Page, test } from '@playwright/test';

const PEOPLE_COMMITTEE_URL = '/org/people?tab=committee';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = 'Toyota';
const MOCK_ACCOUNT_SLUG = 'toyota';

const CHIANING_EMAIL = 'johnny.wang@toyota.com';

// 1×1 transparent PNG — loads synchronously (no network) so the photo <img> path is deterministic.
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const CHIANING = {
  email: CHIANING_EMAIL,
  firstName: 'Chianing',
  lastName: 'Wang',
  fullName: 'Chianing Wang',
  jobTitle: 'Infrastructure Architect',
  initials: 'CW',
  avatarUrl: PNG_1x1,
};

function committeeMembersResponse() {
  const seat = (uid: string, committeeUid: string, committeeName: string) => ({
    seatId: uid,
    memberUid: uid,
    committeeUid,
    committeeName,
    committeeCategory: 'Working Group',
    projectUid: 'uec-root',
    foundationSlug: 'ultra-ethernet-consortium',
    foundationName: 'Ultra Ethernet Consortium',
    role: '',
    votingStatus: 'Non-voting',
    appointedBy: 'Membership Entitlement',
    isOrgEditable: true,
    reason: null,
    person: CHIANING,
  });
  return {
    orgUid: MOCK_UID,
    assignments: [seat('m-inc', 'c-inc', 'INC Software Working Area'), seat('m-perf', 'c-perf', 'Performance Working Group')],
    stats: { individualCount: 1, committeeCount: 2, foundationsCovered: 1 },
  };
}

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

async function stubAccountContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, accountSlug: MOCK_ACCOUNT_SLUG, membershipTier: '', uid: MOCK_UID }],
        isRootWriter: false,
      }),
    })
  );
  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: [MOCK_UID],
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        username: 'e2e-org-people-avatars',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function gotoCommitteeTab(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PEOPLE_COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  if (!page.url().includes('/org/people')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/people redirected away');
  }
  await expect(page.getByTestId('org-people-panel-committee')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.setTimeout(120_000);

test.describe('Org People — avatar consistency', () => {
  test('same person shows the same avatar treatment on the Committee tab row and in the reassign picker', async ({ page }) => {
    await stubAccountContext(page);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committeeMembersResponse()) })
    );
    // The org-wide employee picker carries the same person (same avatar) — proving cross-surface consistency.
    await page.route(/\/api\/orgs\/[^/]+\/lens\/employees(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orgUid: MOCK_UID, employees: [CHIANING] }) })
    );

    await gotoCommitteeTab(page);

    // Surface 1 — the People → Committee roster row renders the photo.
    const row = page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('person-avatar-image')).toBeVisible();

    // Surface 2 — the reassign picker suggestion renders the same photo for the same person.
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();
    await expect(page.getByTestId('org-people-committee-modal-reassign')).toBeVisible();
    await page.getByTestId('org-people-committee-modal-reassign-email-input').fill('wang');
    const option = page.getByTestId(`org-people-committee-modal-reassign-employee-option-${CHIANING_EMAIL}`);
    await expect(option).toBeVisible();
    await expect(option.getByTestId('person-avatar-image')).toBeVisible();
  });
});
