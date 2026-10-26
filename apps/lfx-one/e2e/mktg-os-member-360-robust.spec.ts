// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MKTG_AGENTS } from '@lfx-one/shared/constants';

import { MEMBER_360_DOCUMENT_ID, openMember360, setupMember360 } from './helpers/member-360.helper';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 60000 });

for (const width of [1440, 1280, 390]) {
  test(`intake project and tracker hints follow the board at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupMember360(page); // Includes suppressCookieBanner(page).
    await openMember360(page);
    const project = page.getByTestId('member-360-project');
    const projectHint = project.getByTestId('member-360-project-hint');
    await expect(projectHint).toHaveCSS('font-size', '13px');
    await expect(project).toHaveCSS('column-gap', '10px');
    const trackerHint = page.getByTestId('member-360-trackers-hint');
    const trackerPositions = await trackerHint.evaluate((element) => {
      const label = element.previousElementSibling?.getBoundingClientRect();
      const first = element.getClientRects()[0];
      if (!label || !first) throw new Error('Tracker label or inline hint fragment missing');
      return { gap: first.left - label.right, labelTop: label.top, hintTop: first.top };
    });
    // One inline space at the app's 14px base, with subpixel tolerance; first words stay on the label's line even at390.
    expect(Math.abs(trackerPositions.gap - 3.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(trackerPositions.hintTop - trackerPositions.labelTop)).toBeLessThan(5);
    await expect(trackerHint).toHaveCSS('font-size', '13px');
    await expect(trackerHint).toHaveCSS('font-weight', '400');
    await expect(page.getByTestId('member-360-upload-types')).toHaveText('XLSX or CSV');
    if (width >= 1280) {
      const positions = await projectHint.evaluate((element) => {
        const name = element.previousElementSibling?.getBoundingClientRect();
        const hint = element.getBoundingClientRect();
        if (!name) throw new Error('Project name missing');
        return { gap: hint.left - name.right, nameTop: name.top, hintTop: hint.top };
      });
      expect(Math.abs(positions.gap - 10)).toBeLessThanOrEqual(1);
      expect(Math.abs(positions.hintTop - positions.nameTop)).toBeLessThan(5);
    }
    await page.screenshot({ path: info.outputPath(`intake-hints-${width}.png`), fullPage: true });
  });
  test(`ranking structure and collapsed sections at ${width}px`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupMember360(page, { stored: true });
    await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
    await expect(page.getByTestId('member-360-result')).toBeVisible();
    await expect(page.getByTestId('member-360-summary')).toContainText('Members scored');
    await expect(page.getByTestId('member-360-summary')).toContainText('Renewals within 120 days');
    const evidence = page.getByTestId('member-360-evidence');
    const method = page.getByTestId('member-360-method');
    await expect(evidence).not.toHaveAttribute('open', '');
    await expect(method).not.toHaveAttribute('open', '');
    await expect(evidence.locator('summary')).toHaveText('Evidence');
    await expect(method.locator('summary')).toHaveText('Method');
    await expect(page.getByTestId('member-360-trend')).toHaveText(['—', '—']);
    await expect(page.getByLabel('no trend', { exact: true })).toHaveCount(2);
    const header = page.getByTestId('member-360-result-header');
    const positions = await header.evaluate((element) => {
      const title = element.querySelector('h2')?.getBoundingClientRect();
      const subtitle = element.querySelector('p')?.getBoundingClientRect();
      const actions = element.querySelector('[data-testid="member-360-result-actions"]')?.getBoundingClientRect();
      if (!title || !subtitle || !actions) throw new Error('Result header is incomplete');
      return { titleTop: title.top, subtitleBottom: subtitle.bottom, actionsTop: actions.top, titleRight: title.right, actionsLeft: actions.left };
    });
    if (width >= 1280) {
      expect(positions.actionsTop).toBe(positions.titleTop);
      expect(positions.actionsLeft).toBeGreaterThanOrEqual(positions.titleRight);
    } else expect(positions.actionsTop).toBeGreaterThan(positions.subtitleBottom);
    // The wrapper has no selected-label/placeholder hook; only these internal classes distinguish the two visual states.
    for (const id of ['member-360-tier', 'member-360-owner']) {
      await expect(page.getByTestId(id).locator('.p-select-label')).toHaveText('All');
      await expect(page.getByTestId(id).locator('.p-placeholder')).toHaveCount(0);
    }
    const scroll = page.getByTestId('member-360-ranking-scroll');
    await expect(scroll).toHaveCSS('overflow-x', 'auto');
    await expect(scroll).toHaveCSS('scrollbar-width', 'auto');
    if (browserName !== 'firefox') expect(await scroll.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').height)).toBe('12px');
    if (width <= 1280) expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const bounds = await scroll.boundingBox();
    if (!bounds) throw new Error('Ranking scroll area is missing');
    for (const cell of await page.getByTestId('member-360-ranking-row').first().locator('td').all()) {
      await cell.scrollIntoViewIfNeeded();
      const box = await cell.boundingBox();
      if (!box) throw new Error('Ranking column is missing');
      expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      await expect(cell).not.toHaveCSS('text-overflow', 'ellipsis');
    }
    await page.getByTestId('member-360-expand-1').click();
    for (const heading of ['Gaps', 'Rationale', 'Evidence']) {
      const column = page.getByTestId('member-360-row-detail').getByText(heading, { exact: true });
      await column.scrollIntoViewIfNeeded();
      await expect(column).toBeVisible();
    }
    await scroll.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await expect(page.getByRole('img', { name: /no data/ }).first()).toBeAttached();
    const pageWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(pageWidth.viewport).toBe(width);
    expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.viewport);
    await page.screenshot({ path: info.outputPath(`ranking-${width}.png`), fullPage: true });
  });
}

for (const width of [1280, 390]) {
  test(`family run frame and one intake card at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    // setupMember360 calls suppressCookieBanner(page) before navigating.
    await setupMember360(page);
    await openMember360(page);
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.locator('li:not([aria-hidden])')).toHaveCount(3);
    await expect(breadcrumb.getByTestId('mktg-breadcrumb-link-0')).toHaveText('Sample Foundation kit');
    await expect(breadcrumb).toContainText('Sample Foundation kit');
    await expect(breadcrumb).toContainText('Member & sponsor kit');
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(MKTG_AGENTS.find((agent) => agent.id === 'member-360')?.name ?? 'Member 360');
    const intake = page.getByTestId('member-360-intake');
    await expect(intake).toHaveCount(1);
    await expect(intake.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    await expect(intake.getByTestId('member-360-window')).toBeVisible();
    await expect(intake.getByTestId('member-360-compare')).toBeVisible();
    await expect(intake.getByTestId('member-360-run').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mktg-run-questions')).toHaveCount(0);
    const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.viewport);
    await page.screenshot({ path: info.outputPath(`family-run-${width}.png`), fullPage: true });
  });
}

test('non-writer sees an access message, never a run form', async ({ page }, info) => {
  await setupMember360(page, { writer: false });
  await openMember360(page);
  await expect(page.getByTestId('member-360-no-access')).toContainText('write access');
  await expect(page.getByTestId('member-360-run')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('no-access.png'), fullPage: true });
});

test('the document has a loading state, then a recoverable read error', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}?*`, async (route) => {
    await pending;
    await route.fulfill({ status: 503, body: '{}' });
  });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('mktg-document-view-loading')).toContainText('Loading the document');
  release?.();
  await expect(page.getByTestId('mktg-document-view-error')).toContainText('could not be loaded');
  await expect(page.getByTestId('mktg-document-view-retry')).toBeVisible();
  await page.screenshot({ path: info.outputPath('document-error.png'), fullPage: true });
});

test('evidence and method disclosures are keyboard accessible', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const heat = page.getByRole('img', { name: /no data/ }).first();
  await heat.focus();
  await expect(heat).toBeFocused();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText((await heat.getAttribute('aria-label')) ?? '');
  expect(await tooltip.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(heat).toBeFocused();
  const evidence = page.getByTestId('member-360-evidence');
  await evidence.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(evidence).toHaveAttribute('open', '');
  await expect(evidence.locator('summary')).toHaveText('Evidence');
  await expect(evidence).toContainText('1 row this run.');
  await expect(evidence).toContainText('Member committee attendance');
  const method = page.getByTestId('member-360-method');
  await method.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(method).toHaveAttribute('open', '');
  await expect(method.locator('summary')).toHaveText('Method');
  await expect(method).toContainText('Routing rule version');
  await page.screenshot({ path: info.outputPath('evidence-and-method.png'), fullPage: true });
});

test('empty team actions, gaps and evidence are explicit states', async ({ page }, info) => {
  await setupMember360(page, { stored: true, emptyEvidence: true });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('member-360-no-actions-marketing')).toHaveText('No actions for this team.');
  await page.getByTestId('member-360-expand-1').click();
  await expect(page.getByTestId('member-360-no-gaps')).toHaveText('No gaps reported.');
  await expect(page.getByTestId('member-360-no-member-evidence')).toHaveText('No activity evidence recorded for this member.');
  await page.getByTestId('member-360-evidence').locator('summary').click();
  await expect(page.getByTestId('member-360-no-evidence')).toHaveText('No activity evidence recorded.');
  await page.screenshot({ path: info.outputPath('explicit-empty-result-states.png'), fullPage: true });
});
