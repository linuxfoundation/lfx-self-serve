// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Page } from '@playwright/test';
import type { MktgDocumentComment } from '@lfx-one/shared/interfaces';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { structuredCommentAsset } from './mktg-os-structured-comments.helper';
import { readFaqContent } from '@lfx-one/shared/utils/faq.utils';
import { ASSET_PROJECT, ASSET_REVISION, setupAsset } from './mktg-os-assets.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

export async function setupStructuredComments(page: Page, agentKey: 'brand-kit' | 'boilerplates' | 'faq', writer = true) {
  await suppressCookieBanner(page);
  const { base, kit, key } = await structuredCommentAsset(page, agentKey);
  const fixture = await setupAsset(page, { mode: 'ready', writer, asset: base });
  const nextId = `000002-${'b'.repeat(64)}`;
  const revised = { ...base.revision, id: nextId, number: 2, draftVersion: 2, latest: false, approval: null, origin: 'revised' as const };
  const state = {
    done: false,
    fail: false,
    hold: false,
    uncertain: false,
    releaseBusy: true,
    releases: 0,
    rows: [] as MktgDocumentComment[],
    sends: [] as Record<string, unknown>[],
    adds: [] as Record<string, unknown>[],
  };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/mktg-agents/documents/${agentKey}/living**`, async (route) => {
    if (!writer) return route.fulfill({ status: 403, json: { error: 'Synthetic no access' } });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/comments')) {
      if (state.hold) await gate;
      if (state.fail) return route.fulfill({ status: 503, json: { error: 'Synthetic comments unavailable' } });
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        state.adds.push(body);
        state.rows.push({
          id: 'synthetic-pinned-comment',
          revisionId: ASSET_REVISION,
          anchor: { kind: agentKey === 'brand-kit' ? 'passage' : 'field', key, ...(agentKey === 'brand-kit' && { passage: kit.chapters.voice.line }) },
          author: { name: 'Project writer' },
          text: String(body.text),
          createdAt: '2026-10-21T10:00:00Z',
          status: 'open',
          sentInRun: null,
          resultRevisionId: null,
          resolution: null,
        });
      }
      return route.fulfill({
        json: {
          revisionId: url.searchParams.get('revision') ?? ASSET_REVISION,
          threads: state.done
            ? state.rows.map((row) => ({
                ...row,
                status: 'resolved',
                resultRevisionId: nextId,
                resolution: agentKey === 'faq' ? 'Added the supplied answer as Notes.' : 'Shortened the selected passage.',
              }))
            : state.rows,
        },
      });
    }
    if (url.pathname.endsWith('/release')) {
      state.releases++;
      if (state.releaseBusy) return route.fulfill({ status: 409, json: { code: 'MKTG_REDRAFT_COMMENTS_BUSY' } });
      state.rows = state.rows.map((row) => ({ ...row, status: 'open', sentInRun: null }));
      return route.fulfill({ json: { success: true } });
    }
    if (url.pathname.endsWith('/revise')) {
      state.sends.push(route.request().postDataJSON());
      if (state.uncertain) return route.fulfill({ status: 503, json: { code: 'MKTG_REDRAFT_START_UNCERTAIN' } });
      state.rows = state.rows.map((row) => ({ ...row, status: 'sent', sentInRun: 'c'.repeat(64) }));
      return route.fulfill({ json: { sessionId: 'synthetic-redraft', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 1 } });
    }
    const isNew = url.pathname.endsWith(nextId);
    const sidecar = structuredClone(base.sidecar);
    let markdown = base.markdown;
    if (isNew && sidecar) {
      if (agentKey === 'brand-kit') {
        const nextKit = brandKitTestRevision();
        nextKit.chapters.voice.line = 'Revised synthetic brand line.';
        Object.assign(sidecar, { chapters: nextKit.chapters, version: 2, mode: 'redraft' });
      } else if (agentKey === 'faq') {
        const content = readFaqContent(markdown);
        if (!content) throw new Error('Missing synthetic FAQ content');
        content.faq[0][1][2][1] = state.rows[0]?.text ?? '';
        content.faq[0][1][2][2] = 'Notes';
        markdown = JSON.stringify(content);
        Object.assign(sidecar, { version: 2, mode: 'redraft', checks: { findings: [], unanswered: [] }, report: { ...kit.report, gaps: [] } });
      } else {
        const content = JSON.parse(markdown);
        content.bp[1].t = 'Revised synthetic boilerplate.';
        markdown = JSON.stringify(content);
      }
    }
    return route.fulfill({
      json: {
        ...base,
        sidecar,
        markdown,
        revision: isNew ? revised : base.revision,
        revisions: state.done ? [revised, base.revision] : [base.revision],
        current: { revisionId: ASSET_REVISION, changedAt: '2026-10-21T10:00:00Z', changedBy: { name: 'Project writer' } },
        approvedCurrent: { revisionId: ASSET_REVISION, number: 1 },
      },
    });
  });
  await page.route(`**/api/mktg-agents/${agentKey}/result`, (route) =>
    route.fulfill({
      json: state.done
        ? {
            status: 'ready',
            version: 2,
            documentMarkdown: '# Synthetic redraft',
            persistence: {
              project: ASSET_PROJECT.uid,
              version: 2,
              s3_key: 'synthetic',
              content_sha256: 'b'.repeat(64),
              document_location: { agent_key: agentKey, document_id: 'living', revision_id: nextId },
            },
          }
        : { status: 'pending', activity: [] },
    })
  );
  return {
    ...fixture,
    state,
    key,
    nextId,
    release,
    exportChecks: () => fixture.state.exportChecks,
    open: () => fixture.open(agentKey === 'brand-kit' ? '&tab=voice' : ''),
  };
}
