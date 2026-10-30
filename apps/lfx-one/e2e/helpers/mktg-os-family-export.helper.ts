// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES, MKTG_FAMILY_EXPORT_API_PATH, MKTG_FAMILY_EXPORT_KINDS } from '@lfx-one/shared/constants';
import type { MktgDocumentsResponse, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { expect, Page } from '@playwright/test';
import { familyExportMember, familyExportRecord, familyExportStarted } from '../../src/app/shared/testing/mktg-family-export-test-data';
import { suppressCookieBanner } from './account-settings-email.helper';
import { DOCUMENT_PROJECT, setupDocuments } from './mktg-os-documents.helper';
import { columnAssetRevisionResponse, draftFrameworkAsset, nativeAssetRevisionResponse } from './mktg-os-asset-views.helper';

/** Only the authenticated shell uses harness state. Domain traffic is entirely synthetic. */
export async function openFamilyExports(
  page: Page,
  options: {
    familyId?: string;
    existing?: boolean;
    stale?: boolean;
    empty?: boolean;
    writer?: boolean;
    lookupStatus?: number;
    result?: 'pending' | 'failed';
    holdList?: boolean;
    holdPrint?: boolean;
    approvedFamily?: boolean;
    allAssets?: boolean;
  } = {}
) {
  await suppressCookieBanner(page);
  // Pins feature override, cookies, project writer permissions and shell APIs using the canonical helper.
  await setupDocuments(page, { writer: options.writer ?? true });
  const member = familyExportMember();
  const type = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === member.agentKey);
  if (!type) throw new Error('Synthetic framework type missing');
  const approval = { approvedAt: '2026-10-20T00:00:00Z', approvedBy: null };
  const base = nativeAssetRevisionResponse('faq');
  const asset = draftFrameworkAsset();
  const revision = { ...base.revision, id: member.revisionId, number: member.revisionNumber, contentSha256: member.contentSha256, approval };
  const response: MktgRevisionResponse = {
    ...base,
    project: DOCUMENT_PROJECT.uid,
    type,
    revision,
    revisions: [revision],
    approval,
    approvedCurrent: { revisionId: revision.id, number: revision.number },
    markdown: JSON.stringify(asset.content),
    sidecar: { report: asset.report, checks: asset.checks, mode: asset.mode },
  };
  const listing: MktgDocumentsResponse = {
    project: DOCUMENT_PROJECT.uid,
    groups: MKTG_DOCUMENT_TYPES.map((entry) => ({
      type: entry,
      documents:
        !options.empty && (entry.agentKey === type.agentKey || (options.approvedFamily && Object.hasOwn(MKTG_FAMILY_EXPORT_KINDS, entry.agentKey)))
          ? [
              {
                agentKey: entry.agentKey,
                documentId: 'living',
                revisionCount: 1,
                latestRevisionId: revision.id,
                currentRevisionNumber: 1,
                approvedCurrent: response.approvedCurrent,
                createdAt: revision.createdAt,
                updatedAt: revision.createdAt,
              },
            ]
          : [],
    })),
  };
  await page.route('**/api/mktg-agents/documents?*', (route) => {
    if (options.holdList) return;
    return route.fulfill({ status: options.writer === false ? 403 : 200, json: options.writer === false ? { code: 'FORBIDDEN' } : listing });
  });
  let releasePrint: () => void = () => undefined;
  const printGate = new Promise<void>((resolve) => {
    releasePrint = resolve;
  });
  await page.route('**/api/mktg-agents/documents/foundation-message/living/revisions/**', async (route) => {
    if (options.holdPrint) await printGate;
    return route.fulfill({ json: response });
  });
  const members = options.allAssets
    ? MKTG_DOCUMENT_TYPES.filter((entry) => Object.hasOwn(MKTG_FAMILY_EXPORT_KINDS, entry.agentKey)).map((entry) =>
        familyExportMember({ agentKey: entry.agentKey as keyof typeof MKTG_FAMILY_EXPORT_KINDS })
      )
    : [member];
  if (options.allAssets) {
    for (const current of members) {
      const asset = columnAssetRevisionResponse(current.agentKey);
      const revision = { ...asset.revision, id: current.revisionId, contentSha256: current.contentSha256 };
      await page.route(`**/api/mktg-agents/documents/${current.agentKey}/living/revisions/**`, async (route) => {
        if (options.holdPrint) await printGate;
        return route.fulfill({
          json: {
            ...asset,
            project: DOCUMENT_PROJECT.uid,
            revision,
            revisions: [revision],
            approvedCurrent: { revisionId: revision.id, number: revision.number },
          },
        });
      });
    }
  }
  let record = options.existing ? familyExportRecord({ project: DOCUMENT_PROJECT.uid }) : null;
  let ready = options.result !== 'pending';
  let started = familyExportStarted(DOCUMENT_PROJECT.uid);
  let lookupReads = 0;
  await page.route(`**${MKTG_FAMILY_EXPORT_API_PATH}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/last')) {
      lookupReads++;
      return route.fulfill({
        status: options.lookupStatus ?? 200,
        json: {
          last: record,
          currentMembers: options.empty ? [] : members,
          skippedMembers: options.allAssets ? [] : ['brand-kit', 'boilerplates', 'faq'],
          stale: options.stale ?? false,
        },
      });
    }
    if (path.endsWith('/start')) {
      const mode = route.request().postDataJSON().mode;
      started = { ...started, snapshot: { ...started.snapshot, mode, deckId: mode === 'update' ? (record?.deckId ?? null) : null } };
      return route.fulfill({ json: started });
    }
    if (path.endsWith('/result')) {
      if (options.result === 'failed')
        return route.fulfill({ json: { status: 'failed', failure: 'google', message: 'Synthetic export failure. Try again.', deckLink: null } });
      if (!ready) return route.fulfill({ json: { status: 'pending' } });
      const deckId = started.snapshot.mode === 'update' ? (record?.deckId ?? 'synthetic_deck_123') : 'synthetic_new_deck_123';
      record = familyExportRecord({
        project: DOCUMENT_PROJECT.uid,
        deckId,
        link: `https://docs.google.com/presentation/d/${deckId}/edit`,
        mode: started.snapshot.mode,
      });
      return route.fulfill({ json: { status: 'ready', record } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.evaluate(
    (url) => {
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    },
    `/project/mktg-os-agents/families/${options.familyId ?? 'positioning-brand'}?project=${DOCUMENT_PROJECT.slug}`
  );
  await expect(page.getByTestId('mktg-family-page')).toBeVisible();
  return {
    complete: () => {
      ready = true;
    },
    lookupReads: () => lookupReads,
    releasePrint,
  };
}
