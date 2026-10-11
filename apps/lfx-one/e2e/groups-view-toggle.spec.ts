// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * My Groups list↔card view toggle — LFXV2-1715.
 *
 * Coverage:
 *   - Filtering/reset and progressive reveal preserve the expected group identities.
 *   - Toggling List↔Card switches the rendered view.
 *   - The last-selected view persists across a page reload (localStorage).
 *   - Search still narrows results in card view.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { MyCommittee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { GROUPS_CARD_GRID_PAGE_SIZE, GROUPS_VIEW_MODE_STORAGE_KEY, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

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

function buildManyMyCommittees(count: number): MyCommittee[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, i) => ({
    uid: `c0000000-0000-0000-0000-0000000f${String(i).padStart(3, '0')}`,
    name: `Committee ${i}`,
    category: 'Working Group',
    enable_voting: false,
    public: true,
    sso_group_enabled: false,
    created_at: now,
    updated_at: now,
    total_members: i,
    total_voting_repos: 0,
    project_uid: 'p0000000-0000-0000-0000-00000000f001',
    project_name: 'Test Project',
    my_role: 'Member',
  })) as MyCommittee[];
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
  await suppressCookieBanner(page);
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  // Ready-state wait: either the toggle (has items) or the zero-groups empty state renders once
  // the page is interactive — asserting this here, once, means individual tests don't need to.
  await expect(page.getByTestId('groups-view-toggle').or(page.getByTestId('groups-card-grid-empty'))).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('My Groups — list↔card view toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubPendingInvitations(page);
    await stubMyCommittees(page, buildMyCommittees());
    await gotoMyGroups(page);
  });

  test('Cards contain long informational chat identifiers without creating links or mobile overflow', async ({ page }) => {
    const identifier = '#' + 'synthetic-channel'.repeat(40);
    const committees = buildMyCommittees();
    committees[0].chat_channel = identifier;
    await stubMyCommittees(page, committees);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 375, height: 850 });
    await page.getByTestId('groups-view-card-btn').click();
    const channels = page.getByTestId(`groups-card-grid-channels-${MOCK_COMMITTEE_UID_A}`);
    await expect(channels).toContainText(identifier);
    await expect(channels.getByRole('link')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await channels.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  });

  test('Board Members can open My Groups through keyboard title navigation', async ({ page }) => {
    await setPersonaCookie(page, ['board-member']);
    await stubPersona(page, ['board-member']);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('groups-view-list-btn').click();
    const title = page.getByTestId('committees-me-table').getByRole('link', { name: 'Technical Steering Committee', exact: true });
    await expect(title).toBeVisible();
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/groups/${MOCK_COMMITTEE_UID_A}(?:[?#]|$)`));
  });

  test('List stacks readable labeled cells on mobile without overflow and retains desktop table rows', async ({ page }) => {
    await page.getByTestId('groups-view-list-btn').click();
    const table = page.getByTestId('committees-me-table');
    const row = table.locator('tbody > tr').first();
    await page.setViewportSize({ width: 375, height: 850 });
    await expect(row).toHaveCSS('display', 'flex');
    await expect(row).toHaveCSS('flex-direction', 'column');
    for (const label of ['Group', 'My Role', 'Type', 'Members', 'Channels', 'Voting', 'Updated', 'Actions']) {
      const cell = row.locator(`td[data-label="${label}"]`);
      await expect(cell).toBeVisible();
      const style = await cell.evaluate((element) => {
        const before = getComputedStyle(element, '::before');
        return { content: before.content, visibility: before.visibility, display: before.display };
      });
      expect(style.content).toBe(`"${label}"`);
      expect(style.visibility).toBe('visible');
      expect(style.display).not.toBe('none');
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 850 });
    await expect(row).toHaveCSS('display', 'table-row');
    await expect(table.locator('thead')).toBeVisible();
    await expect(table.locator('table')).toHaveCSS('display', 'table');
  });

  test('long search chips keep their remove action in the mobile viewport and retain the full query', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    const query = 'unbroken-search-'.repeat(40);
    const search = page.getByTestId('committee-search-input').getByRole('textbox');
    await search.fill(query);
    const remove = page.getByRole('button', { name: `Remove Search: ${query} filter`, exact: true });
    await expect(remove).toBeVisible();
    await expect(search).toHaveValue(query);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await remove.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    await remove.click();
    await expect(search).toHaveValue('');
    await expect(page.getByText('Technical Steering Committee', { exact: true })).toBeVisible();
  });

  test('defaults to list view, and Card switches to the card grid', async ({ page }) => {
    await expect(page.getByTestId('groups-view-toggle'), 'view toggle should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('committees-me-table'), 'list view renders by default').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('groups-view-card-btn').click();

    await expect(page.getByTestId('groups-card-grid'), 'card grid should render after switching to Card').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('committees-me-table')).toHaveCount(0);
  });

  test('aria-pressed on the toggle buttons reflects the active view on the real native button', async ({ page }) => {
    await expect(page.getByTestId('groups-view-toggle')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // getByTestId resolves the <lfx-button> host — descend to the native button PrimeNG renders via
    // its accessible role, since that's the element aria-pressed must land on for assistive tech.
    const listButton = page.getByTestId('groups-view-list-btn').getByRole('button', { name: 'List view' });
    const cardButton = page.getByTestId('groups-view-card-btn').getByRole('button', { name: 'Card view' });

    await expect(listButton, 'list is the active view by default').toHaveAttribute('aria-pressed', 'true');
    await expect(cardButton, 'card is not active by default').toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('groups-view-card-btn').click();

    await expect(listButton, 'list should no longer be pressed after switching to card').toHaveAttribute('aria-pressed', 'false');
    await expect(cardButton, 'card should be pressed after switching to it').toHaveAttribute('aria-pressed', 'true');
  });

  test('the selected view persists across a page reload', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId('groups-card-grid')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('groups-card-grid'), 'card view should still be active after reload').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('committees-me-table')).toHaveCount(0);
  });

  test('search narrows results in card view', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_B}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('committee-search-input').getByRole('textbox').fill('Technical');

    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`), 'matching card should remain').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_B}`), 'non-matching card should be filtered out').toHaveCount(0);
  });

  test('a search matching nothing shows the "no results" empty state, and its reset CTA actually clears the search', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('committee-search-input').getByRole('textbox').fill('no-such-group-xyz');

    await expect(page.getByTestId('groups-card-grid-no-results'), 'no-results empty state should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`)).toHaveCount(0);

    await page.getByTestId('groups-card-grid-no-results').getByRole('button', { name: 'Reset filters' }).click();

    // The reset CTA must clear the search text (not just the behavioral-class chip) — both cards
    // should return once the filter that actually caused the empty state is cleared.
    await expect(page.getByTestId('committee-search-input').getByRole('textbox')).toHaveValue('');
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_A}`), 'cards should return after reset').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID_B}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
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
    await gotoMyGroups(page);
  });

  test('shows the "no groups yet" empty state in card view when the caller has no groups', async ({ page }) => {
    await expect(page.getByTestId('groups-card-grid-empty'), 'empty state should render for a zero-groups caller').toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('committee-search-input'), 'filter bar should not render with zero groups').toHaveCount(0);
  });
});

test.describe('My Groups — card view "Show more" pagination', () => {
  const TOTAL_COMMITTEES = GROUPS_CARD_GRID_PAGE_SIZE + 3;

  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubPendingInvitations(page);
    await stubMyCommittees(page, buildManyMyCommittees(TOTAL_COMMITTEES));
    await gotoMyGroups(page);
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId('groups-card-grid')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('caps the initial page and reveals the remaining groups via Show more', async ({ page }) => {
    const cards = page.getByTestId('groups-card-grid').locator('[data-testid^="groups-card-grid-item-"]');
    await expect(cards).toHaveCount(GROUPS_CARD_GRID_PAGE_SIZE);
    const showMore = page.getByTestId('groups-card-grid-show-more');
    await expect(showMore).toBeVisible();
    await showMore.click();

    await expect(cards).toHaveCount(TOTAL_COMMITTEES);
    await expect(showMore, 'Show more should disappear once every group is revealed').toHaveCount(0);
  });
});
