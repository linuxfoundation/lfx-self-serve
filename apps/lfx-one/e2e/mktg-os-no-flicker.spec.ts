// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import type { MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, kitDocuments, kitRevision, kitJson, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';
import { DOCUMENTS_URL, openDocuments, setupDocuments, startedDocumentRun } from './helpers/mktg-os-documents.helper';
import { MEMBER_360_DOCUMENT_ID, openMember360, setupMember360 } from './helpers/member-360.helper';
import { member360Revision } from './fixtures/mock-data/member-360.mock';
import { redraftFixture } from './helpers/mktg-os-redraft.helper';

// Deliberately hold reads instead of racing fast local fixtures: QA can capture both paints.
test.beforeEach(async ({ page }) => suppressCookieBanner(page));
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('settled.png'), fullPage: true });
});

test('living document lands with its catalog title and resolved action, never Run again first', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await setupKit(page, { loaded: true, revisionHold: hold });
  await openKit(page, '/documents/foundation-message/living');
  await expect(page.getByTestId('mktg-document-view-title-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-action-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-run-again')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('loading.png'), fullPage: true });
  release();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveText(`${KIT_PROJECT.name} Messaging framework`);
  await expect(page.getByTestId('mktg-document-view-run-again')).toHaveText('Create a new version');
});

test('an approval in a second browser context updates the open document in place without reload', async ({ page, browser, kitRequestCheck }, info) => {
  const type = kitDocuments(true).groups.find((group) => group.type.agentKey === 'foundation-message')?.type;
  if (!type) throw new Error('Missing synthetic framework type');
  const original = kitRevision(type);
  const newer = { ...original.revision, id: `000004-${'b'.repeat(64)}`, number: 4, latest: false };
  let response: MktgRevisionResponse = { ...original, revisions: [newer, original.revision] };
  const path = `/api/mktg-agents/documents/${type.agentKey}/living`;
  await setupKit(page, { loaded: true });
  await page.route(
    (url) => url.pathname === path,
    (route) => kitJson(route, response)
  );
  await page.route(
    (url) => url.pathname === `${path}/revisions/${newer.id}`,
    (route) => kitJson(route, { ...response, revision: response.revisions[0], approval: response.revisions[0]?.approval })
  );
  await openKit(page, `/documents/${type.agentKey}/living`);
  await expect(page.getByTestId('mktg-document-view-content')).toBeVisible();
  const tab = page.getByTestId('mktg-framework-view-tab-numbers');
  await tab.click();
  const ids = ['mktg-document-view-title', 'mktg-document-view-content', 'mktg-document-view-revisions', 'mktg-framework-view-tab-numbers'];
  for (const id of ids) await page.getByTestId(id).evaluate((node) => (node.dataset['liveIdentity'] = 'kept'));
  const originalUrl = page.url();
  const content = await page.getByTestId('mktg-document-view-content').textContent();
  const fresh = await browser.newContext({ storageState: info.project.use.storageState, proxy: info.project.use.proxy, baseURL: info.project.use.baseURL });
  try {
    const approver = await fresh.newPage();
    kitRequestCheck(approver);
    await setupKit(approver, { loaded: true });
    await approver.route(
      (url) => url.pathname === path,
      (route) => kitJson(route, response)
    );
    await approver.route(
      (url) => url.pathname === `${path}/comments`,
      (route) => kitJson(route, { revisionId: new URL(route.request().url()).searchParams.get('revision'), threads: [] })
    );
    await approver.route(
      (url) => url.pathname === `${path}/revisions/${newer.id}`,
      (route) => kitJson(route, { ...response, revision: newer })
    );
    await approver.route(
      (url) => url.pathname === `${path}/revisions/${newer.id}/approve`,
      async (route) => {
        expect(route.request().method()).toBe('POST');
        const approval = { approvedAt: '2026-10-29T12:00:00Z', approvedBy: { name: 'Synthetic reviewer' } };
        const approved = { ...newer, approval, latest: true };
        response = {
          ...original,
          revisions: [approved, { ...original.revision, latest: false }],
          approvedCurrent: { revisionId: approved.id, number: approved.number },
        };
        await kitJson(route, { ...response, revision: approved, approval });
      }
    );
    await openKit(approver, `/documents/${type.agentKey}/living`);
    await approver.getByTestId('mktg-document-view-open-4').click();
    await approver.getByTestId('mktg-document-view-approve').getByRole('button').click();
    await approver.getByRole('button', { name: 'Approve anyway', exact: true }).click();
    await expect(approver.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    await expect(page.getByTestId('mktg-document-view-new-approval')).toContainText('v4 was approved by Synthetic reviewer', { timeout: 20_000 });
    await expect(page.getByTestId('mktg-document-view-new-approval').getByRole('link', { name: 'Open it' })).toHaveAttribute(
      'href',
      new RegExp(`revision=${newer.id}`)
    );
    await expect(page.getByTestId('mktg-document-view-current-4')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-revision-label-4')).toContainText('Approved');
    await expect(page).toHaveURL(originalUrl);
    for (const id of ids) await expect(page.getByTestId(id)).toHaveAttribute('data-live-identity', 'kept');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('mktg-document-view-content')).toHaveText(content ?? '');
    await expect(page.getByTestId('mktg-document-view-loading')).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});

test('two document progress polls keep the selected tab, expanded history, composer, focus and scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setupKit(page, { loaded: true });
  const type = kitDocuments(true).groups.find((group) => group.type.agentKey === 'foundation-message')?.type;
  if (!type) throw new Error('Missing synthetic framework type');
  const stored = kitRevision(type);
  const revisions = Array.from({ length: 9 }, (_, index) => {
    const number = 9 - index;
    return number === stored.revision.number
      ? stored.revision
      : { ...stored.revision, number, id: `${String(number).padStart(6, '0')}-${'a'.repeat(64)}`, latest: false };
  });
  let response: MktgRevisionResponse = {
    ...stored,
    revisions,
    runs: [{ ...startedDocumentRun('writing'), project: KIT_PROJECT.uid, agentKey: type.agentKey }],
  };
  const path = `/api/mktg-agents/documents/${type.agentKey}/living`;
  let polls = 0;
  let bodyReads = 0;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (new URL(route.request().url()).searchParams.get('poll') === '1') polls++;
      await kitJson(route, response);
    }
  );
  await page.route(
    (url) => url.pathname.startsWith(`${path}/revisions/`),
    async (route) => {
      bodyReads++;
      await kitJson(route, response);
    }
  );
  await openKit(page, `/documents/${type.agentKey}/living`);
  const tab = page.getByTestId('mktg-framework-view-tab-numbers');
  await tab.click();
  const disclosure = page.getByTestId('mktg-document-view-show-all-revisions');
  await disclosure.click();
  const field = page.getByTestId('mktg-field-comments-nums[0]');
  await field.hover();
  await field.getByRole('button', { name: /^Comment on/ }).click();
  const composer = field.getByRole('textbox');
  await composer.fill('Synthetic draft kept while document progress refreshes.');
  await composer.focus();
  await composer.evaluate((node) => (node.dataset['refreshIdentity'] = 'kept'));
  const readiness = page.getByTestId('mktg-document-view-readiness');
  await expect(readiness).toBeVisible();
  const readyText = await readiness.textContent();
  const tabs = page.getByTestId('mktg-framework-view-tabs');
  const tabsTop = (await tabs.boundingBox())?.y;
  expect(tabsTop).toBeDefined();
  const scroll = await page.evaluate(() => window.scrollY);
  const before = polls;
  const bodyReadsBefore = bodyReads;
  await expect.poll(() => polls, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2);
  expect(bodyReads).toBe(bodyReadsBefore);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=numbers/);
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('mktg-document-view-revisions').locator('ol > li')).toHaveCount(9);
  await expect(composer).toHaveValue('Synthetic draft kept while document progress refreshes.');
  await expect(composer).toHaveAttribute('data-refresh-identity', 'kept');
  await expect(composer).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  const produced = { ...stored.revision, id: `000010-${'a'.repeat(64)}`, number: 10, latest: true };
  response = {
    ...response,
    runs: [],
    revisions: [produced, ...revisions.map((row) => ({ ...row, latest: false }))],
    current: { revisionId: produced.id, changedAt: '2026-10-29T12:00:00Z', changedBy: null },
  };
  const beforeStore = polls;
  await expect.poll(() => polls, { timeout: 20_000 }).toBeGreaterThan(beforeStore);
  await expect(page.getByTestId('mktg-document-view-new-approval')).toContainText('v10 was produced');
  await expect(page.getByTestId('mktg-document-view-revisions').getByTestId('mktg-document-view-history-bar')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-content').getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
  await expect(readiness).toHaveText(readyText ?? '');
  expect((await tabs.boundingBox())?.y).toBe(tabsTop);
  expect(bodyReads).toBe(bodyReadsBefore);
  await expect(composer).toBeFocused();
});

test('two same-scope comments refreshes keep the heading and thread nodes without a skeleton', async ({ page }) => {
  const { fixture } = await redraftFixture(page);
  let reads = 0;
  let release = () => {};
  let pending = Promise.resolve();
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/documents/foundation-message/living/comments',
    async (route) => {
      reads++;
      await pending;
      await kitJson(route, { revisionId: new URL(route.request().url()).searchParams.get('revision'), threads: fixture.state.rows });
    }
  );
  // A definitive refusal clears only the send intent and refreshes the same comments;
  // no live generation, navigation or successful write is needed for either cycle.
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/documents/foundation-message/living/revise',
    (route) => kitJson(route, { code: 'MKTG_REDRAFT_COMMENTS_BUSY' }, 409)
  );
  await fixture.open();
  const panel = page.getByTestId('mktg-comments-panel');
  const heading = panel.getByRole('heading', { name: 'Comments', exact: true });
  const threads = panel.getByTestId('mktg-comment-thread');
  await expect(heading).toBeVisible();
  await expect(threads).toHaveCount(2);
  await heading.evaluate((node) => node.setAttribute('data-refresh-identity', 'heading'));
  for (let index = 0; index < 2; index++) {
    await threads.nth(index).evaluate((node, id) => node.setAttribute('data-refresh-identity', id), `thread-${index}`);
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    pending = new Promise<void>((resolve) => (release = resolve));
    const before = reads;
    await panel.getByRole('button', { name: 'Send 2 open comments to the agent', exact: true }).click();
    try {
      await expect.poll(() => reads).toBeGreaterThan(before);
      await expect(heading).toBeVisible();
      await expect(heading).toHaveAttribute('data-refresh-identity', 'heading');
      await expect(threads).toHaveCount(2);
      for (let index = 0; index < 2; index++) await expect(threads.nth(index)).toHaveAttribute('data-refresh-identity', `thread-${index}`);
      await expect(panel.getByTestId('mktg-comments-loading')).toHaveCount(0);
    } finally {
      release();
    }
    await expect(panel.getByRole('button', { name: 'Send 2 open comments to the agent', exact: true })).toBeEnabled();
    await expect(heading).toHaveAttribute('data-refresh-identity', 'heading');
    for (let index = 0; index < 2; index++) await expect(threads.nth(index)).toHaveAttribute('data-refresh-identity', `thread-${index}`);
    await expect(panel.getByTestId('mktg-comments-loading')).toHaveCount(0);
  }
});

test('approving during progress polls keeps the settled rail without inserting parent skeletons', async ({ page }) => {
  await setupKit(page, { loaded: true });
  const type = kitDocuments(true).groups.find((group) => group.type.agentKey === 'foundation-message')?.type;
  if (!type) throw new Error('Missing synthetic framework type');
  const response = { ...kitRevision(type, false), runs: [{ ...startedDocumentRun('writing'), project: KIT_PROJECT.uid, agentKey: type.agentKey }] };
  const path = `/api/mktg-agents/documents/${type.agentKey}/living`;
  let approved = false;
  let polls = 0;
  let rereads = 0;
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === path || url.pathname.startsWith(`${path}/revisions/`),
    async (route) => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname.endsWith('/approve')) {
        approved = true;
        response.approval = { approvedAt: '2026-10-29T10:00:00Z', approvedBy: null };
        response.revision = { ...response.revision, approval: response.approval };
        response.revisions = [response.revision];
        response.approvedCurrent = { revisionId: response.revision.id, number: response.revision.number };
      }
      if (new URL(route.request().url()).searchParams.get('poll') === '1') polls++;
      await kitJson(route, response);
    }
  );
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/documents',
    async (route) => {
      if (approved) {
        rereads++;
        await hold;
      }
      await kitJson(route, kitDocuments(true));
    }
  );
  await openKit(page, `/documents/${type.agentKey}/living`);
  await expect(page.getByTestId('mktg-document-view-about')).toBeVisible();
  const rail = page.locator('section[aria-label="Revision details"]');
  const identities = await rail.evaluate((element) => {
    element.setAttribute('data-skeleton-added', 'false');
    const selector = '[data-testid^="mktg-document-view-"][data-testid$="-skeleton"]';
    new MutationObserver((records) => {
      if (
        records.some((record) =>
          Array.from(record.addedNodes).some((node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector)))
        )
      ) {
        element.setAttribute('data-skeleton-added', 'true');
      }
    }).observe(element, { childList: true, subtree: true });
    return Array.from(element.children).map((child, index) => {
      const identity = `${child.tagName}-${index}`;
      child.setAttribute('data-refresh-identity', identity);
      return identity;
    });
  });
  await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
  await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
  await expect.poll(() => rereads).toBeGreaterThan(0);
  const before = polls;
  await expect.poll(() => polls, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2);
  await expect(page.getByTestId('mktg-comments-panel')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-about')).toBeVisible();
  await expect(rail).toHaveAttribute('data-skeleton-added', 'false');
  expect(await rail.evaluate((element) => Array.from(element.children).map((child) => child.getAttribute('data-refresh-identity')))).toEqual(identities);
  release();
  await expect(page.getByTestId('mktg-document-view-downstream-skeleton')).toHaveCount(0);
});

test('the first framework content settles with its last-export answer and the rail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setupKit(page, { loaded: true, approvedFramework: true });
  const type = kitDocuments(true).groups.find((group) => group.type.agentKey === 'foundation-message')?.type;
  if (!type) throw new Error('Missing synthetic framework type');
  const revision = kitRevision(type).revision;
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/slides-export/last',
    async (route) => {
      await hold;
      await kitJson(route, {
        last: {
          schema: 'mktg-slides-export/v1',
          project: KIT_PROJECT.uid,
          agentKey: type.agentKey,
          documentId: 'living',
          revisionId: revision.id,
          revisionNumber: revision.number,
          contentSha256: revision.contentSha256,
          mode: 'create',
          deckId: 'SyntheticDeck',
          link: 'https://docs.google.com/presentation/d/SyntheticDeck/edit',
          title: 'Synthetic framework export',
          slideCount: 1,
          assets: ['framework'],
          branded: { kit: false, logo: false, backgrounds: 0, text_colors: 0, fonts: 0, bars: 0, logos: 0, logos_skipped: 0, tables_header: null },
          exportedAt: '2026-10-28T09:39:00Z',
          agentVersion: '1.0.0',
        },
        latestRevision: { id: revision.id, number: revision.number, contentSha256: revision.contentSha256 },
      });
    }
  );
  await openKit(page, '/documents/foundation-message/living');
  await expect(page.getByTestId('mktg-document-view-content-skeleton')).toBeVisible();
  await expect(page.getByTestId('mktg-slides-export-lookup-loading')).toBeHidden();
  await expect(page.getByTestId('mktg-document-view-about')).toBeHidden();
  const tabs = page.getByTestId('mktg-framework-view-tabs');
  await expect(tabs).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('export-history-pending.png'), fullPage: true });
  release();
  await expect(page.getByTestId('mktg-slides-export-last-link')).toBeVisible();
  await expect(page.getByTestId('mktg-slides-export-last-link')).toHaveText(/Open the last export/);
  await expect(page.getByTestId('mktg-document-view-about')).toBeVisible();
  expect(
    await page.locator('section[aria-label="Revision details"]').evaluate((rail) =>
      Array.from(rail.children)
        .filter((card) => card.tagName !== 'LFX-MKTG-SKELETON')
        .map((card) => card.getAttribute('data-testid') ?? card.tagName)
    )
  ).toEqual(['LFX-MKTG-COMMENTS-PANEL', 'mktg-document-view-revisions', 'LFX-MKTG-DOWNSTREAM', 'mktg-document-view-about']);
  await expect(page.getByTestId('mktg-document-view-content-skeleton')).toHaveCount(0);
  await expect(tabs).toBeVisible();
  const before = await tabs.boundingBox();
  expect(before).not.toBeNull();
  if (!before) throw new Error('Missing synthetic framework tabs');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await tabs.boundingBox();
  expect(after).not.toBeNull();
  if (!after) throw new Error('Missing settled framework tabs');
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test('an empty first export lookup shows no line and settles the tabs without a later collapse', async ({ page }) => {
  await setupKit(page, { loaded: true, approvedFramework: true });
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/slides-export/last',
    async (route) => {
      await hold;
      await kitJson(route, { last: null, latestRevision: null });
    }
  );
  await openKit(page, '/documents/foundation-message/living');
  const tabs = page.getByTestId('mktg-framework-view-tabs');
  await expect(page.getByTestId('mktg-document-view-content-skeleton')).toBeVisible();
  await expect(tabs).toBeHidden();
  await expect(page.getByTestId('mktg-slides-export-panel')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('empty-export-pending.png'), fullPage: true });
  release();
  await expect(tabs).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-about')).toBeVisible();
  await expect(page.getByTestId('mktg-slides-export-panel')).toHaveCount(0);
  await expect(page.getByTestId('mktg-slides-export-lookup-loading')).toHaveCount(0);
  const before = await tabs.boundingBox();
  expect(before).not.toBeNull();
  if (!before) throw new Error('Missing synthetic empty-export tabs');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await tabs.boundingBox();
  expect(after).not.toBeNull();
  if (!after) throw new Error('Missing settled empty-export tabs');
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test('Member 360 title waits for the resolved reporting period', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await setupMember360(page, { stored: true });
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, async (route) => {
    await hold;
    await kitJson(route, member360Revision());
  });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('mktg-document-view-title-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveCount(0);
  release();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveText('Member 360 · 2026-Q3');
});

test('Documents reserves started runs on arrival and keeps the slot when a run ends', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  const run = startedDocumentRun();
  const runs = [run];
  await setupDocuments(page, { runs });
  let first = true;
  await page.route('**/api/mktg-agents/documents?*', async (route) => {
    if (first) {
      first = false;
      await hold;
    }
    await route.fallback();
  });
  await openDocuments(page);
  await expect(page.getByTestId('mktg-documents-started-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-documents-started-runs')).toHaveCount(0);
  release();
  await expect(page.getByTestId(`mktg-documents-started-run-${run.runId}`)).toBeVisible();
  runs.splice(0);
  const slot = page.getByTestId('mktg-documents-started-runs');
  await expect(slot).toContainText('No runs in progress', { timeout: 15_000 });
  await expect(slot).toBeVisible();
  await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
});

test('Documents navigation refetch does not blank loaded content or badges', async ({ page }) => {
  await setupDocuments(page);
  await openDocuments(page, DOCUMENTS_URL.replace(/&type=[^&]+/, ''));
  await expect(page.getByTestId('mktg-documents-all')).toBeVisible();
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/mktg-agents/documents?*', async (route) => {
    await hold;
    await route.fallback();
  });
  await page.getByTestId('mktg-documents-nav-icp').click();
  await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
  await expect(page.getByTestId('mktg-documents-loading')).toHaveCount(0);
  await expect(page.getByTestId('mktg-documents-nav-icp')).toContainText('current');
  release();
});

test('Family reserves its header action until the kit answers', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await setupKit(page, { loaded: true, hold });
  await openKit(page, '/families/positioning-brand');
  await expect(page.getByTestId('mktg-family-action-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-family-actions')).toHaveCount(0);
  await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
  release();
  await expect(page.getByTestId('mktg-family-run')).toContainText('Review 4 drafts');
  await expect(page.getByTestId('mktg-family-assets')).toBeVisible();
  await expect(page.getByTestId('mktg-family-action-loading')).toHaveCount(0);
});
