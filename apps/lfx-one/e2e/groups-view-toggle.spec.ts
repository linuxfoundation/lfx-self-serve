// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * My Groups list↔card view toggle — LFXV2-1715.
 *
 * Coverage:
 *   - Card grid renders role badge / member count / relative "last updated" per card.
 *   - Toggling List↔Card switches the rendered view.
 *   - The last-selected view persists across a page reload (localStorage).
 *   - Search still narrows results in card view.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { MyCommittee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { GROUPS_VIEW_MODE_STORAGE_KEY, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_COMMITTEE_UID_A = 'c0000000-0000-0000-0000-00000000a001';
const MOCK_COMMITTEE_UID_B = 'c0000000-0000-0000-0000-00000000a002';

function buildMyCommittees(): MyCommittee[] {
  return [
    {
      uid: MOCK_COMMITTEE_UID_A,
      name: 'Technical Steering Committee',
      category: 'Technical Steering Committee',
      enable_voting: true,
      public: true,
      sso_group_enabled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      total_members: 12,
      total_voting_repos: 5,
      project_uid: 'p0000000-0000-0000-0000-000000000001',
      project_name: 'Test Project',
      my_role: 'Chair',
    } as MyCommittee,
    {
      uid: MOCK_COMMITTEE_UID_B,
      name: 'Marketing Committee',
      category: 'Marketing Committee/Sub Committee',
      enable_voting: false,
      public: true,
      sso_group_enabled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_members: 4,
      total_voting_repos: 0,
      project_uid: 'p0000000-0000-0000-0000-000000000001',
      project_name: 'Test Project',
      my_role: 'Member',
    } as MyCommittee,
  ];
}

async function stubPersona(page: Page, personas: string[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas, personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
}

async function stubPendingInvitations(page: Page): Promise<void> {
  await page.route('**/api/user/pending-invitations*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
}

async function stubMyCommittees(page: Page, committees: MyCommittee[]): Promise<void> {
  await page.route('**/api/committees/my-committees*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) })
  );
}

async function setPersonaCookie(page: Page, personas: string[]): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify(state)),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions
// (expired storageState, broken Auth0 login helper) still fail loudly when creds
// ARE configured. URL-based detection silently turned those into green skips.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoMyGroups(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('My Groups — list↔card view toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubPendingInvitations(page);
    await stubMyCommittees(page, buildMyCommittees());
  });

  test('defaults to list view, and Card switches to the card grid', async ({ page }) => {
    await gotoMyGroups(page);

    await expect(page.getByTestId('groups-view-toggle'), 'view toggle should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('committees-me-table'), 'list view renders by default').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('groups-view-card-btn').click();

    await expect(page.getByTestId('groups-card-grid'), 'card grid should render after switching to Card').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('committees-me-table')).toHaveCount(0);
  });

  test('aria-pressed on the toggle buttons reflects the active view on the real native button', async ({ page }) => {
    await gotoMyGroups(page);
    await expect(page.getByTestId('groups-view-toggle')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // getByTestId resolves the <lfx-button> host — descend to the native button PrimeNG renders via
    // its accessible role, since that's the element aria-pressed must land on for assistive tech.
    const listButton = page.getByTestId('groups-view-list-btn').getByRole('button');
    const cardButton = page.getByTestId('groups-view-card-btn').getByRole('button');

    await expect(listButton, 'list is the active view by default').toHaveAttribute('aria-pressed', 'true');
    await expect(cardButton, 'card is not active by default').toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('groups-view-card-btn').click();

    await expect(listButton, 'list should no longer be pressed after switching to card').toHaveAttribute('aria-pressed', 'false');
    await expect(cardButton, 'card should be pressed after switching to it').toHaveAttribute('aria-pressed', 'true');
  });

  test('card grid shows role badge, member count, and relative last-updated text per card', async ({ page }) => {
    await gotoMyGroups(page);
    await page.getByTestId('groups-view-card-btn').click();

    const card = page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`);
    await expect(card, 'card for the seeded committee should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(card, 'card should show the caller role').toContainText('Chair');
    await expect(card, 'card should show the member count').toContainText('12');
    await expect(card, 'card should show a relative last-updated label').toContainText(/hr ago|min ago|just now/);
  });

  test('the selected view persists across a page reload', async ({ page }) => {
    await gotoMyGroups(page);
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId('groups-card-grid')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('groups-card-grid'), 'card view should still be active after reload').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('committees-me-table')).toHaveCount(0);
  });

  test('search narrows results in card view', async ({ page }) => {
    await gotoMyGroups(page);
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_B}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('committee-search-input').locator('input').fill('Technical');

    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`), 'matching card should remain').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_B}`), 'non-matching card should be filtered out').toHaveCount(0);
  });

  test('a search matching nothing shows the "no results" empty state with a reset CTA', async ({ page }) => {
    await gotoMyGroups(page);
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('committee-search-input').locator('input').fill('no-such-group-xyz');

    await expect(page.getByTestId('groups-card-grid-no-results'), 'no-results empty state should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`)).toHaveCount(0);
  });
});

test.describe('My Groups — card view empty state (no groups at all)', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubPendingInvitations(page);
    await stubMyCommittees(page, []);
    // The view toggle only renders once there's something to toggle (items or loading) — with a
    // zero-groups stub it can unmount before a post-navigation click reaches it. Seed the persisted
    // view mode directly instead of racing the toggle.
    await page.addInitScript((key) => localStorage.setItem(key, 'card'), GROUPS_VIEW_MODE_STORAGE_KEY);
  });

  test('shows the "no groups yet" empty state in card view when the caller has no groups', async ({ page }) => {
    await gotoMyGroups(page);

    await expect(page.getByTestId('groups-card-grid-empty'), 'empty state should render for a zero-groups caller').toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT,
    });
  });
});
