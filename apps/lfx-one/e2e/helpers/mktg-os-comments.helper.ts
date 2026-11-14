// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentComment } from '@lfx-one/shared/interfaces';
import type { Page } from '@playwright/test';
import { setupAsset, ASSET_REVISION } from './mktg-os-assets.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

export async function setupComments(page: Page, hold = false) {
  await suppressCookieBanner(page);
  const asset = await setupAsset(page, { mode: 'ready' });
  const state = { rows: [] as MktgDocumentComment[], failRead: false, deny: false, failSave: false, holdSave: false, posts: [] as Record<string, unknown>[] };
  let releaseSave: () => void = () => undefined;
  const savePending = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let release: () => void = () => undefined;
  const pending = hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  await page.route('**/api/mktg-agents/documents/*/living/comments*', async (route) => {
    const post = route.request().method() === 'POST';
    const body = post ? (route.request().postDataJSON() as Record<string, unknown>) : {};
    if (post) state.posts.push(body);
    if (post && state.holdSave) await savePending;
    let status = 200;
    if (state.deny) status = 403;
    else if ((post && state.failSave) || (!post && state.failRead)) status = 503;
    if (!post) await pending;
    if (post && status === 200)
      state.rows.push({
        id: `synthetic-comment-${state.rows.length + 1}`,
        anchor: { kind: 'field', key: String((body['anchor'] as { key: string }).key) },
        revisionId: ASSET_REVISION,
        author: { name: 'Project writer' },
        text: String(body['text']),
        createdAt: '2026-10-21T10:00:00Z',
        status: 'open',
        sentInRun: null,
        resultRevisionId: null,
        resolution: null,
      });
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? { revisionId: ASSET_REVISION, threads: state.rows } : { error: 'Synthetic comments unavailable' }),
    });
  });
  return { ...asset, state, release, releaseSave };
}
