// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter scheduled sends — Structural Tests — LFXV2-2685.
 *
 * Companion to `newsletter-schedule.spec.ts`. Asserts the data-testid contract
 * for the schedule panel (review screen) and the Scheduled tab (list screen),
 * isolated from copy / wording changes that the content spec exercises.
 *
 * Why this exists: per `docs/architecture/testing/e2e-testing.md`, every
 * feature with E2E coverage gets a content spec AND a structural (`-robust`)
 * spec. The structural spec is the regression net for refactors that move DOM
 * around but keep testid semantics stable.
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
    description: 'Test foundation for newsletter schedule structural specs',
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

async function stubNewsletterApis(page: Page, draft: Newsletter): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}`, (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
    }
    if (method === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...draft, version: draft.version + 1 }) });
    }
    return route.fallback();
  });

  const listResponse: NewsletterListResponse = { newsletters: [{ ...draft }], next_page_token: undefined };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname.endsWith('/newsletters')) {
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

async function stubScheduledTabApis(page: Page, scheduled: Newsletter[], arming: Newsletter[] = []): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || !url.pathname.endsWith('/newsletters')) {
      return route.fallback();
    }
    const status = url.searchParams.get('status');
    const newsletters = status === 'scheduled' ? scheduled : status === 'sending' ? arming : [];
    const body: NewsletterListResponse = { newsletters, next_page_token: undefined };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/recipient-count`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 42 }) })
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
// still fail loudly when creds ARE configured. URL-based detection silently
// turned those into green skips.
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

async function gotoListUrl(page: Page, tab?: 'draft' | 'scheduled' | 'sent'): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  const tabParam = tab ? `&tab=${tab}` : '';
  await page.goto(`/foundation/newsletters/list?project=${MOCK_FOUNDATION_SLUG}${tabParam}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter schedule — review screen structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test.describe('sendMode: now — schedule panel is present but not armed', () => {
    test.beforeEach(async ({ page }) => {
      await stubNewsletterApis(page, buildDraft());
      await gotoEditUrl(page);
      await expect(page.getByTestId('newsletter-review')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    });

    test('renders the schedule mode radio cards and both send-card actions', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-schedule-mode-now')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-schedule-mode-schedule')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-send-test-btn')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-send-now-btn')).toBeAttached();
    });

    test('does not render the schedule submit button or readonly banner in send-now mode', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-schedule-submit-btn')).toHaveCount(0);
      await expect(page.getByTestId('newsletter-review-schedule-readonly-banner')).toHaveCount(0);
    });
  });

  test.describe('sendMode: schedule — hydrated from a draft with scheduled_at', () => {
    test.beforeEach(async ({ page }) => {
      const scheduledAt = new Date(Date.now() + 45 * 60_000).toISOString();
      await stubNewsletterApis(page, buildDraft({ scheduled_at: scheduledAt }));
      await gotoEditUrl(page);
      await expect(page.getByTestId('newsletter-review')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    });

    test('renders the schedule panel, date/time controls, and submit button', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-schedule-panel')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-schedule-date')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-schedule-time')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-schedule-submit-btn')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    });

    test('renders the schedule summary and omits the window-error testid for a valid time', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-schedule-summary')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId('newsletter-review-schedule-window-error')).toHaveCount(0);
    });

    test('does not render the read-only banner while the draft is still editable', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-schedule-readonly-banner')).toHaveCount(0);
      await expect(page.getByTestId('newsletter-review-cancel-schedule-btn')).toHaveCount(0);
    });
  });

  test.describe('window-error testid — present for out-of-window times', () => {
    test('renders newsletter-review-schedule-window-error for a tooSoon time', async ({ page }) => {
      const tooSoon = new Date(Date.now() + 10 * 60_000).toISOString();
      await stubNewsletterApis(page, buildDraft({ scheduled_at: tooSoon }));
      await gotoEditUrl(page);
      await expect(page.getByTestId('newsletter-review')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

      await expect(page.getByTestId('newsletter-review-schedule-window-error')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    });
  });

  test.describe('read-only banner — armed (status: scheduled) newsletter opened via deep-link', () => {
    test.beforeEach(async ({ page }) => {
      const scheduledAt = new Date(Date.now() + 45 * 60_000).toISOString();
      await stubNewsletterApis(page, buildDraft({ status: 'scheduled', scheduled_at: scheduledAt, version: 2 }));
      await gotoEditUrl(page);
      await expect(page.getByTestId('newsletter-review')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    });

    test('renders the readonly banner and cancel-schedule button, not the schedule submit button', async ({ page }) => {
      await expect(page.getByTestId('newsletter-review-schedule-readonly-banner')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId('newsletter-review-cancel-schedule-btn')).toBeAttached();
      await expect(page.getByTestId('newsletter-review-schedule-submit-btn')).toHaveCount(0);
    });
  });
});

test.describe('Newsletter schedule — list screen structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('renders the fourth Scheduled status tab', async ({ page }) => {
    await stubNewsletterApis(page, buildDraft());
    await stubScheduledTabApis(page, []);
    await gotoListUrl(page);

    await expect(page.getByTestId('newsletter-status-tabs')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('filter-pill-scheduled')).toBeAttached();
  });

  test('a scheduled row exposes the scheduled status tag and cancel-schedule action', async ({ page }) => {
    const scheduled = buildDraft({ status: 'scheduled', scheduled_at: new Date(Date.now() + 45 * 60_000).toISOString(), version: 2 });
    await stubNewsletterApis(page, scheduled);
    await stubScheduledTabApis(page, [scheduled]);
    await gotoListUrl(page, 'scheduled');

    await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-status-scheduled-${MOCK_NEWSLETTER_ID}`)).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`newsletter-cancel-schedule-${MOCK_NEWSLETTER_ID}`)).toBeAttached();
  });

  test('an arming row exposes the scheduling status tag and omits the cancel-schedule action', async ({ page }) => {
    const arming = buildDraft({ status: 'sending', scheduled_at: new Date(Date.now() + 20_000).toISOString(), group_id: 'g1' });
    await stubNewsletterApis(page, arming);
    await stubScheduledTabApis(page, [], [arming]);
    await gotoListUrl(page, 'scheduled');

    await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-status-scheduling-${MOCK_NEWSLETTER_ID}`)).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`newsletter-cancel-schedule-${MOCK_NEWSLETTER_ID}`)).toHaveCount(0);
  });
});
