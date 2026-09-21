// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationItem, FormationPeopleResponse, FormationsQueueResponse } from '@lfx-one/shared/interfaces';
// Deep import, not the `utils` barrel (GH-2381): the barrel re-exports form.utils.ts, which
// statically imports @angular/forms — that throws in Playwright's plain Node runtime (no
// @angular/compiler loaded). See "Non-Angular runtimes" in package-architecture.md.
import { deriveFormationEntityType, isFormationLifecycleLive } from '@lfx-one/shared/utils/formation.utils';
import { Page } from '@playwright/test';

import {
  getMockFormation,
  getMockFormationItems,
  mockFormationActivity,
  mockFormationPeopleResponse,
  mockFormationsQueue,
  mockFormationTemplate,
} from '../fixtures/mock-data';

/**
 * Helper class for mocking the Formation Checklist / Formations queue endpoints (GH-1958) in
 * Playwright tests. Sibling to `ApiMockHelper` — kept in its own file since it covers a different
 * domain, matching the one-class-per-domain convention.
 */
export class FormationApiMockHelper {
  /**
   * Mocks the checklist read for the checklist section's both modes: `GET
   * /api/projects/:slug/formation` (project-page, context mode) and its auditor-gated twin `GET
   * /api/formations/:slug/checklist` (foundation drill-down, explicit-slug mode — LFXV2-3386).
   * Same response either way, mirroring the real BFF's shared controller.
   */
  static async setupProjectFormationMock(page: Page, slug: string, opts: { canWrite?: boolean } = {}): Promise<void> {
    const fulfillChecklist = async (route: Parameters<Parameters<Page['route']>[1]>[0]): Promise<void> => {
      const formation = getMockFormation(slug);

      if (!formation) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Formation not found' }) });
        return;
      }

      const items = getMockFormationItems(formation.uid);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // can_write mirrors the real BFF's per-caller writer flag (GH-2694) — true here, since these
        // specs exercise the editable drawer; without it the assignee/due-date fields render
        // read-only and every editing flow fails. can_set_status likewise mirrors the GH-2705
        // writer ∧ team:formation pair; without it every status control is hidden.
        body: JSON.stringify({ formation, template: mockFormationTemplate, items, can_write: opts.canWrite ?? true, can_set_status: true }),
      });
    };

    await page.route('**/api/projects/*/formation', fulfillChecklist);
    await page.route('**/api/formations/*/checklist', fulfillChecklist);
  }

  /**
   * Mocks `GET /api/projects/:slug/formation/people` for the sidebar people card (#2724). Its own
   * route: the checklist glob above (`**\/api/projects/*\/formation`) doesn't match this longer
   * path, since `*` never crosses `/`. Pass a response to exercise the `unavailable`/empty states.
   */
  static async setupFormationPeopleMock(page: Page, response: FormationPeopleResponse = mockFormationPeopleResponse): Promise<void> {
    await page.route('**/api/projects/*/formation/people', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
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

      // Mirrors formation.service.ts's lifecycle drop (GH-2584): only formations the service
      // reports as still in progress reach the rows or any tile. It must stay a mirror — if this
      // filtered by stage while the BFF filtered by lifecycle, a Disengaged fixture would be
      // dropped here for the wrong reason and the queue tests would pass without the fix.
      const inFormationRows = rows.filter((row) => isFormationLifecycleLive(row.lifecycle));

      let filtered = inFormationRows;
      if (subStage) filtered = filtered.filter((row) => row.sub_stage === subStage);
      if (search) filtered = filtered.filter((row) => row.project_name.toLowerCase().includes(search));

      const tiles: FormationsQueueResponse['tiles'] = {
        exploratory: inFormationRows.filter((row) => row.sub_stage === 'exploratory').length,
        engaged: inFormationRows.filter((row) => row.sub_stage === 'engaged').length,
        on_hold: inFormationRows.filter((row) => row.sub_stage === 'on_hold').length,
        total: inFormationRows.length,
        foundations: inFormationRows.filter((row) => deriveFormationEntityType(row) === 'foundation').length,
        // Mirrors formation.service.ts's buildQueueTiles — a bare 'project' entity rolls into the
        // projects count so it isn't dropped from the breakdown while still counting toward total.
        projects: inFormationRows.filter((row) => deriveFormationEntityType(row) !== 'foundation').length,
        // GH-2366 — rows whose sub_stage has no queue-taxonomy equivalent. Non-zero for the
        // GH-2584 lifecycle fixture (its unmapped and Confidential rows are both still forming and
        // both unlabelled), zero for the default queue fixture.
        unmapped: inFormationRows.filter((row) => row.sub_stage === null).length,
        // Mirrors buildQueueTilesFromRows's ready/blocked counts — over the unfiltered set, like
        // every other tile, so the "Ready to activate" and "Blocked" tiles hold still while a pill
        // narrows the rows.
        ready: inFormationRows.filter((row) => row.gates_cleared).length,
        blocked: inFormationRows.filter((row) => row.blocked_item_titles.length > 0).length,
        blocked_items: inFormationRows.reduce((sum, row) => sum + row.blocked_item_titles.length, 0),
      };

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tiles, rows: filtered }) });
    });
  }

  /**
   * Mocks `POST /api/formations/:projectUid/items/:itemKey/{status,assignment}` and
   * `PATCH /api/formations/:projectUid/items/:itemKey` (GH-2576 Phase 2's three real write routes)
   * with a canned success or error response per test. The success body is `{item, etag}` — the full
   * seeded `FormationItem` (fields updated to match the write) wrapped in the real response envelope
   * — since `FormationItemDrawerComponent` consumes `result.item` directly
   * (`itemChanged.emit(updated)`, `${updated.title} is done`); a partial body would leave those
   * fields `undefined` in a way the real BFF never does.
   */
  static async setupFormationItemActionMock(
    page: Page,
    options: { status?: 'success' | 'error'; assignment?: 'success' | 'error'; update?: 'success' | 'error' } = {}
  ): Promise<void> {
    const findItem = (url: string): FormationItem | undefined => {
      const { projectUid, itemKey } = FormationApiMockHelper.parseItemAddress(url);
      return getMockFormationItems('formation:cascade-data-alliance').find((item) => item.project_uid === projectUid && item.template_item_key === itemKey);
    };

    await page.route('**/api/formations/*/items/*/status', async (route) => {
      if (options.status === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      if (!item) {
        // Fixture drift (a test targets an address not in the cascade-data-alliance fixture, or the
        // fixture's addressing scheme changed) — fail loudly rather than silently falling back to a
        // partial body the real BFF never produces.
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this address' }) });
        return;
      }
      const requestBody = route.request().postDataJSON() as { status?: string; reason?: string };
      const updated = {
        ...item,
        status: requestBody.status ?? item.status,
        skip_reason: requestBody.status === 'skipped' ? (requestBody.reason ?? item.skip_reason) : null,
        version: item.version + 1,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: updated, etag: String(updated.version) }) });
    });
    await page.route('**/api/formations/*/items/*/assignment', async (route) => {
      if (options.assignment === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      if (!item) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this address' }) });
        return;
      }
      const requestBody = route.request().postDataJSON() as { assignee?: string; due_date?: string };
      let nextOwner = item.owner;
      if (requestBody.assignee) {
        nextOwner = { username: requestBody.assignee, name: requestBody.assignee };
      } else if (requestBody.assignee === '') {
        nextOwner = null;
      }
      const updated = {
        ...item,
        owner: nextOwner,
        due_date: requestBody.due_date !== undefined ? requestBody.due_date || null : item.due_date,
        version: item.version + 1,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: updated, etag: String(updated.version) }) });
    });
    await page.route('**/api/formations/*/items/*', async (route) => {
      if (route.request().method() !== 'PATCH') {
        // Falls back to the previously-registered handler for this same pattern
        // (`setupFormationItemMock`'s GET handling), rather than `continue()`-ing straight to the
        // network, which has nothing listening in a Playwright-mocked test.
        await route.fallback();
        return;
      }
      if (options.update === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const item = findItem(route.request().url());
      if (!item) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this address' }) });
        return;
      }
      const requestBody = route.request().postDataJSON() as { note?: string; evidence_link?: string };
      const updated = { ...item, notes: requestBody.note !== undefined ? requestBody.note || null : item.notes, version: item.version + 1 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: updated, etag: String(updated.version) }) });
    });
  }
}
