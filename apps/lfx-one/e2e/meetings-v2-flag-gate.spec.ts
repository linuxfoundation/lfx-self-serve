// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meetings v2 dark-launch gate E2E (#1451).
 *
 * `MEETING_V2_ENABLED_FLAG` is read at every meetings entry point, and every one of them has a unit spec
 * covering both branches. None of those specs renders the flag as a *user* meets it: they provide a
 * `FeatureFlagService` double, so a regression in the real service — a changed key, a default that
 * stops being `false`, an override that stops being read before LaunchDarkly resolves — leaves the
 * whole unit suite green while an untargeted organizer gets the v2 dropdown.
 *
 * This spec pins the busiest entry point through the real service instead: the meetings dashboard's
 * Create Meeting button, which is a navigating link to the pre-v2 create page with the flag off and
 * a dropdown trigger with it on. Both cases assert the shape that is present *and* that the other
 * branch's markup is absent, because the two buttons carry the same `data-testid` on purpose and a
 * presence-only assertion would pass against either one. Since #2873 it also pins the `/meetings/:id`
 * page gate — the only reader an anonymous visitor can reach, and the only one that swaps a whole
 * page rather than a control; its own describe block below carries the details.
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 *
 * The flag needs no LaunchDarkly targeting in either direction — both cases pin it through the
 * `FEATURE_FLAG_OVERRIDE_STORAGE_KEY` localStorage override that {@link stubMeetingsV2Flag} seeds.
 * Pinning is what makes the flag-off case meaningful: an unpinned flag is already `false`, so that
 * test would pass against a button that was never gated.
 */

import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { expect, Locator, Page, Route, test } from '@playwright/test';

import { stubMeetingsV2Flag } from './helpers/meetings-v2-flag.helper';

const PAGE_LOAD_TIMEOUT = 20_000;
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000f001';
const PROJECT_SLUG = 'flag-gate-e2e-project';
const PROJECT_NAME = 'Flag Gate E2E Project';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** The `data-testid` sits on the `lfx-button` host; the rendered element is the anchor or button inside it. */
function createTrigger(page: Page): Locator {
  return page.getByTestId('meeting-create-button');
}

/** `writer: true` is what `ProjectContextService.meetingWriteAccessFor` short-circuits on, and the button is gated on it. */
function buildProjectStub(): Record<string, unknown> {
  return {
    uid: PROJECT_UID,
    slug: PROJECT_SLUG,
    name: PROJECT_NAME,
    description: `${PROJECT_NAME} for the meetings v2 flag gate spec`,
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

async function seedContextCookies(page: Page): Promise<void> {
  const persona: PersistedPersonaState = { primary: 'executive-director' as PersonaType, all: ['executive-director' as PersonaType] };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(persona)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/', sameSite: 'Lax' },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Everything the project lens fetches on its way to rendering the meetings header.
 *
 * The meeting lists are stubbed empty on purpose: this spec asserts the header's create control, and
 * an empty list renders it exactly as a populated one does while keeping the page off the real BFF.
 */
async function stubProjectContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) => fulfillJson(route, buildProjectStub()));
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') {
      return route.fallback();
    }
    return fulfillJson(route, []);
  });
  // Without this the app loads the test account's REAL projects and applyDefaultSelection can
  // override the seeded context mid-test. Including the seeded project preserves the selection.
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = new URL(route.request().url());
    const isFoundation = url.searchParams.get('lens') !== 'project';
    const items = isFoundation ? [] : [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }];
    return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' });
  });
  await page.route('**/api/meetings*', (route) => (route.request().method() === 'GET' ? fulfillJson(route, { data: [] }) : route.fallback()));
  await page.route('**/api/meetings/count*', (route) => fulfillJson(route, { count: 0 }));
  await page.route('**/api/past-meetings*', (route) => fulfillJson(route, { data: [] }));
  await page.route('**/api/past-meetings/count*', (route) => fulfillJson(route, { count: 0 }));
}

/**
 * Boots the app with the flag pinned and lands on the project lens meetings list.
 *
 * Client-side (SPA) navigation rather than `page.goto('/project/meetings')`: a full navigation SSRs
 * the route on the Express server, and server-side fetches bypass `page.route` stubs and hit the
 * real BFF — which would resolve the test account's own projects instead of the seeded one.
 */
async function gotoProjectMeetings(page: Page, flagEnabled: boolean): Promise<void> {
  await stubMeetingsV2Flag(page, flagEnabled);
  await seedContextCookies(page);
  await stubProjectContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  // The '/' boot SSRs with the real backend persona data and can Set-Cookie a real selection,
  // racing the stubbed context — re-assert the intended cookies post-boot.
  await seedContextCookies(page);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, '/project/meetings');

  await expect(createTrigger(page)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Meetings v2 dark-launch gate', () => {
  // Pin a desktop viewport so the boot assertion holds across every Playwright project: the shell's
  // left-nav sidebar is `hidden lg:flex`, so under mobile-chrome (Pixel 5, 393px) it is display:none
  // and `gotoProjectMeetings` would time out waiting for a shell that rendered correctly.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('keeps Create Meeting a link to the pre-v2 create page while the flag is off', async ({ page }) => {
    await gotoProjectMeetings(page, false);

    // An anchor with a real href, not a button: the pre-v2 create page is a route, and middle-click,
    // copy-link and the status bar all worked on this control before v2 and still have to.
    const link = createTrigger(page).locator('a');
    await expect(link).toHaveAttribute('href', '/meetings/create');
    // Nothing in this control announces a popup — the attribute is bound on the v2 branch only.
    await expect(createTrigger(page).locator('[aria-haspopup]')).toHaveCount(0);

    // Absent, not hidden. The trigger above is already visible, so this cannot pass against an
    // unrendered page — and a dropdown mounted but hidden would still be reachable by keyboard.
    await expect(page.locator('lfx-meeting-create-menu')).toHaveCount(0);
    await expect(page.getByTestId('meeting-create-advanced')).toHaveCount(0);
  });

  test('turns the same button into the v2 type picker once the flag is on', async ({ page }) => {
    await gotoProjectMeetings(page, true);

    const trigger = createTrigger(page).locator('button');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    // No href anywhere in the control: this branch opens a panel over the list, and a link here
    // would put a destination in the status bar that the click never goes to.
    await expect(createTrigger(page).locator('a')).toHaveCount(0);

    await trigger.click();

    // The panel is appended to `body`, so it is looked up on the page rather than under the trigger.
    await expect(page.getByTestId('meeting-create-advanced')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });
});

/**
 * The public meeting page's own gate (#2873).
 *
 * `/meetings/:id` is the one flag reader that is a whole page rather than a control, and the only
 * one an anonymous visitor can reach, so the branch it renders is asserted here through the real
 * `FeatureFlagService` for the same reason the create button is.
 *
 * Client-side navigation rather than `page.goto('/meetings/<id>')`: a full navigation SSRs the route
 * on the Express server, server-side fetches bypass `page.route`, and the pre-v2 page redirects to
 * `/meetings/not-found` when the lookup fails — so a full navigation would serve the not-found page
 * for *both* branches and assert nothing. The lookup is stubbed and held open instead of answered,
 * which parks the pre-v2 page on its loading state so the branch marker can be read without racing
 * the redirect that a resolved 404 triggers.
 */
test.describe('Meetings v2 dark-launch gate — /meetings/:id', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const MEETING_UID = 'm0000000-0000-0000-0000-00000000f001';

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  /** Boots the app with the flag pinned, holds the meeting lookup open, and SPA-navigates to the page. */
  async function gotoMeetingDetails(page: Page, flagEnabled: boolean): Promise<() => void> {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await stubMeetingsV2Flag(page, flagEnabled);
    await page.route('**/public/api/meetings/**', async (route) => {
      await held;
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not found' }) });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.evaluate((url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/meetings/${MEETING_UID}`);

    return release;
  }

  test('renders the pre-v2 meeting page while the flag is off', async ({ page }) => {
    const release = await gotoMeetingDetails(page, false);

    await expect(page.getByTestId('meeting-details-gate-v1')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    // Absent, not hidden — a v2 tree mounted alongside v1 would still run its own data flows.
    await expect(page.getByTestId('meeting-details-gate-v2')).toHaveCount(0);

    // Letting the stubbed lookup answer 404 sends the pre-v2 page to its own not-found route, which
    // no other branch does — second proof that this branch is the one that ran.
    release();
    await expect(page).toHaveURL(/\/meetings\/not-found$/, { timeout: PAGE_LOAD_TIMEOUT });
  });

  test('renders the v2 meeting page once the flag is on', async ({ page }) => {
    const release = await gotoMeetingDetails(page, true);

    await expect(page.getByTestId('meeting-details-gate-v2')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('meeting-details-gate-v1')).toHaveCount(0);

    // The pre-v2 page never mounted, so nothing asked for the meeting and releasing the held lookup
    // changes nothing — in particular it does not redirect this branch to not-found.
    release();
    await expect(page).toHaveURL(new RegExp(`/meetings/${MEETING_UID}$`));
  });
});
