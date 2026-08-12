// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter scheduled sends — LFXV2-2685.
 *
 * Locks in the schedule/cancel-schedule UI end to end: arming a saved draft,
 * the two UI-enforced window guards (tooSoon/tooFar), the 503
 * environment-unavailable path, cancelling an armed schedule (including the
 * SendGrid cancel-window-closed and settlement-race cases), and the list's
 * arming-row visibility (must show on Scheduled, never on Sent).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type {
  LensItem,
  Newsletter,
  NewsletterCancelScheduleResult,
  NewsletterListResponse,
  NewsletterScheduleResult,
  PersistedPersonaState,
  PersonaType,
} from '@lfx-one/shared/interfaces';
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
    description: 'Test foundation for newsletter schedule specs',
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

/**
 * Registers the shared draft/committee/recipient-count routes plus the two
 * schedule endpoints. `scheduleHandler`/`cancelHandler` let each test control
 * the arm/cancel response (success or a specific error status/upstreamCode)
 * without re-declaring the whole route set.
 */
async function stubNewsletterApis(
  page: Page,
  draft: Newsletter,
  options: {
    scheduleHandler?: (route: import('@playwright/test').Route) => Promise<void> | void;
    cancelHandler?: (route: import('@playwright/test').Route) => Promise<void> | void;
  } = {}
): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}/schedule`, (route) => {
    if (options.scheduleHandler) return options.scheduleHandler(route);
    return route.fallback();
  });
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}/cancel-schedule`, (route) => {
    if (options.cancelHandler) return options.cancelHandler(route);
    return route.fallback();
  });

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

/**
 * Registers the Scheduled-tab list routes: `status=scheduled` for the armed,
 * paginated rows and `status=sending` for arms-in-progress (prepended
 * client-side, not paginated). Also stubs `status=sent` so the Sent-tab
 * exclusion test can flip tabs without hitting the fallback 404.
 */
async function stubScheduledTabApis(page: Page, scheduled: Newsletter[], arming: Newsletter[] = [], sent: Newsletter[] = []): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || !url.pathname.endsWith('/newsletters')) {
      return route.fallback();
    }
    const status = url.searchParams.get('status');
    const newsletters = status === 'scheduled' ? scheduled : status === 'sending' ? arming : status === 'sent' ? sent : [];
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
// still fail loudly when creds ARE configured. See newsletter-reopen-review.spec.ts.
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

test.describe('Newsletter schedule — arm from the review screen', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('arming a valid schedule lands on the list with the Scheduled tab selected', async ({ page }) => {
    const scheduledAt = new Date(Date.now() + 45 * 60_000).toISOString();
    const draft = buildDraft({ scheduled_at: scheduledAt });

    await stubNewsletterApis(page, draft, {
      scheduleHandler: (route) => {
        const result: NewsletterScheduleResult = {
          newsletter: { ...draft, status: 'sending', group_id: 'g1' },
          group_id: 'g1',
          scheduled_at: scheduledAt,
          total_recipients: 42,
          sent: 0,
          failed: 0,
        };
        return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(result) });
      },
    });
    await stubScheduledTabApis(page, [{ ...draft, status: 'scheduled' }]);

    await gotoEditUrl(page);
    await expect(page.getByTestId('newsletter-review'), 'review screen should render with schedule mode already selected').toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-review-schedule-submit-btn'), 'Schedule button should be enabled for a valid future time').toBeEnabled({
      timeout: ELEMENT_TIMEOUT,
    });

    await page.getByTestId('newsletter-review-schedule-submit-btn').click();
    await page.getByRole('button', { name: 'Schedule' }).click();

    await expect(page).toHaveURL(/newsletters\/list/, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/tab=scheduled/);
  });

  test('a time inside the minimum lead disables Schedule with the tooSoon message', async ({ page }) => {
    const tooSoon = new Date(Date.now() + 10 * 60_000).toISOString();
    const draft = buildDraft({ scheduled_at: tooSoon });
    await stubNewsletterApis(page, draft);

    await gotoEditUrl(page);
    await expect(page.getByTestId('newsletter-review'), 'review screen should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('newsletter-review-schedule-window-error'), 'tooSoon guidance should be shown').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-schedule-submit-btn'), 'Schedule button should be disabled inside the minimum lead').toBeDisabled();
  });

  test('a time beyond the 72-hour horizon disables Schedule with the tooFar message', async ({ page }) => {
    const tooFar = new Date(Date.now() + 80 * 60 * 60_000).toISOString();
    const draft = buildDraft({ scheduled_at: tooFar });
    await stubNewsletterApis(page, draft);

    await gotoEditUrl(page);
    await expect(page.getByTestId('newsletter-review'), 'review screen should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('newsletter-review-schedule-window-error'), 'tooFar guidance should be shown').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-review-schedule-submit-btn'), 'Schedule button should be disabled beyond the maximum horizon').toBeDisabled();
  });

  test('a 503 from the schedule endpoint shows the environment-unavailable copy', async ({ page }) => {
    const scheduledAt = new Date(Date.now() + 45 * 60_000).toISOString();
    const draft = buildDraft({ scheduled_at: scheduledAt });

    await stubNewsletterApis(page, draft, {
      scheduleHandler: (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'provider_unavailable' }) }),
    });

    await gotoEditUrl(page);
    await expect(page.getByTestId('newsletter-review'), 'review screen should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('newsletter-review-schedule-submit-btn').click();
    await page.getByRole('button', { name: 'Schedule' }).click();

    await expect(page.getByText("Scheduling isn't available in this environment. Use Send now instead.")).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    // Must stay on the review screen — a 503 is not a reason to navigate away.
    await expect(page.getByTestId('newsletter-review')).toBeVisible();
  });

  test('a deep-linked ?step= on a scheduled newsletter still lands on review, not the stepper', async ({ page }) => {
    const scheduledAt = new Date(Date.now() + 45 * 60_000).toISOString();
    const scheduled = buildDraft({ status: 'scheduled', scheduled_at: scheduledAt, version: 2 });
    await stubNewsletterApis(page, scheduled);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await page.goto(`/foundation/newsletters/${MOCK_FOUNDATION_UID}/${MOCK_NEWSLETTER_ID}/edit?project=${MOCK_FOUNDATION_SLUG}&step=2`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // isScheduleReadOnly() must win over the bookmarked step param — otherwise a
    // direct link to the stepper would bypass the read-only lock on an armed schedule.
    await expect(page.getByTestId('newsletter-review'), 'a scheduled newsletter must render review even with ?step=2').toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-manage-stepper')).not.toBeVisible();
  });
});

test.describe('Newsletter schedule — list screen cancel action', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('cancelling an armed schedule returns the row to Drafts', async ({ page }) => {
    const scheduledAt = new Date(Date.now() + 45 * 60_000).toISOString();
    const scheduled = buildDraft({ status: 'scheduled', scheduled_at: scheduledAt, version: 2 });

    await stubNewsletterApis(page, scheduled, {
      cancelHandler: (route) => {
        const result: NewsletterCancelScheduleResult = { newsletter: { ...scheduled, status: 'draft', version: 3, group_id: undefined } };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      },
    });
    await stubScheduledTabApis(page, [scheduled]);

    await gotoListUrl(page, 'scheduled');
    await expect(page.getByTestId('newsletter-list-table'), 'scheduled list should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-status-scheduled-${MOCK_NEWSLETTER_ID}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId(`newsletter-cancel-schedule-${MOCK_NEWSLETTER_ID}`).click();
    await page.getByRole('button', { name: 'Cancel schedule' }).click();

    await expect(page.getByText('Schedule cancelled')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(`newsletter-row-${MOCK_NEWSLETTER_ID}`), 'row should be spliced out of the Scheduled tab on success').toHaveCount(0);
  });

  test('cancel_window_closed keeps the row and shows the too-late-to-cancel copy', async ({ page }) => {
    const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const scheduled = buildDraft({ status: 'scheduled', scheduled_at: scheduledAt, version: 2 });

    await stubNewsletterApis(page, scheduled, {
      // The BFF's error serializer maps the upstream discriminating code into
      // `upstreamCode` (see microservice.error.ts) — the component branches on
      // that field, not the raw upstream `{ error: '<code>' }` shape.
      cancelHandler: (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Too close to the send time to cancel.', code: 'CONFLICT', upstreamCode: 'cancel_window_closed' }),
        }),
    });
    await stubScheduledTabApis(page, [scheduled]);

    await gotoListUrl(page, 'scheduled');
    await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`newsletter-cancel-schedule-${MOCK_NEWSLETTER_ID}`).click();
    await page.getByRole('button', { name: 'Cancel schedule' }).click();

    await expect(page.getByText('Too close to the send time to cancel. This newsletter will go out as scheduled.')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    // The row must stay put — this is not the same outcome as a successful cancel.
    await expect(page.getByTestId(`newsletter-row-${MOCK_NEWSLETTER_ID}`)).toBeVisible();
  });

  test('a 412 on cancel (the settlement race) renders the already-sent copy, not a generic sync error', async ({ page }) => {
    const scheduledAt = new Date(Date.now() - 1 * 60_000).toISOString(); // just settled
    const scheduled = buildDraft({ status: 'scheduled', scheduled_at: scheduledAt, version: 2 });

    await stubNewsletterApis(
      page,
      { ...scheduled, status: 'sent', version: 3 },
      {
        cancelHandler: (route) => route.fulfill({ status: 412, contentType: 'application/json', body: JSON.stringify({ error: 'version_mismatch' }) }),
      }
    );
    await stubScheduledTabApis(page, [scheduled]);

    await gotoListUrl(page, 'scheduled');
    await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`newsletter-cancel-schedule-${MOCK_NEWSLETTER_ID}`).click();
    await page.getByRole('button', { name: 'Cancel schedule' }).click();

    // Must be the settlement-race message, distinct from cancel_window_closed and
    // from a generic "out of sync" conflict message.
    await expect(page.getByText('This newsletter has already been sent.')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByText('Too close to the send time to cancel.')).toHaveCount(0);
  });
});

test.describe('Newsletter schedule — arming rows are visible on Scheduled and hidden from Sent', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('an arming (sending + scheduled_at) row shows on the Scheduled tab as "Scheduling…"', async ({ page }) => {
    const arming = buildDraft({ status: 'sending', scheduled_at: new Date(Date.now() + 20_000).toISOString(), group_id: 'g1' });
    await stubNewsletterApis(page, arming);
    await stubScheduledTabApis(page, [], [arming]);

    await gotoListUrl(page, 'scheduled');
    await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-status-scheduling-${MOCK_NEWSLETTER_ID}`), 'arming row should render as Scheduling…').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    // No cancel action while arming — the row hasn't settled to `scheduled` yet.
    await expect(page.getByTestId(`newsletter-cancel-schedule-${MOCK_NEWSLETTER_ID}`)).toHaveCount(0);
  });

  test('the same arming row does not appear on the Sent tab', async ({ page }) => {
    const arming = buildDraft({ status: 'sending', scheduled_at: new Date(Date.now() + 20_000).toISOString(), group_id: 'g1' });
    await stubNewsletterApis(page, arming);
    // Upstream's status=sent filter matches sending rows too — the arming row
    // would show here if the client-side exclusion in initLoadOnContextOrTab
    // regressed.
    await stubScheduledTabApis(page, [], [], [arming]);

    await gotoListUrl(page, 'sent');
    await expect(page.getByTestId('newsletter-status-tabs')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`newsletter-row-${MOCK_NEWSLETTER_ID}`), 'arming row must be excluded from the Sent tab').toHaveCount(0);
  });
});
