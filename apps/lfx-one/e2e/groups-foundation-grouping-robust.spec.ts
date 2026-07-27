// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * All Groups — foundation tree-grouping — Structural Tests — LFXV2-1715.
 *
 * Companion to `groups-foundation-grouping.spec.ts`. Asserts the data-testid contract
 * and `aria-expanded` state for the group header caret, isolated from copy/wording changes.
 */

import type { Committee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation-robust';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000e001';
const MOCK_COMMITTEE_UID_SUB = 'c0000000-0000-0000-0000-00000000e002';

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation Robust',
    description: 'Test foundation for groups foundation-grouping structural specs',
    public: true,
    parent_uid: '',
    stage: 'Active',
    category: 'project',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: new Date().toISOString(),
    mailing_list_count: 0,
    writer: true,
  };
}

function buildCommittees(): Committee[] {
  const now = new Date().toISOString();
  return [
    {
      uid: MOCK_COMMITTEE_UID_SUB,
      name: 'Alpha Working Group',
      category: 'Working Group',
      enable_voting: false,
      public: true,
      sso_group_enabled: false,
      created_at: now,
      updated_at: now,
      total_members: 6,
      total_voting_repos: 0,
      project_uid: 'p0000000-0000-0000-0000-00000000e003',
      project_name: 'Alpha Project Robust',
      parent_project_uid: MOCK_FOUNDATION_UID,
      is_foundation: false,
    } as Committee,
  ];
}

async function stubBackend(page: Page, committees: Committee[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
  await page.route('**/api/committees/my-committee-uids*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') {
      return route.fallback();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) });
  });
}

async function setCookies(page: Page, personas: string[]): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: 'foundation', domain: 'localhost', path: '/', sameSite: 'Lax' },
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

async function gotoFoundationGroups(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('All Groups foundation grouping — Structural Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setCookies(page, ['executive-director']);
    await stubBackend(page, buildCommittees());
    await gotoFoundationGroups(page);
    await expect(page.getByTestId('groups-foundation-group-alpha-project-robust')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('group wrapper and caret are attached with the documented testid contract', async ({ page }) => {
    await expect(page.getByTestId('groups-foundation-group-alpha-project-robust')).toBeAttached();
    await expect(page.getByTestId('groups-foundation-group-alpha-project-robust-caret')).toBeAttached();
  });

  test('caret aria-expanded starts true (expanded by default) and flips to false on collapse', async ({ page }) => {
    const caret = page.getByTestId('groups-foundation-group-alpha-project-robust-caret');
    await expect(caret).toHaveAttribute('aria-expanded', 'true');

    await caret.click();
    await expect(caret, 'aria-expanded should flip to false after collapsing').toHaveAttribute('aria-expanded', 'false', { timeout: ELEMENT_TIMEOUT });

    await caret.click();
    await expect(caret, 'aria-expanded should flip back to true after re-expanding').toHaveAttribute('aria-expanded', 'true', { timeout: ELEMENT_TIMEOUT });
  });

  test('per-group committee table root is attached while expanded', async ({ page }) => {
    await expect(page.getByTestId('committees-project-table-alpha-project-robust')).toBeAttached();
  });
});
