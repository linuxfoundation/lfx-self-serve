// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Structural companion to vote-permalink.spec.ts (#3659): `/votes/:id` renders the vote detail page.
 * Boots the real My Votes shell, then uses SPA navigation so the permalink's synthetic
 * API requests are intercepted in the browser rather than bypassing stubs during SSR.
 */
import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());
test.describe.configure({ timeout: 60_000 });

const RENDER_TIMEOUT = 30_000;
const PROJECT_UID = '00000000-0000-4000-8000-000000003658';
const PROJECT_SLUG = 'vote-structure-e2e-project';
const VOTE_UID = '00000000-0000-4000-8000-000000003659';
const VOTE = {
  uid: VOTE_UID,
  name: 'Synthetic Charter Vote',
  description: '<p>Review the synthetic charter.</p>',
  status: 'active',
  response_status: 'awaiting_response',
  project_uid: PROJECT_UID,
  project_slug: PROJECT_SLUG,
  project_name: 'Synthetic Vote Project',
  poll_type: 'generic',
  creation_time: '2099-05-01T00:00:00Z',
  end_time: '2099-06-01T18:00:00Z',
};

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function bootMyVotes(page: Page): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: 'localhost', path: '/', sameSite: 'Lax' }]);
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
  );
  await page.route('**/api/nav/lens-items*', (route) => fulfillJson(route, { items: [], next_page_token: null, upstream_failed: false, lens: 'me' }));
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route(/\/api\/votes(\/count)?(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (new URL(route.request().url()).pathname === '/api/votes/count') return fulfillJson(route, { count: 0 });
    return fulfillJson(route, { data: [], total: 0, page_size: 0, next_page_token: null });
  });
  await page.route('**/api/votes/my-votes*', (route) => fulfillJson(route, [VOTE]));
  await page.route(`**/api/votes/${VOTE_UID}/my-response`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route(`**/api/projects/${PROJECT_SLUG}`, (route) =>
    fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: VOTE.project_name, writer: false })
  );
  // Do not SSR /votes: its real transfer-cache response would bypass page.route fixtures.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: RENDER_TIMEOUT });
  await page.evaluate(() => {
    window.history.pushState({}, '', '/votes');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId(`votes-more-${VOTE_UID}`)).toBeVisible({ timeout: RENDER_TIMEOUT });
}

async function navigateToPermalink(page: Page): Promise<void> {
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/votes/${VOTE_UID}`);
}

test.describe('Vote permalink structure (#3659)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('preserves the row action-menu contract without opening the vote', async ({ page }) => {
    await bootMyVotes(page);
    const more = page.getByTestId(`votes-more-${VOTE_UID}`);
    await expect(more.locator('button')).toHaveAttribute('aria-label', 'More actions');
    await more.locator('button').click();

    await expect(page.getByTestId('votes-row-action-menu')).toBeAttached();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`/votes/${VOTE_UID}`));
  });

  test('preserves skeleton, error, retry and view-only panel test IDs on the vote page', async ({ page }) => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => (release = resolve));
    let attempts = 0;
    await page.route(`**/api/votes/${VOTE_UID}`, async (route) => {
      if (attempts++ === 0) {
        await pending;
        return route.fulfill({ status: 503, body: '{}' });
      }
      return fulfillJson(route, VOTE);
    });
    await bootMyVotes(page);
    await navigateToPermalink(page);

    try {
      const root = page.getByTestId('vote-detail');
      const loading = root.getByTestId('vote-detail-loading');
      await expect(loading).toBeVisible({ timeout: RENDER_TIMEOUT });
      await expect(loading.locator('p-skeleton')).toHaveCount(2);
      await expect(root.getByTestId('vote-detail-error')).toHaveCount(0);
      release?.();

      const error = root.getByTestId('vote-detail-error');
      await expect(error).toBeVisible({ timeout: RENDER_TIMEOUT });
      await expect(root.getByTestId('vote-detail-loading')).toHaveCount(0);
      await error.getByTestId('vote-detail-retry').getByRole('button').click();

      await expect(page.getByTestId('vote-detail-voter-not-participant')).toBeVisible({ timeout: RENDER_TIMEOUT });
      await expect(page.getByTestId('vote-detail-description')).toBeVisible();
      await expect(root.getByTestId('vote-detail-error')).toHaveCount(0);
      await expect(page.getByTestId('vote-detail-overview-results')).toHaveCount(0);
    } finally {
      release?.();
    }
  });
});
