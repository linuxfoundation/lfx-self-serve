// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES, MKTG_FAMILY_EXPORT_API_PATH, MKTG_FAMILY_EXPORT_KINDS, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import type { FaqContent, MktgDocumentsResponse, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { expect, Locator, Page } from '@playwright/test';
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
    /** With `allAssets`: the FAQ the family PDF prints, instead of the canonical envelope's. */
    faqContent?: FaqContent;
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
      const markdown = current.agentKey === 'faq' && options.faqContent ? JSON.stringify(options.faqContent) : asset.markdown;
      const revision = { ...asset.revision, id: current.revisionId, contentSha256: current.contentSha256 };
      await page.route(`**/api/mktg-agents/documents/${current.agentKey}/living/revisions/**`, async (route) => {
        if (options.holdPrint) await printGate;
        return route.fulfill({
          json: {
            ...asset,
            markdown,
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

/** One frame of the family book as the e2e reads it: the grammar's plan id and the book's page number. */
export interface FamilyBookFrame {
  id: string;
  page: number;
}

/**
 * The family book's frames, by the portrait grammar's contract (`[data-testid="lfx-mktg-portrait-page"]` with
 * `data-page-id` and `data-page`): every one 816×1056 with nothing laid out past its edge, the book opening on the
 * cover and contents, each document's opener before its pages, the Sources page and the back cover last, the numbers
 * rising by one across the frames (the flowing framework print of stage 1 takes its pages between its opener and the
 * next). Returns what the content assertions need: the openers, a frame by id, the kit's page count, the total.
 */
export async function expectFamilyBookFrames(book: Locator) {
  const pages = book.locator('[data-testid="lfx-mktg-portrait-page"]');
  const frames: FamilyBookFrame[] = (
    await pages.evaluateAll((elements) => elements.map((element) => [element.getAttribute('data-page-id') ?? '', Number(element.getAttribute('data-page'))]))
  ).map(([id, page]) => ({ id: String(id), page: Number(page) }));
  expect(frames.length).toBeGreaterThan(8);
  expect(frames.slice(0, 3).map((frame) => frame.id)).toEqual(['cover', 'contents', 'opener-foundation-message']);
  expect(frames.slice(-6).map((frame) => frame.id)).toEqual(['opener-boilerplates', 'boilerplates', 'opener-faq', 'faq-1', 'sources', 'back-cover']);
  expect(frames[3].id).toBe('opener-brand-kit');
  const openers = frames.filter((frame) => frame.id.startsWith('opener-'));
  expect(openers.map((frame) => frame.id)).toEqual(['opener-foundation-message', 'opener-brand-kit', 'opener-boilerplates', 'opener-faq']);
  // One plan numbers every frame: from the kit's opener on, the numbers rise by one; the framework's flowing pages sit
  // between its opener (3) and the kit's.
  expect(frames.slice(0, 3).map((frame) => frame.page)).toEqual([1, 2, 3]);
  expect(frames[3].page).toBeGreaterThan(3);
  frames.slice(4).forEach((frame, index) => expect(frame.page).toBe(frames[3].page + index + 1));
  const total = frames[frames.length - 1].page;
  // Every frame is one US Letter page, and nothing in it is laid out past its edge.
  const geometry = await pages.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const overflowing = Array.from(element.querySelectorAll<HTMLElement>('*')).filter((child) => {
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.left < box.left - 0.5 || rect.top < box.top - 0.5 || rect.right > box.right + 0.5 || rect.bottom > box.bottom + 0.5;
      });
      return { width: Math.round(box.width), height: Math.round(box.height), overflowing: overflowing.map((child) => child.className) };
    })
  );
  geometry.forEach((frame, index) => {
    expect({ id: frames[index].id, width: frame.width, height: frame.height }).toEqual({
      id: frames[index].id,
      width: MKTG_PORTRAIT_PAGE.width,
      height: MKTG_PORTRAIT_PAGE.height,
    });
    expect({ id: frames[index].id, overflowing: frame.overflowing }).toEqual({ id: frames[index].id, overflowing: [] });
  });
  const kitPages = frames.filter(
    (frame) => !frame.id.startsWith('opener-') && !['cover', 'contents', 'boilerplates', 'faq-1', 'sources', 'back-cover'].includes(frame.id)
  );
  return {
    frames,
    openers,
    total,
    kitPages: kitPages.length,
    byId: (id: string): Locator => book.locator(`[data-testid="lfx-mktg-portrait-page"][data-page-id="${id}"]`),
    byIdPage: (id: string): number => frames.find((frame) => frame.id === id)?.page ?? 0,
  };
}
