// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationItem, FormationsQueueResponse } from '@lfx-one/shared/interfaces';
import { deriveFormationEntityType } from '@lfx-one/shared/utils';
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
        body: JSON.stringify({ formation, template: mockFormationTemplate, items }),
      });
    });
  }

  /** Mocks `GET /api/formations/:projectUid/items/:itemKey` for the item drawer (GH-2267 Phase 2 addressing). */
  static async setupFormationItemMock(page: Page): Promise<void> {
    await page.route('**/api/formations/*/items/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const { projectUid, itemKey } = FormationApiMockHelper.parseItemAddress(route.request().url());
      const item = getMockFormationItems('formation:cascade-data-alliance').find(
        (candidate) => candidate.project_uid === projectUid && candidate.template_item_key === itemKey
      );

      if (!item) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Formation item not found' }) });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ item, history: mockFormationActivity[item.uid] ?? [], history_state: 'complete' }),
      });
    });
  }

  /** Splits an `/api/formations/:projectUid/items/:itemKey[...]` URL into its two address segments. */
  private static parseItemAddress(url: string): { projectUid: string; itemKey: string } {
    const segments = new URL(url).pathname.split('/');
    const itemsIndex = segments.indexOf('items');
    return {
      projectUid: decodeURIComponent(segments[itemsIndex - 1] ?? ''),
      itemKey: decodeURIComponent(segments[itemsIndex + 1] ?? ''),
    };
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
      if (search) filtered = filtered.filter((row) => row.project_name.toLowerCase().includes(search));

      const tiles: FormationsQueueResponse['tiles'] = {
        exploratory: rows.filter((row) => row.sub_stage === 'exploratory').length,
        engaged: rows.filter((row) => row.sub_stage === 'engaged').length,
        on_hold: rows.filter((row) => row.sub_stage === 'on_hold').length,
        total: rows.length,
        foundations: rows.filter((row) => deriveFormationEntityType(row) === 'foundation').length,
        // Mirrors formation.service.ts's buildQueueTiles — a bare 'project' entity rolls into the
        // projects count so it isn't dropped from the breakdown while still counting toward total.
        projects: rows.filter((row) => deriveFormationEntityType(row) !== 'foundation').length,
        // GH-2366 — rows whose sub_stage has no queue-taxonomy equivalent; none of the fixture rows
        // are unmapped today, so this mirrors the real BFF's shape without changing any mocked count.
        unmapped: rows.filter((row) => row.sub_stage === null).length,
      };

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tiles, rows: filtered }) });
    });
  }

  /**
   * Mocks `PATCH /api/formations/:projectUid/items/:itemKey/{complete,skip,request}` (GH-2267 Phase
   * 2 addressing) with a canned success or error response per test. The success body is the full
   * seeded `FormationItem` (status field updated to match the action) — not just `{ status: '...' }`
   * — since `FormationItemDrawerComponent` consumes the response body directly
   * (`itemChanged.emit(updated)`, `${updated.title} is done`); a partial body would leave those
   * fields `undefined` in a way the real BFF never does.
   */
  static async setupFormationItemActionMock(
    page: Page,
    options: { complete?: 'success' | 'error'; skip?: 'success' | 'error'; request?: 'success' | 'error' } = {}
  ): Promise<void> {
    const findItem = (url: string): FormationItem | undefined => {
      const { projectUid, itemKey } = FormationApiMockHelper.parseItemAddress(url);
      return getMockFormationItems('formation:cascade-data-alliance').find((item) => item.project_uid === projectUid && item.template_item_key === itemKey);
    };

    await page.route('**/api/formations/*/items/*/complete', async (route) => {
      if (options.complete === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      if (!item) {
        // Fixture drift (a test targets an address not in the cascade-data-alliance fixture, or the
        // fixture's addressing scheme changed) — fail loudly rather than silently falling back to the
        // partial { status } body this mock was changed to stop producing.
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this address' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'done', skip_reason: null }) });
    });
    await page.route('**/api/formations/*/items/*/skip', async (route) => {
      if (options.skip === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      if (!item) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this address' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'skipped' }) });
    });
    await page.route('**/api/formations/*/items/*/request', async (route) => {
      if (options.request === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      if (!item) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this address' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'blocked' }) });
    });
  }
}
