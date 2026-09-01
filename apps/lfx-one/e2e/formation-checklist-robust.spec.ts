// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation checklist section (project page) — robust structural tests (GH-1958).
 * Asserts the data-testid contract, DOM nesting, and per-action-kind control shape independent
 * of copy/content — see formation-checklist.spec.ts for the content-based behavior coverage.
 */

import { expect, test } from '@playwright/test';

import { getMockFormation, getMockFormationItems, mockFormationTemplate } from './fixtures/mock-data';
import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoProjectOverview,
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
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);
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

    test('status_only action with a null href renders disabled with unavailable text', async ({ page }) => {
      const statusOnlyItem = ITEMS.find((item) => item.action === 'status_only');
      if (!statusOnlyItem) throw new Error('Expected a seeded status_only-action item.');
      expect(statusOnlyItem.action_href).toBeFalsy();

      const container = page.getByTestId(`formation-checklist-row-action-${statusOnlyItem.uid}`);
      await expect(container).toContainText('Link unavailable');
      const control = page.getByTestId(`formation-checklist-row-status-only-${statusOnlyItem.uid}`);
      await expect(control.locator('button')).toBeDisabled();
    });

    test('manual action renders a real button', async ({ page }) => {
      const manualItem = ITEMS.find((item) => item.action === 'manual');
      if (!manualItem) throw new Error('Expected a seeded manual-action item.');

      const control = page.getByTestId(`formation-checklist-row-manual-${manualItem.uid}`);
      await expect(control).toBeAttached();
      expect(await control.evaluate((el) => el.tagName)).toBe('BUTTON');
    });

    test('request action renders its gated control per can_complete', async ({ page }) => {
      const requestItem = ITEMS.find((item) => item.action === 'request');
      if (!requestItem) throw new Error('Expected a seeded request-action item.');

      const control = page.getByTestId(`formation-checklist-row-request-${requestItem.uid}`);
      await expect(control).toBeAttached();
      if (requestItem.can_complete) {
        await expect(control.locator('button')).toBeEnabled();
      } else {
        await expect(control.locator('button')).toBeDisabled();
      }
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

    test('an item with a real link nests a safely-attributed anchor under the links container', async ({ page }) => {
      const item = ITEMS[0];
      const safeHref = 'https://example.com/formation/linked-doc';
      const itemsWithLink = ITEMS.map((candidate) =>
        candidate.uid === item.uid ? { ...candidate, links: [{ label: 'Linked doc', href: safeHref }] } : candidate
      );

      await page.route('**/api/projects/*/formation', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formation: FORMATION, template: mockFormationTemplate, items: itemsWithLink, data_source: 'fixture' }),
        })
      );
      await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);
      await page.getByTestId(`formation-checklist-row-title-${item.uid}`).click();

      const drawer = page.getByTestId('formation-item-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('formation-item-drawer-links')).toBeAttached();

      const link = drawer.getByTestId(`formation-item-drawer-link-${safeHref}`);
      await expect(link).toBeAttached();
      expect(await link.evaluate((el) => el.tagName)).toBe('A');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('an item with history nests entries under the history container', async ({ page }) => {
      const itemWithHistory = ITEMS.find((item) => item.uid.endsWith('contribution-agreement-executed'));
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
      await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

      const error = page.getByTestId('formation-checklist-inline-error');
      await expect(error).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      const retry = error.getByTestId('formation-checklist-retry');
      await expect(retry).toBeAttached();
      expect(await retry.evaluate((el) => el.tagName)).toBe('BUTTON');
      await expect(page.getByTestId(`formation-checklist-panel-${ITEMS[0].section_key}`)).toHaveCount(0);
    });
  });
});
