// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Reopen Review UX — Structural Tests — LFXV2-2131.
 *
 * Companion to `newsletter-reopen-review.spec.ts`. Asserts the data-testid
 * contract for the Review screen and the round-trip into the stepper, isolated
 * from copy / wording changes that the content spec exercises.
 *
 * Why this exists: per `docs/architecture/testing/e2e-testing.md`, every feature
 * with E2E coverage gets a content spec AND a structural (`-robust`) spec. The
 * structural spec is the regression net for refactors that move DOM around but
 * keep testid semantics stable.
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
    description: 'Test foundation for newsletter reopen review structural specs',
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

function buildDraft(): Newsletter {
  return {
    id: MOCK_NEWSLETTER_ID,
    project_uid: MOCK_FOUNDATION_UID,
    subject: 'Welcome to KubeCon Recap',
    body_html: '<p>Recap body.</p>',
    ed_reply_email: 'ed@example.com',
    committee_uids: [MOCK_COMMITTEE_UID],
    status: 'draft',
    total_recipients: 0,
    created_by: 'test-user',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
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

async function stubBackend(page: Page, draft: Newsletter): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );

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

  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));

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
      body: JSON.stringify([{ uid: MOCK_COMMITTEE_UID, name: 'Community Newsletter', category: 'Newsletter' }]),
    })
  );
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

async function gotoReview(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/newsletters/${MOCK_FOUNDATION_UID}/${MOCK_NEWSLETTER_ID}/edit?project=${MOCK_FOUNDATION_SLUG}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter Reopen Review — Structural Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubBackend(page, buildDraft());
    await gotoReview(page);
    await expect(page.getByTestId('newsletter-review')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test.describe('Review root + header', () => {
    test('renders the review root', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review')).toBeAttached();
      await expect(page.getByTestId('newsletter-manage-title')).toBeAttached();
    });

    test('renders the draft tag, subject, and (optional) saved indicator', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-draft-tag')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-subject')).toBeAttached();
      // savedLabel is null on fresh load (autosave hasn't fired) — assert the testid is conditional, not required.
      await expect(page.getByTestId('newsletter-review-saved-indicator')).toHaveCount(0);
    });
  });

  test.describe('Section cards', () => {
    test('renders all three section cards with edit affordances', async ({ page }) => {
      for (const section of ['audience', 'content', 'send']) {
        await expect(page.getByTestId(`newsletter-review-${section}-card`), `${section} card should be attached`).toBeAttached();
        await expect(page.getByTestId(`newsletter-review-${section}-edit-btn`), `${section} edit button should be attached`).toBeAttached();
      }
    });

    test('renders the audience summary when committees are populated', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-audience-summary')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-audience-empty')).toHaveCount(0);
    });

    test('renders the content subject and preview when body is populated', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-content-subject')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-content-preview')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-preview-btn')).toBeAttached();
    });

    test('renders the send card actions (test + send-now)', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-send-summary')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-send-test-btn')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-send-now-btn')).toBeAttached();
    });

    test('renders the delete affordance', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-delete-btn')).toBeAttached();
    });
  });

  test.describe('Stepper round-trip', () => {
    test('Edit on Audience attaches the stepper and back-to-review hook', async ({ page }) => {
      await page.getByTestId('newsletter-review-audience-edit-btn').click();
      await expect(page.getByTestId('newsletter-manage-stepper')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId('newsletter-manage-back-to-review')).toBeAttached();
    });
  });

  test.describe('ConfirmDialog hook', () => {
    test('confirm dialog mount point stays attached so review-screen Delete can trigger it', async ({ page }) => {
      // p-confirmDialog is rendered outside the showReview branch; that's the contract the delete flow relies on.
      await expect(page.locator('p-confirmdialog')).toBeAttached();
    });
  });
});

test.describe('Newsletter list — Draft tag testid (structural)', () => {
  test('draft row exposes the newsletter-status-draft-<id> testid', async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubBackend(page, buildDraft());
    skipWhenAuthMissing();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await page.goto(`/foundation/newsletters/list?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-status-draft-${MOCK_NEWSLETTER_ID}`)).toBeAttached();
  });
});
