// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Votes empty states (#3799), through the project route and real templates with synthetic BFF reads.
 * Requires the normal Playwright authenticated storage state and a running app at baseURL.
 */
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

const PROJECT_UID = 'p0000000-0000-0000-0000-000000003799';
const PROJECT_SLUG = 'synthetic-votes-project';
const PROJECT_NAME = 'Synthetic Votes Project';
const PAGE_LOAD_TIMEOUT = 20_000;

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function seedProjectLens(page: Page, origin: string): Promise<void> {
  await page.context().addCookies([
    { name: LENS_COOKIE_KEY, value: 'project', url: origin, sameSite: 'Lax' },
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
      url: origin,
      sameSite: 'Lax',
    },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      url: origin,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Votes status-aware empty states', () => {
  // The sidebar boot assertion needs a desktop viewport, including on the mobile Playwright project.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('keeps status and search recovery available before returning to the unfiltered All card', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const listRequests: URL[] = [];
    const countRequests: URL[] = [];
    await seedProjectLens(page, origin);
    await page.route('**/api/user/personas*', (route) =>
      fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
    );
    await page.route('**/api/nav/lens-items*', (route) => {
      const lens = new URL(route.request().url()).searchParams.get('lens');
      const items = lens === 'project' ? [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, isFoundation: false, logoUrl: null }] : [];
      return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens });
    });
    await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) =>
      fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, parent_uid: '', writer: true })
    );
    await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
    await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
    await page.route('**/api/committees?*', (route) => fulfillJson(route, []));
    await page.route(
      (url) => url.pathname === '/api/votes' || url.pathname.startsWith('/api/votes/'),
      (route) => {
        const url = new URL(route.request().url());
        switch (url.pathname) {
          case '/api/votes':
            listRequests.push(url);
            return fulfillJson(route, { data: [], total_records: 0 });
          case '/api/votes/count':
            countRequests.push(url);
            return fulfillJson(route, { count: 0 });
          case '/api/votes/summary':
            return fulfillJson(route, { active_votes: 0, closing_soon: 0, as_of: '2026-10-18T12:00:00Z' });
          case '/api/votes/status-counts':
            return fulfillJson(route, { all: 0, active: 0, disabled: 0, ended: 0 });
          case '/api/votes/my-votes':
            return fulfillJson(route, { votes: [], complete: true });
          default:
            return route.fallback();
        }
      }
    );

    // Boot first, then navigate client-side so route-specific reads cannot bypass the stubs during SSR.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await seedProjectLens(page, origin);
    await page.evaluate((url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/votes?project=${PROJECT_SLUG}`);

    const empty = page.getByTestId('votes-table-empty-state');
    await expect(empty).toContainText('No active votes', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('filter-pill-active')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    await expect.poll(() => countRequests.length).toBeGreaterThan(0);
    expect(listRequests[0].searchParams.getAll('filters')).toEqual(['status:active']);
    expect(countRequests[0].searchParams.getAll('filters')).toEqual(['status:active']);

    await page.getByTestId('filter-pill-disabled').click();
    await expect(empty).toContainText('No draft votes');
    await page.getByTestId('filter-pill-ended').click();
    await expect(empty).toContainText('No ended votes yet');
    await page.getByTestId('votes-search-input').locator('input').fill('absent');
    await expect(empty).toContainText('No votes match your filters');
    await empty.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page.getByTestId('votes-empty-state-card')).toContainText('No votes yet');
    await expect(empty).toHaveCount(0);
    expect(listRequests.at(-1)!.searchParams.getAll('filters')).toEqual([]);
    expect(listRequests.at(-1)!.searchParams.has('name')).toBe(false);
  });
});
