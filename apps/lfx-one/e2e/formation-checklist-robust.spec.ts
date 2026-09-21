// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation checklist section (project page) — robust structural tests (GH-1958).
 * Asserts the data-testid contract, DOM nesting, and per-action-kind control shape independent
 * of copy/content — see formation-checklist.spec.ts for the content-based behavior coverage.
 */

import { expect, test } from '@playwright/test';

import { getMockFormation, getMockFormationItems, mockFormationActivity, mockFormationTemplate } from './fixtures/mock-data';
import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoProjectFormation,
  mockFormationChecklistApis,
  stubFormationFlag,
} from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

const PROJECT = buildBaseProject(FORMATION_PROJECT_SLUG);
const FORMATION = getMockFormation(PROJECT.slug);
if (!FORMATION) throw new Error('Expected a seeded mock formation for this slug.');
const ITEMS = getMockFormationItems(FORMATION.uid);

test.describe('Formation checklist section — structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: PROJECT });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);
    await expect(page.getByTestId('formation-checklist-section')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test.describe('Readiness strip', () => {
    test('renders one segment per checklist item with an accessible label', async ({ page }) => {
      await expect(page.getByTestId('formation-readiness-strip')).toBeAttached();

      const bar = page.getByTestId('formation-readiness-strip-segment-bar');
      await expect(bar).toHaveAttribute('role', 'img');
      const label = await bar.getAttribute('aria-label');
      expect(label).toBeTruthy();

      const segments = bar.locator(':scope > div');
      await expect(segments).toHaveCount(ITEMS.length);
    });

    test('nests counts and gating text under the strip container', async ({ page }) => {
      const strip = page.getByTestId('formation-readiness-strip');
      await expect(strip.getByTestId('formation-readiness-strip-counts')).toBeAttached();
      await expect(strip.getByTestId('formation-readiness-strip-gating')).toBeAttached();
    });

    test('carries no announcement-date block — it moved to the page sidebar (GH-2702)', async ({ page }) => {
      await expect(page.getByTestId('formation-readiness-strip-announcement')).toHaveCount(0);
    });
  });

  test.describe('Page sidebar (GH-2702)', () => {
    test('nests the checklist section and the formation card under the two-column wrapper', async ({ page }) => {
      const columns = page.getByTestId('formation-page-columns');
      await expect(columns.getByTestId('formation-checklist-section')).toBeAttached();

      const sidebar = columns.getByTestId('formation-page-sidebar');
      await expect(sidebar).toBeAttached();
      await expect(sidebar.getByTestId('formation-card')).toBeAttached();
      await expect(sidebar.getByTestId('formation-people-card')).toBeAttached();
    });
  });

  test.describe('Checklist panels', () => {
    test('renders a panel per template section, nesting only that section’s rows', async ({ page }) => {
      const sectionKeys = [...new Set(ITEMS.map((item) => item.section_key))];
      expect(sectionKeys.length).toBeGreaterThan(1);

      for (const sectionKey of sectionKeys) {
        const panel = page.getByTestId(`formation-checklist-panel-${sectionKey}`);
        await expect(panel).toBeAttached();

        for (const item of ITEMS.filter((candidate) => candidate.section_key === sectionKey)) {
          await expect(panel.getByTestId(`formation-checklist-row-${item.uid}`)).toBeAttached();
        }
        for (const item of ITEMS.filter((candidate) => candidate.section_key !== sectionKey)) {
          await expect(panel.getByTestId(`formation-checklist-row-${item.uid}`)).toHaveCount(0);
        }
      }
    });
  });

  test.describe('Row action-kind rendering', () => {
    test('link action renders a real, safely-attributed anchor', async ({ page }) => {
      const linkItem = ITEMS.find((item) => item.action === 'link');
      if (!linkItem) throw new Error('Expected a seeded link-action item.');

      const control = page.getByTestId(`formation-checklist-row-link-${linkItem.uid}`);
      await expect(control).toBeAttached();
      expect(await control.evaluate((el) => el.tagName)).toBe('A');
      await expect(control).toHaveAttribute('target', '_blank');
      await expect(control).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(control).toHaveAttribute('href', linkItem.action_href ?? '');
    });

    test('status_only action with a null href renders "View details", not a dead Open button', async ({ page }) => {
      const statusOnlyItem = ITEMS.find((item) => item.action === 'status_only');
      if (!statusOnlyItem) throw new Error('Expected a seeded status_only-action item.');
      expect(statusOnlyItem.action_href).toBeFalsy();

      // No safe destination falls back to the shared "View details" affordance (the `manual`-action
      // testid, reused by design — see formation-checklist-row.component.html), not a disabled
      // "Open" button with "Link unavailable" text.
      const container = page.getByTestId(`formation-checklist-row-action-${statusOnlyItem.uid}`);
      await expect(container).not.toContainText('Link unavailable');
      await expect(page.getByTestId(`formation-checklist-row-status-only-${statusOnlyItem.uid}`)).toHaveCount(0);
      const control = page.getByTestId(`formation-checklist-row-manual-${statusOnlyItem.uid}`);
      await expect(control.locator('button')).toBeEnabled();
    });

    test('manual action renders a real button', async ({ page }) => {
      const manualItem = ITEMS.find((item) => item.action === 'manual');
      if (!manualItem) throw new Error('Expected a seeded manual-action item.');

      // `[data-testid]` lands on the `<lfx-button>` host, not the inner native `<button>` it
      // renders — resolve into the real button before checking its tag name (copilot-pull-request-reviewer).
      const control = page.getByTestId(`formation-checklist-row-manual-${manualItem.uid}`).locator('button');
      await expect(control).toBeAttached();
      expect(await control.evaluate((el) => el.tagName)).toBe('BUTTON');
    });

    // The seeded `request`-action item (`domain_and_dns_transfer`) is `status: 'blocked'`, but the
    // gated control only renders under `isActionable()` (`!readOnly() && status === 'in_progress'`)
    // — the mock's real status never exercises this control at all. Serve it flipped to `in_progress`
    // here, same route-fulfill override the evidence-link test below uses, so the assertion actually
    // runs against a rendered control (code review, GH-2576).
    test('request action renders its gated control per available_actions (GH-2576)', async ({ page }) => {
      const requestItem = ITEMS.find((item) => item.action === 'request');
      if (!requestItem) throw new Error('Expected a seeded request-action item.');
      const actionableItem = { ...requestItem, status: 'in_progress' as const };
      const itemsWithActionable = ITEMS.map((candidate) => (candidate.uid === requestItem.uid ? actionableItem : candidate));

      await page.route('**/api/projects/*/formation', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formation: FORMATION, template: mockFormationTemplate, items: itemsWithActionable, can_write: true, can_set_status: true }),
        })
      );
      await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

      const control = page.getByTestId(`formation-checklist-row-request-${requestItem.uid}`);
      await expect(control).toBeAttached();
      // `requestFormationItem` moves status to `blocked`, the same write `mark_blocked` gates
      // (`FormationChecklistRowComponent.canPerformGatedAction`).
      await expect(control.locator('button')).toBeEnabled();
    });

    test('request action renders a disabled gated control when mark_blocked is absent (GH-2576)', async ({ page }) => {
      const requestItem = ITEMS.find((item) => item.action === 'request');
      if (!requestItem) throw new Error('Expected a seeded request-action item.');
      const disabledItem = { ...requestItem, status: 'in_progress' as const, available_actions: [] };
      const itemsWithDisabled = ITEMS.map((candidate) => (candidate.uid === requestItem.uid ? disabledItem : candidate));

      await page.route('**/api/projects/*/formation', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formation: FORMATION, template: mockFormationTemplate, items: itemsWithDisabled, can_write: true, can_set_status: true }),
        })
      );
      await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

      const control = page.getByTestId(`formation-checklist-row-request-${requestItem.uid}`);
      await expect(control).toBeAttached();
      await expect(control.locator('button')).toBeDisabled();
    });

    test('provisionable action renders its gated control and lists its sub-items in the drawer', async ({ page }) => {
      const provisionableItem = ITEMS.find((item) => item.action === 'provisionable');
      if (!provisionableItem) throw new Error('Expected a seeded provisionable-action item.');
      expect((provisionableItem.sub_items ?? []).length).toBeGreaterThan(0);

      const control = page.getByTestId(`formation-checklist-row-provision-${provisionableItem.uid}`);
      await expect(control).toBeAttached();

      await page.getByTestId(`formation-checklist-row-title-${provisionableItem.uid}`).click();
      const drawer = page.getByTestId('formation-item-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('formation-item-drawer-sub-items')).toBeAttached();
    });
  });

  test.describe('Row chip contract', () => {
    test('gating row nests a status chip and a gates-active chip; non-gating row omits the latter', async ({ page }) => {
      const gatingItem = ITEMS.find((item) => item.is_gating);
      const nonGatingItem = ITEMS.find((item) => !item.is_gating);
      if (!gatingItem || !nonGatingItem) throw new Error('Expected both a gating and a non-gating seeded item.');

      await expect(page.getByTestId(`formation-checklist-row-status-chip-${gatingItem.uid}`)).toBeAttached();
      await expect(page.getByTestId(`formation-checklist-row-gates-active-chip-${gatingItem.uid}`)).toBeAttached();
      await expect(page.getByTestId(`formation-checklist-row-gates-active-chip-${nonGatingItem.uid}`)).toHaveCount(0);
    });

    test('a row with an owner_team renders an owner chip', async ({ page }) => {
      const ownedItem = ITEMS.find((item) => !!item.owner_team);
      if (!ownedItem) throw new Error('Expected a seeded item with an owner_team.');
      await expect(page.getByTestId(`formation-checklist-row-owner-chip-${ownedItem.uid}`)).toBeAttached();
    });

    // #2774: the audience icon renders only for the external-involving audiences (`external`/`both`);
    // `internal` and a null (unrecognized) audience both render nothing. Inline predicate rather than
    // the shared `isFormationItemExternal` — e2e must not import the `utils` barrel (GH-2381).
    test('audience icon renders for an external-involving item and not for an internal or null one', async ({ page }) => {
      const externalItem = ITEMS.find((item) => item.audience === 'external' || item.audience === 'both');
      const internalItem = ITEMS.find((item) => item.audience === 'internal');
      const noAudienceItem = ITEMS.find((item) => item.audience === null);
      if (!externalItem || !internalItem || !noAudienceItem) throw new Error('Expected seeded items with external/both, internal and null audiences.');

      await expect(page.getByTestId(`formation-checklist-row-audience-chip-${externalItem.uid}`)).toBeAttached();
      await expect(page.getByTestId(`formation-checklist-row-audience-chip-${internalItem.uid}`)).toHaveCount(0);
      await expect(page.getByTestId(`formation-checklist-row-audience-chip-${noAudienceItem.uid}`)).toHaveCount(0);
    });

    // #2689/#2774: team, assignee and due-date cells render on every row (an unset value still
    // renders its placeholder cell), so the section header's captions always have columns under them.
    test('every row nests a team cell, an assignee cell and a due-date cell', async ({ page }) => {
      for (const item of ITEMS) {
        await expect(page.getByTestId(`formation-checklist-row-owner-chip-${item.uid}`)).toBeAttached();
        await expect(page.getByTestId(`formation-checklist-row-assignee-${item.uid}`)).toBeAttached();
        await expect(page.getByTestId(`formation-checklist-row-due-date-${item.uid}`)).toBeAttached();
      }
    });

    // #2774: sub-items surface as a disclosure whose panel opens inside the row's own wrapper.
    test('a row with sub-items nests a collapsed disclosure whose panel opens inside the row', async ({ page }) => {
      const subItemsItem = ITEMS.find((item) => (item.sub_items ?? []).length > 0);
      if (!subItemsItem) throw new Error('Expected a seeded item with sub-items.');

      const trigger = page.getByTestId(`formation-checklist-row-sub-items-${subItemsItem.uid}`);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId(`formation-checklist-row-sub-items-panel-${subItemsItem.uid}`)).toHaveCount(0);

      await trigger.click();

      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const panel = page.getByTestId(`formation-checklist-row-${subItemsItem.uid}`).getByTestId(`formation-checklist-row-sub-items-panel-${subItemsItem.uid}`);
      await expect(panel).toBeAttached();
      await expect(panel.locator('[data-testid^="formation-sub-item-row-"]')).toHaveCount(subItemsItem.sub_items.length);
    });
  });

  test.describe('Item drawer structural nesting', () => {
    test('opening a row nests notes/assignee/due-date/save/history containers and a real close button', async ({ page }) => {
      const item = ITEMS[0];
      await page.getByTestId(`formation-checklist-row-title-${item.uid}`).click();

      const drawer = page.getByTestId('formation-item-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('formation-item-drawer-notes')).toBeAttached();
      await expect(drawer.getByTestId('formation-item-drawer-assignee')).toBeAttached();
      await expect(drawer.getByTestId('formation-item-drawer-due-date')).toBeAttached();
      await expect(drawer.getByTestId('formation-item-drawer-save')).toBeAttached();
      await expect(drawer.getByTestId('formation-item-drawer-history')).toBeAttached();

      const closeButton = drawer.getByTestId('formation-item-drawer-close');
      await expect(closeButton).toBeAttached();
      expect(await closeButton.evaluate((el) => el.tagName)).toBe('BUTTON');
    });

    // #2732: arriving with `?item=<template_item_key>` yields the same nested drawer with no click.
    test('a deep-linked item nests the same drawer containers without any row click', async ({ page }) => {
      const item = ITEMS[0];
      await page.goto(`/project/formation?project=${FORMATION_PROJECT_SLUG}&item=${item.template_item_key}`, { waitUntil: 'domcontentloaded' });

      const drawer = page.getByTestId('formation-item-drawer');
      await expect(drawer).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(drawer.getByTestId('formation-item-drawer-notes')).toBeAttached();
      await expect(drawer.getByTestId('formation-item-drawer-assignee')).toBeAttached();
      await expect(drawer.getByTestId('formation-item-drawer-history')).toBeAttached();
      await expect(page).toHaveURL(new RegExp(`/project/formation\\?project=${FORMATION_PROJECT_SLUG}$`));
    });

    test('an item with a real evidence link nests a safely-attributed anchor under the links container', async ({ page }) => {
      const item = ITEMS[0];
      const safeHref = 'https://example.com/formation/linked-doc';
      const itemsWithLink = ITEMS.map((candidate) => (candidate.uid === item.uid ? { ...candidate, evidence_link: safeHref } : candidate));

      await page.route('**/api/projects/*/formation', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formation: FORMATION, template: mockFormationTemplate, items: itemsWithLink, can_write: true, can_set_status: true }),
        })
      );
      // The drawer fetches item detail from a separate GET (`/api/formations/:projectUid/items/:itemKey`)
      // — overriding only the list route above leaves this endpoint on the default mock, which serves
      // the original fixture item with `evidence_link: null`, so the assertion below would never see a
      // rendered link (Copilot review, GH-2576).
      await page.route('**/api/formations/*/items/*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const segments = new URL(route.request().url()).pathname.split('/');
        const itemsIndex = segments.indexOf('items');
        const projectUid = decodeURIComponent(segments[itemsIndex - 1] ?? '');
        const itemKey = decodeURIComponent(segments[itemsIndex + 1] ?? '');
        const matched = itemsWithLink.find((candidate) => candidate.project_uid === projectUid && candidate.template_item_key === itemKey);
        if (!matched) return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ item: matched, history: mockFormationActivity[matched.uid] ?? [], history_state: 'complete' }),
        });
      });
      await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);
      await page.getByTestId(`formation-checklist-row-title-${item.uid}`).click();

      const drawer = page.getByTestId('formation-item-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('formation-item-drawer-links')).toBeAttached();

      const link = drawer.getByTestId('formation-item-drawer-evidence-link');
      await expect(link).toBeAttached();
      expect(await link.evaluate((el) => el.tagName)).toBe('A');
      await expect(link).toHaveAttribute('href', safeHref);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('an item with history nests entries under the history container', async ({ page }) => {
      const itemWithHistory = ITEMS.find((item) => item.uid.endsWith('contribution_agreement_executed'));
      if (!itemWithHistory) throw new Error('Expected the seeded item with activity history.');

      await page.getByTestId(`formation-checklist-row-title-${itemWithHistory.uid}`).click();
      const history = page.getByTestId('formation-item-drawer-history');
      await expect(history).toBeVisible();
      await expect(history.getByText('No activity yet.')).toHaveCount(0);
    });
  });

  test.describe('Page-state contract', () => {
    test('inline error state nests a retry button in place of the panels', async ({ page }) => {
      await stubFormationFlag(page, true);
      await mockFormationChecklistApis(page, { project: PROJECT, checklistState: 'error' });
      await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

      const error = page.getByTestId('formation-checklist-inline-error');
      await expect(error).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      const retry = error.getByTestId('formation-checklist-retry');
      await expect(retry).toBeAttached();
      expect(await retry.evaluate((el) => el.tagName)).toBe('BUTTON');
      await expect(page.getByTestId(`formation-checklist-panel-${ITEMS[0].section_key}`)).toHaveCount(0);
    });
  });
});
