// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * My Newsletters (Me lens) — LFXV2-2912, reworked by #3483.
 *
 * Members see the sent newsletters whose recipient committees include a
 * committee they currently belong to. The BFF derives the feed from live
 * committee membership (leaving a group hides its newsletters; joining
 * reveals past ones). `/newsletters/my` shows one card per foundation;
 * `/newsletters/my/:foundationSlug` lists that foundation's issues (title,
 * sent date, project, client-side search + project filter); a newsletter opens
 * on its reader permalink page (#4979, which retired the reader drawer). Both
 * read the one GET /api/newsletters/my-foundations response.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { MyNewsletter, MyNewsletterFoundation, MyNewsletterFoundationsResponse, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;

const PROJECT_UID = 'p0000000-0000-0000-0000-000000000001';
const FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000002';
const FOUNDATION_SLUG = 'test-foundation';
const OTHER_FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000003';

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
    parent_project_name: 'Test Foundation',
    parent_is_foundation: true,
    foundation_uid: FOUNDATION_UID,
    foundation_slug: FOUNDATION_SLUG,
    foundation_name: 'Test Foundation',
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
    foundation_uid: FOUNDATION_UID,
    foundation_slug: FOUNDATION_SLUG,
    foundation_name: 'Test Foundation',
  },
];

const MOCK_FOUNDATIONS: MyNewsletterFoundation[] = [
  {
    uid: FOUNDATION_UID,
    slug: FOUNDATION_SLUG,
    name: 'Test Foundation',
    logo_url: null,
    received_count: 2,
    last_sent_at: '2026-07-15T12:00:00Z',
    newsletter_group: { uid: 'g0000000-0000-0000-0000-000000000004', name: 'Test Foundation Newsletter' },
    can_invite: true,
    membership_name: 'The Linux Foundation',
  },
  {
    uid: OTHER_FOUNDATION_UID,
    slug: 'other-foundation',
    name: 'Other Foundation',
    logo_url: null,
    received_count: 1,
    last_sent_at: '2026-05-10T12:00:00Z',
    newsletter_group: null,
    can_invite: false,
    membership_name: null,
    invite_denied_reason: 'no_newsletter_group',
  },
];

function foundationsResponse(newsletters: MyNewsletter[], foundations: MyNewsletterFoundation[] = MOCK_FOUNDATIONS): MyNewsletterFoundationsResponse {
  return { foundations, newsletters, complete: true, inviter: { eligible: true, company_name: 'Acme Motors' } };
}

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

async function stubMyNewsletterFoundationsApi(page: Page, response: MyNewsletterFoundationsResponse): Promise<void> {
  await page.route(/\/api\/newsletters\/my-foundations(?:\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  );
}

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoMyNewsletterFoundations(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/newsletters/my', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('my-newsletters-title')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

async function gotoMyNewsletters(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto(`/newsletters/my/${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('my-newsletters-title')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

test.describe('My Newsletters — foundation cards', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubMyNewsletterFoundationsApi(page, foundationsResponse(MOCK_NEWSLETTERS));
  });

  test('shows one card per foundation with its received count and drill-down link', async ({ page }) => {
    await gotoMyNewsletterFoundations(page);

    const grid = page.getByTestId('my-newsletters-foundation-grid');
    await expect(grid).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    const cards = grid.getByTestId('newsletter-foundation-card');
    await expect(cards).toHaveCount(2);

    const first = cards.nth(0);
    await expect(first.getByTestId('newsletter-foundation-card-name')).toHaveText('Test Foundation');
    await expect(first.getByTestId('newsletter-foundation-card-count')).toContainText('2 newsletters received');
    await expect(first.getByTestId('newsletter-foundation-card-view-all')).toHaveAttribute('href', `/newsletters/my/${FOUNDATION_SLUG}`);
    await expect(first.getByTestId('newsletter-foundation-card-invite').locator('button')).toBeEnabled();

    const second = cards.nth(1);
    await expect(second.getByTestId('newsletter-foundation-card-count')).toContainText('1 newsletter received');
    await expect(second.getByTestId('newsletter-foundation-card-invite').locator('button')).toBeDisabled();
  });

  test("a card opens that foundation's newsletters", async ({ page }) => {
    await gotoMyNewsletterFoundations(page);

    await page.getByTestId('newsletter-foundation-card-body').first().click();

    await expect(page).toHaveURL(new RegExp(`/newsletters/my/${FOUNDATION_SLUG}$`));
    await expect(page.getByTestId('my-newsletters-title')).toHaveText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('Invite opens the invite dialog for that foundation', async ({ page }) => {
    await gotoMyNewsletterFoundations(page);

    await page.getByTestId('newsletter-foundation-card-invite').first().locator('button').click();

    const dialog = page.getByTestId('newsletter-invite-dialog');
    await expect(dialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(dialog).toContainText('Test Foundation newsletter');
  });

  test('shows the empty state when the user receives no newsletters', async ({ page }) => {
    await stubMyNewsletterFoundationsApi(page, foundationsResponse([], []));
    await gotoMyNewsletterFoundations(page);

    await expect(page.getByTestId('my-newsletters-empty-state')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('my-newsletters-empty-state')).toContainText('No newsletters yet');
    await expect(page.getByTestId('my-newsletters-foundation-grid')).toHaveCount(0);
  });
});

test.describe('My Newsletters — foundation drill-down', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['contributor']);
    await stubPersona(page, ['contributor']);
    await stubMyNewsletterFoundationsApi(page, foundationsResponse(MOCK_NEWSLETTERS));
  });

  test('heads the page with the foundation, a breadcrumb back to the cards, and Invite', async ({ page }) => {
    await gotoMyNewsletters(page);

    await expect(page.getByTestId('my-newsletters-title')).toHaveText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('my-newsletters-back')).toHaveAttribute('href', '/newsletters/my');
    await expect(page.getByTestId('my-newsletters-breadcrumb-current')).toHaveText('Test Foundation');
    await expect(page.getByTestId('my-newsletters-invite')).toBeVisible();
  });

  test("lists only the route foundation's newsletters", async ({ page }) => {
    const otherNewsletter: MyNewsletter = {
      id: 'd0000000-0000-0000-0000-000000000004',
      project_uid: OTHER_FOUNDATION_UID,
      subject: 'Other Foundation Digest',
      sent_at: '2026-05-10T12:00:00Z',
      project_name: 'Other Foundation',
      project_slug: 'other-foundation',
      is_foundation: true,
      foundation_uid: OTHER_FOUNDATION_UID,
      foundation_slug: 'other-foundation',
      foundation_name: 'Other Foundation',
    };
    await stubMyNewsletterFoundationsApi(page, foundationsResponse([...MOCK_NEWSLETTERS, otherNewsletter]));
    await gotoMyNewsletters(page);

    await expect(page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`my-newsletters-row-${otherNewsletter.id}`)).toHaveCount(0);
  });

  test('lists sent newsletters with title, sent date, and project name', async ({ page }) => {
    await gotoMyNewsletters(page);

    // Reader-framed Title column and the issue's Sent date (sent_at).
    const table = page.getByTestId('my-newsletters-table');
    await expect(table.locator('th').nth(0)).toHaveText('Title');
    await expect(table.locator('th').nth(1)).toHaveText('Sent');

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

  test('clicking a newsletter opens its reader page, with no drawer (#4979)', async ({ page }) => {
    await gotoMyNewsletters(page);

    await page.getByTestId(`my-newsletters-row-${MOCK_NEWSLETTERS[0].id}`).click();

    await expect(page).toHaveURL(new RegExp(`/newsletters/${MOCK_NEWSLETTERS[0].project_slug}/${MOCK_NEWSLETTERS[0].id}$`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('my-newsletters-preview-drawer')).toHaveCount(0);
  });

  test('shows the empty state when the foundation has no reachable newsletters', async ({ page }) => {
    await stubMyNewsletterFoundationsApi(page, foundationsResponse([]));
    await gotoMyNewsletters(page);

    await expect(page.getByTestId('my-newsletters-empty-state')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('my-newsletters-empty-state')).toContainText('No newsletters yet');
    await expect(page.getByTestId('my-newsletters-empty-state')).toContainText('Issues you receive from this foundation will appear here.');
  });

  test('a legacy ?issue=&project= drawer link redirects to the reader page', async ({ page }) => {
    skipWhenAuthMissing();
    const issueId = MOCK_NEWSLETTERS[0].id;
    const projectSlug = MOCK_NEWSLETTERS[0].project_slug ?? 'test-project';

    await page.goto(`/newsletters/my/${FOUNDATION_SLUG}?issue=${issueId}&project=${projectSlug}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/newsletters/${projectSlug}/${issueId}$`), { timeout: ELEMENT_TIMEOUT });
  });

  test('subject renders as a real link to the canonical permalink', async ({ page }) => {
    await gotoMyNewsletters(page);

    const subjectLink = page.getByTestId(`my-newsletters-open-${MOCK_NEWSLETTERS[0].id}`);
    await expect(subjectLink).toHaveAttribute('href', `/newsletters/${MOCK_NEWSLETTERS[0].project_slug}/${MOCK_NEWSLETTERS[0].id}`);
  });

  test('subject without a resolved project_slug shows as plain text that opens nothing', async ({ page }) => {
    // project_slug is an enrichment field that can fail to resolve upstream; with no permalink
    // there is no reader page to open, so the subject is plain text and the row stays put.
    const newsletterWithoutSlug: MyNewsletter = {
      id: 'c0000000-0000-0000-0000-000000000003',
      project_uid: PROJECT_UID,
      subject: 'Untitled Project Update',
      sent_at: '2026-05-01T12:00:00Z',
      project_name: 'Test Project',
      is_foundation: false,
      parent_project_uid: FOUNDATION_UID,
      parent_project_name: 'Test Foundation',
      parent_is_foundation: true,
      foundation_uid: FOUNDATION_UID,
    };
    await stubMyNewsletterFoundationsApi(page, foundationsResponse([newsletterWithoutSlug]));
    await gotoMyNewsletters(page);

    const subject = page.getByTestId(`my-newsletters-open-${newsletterWithoutSlug.id}`);
    await expect(subject).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(subject).not.toHaveAttribute('href');
    await page.getByTestId(`my-newsletters-row-${newsletterWithoutSlug.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/newsletters/my/${FOUNDATION_SLUG}$`));
  });
});
