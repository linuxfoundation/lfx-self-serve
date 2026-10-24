// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Page } from '@playwright/test';
import type { MktgDocumentComment } from '@lfx-one/shared/interfaces';
import { ASSET_PROJECT, ASSET_REVISION, assetRevision } from './mktg-os-assets.helper';
import { setupComments } from './mktg-os-comments.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

export const redraftComment = (id: string): MktgDocumentComment => ({
  id,
  anchor: { kind: 'field', key: 'mf.positioning' },
  revisionId: ASSET_REVISION,
  author: { name: 'Project writer' },
  text: 'Shorten the synthetic positioning.',
  createdAt: '2026-10-21T10:00:00Z',
  status: 'open',
  sentInRun: null,
  resultRevisionId: null,
  resolution: null,
});

export async function redraftFixture(page: Page) {
  await suppressCookieBanner(page);
  const fixture = await setupComments(page);
  const nextId = `000002-${'b'.repeat(64)}`;
  fixture.state.rows = [redraftComment('comment-one'), redraftComment('comment-two')];
  const state = { done: false, fail: false, releaseBusy: true, sends: [] as Record<string, unknown>[] };
  const base = assetRevision();
  base.revision.draftVersion = 1;
  base.revision.approval = { approvedAt: '2026-10-21T10:00:00Z', approvedBy: { name: 'Project writer' } };
  const revised = { ...base.revision, id: nextId, number: 2, draftVersion: 2, latest: false, approval: null, origin: 'revised' as const };
  await page.route('**/api/mktg-agents/documents/*/living**', async (route) => {
    const url = new URL(route.request().url());
    let status = 200;
    let response: unknown;
    if (url.pathname.endsWith('/comments'))
      response = {
        revisionId: url.searchParams.get('revision'),
        threads:
          url.searchParams.get('revision') === nextId
            ? fixture.state.rows.map((row) => ({ ...row, status: 'resolved', resultRevisionId: nextId, resolution: 'Updated synthetically.' }))
            : fixture.state.rows,
      };
    else if (url.pathname.endsWith('/release')) {
      status = state.releaseBusy ? 409 : 200;
      response = state.releaseBusy ? { code: 'MKTG_REDRAFT_COMMENTS_BUSY' } : { success: true };
    } else if (url.pathname.endsWith('/revise')) {
      state.sends.push(route.request().postDataJSON());
      status = state.fail ? 503 : 200;
      response = state.fail
        ? { code: 'MKTG_REDRAFT_START_UNCERTAIN' }
        : { sessionId: 'synthetic-redraft', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 1 };
    } else {
      const isNew = url.pathname.endsWith(nextId);
      const content = JSON.parse(base.markdown);
      if (isNew) content.mf.tagline = 'Revised synthetic tagline.';
      response = {
        ...base,
        revision: isNew ? revised : base.revision,
        markdown: JSON.stringify(content),
        revisions: state.done ? [revised, base.revision] : [base.revision],
        current: { revisionId: ASSET_REVISION, changedAt: '2026-10-21T10:00:00Z', changedBy: { name: 'Project writer' } },
        approvedCurrent: { revisionId: ASSET_REVISION, number: 1 },
        runs: [],
      };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.route('**/api/mktg-agents/foundation-message/result', async (route) => {
    const response = state.done
      ? {
          status: 'ready',
          version: 2,
          documentMarkdown: '# Synthetic redraft',
          persistence: {
            project: ASSET_PROJECT.uid,
            version: 2,
            s3_key: 'synthetic',
            content_sha256: 'b'.repeat(64),
            document_location: { agent_key: 'foundation-message', document_id: 'living', revision_id: nextId },
          },
        }
      : { status: 'pending', activity: [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return { fixture, state, nextId };
}
