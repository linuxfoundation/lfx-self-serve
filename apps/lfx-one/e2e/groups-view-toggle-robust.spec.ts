// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * My Groups list↔card view toggle — Structural Tests — LFXV2-1715.
 *
 * Companion to `groups-view-toggle.spec.ts`. Asserts the data-testid contract and
 * ARIA attributes for the view toggle, isolated from copy/wording changes.
 */

import type { MyCommittee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-00000000d001';

function buildMyCommittees(): MyCommittee[] {
  const now = new Date().toISOString();
  return [
    {
      uid: MOCK_COMMITTEE_UID,
      name: 'Technical Steering Committee',
      category: 'Technical Steering Committee',
      enable_voting: true,
      public: true,
      sso_group_enabled: false,
      created_at: now,
      updated_at: now,
      total_members: 8,
      total_voting_repos: 8,
      project_uid: 'p0000000-0000-0000-0000-00000000d001',
      project_name: 'Test Project',
      my_role: 'Vice Chair',
    } as MyCommittee,
  ];
}

function buildManyMyCommittees(count: number): MyCommittee[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, i) => ({
    uid: `c0000000-0000-0000-0000-0000000e${String(i).padStart(3, '0')}`,
    name: `Committee ${i}`,
    category: 'Working Group',
    enable_voting: false,
    public: true,
    sso_group_enabled: false,
    created_at: now,
    updated_at: now,
    total_members: i,
    total_voting_repos: 0,
    project_uid: 'p0000000-0000-0000-0000-00000000e001',
    project_name: 'Test Project',
    my_role: 'Member',
  })) as MyCommittee[];
}

async function stubBackend(page: Page, committees: MyCommittee[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
  await page.route('**/api/user/pending-invitations*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.route('**/api/committees/my-committees*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) })
  );
}

async function setPersonaCookie(page: Page, personas: string[]): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' }]);
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

test.describe('My Groups view toggle — Structural Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubBackend(page, buildMyCommittees());
    await gotoMyGroups(page);
    await expect(page.getByTestId('groups-view-toggle')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('toggle buttons are attached with stable testids', async ({ page }) => {
    await expect(page.getByTestId('groups-view-list-btn')).toBeAttached();
    await expect(page.getByTestId('groups-view-card-btn')).toBeAttached();
  });

  test('toggle buttons expose aria-pressed on the native button element', async ({ page }) => {
    await expect(page.getByTestId('groups-view-list-btn').getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('groups-view-card-btn').getByRole('button', { name: 'Card view' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('switching to card view attaches the card-grid root and one card per committee', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId('groups-card-grid')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID}`)).toBeAttached();
  });

  test('cards are real anchors with a working href, not simulated buttons', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    const card = page.getByTestId(`groups-card-grid-item-${MOCK_COMMITTEE_UID}`);
    await expect(card).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    expect(await card.evaluate((el) => el.tagName)).toBe('A');
    await expect(card).toHaveAttribute('href', `/groups/${MOCK_COMMITTEE_UID}`);
    await expect(card).not.toHaveAttribute('role', 'button');
  });

  test('list view stays the default structural root', async ({ page }) => {
    await expect(page.getByTestId('committees-me-table')).toBeAttached();
    await expect(page.getByTestId('groups-card-grid')).toHaveCount(0);
  });
});

test.describe('My Groups card grid — pagination structural tests', () => {
  const TOTAL_COMMITTEES = 15;
  const PAGE_SIZE = 12;

  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubBackend(page, buildManyMyCommittees(TOTAL_COMMITTEES));
    await gotoMyGroups(page);
    await page.getByTestId('groups-view-card-btn').click();
    await expect(page.getByTestId('groups-card-grid')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('caps the initial render at the page size and reveals the rest via Show more', async ({ page }) => {
    const grid = page.getByTestId('groups-card-grid');
    await expect(grid.locator('a')).toHaveCount(PAGE_SIZE);

    const showMore = page.getByTestId('groups-card-grid-show-more');
    await expect(showMore).toBeVisible();

    await showMore.click();

    await expect(grid.locator('a')).toHaveCount(TOTAL_COMMITTEES);
    await expect(showMore).toHaveCount(0);
  });
});
