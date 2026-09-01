// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationItem, FormationsQueueResponse } from '@lfx-one/shared/interfaces';
import { Page } from '@playwright/test';

import { getMockFormation, getMockFormationItems, mockFormationActivity, mockFormationsQueue, mockFormationTemplate } from '../fixtures/mock-data';

/**
 * Helper class for mocking the Formation Checklist / Formations queue endpoints (GH-1958) in
 * Playwright tests. Sibling to `ApiMockHelper` — kept in its own file since it covers a different
 * domain, matching the one-class-per-domain convention.
 */
export class FormationApiMockHelper {
  /** Mocks `GET /api/projects/:slug/formation` for the checklist section. */
  static async setupProjectFormationMock(page: Page, slug: string): Promise<void> {
    await page.route('**/api/projects/*/formation', async (route) => {
      const formation = getMockFormation(slug);

      if (!formation) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Formation not found' }) });
        return;
      }

      const items = getMockFormationItems(formation.uid);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ formation, template: mockFormationTemplate, items, data_source: 'fixture' }),
      });
    });
  }

  /** Mocks `GET /api/formation-items/:uid` for the item drawer. */
  static async setupFormationItemMock(page: Page): Promise<void> {
    await page.route('**/api/formation-items/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const uid = decodeURIComponent(route.request().url().split('/').pop() ?? '');
      const item = Object.values(getMockFormationItems('formation:cascade-data-alliance')).find((candidate) => candidate.uid === uid);

      if (!item) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Formation item not found' }) });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ item, history: mockFormationActivity[uid] ?? [] }),
      });
    });
  }

  /** Mocks `GET /api/formations` (queue), honoring `sub_stage`/`search` query params like the real BFF does. */
  static async setupFormationsQueueMock(page: Page, rows = mockFormationsQueue): Promise<void> {
    await page.route('**/api/formations*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const url = new URL(route.request().url());
      const subStage = url.searchParams.get('sub_stage');
      const search = url.searchParams.get('search')?.trim().toLowerCase();

      let filtered = rows;
      if (subStage) filtered = filtered.filter((row) => row.sub_stage === subStage);
      if (search) filtered = filtered.filter((row) => row.parent_project_name.toLowerCase().includes(search));

      const tiles: FormationsQueueResponse['tiles'] = {
        proposed: rows.filter((row) => row.sub_stage === 'proposed').length,
        exploratory: rows.filter((row) => row.sub_stage === 'exploratory').length,
        engaged: rows.filter((row) => row.sub_stage === 'engaged').length,
        on_hold: rows.filter((row) => row.sub_stage === 'on_hold').length,
        activating: rows.filter((row) => row.sub_stage === 'activating').length,
        withdrawn: rows.filter((row) => row.sub_stage === 'withdrawn').length,
        total: rows.length,
        foundations: rows.filter((row) => row.entity_type === 'foundation').length,
        // Mirrors formation.service.ts's buildQueueTiles — a bare 'project' entity rolls into the
        // subprojects count so it isn't dropped from the breakdown while still counting toward total.
        subprojects: rows.filter((row) => row.entity_type === 'subproject' || row.entity_type === 'project').length,
        mine: 0,
      };

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tiles, rows: filtered, data_source: 'fixture' }) });
    });
  }

  /**
   * Mocks `PATCH /api/formation-items/:uid/{complete,skip,request}` with a canned success or error
   * response per test. The success body is the full seeded `FormationItem` (status field updated to
   * match the action) — not just `{ status: '...' }` — since `FormationItemDrawerComponent` consumes
   * the response body directly (`itemChanged.emit(updated)`, `${updated.title} is done`); a partial
   * body would leave those fields `undefined` in a way the real BFF never does.
   */
  static async setupFormationItemActionMock(
    page: Page,
    options: { complete?: 'success' | 'error'; skip?: 'success' | 'error'; request?: 'success' | 'error' } = {}
  ): Promise<void> {
    const findItem = (url: string): FormationItem | undefined => {
      const segments = new URL(url).pathname.split('/');
      const uid = decodeURIComponent(segments[segments.length - 2] ?? '');
      return getMockFormationItems('formation:cascade-data-alliance').find((item) => item.uid === uid);
    };

    await page.route('**/api/formation-items/*/complete', async (route) => {
      if (options.complete === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'done', skip_reason: null }) });
    });
    await page.route('**/api/formation-items/*/skip', async (route) => {
      if (options.skip === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'skipped' }) });
    });
    await page.route('**/api/formation-items/*/request', async (route) => {
      if (options.request === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'waiting_on_partner' }) });
    });
  }

  /** Mocks `POST /api/formations/:uid/accept` and `/decline`. */
  static async setupFormationQueueActionMock(page: Page): Promise<void> {
    await page.route('**/api/formations/*/accept', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deep_link_url: 'https://admin.linuxfoundation.org/formations/cascade-data-alliance' }),
      });
    });
    await page.route('**/api/formations/*/decline', async (route) => {
      const formation = mockFormationsQueue[0];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...formation, state: 'withdrawn', sub_stage: 'withdrawn' }) });
    });
  }
}
