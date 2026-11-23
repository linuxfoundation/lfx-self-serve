// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Redesigned Me lens Groups page (#5823), behind GROUPS_REDESIGN_FLAG.
 *
 * Coverage:
 *   - With no groups, the empty state shows and the metrics and toolbar don't.
 *   - With groups, the cards, metrics and type tabs show.
 *   - A search with no match shows no results, and Reset filters brings the cards back.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { MyCommittee } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { stubGroupsRedesignFlag } from './helpers/groups-redesign-flag.helper';

const PAGE_LOAD_TIMEOUT = 20_000;

function buildMyCommittees(): MyCommittee[] {
  const now = new Date().toISOString();
  const base = { public: true, sso_group_enabled: false, created_at: now, updated_at: now, project_uid: 'p0000000-0000-0000-0000-00000000e001' };
  return [
    { ...base, uid: 'c0000000-0000-0000-0000-00000000e001', name: 'Docs Working Group', category: 'Working Group', enable_voting: false, total_members: 6 },
    { ...base, uid: 'c0000000-0000-0000-0000-00000000e002', name: 'Governing Board', category: 'Board', enable_voting: true, total_members: 9 },
  ].map((committee) => ({ ...committee, project_name: 'Test Project', my_role: 'Member' }) as MyCommittee);
}

const AUTH_CREDS_PRESENT = !!process.env['TEST_USERNAME'] && !!process.env['TEST_PASSWORD'];

async function gotoGroups(page: Page, committees: MyCommittee[]): Promise<void> {
  test.skip(!AUTH_CREDS_PRESENT, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  await stubGroupsRedesignFlag(page, true);
  await page.route('**/api/committees/my-committees*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) })
  );
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Groups redesign', () => {
  test('shows the empty state without groups', async ({ page }) => {
    await gotoGroups(page, []);

    await expect(page.getByTestId('groups-redesign-empty')).toContainText('No groups yet', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('groups-redesign-metrics')).toHaveCount(0);
    await expect(page.getByTestId('groups-redesign-toolbar')).toHaveCount(0);
  });

  test('shows the cards, metrics and type tabs', async ({ page }) => {
    await gotoGroups(page, buildMyCommittees());

    await expect(page.getByTestId('groups-home-card')).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('groups-redesign-metric').first()).toContainText('Total Groups');
    await expect(page.getByRole('tab', { name: /Working Groups/ })).toBeVisible();
  });

  test('shows no results for a search, and Reset filters clears it', async ({ page }) => {
    await gotoGroups(page, buildMyCommittees());
    await expect(page.getByTestId('groups-home-card')).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('groups-redesign-search').getByRole('searchbox').fill('no group is called this');
    await expect(page.getByTestId('groups-redesign-no-results')).toContainText('No groups match your search');

    await page.getByTestId('groups-redesign-no-results-reset').getByRole('button').click();
    await expect(page.getByTestId('groups-home-card')).toHaveCount(2);
  });
});
