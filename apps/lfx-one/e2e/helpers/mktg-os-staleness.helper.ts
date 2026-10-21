// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES, MKTG_KIT_POSITIONING_FAMILY_ID } from '@lfx-one/shared/constants';
import type { MktgDocumentsResponse, MktgRebuildResponse, MktgRevisionRef, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { mktgRebuildDocumentTypes } from '@lfx-one/shared/utils/mktg-rebuild.utils';
import { expect, Page } from '@playwright/test';
import { suppressCookieBanner } from './account-settings-email.helper';
import { draftFrameworkAsset } from './mktg-os-asset-views.helper';
import { DOCUMENT_PROJECT, fulfillDocumentJson, setupDocuments } from './mktg-os-documents.helper';

export const STALENESS_FAMILY_URL = `/project/mktg-os-agents/families/${MKTG_KIT_POSITIONING_FAMILY_ID}?project=${DOCUMENT_PROJECT.slug}`;
export const STALENESS_KIT_URL = `/project/mktg-os-agents?project=${DOCUMENT_PROJECT.slug}`;
export const STALENESS_ASSET_URL = `/project/mktg-os-agents/documents/foundation-message/living?project=${DOCUMENT_PROJECT.slug}`;
export const upstreamRef = (number: number): MktgRevisionRef => ({
  agentKey: 'foundation-message',
  revisionId: `${String(number).padStart(6, '0')}-${String(number).repeat(64)}`,
  revisionNumber: number,
  contentSha256: String(number).repeat(64),
});

export async function setupStaleness(
  page: Page,
  options: {
    writer?: boolean;
    empty?: boolean;
    stale?: boolean;
    unknown?: boolean;
    listError?: boolean;
    questions?: boolean;
    failSecond?: boolean;
    holdListing?: Promise<void>;
  } = {}
): Promise<{ starts: string[]; answers: unknown[] }> {
  await suppressCookieBanner(page);
  // Reuses main's shell/auth/flag/project stubs, including setupProjectSlugMock({ writer }).
  await setupDocuments(page, { writer: options.writer ?? true });
  const target = upstreamRef(3);
  const source = upstreamRef(1);
  const types = mktgRebuildDocumentTypes().filter((type) => type.agentKey !== 'brand-kit');
  let provenance: MktgRevisionRef | null = options.stale === false ? target : source;
  if (options.unknown) provenance = null;
  const stale = options.stale !== false && !options.unknown && !options.empty;
  const listing: MktgDocumentsResponse = {
    project: DOCUMENT_PROJECT.uid,
    approvedFramework: options.empty ? null : target,
    groups: MKTG_DOCUMENT_TYPES.map((type) => {
      const current = type.agentKey === 'foundation-message' ? target : source;
      const documents: MktgDocumentsResponse['groups'][number]['documents'] = [];
      if (!options.empty && ['foundation-message', 'boilerplates', 'faq', 'linkedin-post'].includes(type.agentKey)) {
        documents.push({
          agentKey: type.agentKey,
          documentId: type.kind === 'run' ? 'run-123456789012345678901234' : 'living',
          revisionCount: 3,
          latestRevisionId: current.revisionId,
          contentSha256: current.contentSha256,
          currentRevisionNumber: current.revisionNumber,
          approvedCurrent: type.kind === 'living' ? { revisionId: current.revisionId, number: current.revisionNumber } : null,
          updatedAt: '2026-10-21T08:00:00Z',
          createdAt: new Date().toISOString(),
          upstreamFramework: provenance,
          needsRebuild: stale && types.some((entry) => entry.agentKey === type.agentKey) ? { builtFrom: source, rebuildFrom: target } : null,
        });
      }
      return { type, documents };
    }),
  };
  const chain: MktgRebuildResponse = {
    project: DOCUMENT_PROJECT.uid,
    chainId: '12345678-1234-4123-8123-123456789abc',
    ownerToken: 'a'.repeat(64),
    framework: target,
    status: 'running',
    steps: types.map((type) => ({ agentId: type.catalogAgentId ?? '', agentKey: type.agentKey, status: 'queued', activity: [] })),
  };
  const starts: string[] = [];
  const answers: unknown[] = [];
  let answered = false;
  await page.route('**/api/mktg-agents/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (options.writer === false) return fulfillDocumentJson(route, { error: 'Write access required' }, 403);
    if (path.endsWith('/documents')) {
      if (options.holdListing) await options.holdListing;
      return fulfillDocumentJson(route, options.listError ? { error: 'Synthetic read failure' } : listing, options.listError ? 503 : 200);
    }
    if (path.includes('/rebuild/')) {
      const request = route.request().postDataJSON();
      if (path.endsWith('/start')) {
        chain.steps[0].status = 'running';
        starts.push(chain.steps[0].agentId);
      }
      if (path.endsWith('/advance')) {
        const step = chain.steps[request.stepIndex];
        if (request.answers) {
          answers.push(request);
          answered = true;
          delete step.questions;
          delete step.questionsId;
        } else starts.push(step.agentId);
        step.status = 'running';
        chain.status = 'running';
      }
      if (path.endsWith('/result')) {
        const index = chain.steps.findIndex((step) => step.status !== 'draft');
        const step = chain.steps[index];
        if (options.questions && index === 0 && !answered) {
          step.status = 'questions';
          step.questionsId = 'synthetic-q1';
          step.questions = [
            {
              key: 'domain',
              label: 'Domain',
              question: 'Which project domain should appear?',
              why: 'The source was unavailable.',
              suggestedAnswer: 'mesh.example',
              basis: [],
            },
          ];
          chain.status = 'questions';
        } else if (options.failSecond && index === 1) {
          step.status = 'failed';
          step.message = 'Synthetic source unavailable';
          chain.status = 'failed';
        } else {
          step.status = 'draft';
          step.persistence = {
            s3_key: `documents/${chain.project}/${step.agentKey}/living/${upstreamRef(2).revisionId}.json`,
            content_sha256: '2'.repeat(64),
            project: chain.project,
            version: 1,
          };
          if (chain.steps.every((entry) => entry.status === 'draft')) chain.status = 'complete';
        }
      }
      return fulfillDocumentJson(route, chain);
    }
    const parts = path.split('/');
    const key = parts[4];
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key);
    if (path.includes('/documents/') && type) {
      const isFramework = key === 'foundation-message';
      const openedDraft = path.includes(upstreamRef(2).revisionId);
      const number = isFramework ? 3 : 2;
      const ref = upstreamRef(number);
      const revision = {
        id: ref.revisionId,
        number,
        createdAt: '2026-10-21T08:00:00Z',
        origin: 'generated' as const,
        restoredFromNumber: null,
        intakeMode: 'form' as const,
        status: '',
        contentSha256: ref.contentSha256,
        format: isFramework ? ('json' as const) : ('markdown' as const),
        commentCount: 0,
        latest: !openedDraft,
        approval: isFramework ? { approvedAt: '2026-10-21T08:01:00Z', approvedBy: null } : null,
      };
      const asset = draftFrameworkAsset();
      const response: MktgRevisionResponse = {
        project: DOCUMENT_PROJECT.uid,
        type,
        documentId: 'living',
        revisions: [revision],
        approvedCurrent: isFramework ? { revisionId: ref.revisionId, number } : null,
        revision,
        approval: revision.approval,
        markdown: isFramework ? JSON.stringify(asset.content) : '# Synthetic rebuilt draft\n\nReady for review.',
        sidecar: isFramework ? { mode: asset.mode, report: asset.report, checks: asset.checks } : null,
      };
      return fulfillDocumentJson(route, response);
    }
    return fulfillDocumentJson(route, { error: 'No synthetic resource' }, 404);
  });
  return { starts, answers };
}

export async function openStaleness(page: Page, url = STALENESS_FAMILY_URL): Promise<void> {
  await page.evaluate((destination) => {
    history.pushState({}, '', destination);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await expect(page.getByTestId('mktg-family-page').or(page.getByTestId('mktg-kit-page')).or(page.getByTestId('mktg-document-view-page'))).toBeVisible({
    timeout: 20_000,
  });
}
