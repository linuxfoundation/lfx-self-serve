// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** People → Committee tab reassign E2E (spec 027 US3 bulk modal + US4 single-edit modal). Deterministic via route mocks. */

import { expect, Page, Route, test } from '@playwright/test';

const PEOPLE_COMMITTEE_URL = '/org/people?tab=committee';
const DATA_LOAD_TIMEOUT = 30_000;
const TOAST_TIMEOUT = 10_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = 'Toyota';
const MOCK_ACCOUNT_SLUG = 'toyota';

const CHIANING_EMAIL = 'johnny.wang@toyota.com';
const REPLACEMENT_EMAIL = 'cara.dev@toyota.com';

function entitlementSeat(uid: string, committeeUid: string, committeeName: string) {
  return {
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
    person: { email: CHIANING_EMAIL, firstName: 'Chianing', lastName: 'Wang', fullName: 'Chianing Wang', jobTitle: 'Infrastructure Architect', initials: 'CW' },
  };
}

function committeeMembersResponse() {
  return {
    orgUid: MOCK_UID,
    assignments: [
      entitlementSeat('m-inc', 'c-inc', 'INC Software Working Area'),
      entitlementSeat('m-perf', 'c-perf', 'Performance Working Group'),
      entitlementSeat('m-link', 'c-link', 'Link Layer Working Group'),
      {
        seatId: 'm-tsc',
        memberUid: 'm-tsc',
        committeeUid: 'c-tsc',
        committeeName: 'Technical Steering Committee',
        committeeCategory: 'Technical',
        projectUid: 'uec-root',
        foundationSlug: 'ultra-ethernet-consortium',
        foundationName: 'Ultra Ethernet Consortium',
        role: 'Member',
        votingStatus: 'Voting Rep',
        appointedBy: 'Community',
        isOrgEditable: false,
        reason: "This seat is held by foundation election or appointment, not by your organization's membership entitlement.",
        person: {
          email: CHIANING_EMAIL,
          firstName: 'Chianing',
          lastName: 'Wang',
          fullName: 'Chianing Wang',
          jobTitle: 'Infrastructure Architect',
          initials: 'CW',
        },
      },
    ],
    stats: { individualCount: 1, committeeCount: 4, foundationsCovered: 1 },
  };
}

const MOCK_EMPLOYEES = [
  { email: REPLACEMENT_EMAIL, firstName: 'Cara', lastName: 'Dev', fullName: 'Cara Dev', jobTitle: 'Senior Engineer', initials: 'CD' },
  { email: 'evan.qa@toyota.com', firstName: 'Evan', lastName: 'QA', fullName: 'Evan QA', jobTitle: 'QA Lead', initials: 'EQ' },
];

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

async function stubAccountContext(page: Page, opts: { writers: string[] } = { writers: [MOCK_UID] }): Promise<void> {
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
        writers: opts.writers,
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        username: 'e2e-org-people-committee-reassign',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubCommitteeMembers(page: Page, body: unknown = committeeMembersResponse()): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function stubEmployees(page: Page, employees: unknown[] = MOCK_EMPLOYEES, status = 200): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/employees$/, (route) => {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ orgUid: MOCK_UID, employees }) });
  });
}

/** Stubs the PATCH reassign proxy; the handler decides what to return per request. */
async function stubReassignPatch(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members\/[^/]+\/reassign$/, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await handler(route);
  });
}

function reassignedSeatBody(seatId: string, committeeUid: string, committeeName: string) {
  return {
    orgUid: MOCK_UID,
    seat: {
      ...entitlementSeat(seatId, committeeUid, committeeName),
      person: { email: REPLACEMENT_EMAIL, firstName: 'Cara', lastName: 'Dev', fullName: 'Cara Dev', jobTitle: null, initials: 'CD' },
    },
  };
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

test.describe('Org People → Committee — Reassign Committee Roles modal (US3)', () => {
  test('opens with the expected anatomy and reflects the fixture counts', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();

    const modal = page.getByTestId('org-people-committee-modal-reassign');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('org-people-committee-modal-reassign-title')).toHaveText('Reassign Committee Roles');
    // 3 entitlement seats (the non-entitlement TSC seat is excluded), all on 1 foundation.
    await expect(page.getByTestId('org-people-committee-modal-reassign-subtitle')).toHaveText('3 roles across 1 foundation');
    await expect(modal.locator('[data-testid^="org-people-committee-modal-reassign-role-row-"]')).toHaveCount(3);
    await expect(page.getByTestId('org-people-committee-modal-reassign-primary-button')).toContainText('Save Changes (3 roles)');
  });

  test('deselecting a role updates the Save button count', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-modal-reassign-role-checkbox-m-link').click();
    await expect(page.getByTestId('org-people-committee-modal-reassign-primary-button')).toContainText('Save Changes (2 roles)');
  });

  test('Save is disabled until Email / First / Last are filled', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();
    await expect(page.getByTestId('org-people-committee-modal-reassign-primary-button')).toBeDisabled();
  });

  test('valid Save fans out N PATCHes and refreshes', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);
    let patchCount = 0;
    await stubReassignPatch(page, (route) => {
      patchCount += 1;
      const url = route.request().url();
      const seatId = url.split('/committee-members/')[1].split('/reassign')[0];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reassignedSeatBody(seatId, 'c-x', 'Committee')) });
    });

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-modal-reassign-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-committee-modal-reassign-first-name-input').fill('Cara');
    await page.getByTestId('org-people-committee-modal-reassign-last-name-input').fill('Dev');
    await page.getByTestId('org-people-committee-modal-reassign-primary-button').click();

    await expect(page.getByTestId('org-people-committee-toast-success')).toBeVisible({ timeout: TOAST_TIMEOUT });
    expect(patchCount).toBe(3);
  });

  test('a 409 on one PATCH closes the modal and surfaces a partial-success warning toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);
    await stubReassignPatch(page, (route) => {
      const url = route.request().url();
      if (url.includes('/m-link/')) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'seat changed since you opened the dialog' } }),
        });
      }
      const seatId = url.split('/committee-members/')[1].split('/reassign')[0];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reassignedSeatBody(seatId, 'c-x', 'Committee')) });
    });

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-modal-reassign-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-committee-modal-reassign-first-name-input').fill('Cara');
    await page.getByTestId('org-people-committee-modal-reassign-last-name-input').fill('Dev');
    await page.getByTestId('org-people-committee-modal-reassign-primary-button').click();

    // Modal resolves on partial success — leaving it open would re-PATCH already-succeeded seats
    // (their `memberUid` has moved upstream) and 404 them, so the modal closes and a warning toast
    // summarizes the outcome instead.
    await expect(page.getByTestId('org-people-committee-modal-reassign')).toHaveCount(0, { timeout: TOAST_TIMEOUT });
    await expect(page.getByTestId('org-people-committee-toast-success')).toContainText('succeeded', { timeout: TOAST_TIMEOUT });
  });

  test('all PATCHes failing surfaces the cleaned error and keeps the modal open', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);
    await stubReassignPatch(page, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Reassignment failed — please retry.' } }) })
    );

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-modal-reassign-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-committee-modal-reassign-first-name-input').fill('Cara');
    await page.getByTestId('org-people-committee-modal-reassign-last-name-input').fill('Dev');
    await page.getByTestId('org-people-committee-modal-reassign-primary-button').click();

    await expect(page.getByTestId('org-people-committee-modal-reassign-save-error')).toBeVisible();
    await expect(page.getByTestId('org-people-committee-modal-reassign')).toBeVisible();
    await expect(page.getByTestId('org-people-committee-toast-success')).toHaveCount(0);
  });
});

test.describe('Org People → Committee — Edit Committee Role modal (US4)', () => {
  test('opens scoped to one seat with the chip header + current member', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-edit-m-inc').click();

    const modal = page.getByTestId('org-people-committee-modal-edit');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('org-people-committee-modal-edit-title')).toHaveText('Edit Committee Role');
    await expect(page.getByTestId('org-people-committee-modal-edit-chips')).toContainText('INC Software Working Area');
    await expect(page.getByTestId('org-people-committee-modal-edit-chips')).toContainText('Ultra Ethernet Consortium');
    await expect(page.getByTestId('org-people-committee-modal-edit-current')).toContainText('Chianing Wang');
  });

  test('Save fires exactly one PATCH and shows a success toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);
    let patchCount = 0;
    await stubReassignPatch(page, (route) => {
      patchCount += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reassignedSeatBody('m-inc', 'c-inc', 'INC Software Working Area')),
      });
    });

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-edit-m-inc').click();
    await page.getByTestId('org-people-committee-modal-edit-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-committee-modal-edit-first-name-input').fill('Cara');
    await page.getByTestId('org-people-committee-modal-edit-last-name-input').fill('Dev');
    await page.getByTestId('org-people-committee-modal-edit-primary-button').click();

    await expect(page.getByTestId('org-people-committee-toast-success')).toBeVisible({ timeout: TOAST_TIMEOUT });
    expect(patchCount).toBe(1);
  });

  test('a 5xx save keeps the Edit modal open with an inline error and no success toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);
    await stubReassignPatch(page, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Reassignment failed — please retry.' } }) })
    );

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-edit-m-inc').click();
    await page.getByTestId('org-people-committee-modal-edit-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-committee-modal-edit-first-name-input').fill('Cara');
    await page.getByTestId('org-people-committee-modal-edit-last-name-input').fill('Dev');
    await page.getByTestId('org-people-committee-modal-edit-primary-button').click();

    await expect(page.getByTestId('org-people-committee-modal-edit-save-error')).toBeVisible();
    await expect(page.getByTestId('org-people-committee-modal-edit')).toBeVisible();
    await expect(page.getByTestId('org-people-committee-toast-success')).toHaveCount(0);
  });

  test('non-entitlement sub-row shows a disabled Edit pencil', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();
    await expect(page.getByTestId('org-people-committee-edit-m-tsc')).toBeDisabled();
  });

  test('ArrowDown + Enter on the employee combobox selects the highlighted option (keyboard a11y)', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-edit-m-inc').click();

    const emailInput = page.getByTestId('org-people-committee-modal-edit-email-input');
    await emailInput.fill('toyota.com');
    await emailInput.press('ArrowDown');

    // The first option in the listbox is highlighted; aria-activedescendant on the input points to its id.
    await expect(emailInput).toHaveAttribute('aria-activedescendant', 'edit-committee-employee-option-0');

    await emailInput.press('Enter');

    // Selecting via keyboard fills the email + name fields just like the click handler does.
    await expect(emailInput).toHaveValue(REPLACEMENT_EMAIL);
    await expect(page.getByTestId('org-people-committee-modal-edit-first-name-input')).toHaveValue('Cara');
    await expect(page.getByTestId('org-people-committee-modal-edit-last-name-input')).toHaveValue('Dev');
  });

  test('Cancel closes the Edit modal without firing a PATCH', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);
    await stubEmployees(page);
    let patchCount = 0;
    await stubReassignPatch(page, (route) => {
      patchCount += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reassignedSeatBody('m-inc', 'c-inc', 'INC Software Working Area')),
      });
    });

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();
    await page.getByTestId('org-people-committee-edit-m-inc').click();
    await expect(page.getByTestId('org-people-committee-modal-edit')).toBeVisible();

    await page.getByTestId('org-people-committee-modal-edit-cancel').click();
    await expect(page.getByTestId('org-people-committee-modal-edit')).toHaveCount(0);
    expect(patchCount).toBe(0);
  });
});
