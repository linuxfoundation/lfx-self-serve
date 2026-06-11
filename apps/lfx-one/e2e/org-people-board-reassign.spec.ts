// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** People → Board tab reassign E2E (bulk reassign modal + single-edit modal). Deterministic via route mocks. */

import { expect, Page, Route, test } from '@playwright/test';

const PEOPLE_BOARD_URL = '/org/people?tab=board';
const DATA_LOAD_TIMEOUT = 30_000;
const TOAST_TIMEOUT = 10_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = 'Toyota';
const MOCK_ACCOUNT_SLUG = 'toyota';

const MASAKI_EMAIL = 'masaki.isetani@toyota.com';
const KENSUKE_EMAIL = 'kensuke.hanaoka@toyota.com';
const REPLACEMENT_EMAIL = 'cara.dev@toyota.com';

const MASAKI = { email: MASAKI_EMAIL, firstName: 'Masaki', lastName: 'Isetani', fullName: 'Masaki Isetani', jobTitle: 'Senior Manager', initials: 'MI' };
const KENSUKE = { email: KENSUKE_EMAIL, firstName: 'Kensuke', lastName: 'Hanaoka', fullName: 'Kensuke Hanaoka', jobTitle: 'Engineer', initials: 'KH' };

function masakiSeat(uid: string, foundationName: string, foundationSlug: string, projectUid: string, votingStatus: string) {
  return {
    seatId: uid,
    memberUid: uid,
    committeeUid: `c-${uid}`,
    committeeName: 'Steering Committee',
    committeeCategory: 'Board',
    projectUid,
    foundationSlug,
    foundationName,
    role: '',
    votingStatus,
    appointedBy: 'Membership Entitlement',
    isOrgEditable: true,
    reason: null,
    person: MASAKI,
  };
}

function boardMembersResponse() {
  return {
    orgUid: MOCK_UID,
    assignments: [
      masakiSeat('m-masaki-agl', 'Automotive Grade Linux', 'automotive-grade-linux', 'agl-root', 'Voting'),
      masakiSeat('m-masaki-hl', 'Hyperledger Foundation', 'hyperledger-foundation', 'hl-root', 'Non-voting'),
      {
        seatId: 'm-kensuke',
        memberUid: 'm-kensuke',
        committeeUid: 'c-kensuke',
        committeeName: 'Steering Committee',
        committeeCategory: 'Board',
        projectUid: 'agl-root',
        foundationSlug: 'automotive-grade-linux',
        foundationName: 'Automotive Grade Linux',
        role: '',
        votingStatus: 'Non-voting',
        appointedBy: 'Board Election',
        isOrgEditable: false,
        reason: "This seat is held by foundation election or appointment, not by your organization's membership entitlement.",
        person: KENSUKE,
      },
    ],
    stats: { totalBoardMembers: 2, votingCount: 1, nonVotingCount: 2, foundationsCovered: 2 },
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
        username: 'e2e-org-people-board-reassign',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubBoardMembers(page: Page, body: unknown = boardMembersResponse()): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/board-members$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function stubEmployees(page: Page, employees: unknown[] = MOCK_EMPLOYEES, status = 200): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/employees$/, (route) => {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ orgUid: MOCK_UID, employees }) });
  });
}

/** Stubs the PATCH board reassign proxy; the handler decides what to return per request. */
async function stubReassignPatch(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/board-members\/[^/]+\/reassign$/, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await handler(route);
  });
}

function reassignedSeatBody(seatId: string) {
  return {
    orgUid: MOCK_UID,
    seat: {
      ...masakiSeat(seatId, 'Automotive Grade Linux', 'automotive-grade-linux', 'agl-root', 'Voting'),
      person: { email: REPLACEMENT_EMAIL, firstName: 'Cara', lastName: 'Dev', fullName: 'Cara Dev', jobTitle: null, initials: 'CD' },
    },
  };
}

async function gotoBoardTab(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PEOPLE_BOARD_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  if (!page.url().includes('/org/people')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/people redirected away');
  }
  await expect(page.getByTestId('org-people-panel-board')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.setTimeout(120_000);

test.describe('Org People → Board — Reassign Board Roles modal (US3)', () => {
  test('opens with the expected anatomy and reflects the fixture counts', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();

    const modal = page.getByTestId('org-people-board-modal-reassign');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('org-people-board-modal-reassign-title')).toHaveText('Reassign Board Roles');
    await expect(page.getByTestId('org-people-board-modal-reassign-subtitle')).toHaveText('2 roles across 2 foundations');
    await expect(modal.locator('[data-testid^="org-people-board-modal-reassign-role-row-"]')).toHaveCount(2);
    await expect(page.getByTestId('org-people-board-modal-reassign-primary-button')).toContainText('Save Changes (2 roles)');
  });

  test('deselecting a role updates the Save button count', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-modal-reassign-role-checkbox-m-masaki-hl').click();
    await expect(page.getByTestId('org-people-board-modal-reassign-primary-button')).toContainText('Save Changes (1 role)');
  });

  test('Save is disabled until Email / First / Last are filled', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();
    await expect(page.getByTestId('org-people-board-modal-reassign-primary-button')).toBeDisabled();
  });

  test('valid Save fans out N PATCHes and refreshes', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);
    let patchCount = 0;
    await stubReassignPatch(page, (route) => {
      patchCount += 1;
      const url = route.request().url();
      const seatId = url.split('/board-members/')[1].split('/reassign')[0];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reassignedSeatBody(seatId)) });
    });

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-modal-reassign-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-board-modal-reassign-first-name-input').fill('Cara');
    await page.getByTestId('org-people-board-modal-reassign-last-name-input').fill('Dev');
    await page.getByTestId('org-people-board-modal-reassign-primary-button').click();

    await expect(page.getByTestId('org-people-board-toast-success')).toBeVisible({ timeout: TOAST_TIMEOUT });
    expect(patchCount).toBe(2);
  });

  test('a 409 on one PATCH closes the modal and surfaces a partial-success warning toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);
    await stubReassignPatch(page, (route) => {
      const url = route.request().url();
      if (url.includes('/m-masaki-hl/')) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'seat changed since you opened the dialog' } }),
        });
      }
      const seatId = url.split('/board-members/')[1].split('/reassign')[0];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reassignedSeatBody(seatId)) });
    });

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-modal-reassign-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-board-modal-reassign-first-name-input').fill('Cara');
    await page.getByTestId('org-people-board-modal-reassign-last-name-input').fill('Dev');
    await page.getByTestId('org-people-board-modal-reassign-primary-button').click();

    await expect(page.getByTestId('org-people-board-modal-reassign')).toHaveCount(0, { timeout: TOAST_TIMEOUT });
    await expect(page.getByTestId('org-people-board-toast-success')).toContainText('succeeded', { timeout: TOAST_TIMEOUT });
  });

  test('all PATCHes failing surfaces the cleaned error and keeps the modal open', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);
    await stubReassignPatch(page, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Reassignment failed — please retry.' } }) })
    );

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-modal-reassign-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-board-modal-reassign-first-name-input').fill('Cara');
    await page.getByTestId('org-people-board-modal-reassign-last-name-input').fill('Dev');
    await page.getByTestId('org-people-board-modal-reassign-primary-button').click();

    await expect(page.getByTestId('org-people-board-modal-reassign-save-error')).toBeVisible();
    await expect(page.getByTestId('org-people-board-modal-reassign')).toBeVisible();
    await expect(page.getByTestId('org-people-board-toast-success')).toHaveCount(0);
  });
});

test.describe('Org People → Board — Edit Board Role modal (US4)', () => {
  test('opens scoped to one seat with the chip header + current member', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-edit-m-masaki-agl').click();

    const modal = page.getByTestId('org-people-board-modal-edit');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('org-people-board-modal-edit-title')).toHaveText('Edit Board Role');
    await expect(page.getByTestId('org-people-board-modal-edit-chips')).toContainText('Automotive Grade Linux');
    await expect(page.getByTestId('org-people-board-modal-edit-current')).toContainText('Masaki Isetani');
  });

  test('Save fires exactly one PATCH and shows a success toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);
    let patchCount = 0;
    await stubReassignPatch(page, (route) => {
      patchCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reassignedSeatBody('m-masaki-agl')) });
    });

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-edit-m-masaki-agl').click();
    await page.getByTestId('org-people-board-modal-edit-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-board-modal-edit-first-name-input').fill('Cara');
    await page.getByTestId('org-people-board-modal-edit-last-name-input').fill('Dev');
    await page.getByTestId('org-people-board-modal-edit-primary-button').click();

    await expect(page.getByTestId('org-people-board-toast-success')).toBeVisible({ timeout: TOAST_TIMEOUT });
    expect(patchCount).toBe(1);
  });

  test('a 5xx save keeps the Edit modal open with an inline error and no success toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);
    await stubReassignPatch(page, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Reassignment failed — please retry.' } }) })
    );

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-edit-m-masaki-agl').click();
    await page.getByTestId('org-people-board-modal-edit-email-input').fill(REPLACEMENT_EMAIL);
    await page.getByTestId('org-people-board-modal-edit-first-name-input').fill('Cara');
    await page.getByTestId('org-people-board-modal-edit-last-name-input').fill('Dev');
    await page.getByTestId('org-people-board-modal-edit-primary-button').click();

    await expect(page.getByTestId('org-people-board-modal-edit-save-error')).toBeVisible();
    await expect(page.getByTestId('org-people-board-modal-edit')).toBeVisible();
    await expect(page.getByTestId('org-people-board-toast-success')).toHaveCount(0);
  });

  test('foundation-controlled sub-row shows "Why can\'t I edit?" instead of an Edit pencil', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${KENSUKE_EMAIL}`).click();
    await expect(page.getByTestId('org-people-board-why-m-kensuke')).toBeVisible();
    await expect(page.getByTestId('org-people-board-edit-m-kensuke')).toHaveCount(0);
  });

  test('ArrowDown + Enter on the employee combobox selects the highlighted option (keyboard a11y)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-edit-m-masaki-agl').click();

    const emailInput = page.getByTestId('org-people-board-modal-edit-email-input');
    await emailInput.fill('toyota.com');
    await emailInput.press('ArrowDown');

    // The first option in the listbox is highlighted; aria-activedescendant on the input points to its id.
    await expect(emailInput).toHaveAttribute('aria-activedescendant', 'edit-board-employee-option-0');

    await emailInput.press('Enter');

    // Selecting via keyboard fills the email + name fields just like the click handler does.
    await expect(emailInput).toHaveValue(REPLACEMENT_EMAIL);
    await expect(page.getByTestId('org-people-board-modal-edit-first-name-input')).toHaveValue('Cara');
    await expect(page.getByTestId('org-people-board-modal-edit-last-name-input')).toHaveValue('Dev');
  });

  test('ArrowDown + Enter on the bulk Reassign combobox selects the highlighted option (keyboard a11y)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-reassign-${MASAKI_EMAIL}`).click();

    const emailInput = page.getByTestId('org-people-board-modal-reassign-email-input');
    await emailInput.fill('toyota.com');
    await emailInput.press('ArrowDown');
    await expect(emailInput).toHaveAttribute('aria-activedescendant', 'reassign-board-employee-option-0');

    await emailInput.press('Enter');
    await expect(emailInput).toHaveValue(REPLACEMENT_EMAIL);
    await expect(page.getByTestId('org-people-board-modal-reassign-first-name-input')).toHaveValue('Cara');
    await expect(page.getByTestId('org-people-board-modal-reassign-last-name-input')).toHaveValue('Dev');
  });

  test('Cancel closes the Edit modal without firing a PATCH', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    await stubEmployees(page);
    let patchCount = 0;
    await stubReassignPatch(page, (route) => {
      patchCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reassignedSeatBody('m-masaki-agl')) });
    });

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`).click();
    await page.getByTestId('org-people-board-edit-m-masaki-agl').click();
    await expect(page.getByTestId('org-people-board-modal-edit')).toBeVisible();

    await page.getByTestId('org-people-board-modal-edit-cancel').click();
    await expect(page.getByTestId('org-people-board-modal-edit')).toHaveCount(0);
    expect(patchCount).toBe(0);
  });
});
