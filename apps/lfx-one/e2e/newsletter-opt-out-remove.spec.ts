// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Opt-out Remove Action — LFXV2-2766.
 *
 * Editors and Executive Directors can remove individual opt-outs from the opt-out tab,
 * restoring email delivery for that address. This spec locks in the remove flow: the
 * confirmation dialog appears with clear language about the consequence, and the row
 * disappears from the table and shows a success toast on completion.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { LensItem, NewsletterOptOut, NewsletterOptOutListResponse, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000001';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: MOCK_FOUNDATION_UID,
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

const MOCK_OPT_OUTS: NewsletterOptOut[] = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    email: 'alice@example.com',
    unsubscribed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    email: 'bob@example.com',
    unsubscribed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation',
    description: 'Test foundation for newsletter opt-out remove specs',
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

async function stubPersona(page: Page, personas: string[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas, personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
}

async function stubNavLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const requestedLens = new URL(route.request().url()).searchParams.get('lens') ?? 'foundation';
    if (requestedLens !== 'foundation') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_page_token: null, upstream_failed: false, lens: requestedLens }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [MOCK_FOUNDATION_ITEM], next_page_token: null, upstream_failed: false, lens: 'foundation' }),
    });
  });
}

async function stubProjectApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

async function stubOptOutApi(page: Page, optOuts: NewsletterOptOut[], deletedIds?: string[]): Promise<void> {
  const optOutsResponse: NewsletterOptOutListResponse = { opt_outs: optOuts };

  // GET /opt-outs — returns the full list. The DELETE goes to /opt-outs/:optOutId,
  // one segment longer, so it needs its own route pattern below.
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/opt-outs`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(optOutsResponse) });
    }
    return route.fallback();
  });

  // DELETE /opt-outs/:optOutId — 204 only for ids that exist in the mock data,
  // so a lost/mismatched id between the click handler and the delete call fails
  // the test instead of slipping through. Requested ids are recorded so tests
  // can assert exactly which opt-out was targeted.
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/opt-outs/*`, (route) => {
    if (route.request().method() === 'DELETE') {
      const requestedId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      deletedIds?.push(requestedId);
      if (!optOuts.some((optOut) => optOut.id === requestedId)) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'opt-out not found' }) });
      }
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
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

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoOptOutListUrl(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/newsletters/list?project=${MOCK_FOUNDATION_SLUG}&tab=optout`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter opt-out list — Remove action', () => {
  let deletedIds: string[];

  test.beforeEach(async ({ page }) => {
    deletedIds = [];
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
    await stubOptOutApi(page, MOCK_OPT_OUTS, deletedIds);
  });

  test('displays opt-outs with remove buttons; clicking remove shows confirmation dialog', async ({ page }) => {
    await gotoOptOutListUrl(page);

    // Opt-out table should render with both rows visible
    await expect(page.getByTestId('newsletter-optout-table'), 'opt-out table should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-optout-row-alice@example.com'), 'alice row should be visible').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-optout-row-bob@example.com'), 'bob row should be visible').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Remove buttons should be visible
    await expect(page.getByTestId('newsletter-optout-delete-alice@example.com'), 'alice remove button should be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-optout-delete-bob@example.com'), 'bob remove button should be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });

    // Click remove button for alice
    await page.getByTestId('newsletter-optout-delete-alice@example.com').click();

    // Confirmation dialog should appear
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog, 'confirmation dialog should appear').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(confirmDialog, 'dialog should mention email').toContainText('alice@example.com');
    await expect(confirmDialog, 'dialog should mention consequence').toContainText('will start receiving newsletters');
  });

  test('accepting remove confirmation removes the row and shows success toast', async ({ page }) => {
    await gotoOptOutListUrl(page);

    await expect(page.getByTestId('newsletter-optout-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Click remove button for alice
    await page.getByTestId('newsletter-optout-delete-alice@example.com').click();

    // Accept the confirmation
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    const acceptButton = confirmDialog.getByRole('button', { name: /remove/i });
    await acceptButton.click();

    // Row should disappear after deletion
    await expect(page.getByTestId('newsletter-optout-row-alice@example.com'), 'alice row should be removed').not.toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });

    // bob row should still be visible
    await expect(page.getByTestId('newsletter-optout-row-bob@example.com'), 'bob row should still be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });

    // Success toast should appear (PrimeNG toasts render role="alert", so
    // target the .p-toast container like the rest of the suite does)
    await expect(page.locator('.p-toast'), 'success toast should appear').toContainText('Opt-out removed', { timeout: ELEMENT_TIMEOUT });

    // Exactly one DELETE, targeting alice's id — locks the id contract between
    // the click handler and the delete call.
    expect(deletedIds, 'DELETE should target the selected opt-out id').toEqual([MOCK_OPT_OUTS[0].id]);
  });

  test('failed removal keeps the row and shows error toast', async ({ page }) => {
    // Later route registrations take precedence, so this overrides the
    // beforeEach DELETE stub with a server error.
    await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/opt-outs/*`, (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'upstream unavailable' }) });
      }
      return route.fallback();
    });

    await gotoOptOutListUrl(page);

    await expect(page.getByTestId('newsletter-optout-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Click remove button for alice and accept the confirmation
    await page.getByTestId('newsletter-optout-delete-alice@example.com').click();
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await confirmDialog.getByRole('button', { name: /remove/i }).click();

    // Error toast should appear and the row must be retained
    await expect(page.locator('.p-toast'), 'error toast should appear').toContainText('Remove failed', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-optout-row-alice@example.com'), 'alice row should be retained on failure').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('rejecting remove confirmation keeps the row', async ({ page }) => {
    await gotoOptOutListUrl(page);

    await expect(page.getByTestId('newsletter-optout-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Click remove button for alice
    await page.getByTestId('newsletter-optout-delete-alice@example.com').click();

    // Reject the confirmation
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    const rejectButton = confirmDialog.getByRole('button', { name: /cancel/i });
    await rejectButton.click();

    // Dialog should disappear
    await expect(confirmDialog).not.toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Both rows should still be visible
    await expect(page.getByTestId('newsletter-optout-row-alice@example.com'), 'alice row should still be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-optout-row-bob@example.com'), 'bob row should still be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});
