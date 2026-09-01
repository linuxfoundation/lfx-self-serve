// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Formation Checklist section E2E (GH-1958). Deterministic via route mocks. */

import { getMockFormation, getMockFormationItems, mockFormationTemplate } from './fixtures/mock-data';
import { FormationApiMockHelper } from './helpers/formation-api-mock.helper';
import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoProjectOverview,
  mockFormationChecklistApis,
  stubFormationFlag,
} from './helpers/formation-checklist.helper';
import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

test.describe('Formation Checklist section (GH-1958)', () => {
  test('renders the readiness strip, both template sections, and gates the section on the Formation stage', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const section = page.getByTestId('formation-checklist-section');
    await expect(section).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-readiness-strip')).toBeVisible();
    await expect(page.getByTestId('formation-readiness-strip-gating-text')).toContainText('open');

    // Both seeded-template sections render with at least one row.
    await expect(section.getByText('Legal and entity')).toBeVisible();
    await expect(section.getByText('Community and launch')).toBeVisible();
    await expect(page.getByTestId('formation-checklist-row-title-formation-item:cascade-data-alliance:draft-project-record')).toBeVisible();
  });

  test('does not render the checklist section for a project not in a Formation stage', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG, { stage: 'Active' }) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    // Something else on the page must be visible first, or a slow-loading section could produce a false negative.
    await expect(page.getByTestId('project-dashboard-container')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-section')).toHaveCount(0);
  });

  test('does not render the checklist section when formation-enabled is off, even for a Formation-stage project', async ({ page }) => {
    await stubFormationFlag(page, false);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('project-dashboard-container')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-section')).toHaveCount(0);
  });

  test('a row action opens the item drawer with notes/history lazy-loaded', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const rowTitle = page.getByTestId('formation-checklist-row-title-formation-item:cascade-data-alliance:contribution-agreement-executed');
    await expect(rowTitle).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await rowTitle.click();

    const drawer = page.getByTestId('formation-item-drawer');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('formation-item-drawer-history')).toContainText('updated notes');
  });

  test('the "Choose a template" empty state renders when no template has been chosen', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), checklistState: 'no-template' });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-checklist-empty-no-template')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('the "hasn\'t started" empty state renders when a template is chosen but has no items yet', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), checklistState: 'no-items' });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-checklist-empty-no-items')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('the inline error state renders (with a working Retry) on a 500 from the checklist endpoint', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), checklistState: 'error' });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-checklist-inline-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const retry = page.getByTestId('formation-checklist-retry');
    await expect(retry).toBeVisible();

    // Re-route to a working response before clicking, so this asserts Retry actually recovers —
    // not just that the button is present. Assert on the readiness strip specifically: the section
    // testid is on the outer wrapper and stays mounted through every pageState (including
    // 'loading'/'error'), so it alone can't distinguish a recovered 'ready' state from the
    // transient skeleton the retry click itself produces.
    await FormationApiMockHelper.setupProjectFormationMock(page, FORMATION_PROJECT_SLUG);
    await retry.click();

    await expect(page.getByTestId('formation-readiness-strip')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-inline-error')).toHaveCount(0);
  });

  test('a link-action row with no safe action_href renders a disabled button and visible "Link unavailable" text', async ({ page }) => {
    await stubFormationFlag(page, true);
    const project = buildBaseProject(FORMATION_PROJECT_SLUG);
    await mockFormationChecklistApis(page, { project });

    const formation = getMockFormation(project.slug);
    if (!formation) throw new Error('Expected a seeded mock formation for this slug.');
    const items = getMockFormationItems(formation.uid).map((item) => (item.action === 'link' ? { ...item, action_href: null } : item));
    const linkItem = items.find((item) => item.action === 'link');
    if (!linkItem) throw new Error('Expected a seeded link-action item to null out for this test.');

    await page.route('**/api/projects/*/formation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ formation, template: mockFormationTemplate, items, data_source: 'fixture' }),
      })
    );
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const button = page.getByTestId(`formation-checklist-row-link-${linkItem.uid}`);
    await expect(button).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // `[disabled]` is a component input on the <lfx-button> host — the native `disabled` attribute
    // Playwright checks lands on the PrimeNG <button> it renders internally, not the host itself.
    await expect(button.locator('button')).toBeDisabled();
    await expect(page.getByTestId(`formation-checklist-row-action-${linkItem.uid}`)).toContainText('Link unavailable');
  });

  test('a drawer write is retired by the uid it was issued for, not by whichever item the drawer currently shows', async ({ page }) => {
    // Pins the regression across three prior fix commits on this branch: writeStarted/writeEnded
    // used to resolve the uid from the section's *current* drawerItemUid() signal, so switching to a
    // different item before an earlier write's response landed would clear the wrong item's guard —
    // stranding the original item's buttons disabled forever while dropping the new item's own guard
    // early (re-opening the exact double-write race these commits exist to prevent).
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    const formation = getMockFormation(FORMATION_PROJECT_SLUG);
    if (!formation) throw new Error('Expected a seeded mock formation for this slug.');
    const items = getMockFormationItems(formation.uid);

    // Each PATCH .../complete is held open until this test explicitly releases it, keyed by uid —
    // lets two different items' writes stay in flight at once, which is what this regression needs.
    const pendingResolvers = new Map<string, () => void>();
    await page.route('**/api/formation-items/*/complete', async (route) => {
      const segments = new URL(route.request().url()).pathname.split('/');
      const uid = decodeURIComponent(segments[segments.length - 2] ?? '');
      await new Promise<void>((resolve) => pendingResolvers.set(uid, resolve));
      const item = items.find((candidate) => candidate.uid === uid);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'done', skip_reason: null }) });
    });

    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const uidA = 'formation-item:cascade-data-alliance:contribution-agreement-executed';
    const uidB = 'formation-item:cascade-data-alliance:domain-and-dns-transfer';
    const drawer = page.getByTestId('formation-item-drawer');
    const markComplete = page.getByTestId('formation-item-drawer-mark-complete').locator('button');

    // Start A's write, then close the drawer while it's still in flight — nothing gates onClose() on
    // a pending write, and neither does the mask/ESC dismiss p-drawer offers by default.
    await page.getByTestId(`formation-checklist-row-title-${uidA}`).click();
    await expect(drawer).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await markComplete.click();
    await expect(markComplete).toBeDisabled();
    await page.getByTestId('formation-item-drawer-close').click();
    await expect(drawer).toBeHidden();

    // Open a different item and start its own write too — the drawer (and drawerItemUid()) now
    // points at B while A's write is still unresolved.
    await page.getByTestId(`formation-checklist-row-title-${uidB}`).click();
    await expect(drawer).toBeVisible();
    await markComplete.click();
    await expect(markComplete).toBeDisabled();

    // Release A's held response. If writeEnded resolved the uid from the section's current
    // drawerItemUid() (B) instead of the uid the write was actually issued for (A), this would
    // incorrectly clear B's guard and B's button would re-enable here, before B's own request
    // has resolved.
    pendingResolvers.get(uidA)?.();
    await page.waitForTimeout(300);
    await expect(markComplete).toBeDisabled();

    // Release B's held response too — now B's own write really is done, and its button recovers.
    pendingResolvers.get(uidB)?.();
    await expect(markComplete).toBeEnabled({ timeout: DATA_LOAD_TIMEOUT });

    // A's guard must have been correctly retired when its response was released above — reopening it
    // must not still show it stuck disabled forever.
    await page.getByTestId('formation-item-drawer-close').click();
    await page.getByTestId(`formation-checklist-row-title-${uidA}`).click();
    await expect(drawer).toBeVisible();
    await expect(markComplete).toBeEnabled({ timeout: DATA_LOAD_TIMEOUT });
  });
});
