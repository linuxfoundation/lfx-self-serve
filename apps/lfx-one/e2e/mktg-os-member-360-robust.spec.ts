// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

import { json, MEMBER_360_DOCUMENT_ID, member360Progress, openMember360, setupMember360, stubMember360Progress } from './helpers/member-360.helper';
import { member360Revision } from './fixtures/mock-data/member-360.mock';
import { MKTG_POLL_RETRYING_TEXT } from '@lfx-one/shared/constants';

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
    await setupMember360(page, { stored: true }); // Includes suppressCookieBanner(page).
    const view = member360Revision();
    const envelope = view.member360;
    if (!envelope) throw new Error('Member 360 fixture is missing');
    envelope.tabs.member_ranking[1].days_to_renewal = 120;
    envelope.tabs.member_ranking[1].annual_value = null;
    envelope.tabs.member_ranking.forEach((row, index) => (row.rank = 193 + index));
    envelope.content_sha256 = createHash('sha256').update(JSON.stringify(envelope.tabs)).digest('hex');
    await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, (route) => json(route, view));
    await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
    await expect(page.getByTestId('member-360-result')).toBeVisible();
    const renewalNote = page.getByTestId('member-360-summary-renewals-note');
    await expect(renewalNote).toBeVisible();
    await expect(renewalNote).toHaveText('$25,000 known at list price · 1 without a value');
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
    const header = page.getByTestId('mktg-document-view-title-card');
    await expect(header.getByTestId('member-360-download').getByRole('button')).toHaveText('Download workbook');
    const positions = await header.evaluate((element) => {
      const card = element.getBoundingClientRect();
      const create = element.querySelector('[data-testid="member-360-new-run"]');
      const download = element.querySelector('[data-testid="member-360-download"]');
      if (!create || !download) throw new Error('Title-row actions are incomplete');
      return {
        cardRight: card.right,
        createRight: create.getBoundingClientRect().right,
        createCenterY: (create.getBoundingClientRect().top + create.getBoundingClientRect().bottom) / 2,
        downloadCenterY: (download.getBoundingClientRect().top + download.getBoundingClientRect().bottom) / 2,
        downloadLeft: download.getBoundingClientRect().left,
        downloadRight: download.getBoundingClientRect().right,
        follows: !!(create.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(positions.follows).toBe(true);
    expect(positions.downloadRight).toBeLessThanOrEqual(positions.cardRight);
    if (width >= 1280) {
      expect(positions.downloadLeft).toBeGreaterThanOrEqual(positions.createRight);
      expect(Math.abs(positions.createCenterY - positions.downloadCenterY)).toBeLessThanOrEqual(1);
    }
    // The wrapper has no selected-label/placeholder hook; only these internal classes distinguish the two visual states.
    for (const id of ['member-360-tier', 'member-360-owner']) {
      await expect(page.getByTestId(id).locator('.p-select-label')).toHaveText('All');
      await expect(page.getByTestId(id).locator('.p-placeholder')).toHaveCount(0);
    }
    const scroll = page.getByTestId('member-360-ranking-scroll');
    await expect(scroll).toHaveCSS('overflow-x', 'auto');
    await expect(scroll).toHaveCSS('scrollbar-width', 'auto');
    if (browserName !== 'firefox') expect(await scroll.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').height)).toBe('12px');
    // WebKit can fit this synthetic table at the same width; scroll styles and reachable cells remain required in every browser.
    if (width <= 1280 && browserName === 'chromium') expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
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
    // A three-digit rank stays on one line inside its column: the cells' break-words once split it digit by digit.
    for (const rank of await page.getByTestId('member-360-rank').all()) {
      await expect(rank).toHaveText(/^\s*19\d\s*$/);
      const fit = await rank.evaluate((element) => {
        const cell = element.closest('td');
        if (!cell) throw new Error('Rank cell is missing');
        const box = element.getBoundingClientRect();
        const cellBox = cell.getBoundingClientRect();
        return { height: box.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight), right: box.right, cellRight: cellBox.right };
      });
      expect(fit.height).toBeLessThan(fit.lineHeight * 1.5);
      expect(fit.right).toBeLessThanOrEqual(fit.cellRight);
    }
    await page.getByTestId('member-360-expand-193').click();
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
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Member 360');
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

// 390px holds the longest live heading on one line (#5467). Where a row is too narrow for it, the heading breaks before the count, never inside the
// team name. Which narrow widths that is depends on the layout around the card (a desktop browser keeps the collapsed nav rail, a phone has none),
// so only 390px pins the line count: every width checks that a heading takes one line when it fits its row and two when it does not.
for (const width of [390, 360]) {
  test(`at ${width}px a long team header keeps its name on one line and a free-text deadline wraps inside the Actions card`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupMember360(page, { stored: true }); // Includes suppressCookieBanner(page).
    const view = member360Revision();
    const envelope = view.member360;
    if (!envelope) throw new Error('Member 360 fixture is missing');
    const template = envelope.tabs.actions_by_team[0];
    const spaced = 'when the board meets to approve the renewal plan for next year';
    const unbroken = 'AfterTheBoardApprovesTheRenewalPlanForTheNextFinancialYear';
    // The live shape that wrapped (#5467): the longest team name with a three-digit count. Deadlines are free text in the contract.
    envelope.tabs.actions_by_team = [
      { ...template, owner: 'Member Success', suggested_deadline: spaced },
      { ...template, owner: 'Member Success', suggested_deadline: unbroken },
      ...Array.from({ length: 200 }, () => ({ ...template, owner: 'Member Success' as const })),
      { ...template, owner: 'Sales' },
      { ...template, owner: 'Marketing' },
    ];
    envelope.content_sha256 = createHash('sha256').update(JSON.stringify(envelope.tabs)).digest('hex');
    await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, (route) => json(route, view));
    await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
    const card = page.getByTestId('member-360-actions');
    const team = page.getByTestId('member-360-team-member-success');
    await expect(team.getByRole('heading')).toHaveText('Member Success · 202 actions');
    // Free text sorts after every dated action, so it sits below the fold.
    await team.getByTestId('member-360-show-all-member-success').click();
    await expect(team.getByTestId('member-360-action-row')).toHaveCount(202);
    const layout = await card.evaluate((element) => {
      const lineCount = (target: Element) => Math.round(target.getBoundingClientRect().height / parseFloat(getComputedStyle(target).lineHeight));
      const text = (target: Element) => target.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return {
        headers: Array.from(element.querySelectorAll('h4'), (heading) => {
          const box = heading.closest('[data-testid^="member-360-team-"]');
          const copy = box?.querySelector('[data-testid^="member-360-copy-"]')?.getBoundingClientRect();
          const name = heading.querySelector('[data-testid="member-360-team-name"]');
          const count = name?.nextElementSibling;
          const row = heading.parentElement;
          if (!box || !copy || !name || !count || !row) throw new Error('Team box, heading row, team name, count or Copy list button is missing');
          // An inline box has one rectangle per line it sits on.
          const wrap = () => ({ lines: lineCount(heading), nameLines: name.getClientRects().length, countLines: count.getClientRects().length });
          // The width the heading needs on one line: from the start of the name to the end of the count, in a hidden copy that cannot break.
          const oneLine = heading.cloneNode(true) as HTMLElement;
          oneLine.style.cssText = 'position: absolute; visibility: hidden; white-space: nowrap;';
          row.append(oneLine);
          const needed = oneLine.children[1].getBoundingClientRect().right - oneLine.children[0].getBoundingClientRect().left;
          oneLine.remove();
          const title = heading.getBoundingClientRect();
          const style = getComputedStyle(box);
          const inner = box.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
          const natural = {
            text: text(heading),
            ...wrap(),
            needed,
            available: row.getBoundingClientRect().width,
            titleInsideBox: title.right <= inner + 0.5,
            copyInsideBox: copy.right <= inner + 0.5,
            copyClearOfTitle: copy.left >= title.right - 0.5 || copy.top >= title.bottom - 0.5,
          };
          // The same heading in a row with room for the count only, so the break is measured in every browser and layout, whatever width
          // the page leaves the card: a two-word name is wider than that row and still holds one line.
          row.style.width = `${Math.ceil(count.getBoundingClientRect().width) + 1}px`;
          const squeezed = wrap();
          row.style.width = '';
          return { ...natural, squeezed };
        }),
        dues: Array.from(element.querySelectorAll('[data-testid="member-360-action-due"]'), (due) => ({ text: text(due), lines: lineCount(due) })),
        outsideRow: Array.from(element.querySelectorAll('[data-testid="member-360-action-row"]')).flatMap((row) => {
          const right = row.getBoundingClientRect().right;
          return Array.from(row.querySelectorAll('*'))
            .filter((part) => part.getBoundingClientRect().right > right + 0.5)
            .map(text);
        }),
        cardScrolls: element.scrollWidth > element.clientWidth,
      };
    });
    expect(layout.headers.map((header) => header.text)).toEqual(['Sales · 1 action', 'Marketing · 1 action', 'Member Success · 202 actions']);
    for (const header of layout.headers) {
      info.annotations.push({ type: 'heading', description: `${header.text}: needs ${header.needed.toFixed(1)}px of ${header.available}px` });
      // One line when the row has the room and two when it does not; the name and the count are each whole, inside the box and clear of Copy list.
      expect(header, header.text).toMatchObject({
        lines: header.needed <= header.available ? 1 : 2,
        nameLines: 1,
        countLines: 1,
        titleInsideBox: true,
        copyInsideBox: true,
        copyClearOfTitle: true,
        // Too narrow for one line: the name on the first, the count on the second.
        squeezed: { lines: 2, nameLines: 1, countLines: 1 },
      });
    }
    if (width === 390) expect(layout.headers.map((header) => header.lines)).toEqual([1, 1, 1]);
    // A date keeps one line; free text wraps under the row instead of running out of the card, even with nowhere to break.
    expect(layout.dues).toHaveLength(204);
    expect(layout.dues.filter((due) => due.lines !== 1).map((due) => due.text)).toEqual([`Due ${unbroken}`, `Due ${spaced}`]);
    expect(layout.outsideRow).toEqual([]);
    expect(layout.cardScrolls).toBe(false);
    const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.viewport);
    await page.screenshot({ path: info.outputPath(`actions-${width}.png`), fullPage: true });
  });
}

test('non-writer sees an access message, never a run form', async ({ page }, info) => {
  await setupMember360(page, { writer: false });
  await openMember360(page);
  await expect(page.getByTestId('member-360-no-access')).toContainText('write access');
  await expect(page.getByTestId('member-360-run')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('no-access.png'), fullPage: true });
});

test('the in-progress view and the Start over intake keep their test-id structure', async ({ page }, info) => {
  await setupMember360(page);
  const detail = member360Progress('writing');
  await page.route('**/api/mktg-agents/documents?*', (route) => json(route, { project: 'sample-project', groups: [], runs: detail.runs }));
  await stubMember360Progress(page, () => detail);
  await page.route('**/api/mktg-agents/member-360/result', (route) => json(route, { status: 'pending', activity: detail.runs?.[0]?.activity }));
  await openMember360(page);
  // The open run carries the choice: one row, holding the Start over action, beside the activity pane.
  await expect(page.getByTestId('member-360-generating')).toBeVisible();
  await expect(page.getByTestId('member-360-run-choice')).toHaveCount(1);
  await expect(page.getByTestId('member-360-run-choice').getByTestId('member-360-start-over')).toHaveCount(1);
  await expect(page.getByTestId('member-360-waiting-notice')).toHaveCount(0);
  await page.getByTestId('member-360-start-over').getByRole('button').click();
  // Start over: the notice holds the way back, the intake sits beside it, and the activity pane and its choice are gone.
  const notice = page.getByTestId('member-360-waiting-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByTestId('member-360-waiting-open')).toHaveCount(1);
  await expect(notice.getByTestId('member-360-waiting-open').getByRole('button')).toBeEnabled();
  await expect(page.getByTestId('member-360-intake')).toBeVisible();
  await expect(page.getByTestId('member-360-intake').getByTestId('member-360-run')).toHaveCount(1);
  await expect(notice.getByTestId('member-360-intake')).toHaveCount(0);
  await expect(page.getByTestId('member-360-generating')).toHaveCount(0);
  await expect(page.getByTestId('member-360-run-choice')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('start-over-structure.png'), fullPage: true });
});

test('the document has a loading state, then keeps checking a transient read failure on its own with no Retry button', async ({ page }, info) => {
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
  await expect(page.getByTestId('member-360-download')).toHaveCount(0);
  release?.();
  await expect(page.getByTestId('mktg-document-view-refresh-warning')).toContainText(MKTG_POLL_RETRYING_TEXT);
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-loading')).toBeVisible();
  await expect(page.getByTestId('member-360-download')).toHaveCount(0);
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
  await expect(method).toContainText('Routing rules:');
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
