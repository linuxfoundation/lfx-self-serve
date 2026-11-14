// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * My Groups title navigation and reverse view transitions — LFXV2-1715.
 * Companion to groups-view-toggle.spec.ts; avoids duplicate filter/persistence/pagination checks.
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

test.describe('My Groups title navigation and reverse transitions', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubBackend(page, buildMyCommittees());
    await gotoMyGroups(page);
    await expect(page.getByTestId('groups-view-toggle')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('the title link opens the group detail', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    const title = page.getByTestId(`groups-card-grid-title-${MOCK_COMMITTEE_UID}`);
    await expect(title).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await title.click();
    await expect(page).toHaveURL(new RegExp(`/groups/${MOCK_COMMITTEE_UID}(?:[?#]|$)`));
  });

  test('keyboard activation returns from Cards to List and updates native pressed state', async ({ page }) => {
    await page.getByTestId('groups-view-card-btn').click();
    const listButton = page.getByRole('button', { name: 'List view', exact: true });
    await listButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('committees-me-table')).toBeVisible();
    await expect(page.getByTestId('groups-card-grid')).toHaveCount(0);
    await expect(listButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Card view', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });
});
