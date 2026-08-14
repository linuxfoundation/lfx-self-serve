// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * My Newsletters (Me lens) — LFXV2-2912.
 *
 * Members see the sent newsletters whose recipient committees include a
 * committee they currently belong to. The BFF derives the feed from live
 * committee membership (leaving a group hides its newsletters; joining
 * reveals past ones), so the UI just renders the flat list: title, received
 * date, project/foundation, client-side search + filters, and a reader
 * drawer that fetches the rendered body on demand.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { MyNewsletter, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;

const PROJECT_UID = 'p0000000-0000-0000-0000-000000000001';
const FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000002';

const MOCK_NEWSLETTERS: MyNewsletter[] = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    project_uid: PROJECT_UID,
    subject: 'TAC July Update',
    sent_at: '2026-07-15T12:00:00Z',
    project_name: 'Test Project',
    project_slug: 'test-project',
    is_foundation: false,
    parent_project_uid: FOUNDATION_UID,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    project_uid: FOUNDATION_UID,
    subject: 'Board Quarterly Digest',
    sent_at: '2026-06-20T12:00:00Z',
    project_name: 'Test Foundation',
    project_slug: 'test-foundation',
    is_foundation: true,
    parent_project_uid: '',
  },
];

const MOCK_BODY_HTML = '<p data-e2e="newsletter-body-marker">Hello committee members, here is the July update.</p>';

async function stubPersona(page: Page, personas: string[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas, personaProjects: {}, projects: [], organizations: [], isRootWriter: false }),
    })
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

async function stubMyNewslettersApi(page: Page, newsletters: MyNewsletter[]): Promise<void> {
  await page.route('**/api/newsletters/my-newsletters', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(newsletters) })
  );
}

// The preview drawer fetches the full newsletter (incl. body_html) via the
// project-scoped get when a row is clicked.
async function stubNewsletterDetailApi(page: Page): Promise<void> {
  await page.route('**/api/projects/*/newsletters/*', (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const pathname = new URL(route.request().url()).pathname;
    const newsletterUid = pathname.split('/').pop() ?? '';
    const match = MOCK_NEWSLETTERS.find((n) => n.id === newsletterUid);
    if (!match) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'newsletter not found' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...match,
        body_html: MOCK_BODY_HTML,
        ed_reply_email: 'ed@example.com',
        status: 'sent',
        total_recipients: 12,
        created_by: 'sender',
        version: 1,
        created_at: '2026-07-01T12:00:00Z',
        updated_at: match.sent_at,
      }),
    });
  });
}

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoMyNewsletters(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/newsletters/my', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('my-newsletters-title')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

test.describe('My Newsletters — Me-lens feed', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubMyNewslettersApi(page, MOCK_NEWSLETTERS);
    await stubNewsletterDetailApi(page);
  });

  test('lists sent newsletters with title, received date, and project name', async ({ page }) => {
    await gotoMyNewsletters(page);

    // Reader-framed column headers (not the sender-side Subject / Sent).
    const table = page.getByTestId('my-newsletters-table');
    await expect(table.locator('th').nth(0)).toHaveText('Title');
    await expect(table.locator('th').nth(1)).toHaveText('Received');

    const firstRow = page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`);
    await expect(firstRow).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(firstRow).toContainText('TAC July Update');
    await expect(firstRow).toContainText('Jul 15, 2026');
    await expect(firstRow).toContainText('Test Project');

    const secondRow = page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[1].id}`);
    await expect(secondRow).toContainText('Board Quarterly Digest');
    await expect(secondRow).toContainText('Test Foundation');
  });

  test('search filters the list by subject', async ({ page }) => {
    await gotoMyNewsletters(page);

    await page.getByTestId('my-newsletters-search-input').locator('input').fill('Quarterly');

    await expect(page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[1].id}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`)).toHaveCount(0);
  });

  test('clicking a newsletter opens the reader drawer with the rendered body', async ({ page }) => {
    await gotoMyNewsletters(page);

    await page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`).click();

    const drawer = page.getByTestId('my-newsletters-preview-drawer');
    await expect(drawer.locator('[data-e2e="newsletter-body-marker"]')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(drawer).toContainText('TAC July Update');

    // Reader-framed drawer header: project + received date, no sender-side
    // "Preview / As your recipients will see it" text.
    const drawerHeader = page.getByTestId('newsletter-preview-drawer-header');
    await expect(drawerHeader).toContainText('Test Project');
    await expect(drawerHeader).toContainText('Received Jul 15, 2026');
    await expect(drawerHeader).not.toContainText('Preview');
  });

  test('shows the empty state when the user has no reachable newsletters', async ({ page }) => {
    await stubMyNewslettersApi(page, []);
    await gotoMyNewsletters(page);

    await expect(page.getByTestId('my-newsletters-empty-state')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('my-newsletters-empty-state')).toContainText('No newsletters yet');
  });

  test('opening newsletter updates URL with query params (?issue=...&project=...)', async ({ page }) => {
    await gotoMyNewsletters(page);

    await page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`).click();

    // URL should include query params
    await expect(page).toHaveURL(/\?issue=.*&project=.*/);
    const url = page.url();
    expect(url).toContain(`issue=${MOCK_NEWSLETTERS[0].id}`);
  });

  test('closing drawer clears query params', async ({ page }) => {
    await gotoMyNewsletters(page);

    // Open drawer
    await page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`).click();
    await expect(page).toHaveURL(/\?issue=.*&project=.*/);

    // Close drawer
    await page.getByTestId('newsletter-preview-drawer-close').click();

    // URL should be clean (both drawer params removed)
    const url = page.url();
    expect(url).not.toContain('issue=');
    expect(url).not.toContain('project=');
  });

  test('direct navigation with query params auto-opens the drawer', async ({ page }) => {
    await gotoMyNewsletters(page);

    const issueId = MOCK_NEWSLETTERS[0].id;
    const projectSlug = MOCK_NEWSLETTERS[0].project_slug || 'test-project';

    // Navigate directly with query params
    await page.goto(`/newsletters/my?issue=${issueId}&project=${projectSlug}`, { waitUntil: 'domcontentloaded' });

    // Drawer should be open with the newsletter content
    const drawer = page.getByTestId('my-newsletters-preview-drawer');
    await expect(drawer.locator('[data-e2e="newsletter-body-marker"]')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('share button in drawer copies the canonical permalink URL', async ({ page }) => {
    await gotoMyNewsletters(page);

    await page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`).click();

    // Click the copy-link button
    await page.getByTestId('newsletter-preview-drawer-copy-link').click();

    // Success toast appears
    await expect(page.getByText('Link Copied')).toBeVisible();
  });

  test('subject renders as a real link to the canonical permalink', async ({ page }) => {
    await gotoMyNewsletters(page);

    const subjectLink = page.getByTestId(`my-newsletters-open-${MOCK_NEWSLETTERS[0].id}`);
    await expect(subjectLink).toHaveAttribute('href', `/newsletters/${MOCK_NEWSLETTERS[0].project_slug}/${MOCK_NEWSLETTERS[0].id}`);
  });

  test('new-tab button in drawer header opens the permalink in a new tab', async ({ page, context }) => {
    await gotoMyNewsletters(page);

    await page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`).click();
    const drawer = page.getByTestId('my-newsletters-preview-drawer');
    await expect(drawer.locator('[data-e2e="newsletter-body-marker"]')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    const newTabButton = page.getByTestId('newsletter-preview-drawer-open-new-tab');
    await expect(newTabButton).toHaveAttribute('target', '_blank');
    await expect(newTabButton).toHaveAttribute('rel', /noopener/);
    await expect(newTabButton).toHaveAttribute('href', `/newsletters/${MOCK_NEWSLETTERS[0].project_slug}/${MOCK_NEWSLETTERS[0].id}`);

    const [newPage] = await Promise.all([context.waitForEvent('page'), newTabButton.click()]);
    await expect(newPage).toHaveURL(new RegExp(`/newsletters/${MOCK_NEWSLETTERS[0].project_slug}/${MOCK_NEWSLETTERS[0].id}`));

    // Original tab's drawer stays open — the new tab is a separate context.
    await expect(drawer).toBeVisible();
  });
});
