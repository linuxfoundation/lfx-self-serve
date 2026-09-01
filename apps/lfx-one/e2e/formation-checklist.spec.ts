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
    // Pins the regression across four prior fix commits on this branch: writeStarted/writeEnded used
    // to resolve the uid from the section's *current* drawerItemUid() signal, so switching to a
    // different item before an earlier write's response landed would clear the wrong item's guard —
    // stranding the original item's buttons disabled forever while dropping the new item's own guard
    // early. It also depends on onDrawerItemChanged's uid-gated close (a sibling bug this same test
    // scenario surfaced): without it, A's response landing while B's drawer is open would incorrectly
    // close B's drawer too.
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    const formation = getMockFormation(FORMATION_PROJECT_SLUG);
    if (!formation) throw new Error('Expected a seeded mock formation for this slug.');
    const items = getMockFormationItems(formation.uid);
    // Both need can_complete: true and a non-'done' status — the drawer's Mark complete is
    // [disabled]="!can_complete || busy()" and disappears entirely once status is 'done'; an item
    // failing either check could never be clicked and would never exercise this guard.
    const [itemA, itemB] = items.filter((item) => item.can_complete && item.status !== 'done');
    if (!itemA || !itemB) throw new Error('Expected at least two seeded items with can_complete: true and a non-done status.');

    // Each PATCH .../complete is held open until this test explicitly releases it, keyed by uid —
    // lets two different items' writes stay in flight at once, which is what this regression needs.
    const pendingResolvers = new Map<string, () => void>();
    await page.route('**/api/formation-items/*/complete', async (route) => {
      const segments = new URL(route.request().url()).pathname.split('/');
      const uid = decodeURIComponent(segments[segments.length - 2] ?? '');
      await new Promise<void>((resolve) => pendingResolvers.set(uid, resolve));
      const item = items.find((candidate) => candidate.uid === uid);
      if (!item) {
        // Fixture drift — fail loudly rather than silently fulfilling a partial body (mirrors
        // FormationApiMockHelper.setupFormationItemActionMock's same rationale).
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No mock item for this uid' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, status: 'done', skip_reason: null }) });
    });

    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const drawer = page.getByTestId('formation-item-drawer');
    const markComplete = page.getByTestId('formation-item-drawer-mark-complete').locator('button');

    // Clicking Mark complete only proves the client set its own optimistic [disabled] state — it
    // does not prove the request has actually reached Playwright's route interceptor yet. Poll for
    // the handler above to have registered uid's resolver before releasing it, so releasing never
    // silently no-ops (which would make every assertion below pass for the wrong reason). Deletes the
    // entry once released — a Map with an unresolved-vs-already-released entry that both `.has()` as
    // truthy would let a second write for the same uid poll-pass against a stale, already-fired
    // resolver and release nothing.
    async function releaseHeldRequest(uid: string): Promise<void> {
      await expect.poll(() => pendingResolvers.has(uid)).toBe(true);
      const resolve = pendingResolvers.get(uid);
      pendingResolvers.delete(uid);
      resolve?.();
    }

    // Start A's write, then close the drawer while it's still in flight — nothing gates onClose() on
    // a pending write, and neither does the mask/ESC dismiss p-drawer offers by default.
    await page.getByTestId(`formation-checklist-row-title-${itemA.uid}`).click();
    await expect(drawer).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await markComplete.click();
    await expect(markComplete).toBeDisabled();
    await page.getByTestId('formation-item-drawer-close').click();
    await expect(drawer).toBeHidden();

    // Open a different item and start its own write too — the drawer (and drawerItemUid()) now
    // points at B while A's write is still unresolved.
    await page.getByTestId(`formation-checklist-row-title-${itemB.uid}`).click();
    await expect(drawer).toBeVisible();
    await markComplete.click();
    await expect(markComplete).toBeDisabled();

    // Release A's held response and wait for the actual network round trip to land (not a fixed
    // sleep — any erroneous state change is provoked synchronously by this same response). Exercises
    // the section-level guard end to end: if writeStarted/writeEnded resolved the wrong uid, this
    // would incorrectly re-enable B's button (its submittingItemUids entry cleared instead of A's)
    // and/or incorrectly close B's drawer (onDrawerItemChanged firing for A while B is open). The
    // button's [disabled] here is driven by mutationInFlight (section-owned), not by the drawer's own
    // completingUids — that inner isolation is covered by hand-tracing in the fix commit, not by this
    // assertion, since [disabled] would stay correctly true either way.
    const itemAResponse = page.waitForResponse((response) => response.url().includes(`/${encodeURIComponent(itemA.uid)}/complete`));
    await releaseHeldRequest(itemA.uid);
    await itemAResponse;
    await expect(drawer).toBeVisible();
    await expect(markComplete).toBeDisabled();

    // Release B's held response too — now B's own write really is done. B is still what the drawer
    // shows at this point, so this is a real (uid-matching) completion — onDrawerItemChanged closes
    // the drawer itself, same as any other successful Mark complete.
    await releaseHeldRequest(itemB.uid);
    await expect(drawer).toBeHidden({ timeout: DATA_LOAD_TIMEOUT });

    // A's guard must have been correctly retired when its response was released above — reopening it
    // must not still show it stuck disabled forever. (The drawer is already closed from B's own
    // completion above, so there's nothing to close first.)
    await page.getByTestId(`formation-checklist-row-title-${itemA.uid}`).click();
    await expect(drawer).toBeVisible();
    await expect(markComplete).toBeEnabled({ timeout: DATA_LOAD_TIMEOUT });
  });
});
