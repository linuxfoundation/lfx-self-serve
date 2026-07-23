// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Reopen Review UX — LFXV2-2131.
 *
 * Customer feedback: reopening a saved newsletter dropped the user straight into the
 * 3-step creation wizard, with no signal that the draft was already saved. This spec
 * locks in the Review landing screen for edit mode and the round-trip into the stepper
 * via the per-section "Edit" affordances.
 *
 * Coverage:
 *   - Reopen a saved draft → Review screen renders (Draft tag, subject, three cards).
 *   - Clicking "Edit" on Audience switches to the stepper at step 1.
 *   - Clicking "Back to review" returns to the Review screen with form state intact.
 *   - The list view shows a Draft tag for non-sent rows (parity with the existing Sent tag).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { LensItem, Newsletter, NewsletterListResponse, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000001';
const MOCK_NEWSLETTER_ID = 'n0000000-0000-0000-0000-000000000aaa';
const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-000000000bbb';
const MOCK_INELIGIBLE_COMMITTEE_UID = 'c0000000-0000-0000-0000-000000000ccc';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: MOCK_FOUNDATION_UID,
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation',
    description: 'Test foundation for newsletter reopen review specs',
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

function buildDraft(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    id: MOCK_NEWSLETTER_ID,
    project_uid: MOCK_FOUNDATION_UID,
    subject: 'Welcome to KubeCon Recap',
    body_html: '<p>Thanks for joining us in Chicago this week. Here is a quick recap of the highlights.</p>',
    ed_reply_email: 'ed@example.com',
    committee_uids: [MOCK_COMMITTEE_UID],
    status: 'draft',
    total_recipients: 0,
    created_by: 'test-user',
    version: 1,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
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

async function stubNewsletterApis(
  page: Page,
  draft: Newsletter,
  committees: { uid: string; name: string; category: string }[] = [{ uid: MOCK_COMMITTEE_UID, name: 'Community Newsletter', category: 'Newsletter' }]
): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
    }
    return route.fallback();
  });

  const listResponse: NewsletterListResponse = { newsletters: [{ ...draft }], next_page_token: undefined };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname.endsWith('/newsletters')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listResponse) });
    }
    return route.fallback();
  });

  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/recipient-count`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 42 }) })
  );

  await page.route(`**/api/committees*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(committees),
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

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions
// (expired storageState, broken Auth0 login helper) still fail loudly when creds
// ARE configured. URL-based detection silently turned those into green skips.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoEditUrl(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/newsletters/${MOCK_FOUNDATION_UID}/${MOCK_NEWSLETTER_ID}/edit?project=${MOCK_FOUNDATION_SLUG}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter reopen — Review landing screen', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
    await stubNewsletterApis(page, buildDraft());
  });

  test('lands on the Review screen with draft summary cards', async ({ page }) => {
    await gotoEditUrl(page);

    await expect(page.getByTestId('newsletter-review'), 'review screen should render on reopen').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-draft-tag'), 'Draft tag should appear in the review header').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-subject'), 'review header should show the saved subject').toContainText('Welcome to KubeCon Recap');

    await expect(page.getByTestId('newsletter-review-audience-card'), 'audience card should be visible').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-content-card'), 'content card should be visible').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-send-card'), 'send card should be visible').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Stepper must be hidden on the review landing — that's the whole point of the change.
    await expect(page.getByTestId('newsletter-manage-stepper'), 'stepper should be hidden on the review landing').toHaveCount(0);
  });

  test('Edit on Audience switches to the stepper at step 1; Back to review restores the summary', async ({ page }) => {
    await gotoEditUrl(page);

    await expect(page.getByTestId('newsletter-review'), 'review screen should render before editing').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('newsletter-review-audience-edit-btn').click();

    await expect(page.getByTestId('newsletter-manage-stepper'), 'stepper should mount after clicking Edit on Audience').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-review'), 'review should hide once inside the stepper').toHaveCount(0);
    await expect(page).toHaveURL(/[?&]step=1\b/);

    await page.getByTestId('newsletter-manage-back-to-review').click();

    await expect(page.getByTestId('newsletter-review'), 'review should return after Back to review').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-subject'), 'subject should still match the saved draft').toContainText('Welcome to KubeCon Recap');
    await expect(page).toHaveURL(/[?&]view=review\b/);
  });
});

test.describe('Newsletter reopen — empty-state coverage', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('audience empty-state copy renders when the draft has no committees selected', async ({ page }) => {
    await stubNewsletterApis(page, buildDraft({ committee_uids: [] }));
    await gotoEditUrl(page);

    await expect(page.getByTestId('newsletter-review'), 'review screen should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-audience-empty'), 'audience empty-state copy should appear').toContainText('No groups selected yet');
    // The summary line should NOT render when the empty-state branch is active.
    await expect(page.getByTestId('newsletter-review-audience-summary')).toHaveCount(0);
  });

  test('content incomplete-state copy renders when subject and body are both blank', async ({ page }) => {
    await stubNewsletterApis(page, buildDraft({ subject: '', body_html: '' }));
    await gotoEditUrl(page);

    await expect(page.getByTestId('newsletter-review'), 'review screen should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-content-incomplete'), 'content incomplete copy should appear for blank subject + body').toContainText(
      'Add a subject and body'
    );
    // Untitled draft placeholder for the header subject.
    await expect(page.getByTestId('newsletter-review-subject'), 'header should fall back to Untitled draft').toContainText('Untitled draft');
  });

  test('content incomplete-state distinguishes blank subject vs blank body', async ({ page }) => {
    await stubNewsletterApis(page, buildDraft({ subject: '' }));
    await gotoEditUrl(page);

    await expect(page.getByTestId('newsletter-review-content-incomplete'), 'subject-only blank copy should call out the subject').toContainText(
      'Add a subject before sending'
    );
  });
});

test.describe('Newsletter reopen — audience normalization with mixed committee eligibility', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('a saved ineligible committee UID is pruned from the audience and does not count toward recipients', async ({ page }) => {
    await stubNewsletterApis(page, buildDraft({ committee_uids: [MOCK_COMMITTEE_UID, MOCK_INELIGIBLE_COMMITTEE_UID] }), [
      { uid: MOCK_COMMITTEE_UID, name: 'Community Newsletter', category: 'Newsletter' },
      { uid: MOCK_INELIGIBLE_COMMITTEE_UID, name: 'Legal Committee', category: 'Legal' },
    ]);
    await gotoEditUrl(page);

    await expect(page.getByTestId('newsletter-review'), 'review screen should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // The draft was saved with 2 committee_uids, but only 1 is Newsletter-eligible —
    // normalization must prune the ineligible one before the audience is ever sent,
    // otherwise a stale non-Newsletter uid could be delivered to on a later Send.
    await expect(page.getByTestId('newsletter-review-audience-summary'), 'audience summary should only count the eligible group').toContainText('1 group');
  });
});

test.describe('Newsletter list — Draft tag parity', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
    await stubNewsletterApis(page, buildDraft());
  });

  test('draft rows show a Draft tag mirroring the existing Sent tag', async ({ page }) => {
    skipWhenAuthMissing();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await page.goto(`/foundation/newsletters/list?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('newsletter-list-table'), 'draft list table should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-status-draft-${MOCK_NEWSLETTER_ID}`), 'Draft tag should appear on the draft row').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});
