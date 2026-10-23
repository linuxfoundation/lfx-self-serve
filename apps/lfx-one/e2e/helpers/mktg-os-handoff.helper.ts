// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import {
  BRAND_KIT_CONTRACT_ID,
  BRAND_KIT_INTAKE,
  FOUNDATION_MESSAGE_INTAKE,
  MKTG_DOCUMENT_TYPES,
  MKTG_SLIDES_EXPORT_API_PATH,
} from '@lfx-one/shared/constants';
import type {
  MktgArtifactStoredResponse,
  MktgDocumentRunProgress,
  MktgRevisionResponse,
  MktgRunResultResponse,
  MktgRunSessionResponse,
} from '@lfx-one/shared/interfaces';
import { buildMktgRunActivity } from '@lfx-one/shared/utils/mktg-run-activity.utils';
import { noQuestionsActivityPayloads } from '@lfx-one/shared/utils/__fixtures__/mktg-run-activity.no-questions';
import { expect, Page } from '@playwright/test';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { DATA_LOAD_TIMEOUT, assetRevision } from './mktg-os-assets.helper';
import { DOCUMENT_PROJECT, fulfillDocumentJson, setupDocuments } from './mktg-os-documents.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

/** The browser receives real producer output from synthetic Guild payloads, never invented writing steps. */
export async function setupNoQuestionsHandoff(page: Page) {
  await suppressCookieBanner(page);
  await setupDocuments(page);
  const intake = BRAND_KIT_INTAKE;
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === intake.agentId);
  if (!type || !FOUNDATION_MESSAGE_INTAKE.endpoints.stored) throw new Error('Missing registered handoff fixture');
  const kit = brandKitTestRevision();
  const sidecar = {
    contract: BRAND_KIT_CONTRACT_ID,
    project_name: kit.projectName,
    project: DOCUMENT_PROJECT.uid,
    version: kit.version,
    mode: kit.mode,
    kit: kit.kit,
    chapters: kit.chapters,
    report: kit.report,
    inputs: { website_url: kit.websiteUrl },
    generated_at: kit.generatedAt,
    agent: { agent_version: kit.agentVersion },
  };
  const markdown = JSON.stringify(kit.kit);
  const digest = createHash('sha256').update(markdown).digest('hex');
  const summary = { ...assetRevision().revision, id: `000001-${digest}`, contentSha256: digest, createdAt: '2026-10-20T10:00:10Z' };
  const stored: MktgRevisionResponse = {
    project: DOCUMENT_PROJECT.uid,
    type,
    documentId: 'living',
    revisions: [summary],
    revision: summary,
    approval: null,
    approvedCurrent: null,
    markdown,
    sidecar,
    current: { revisionId: summary.id, changedAt: summary.createdAt, changedBy: null },
  };
  const prerequisite: MktgArtifactStoredResponse = {
    documentMarkdown: '# Synthetic framework',
    revisionNumber: 1,
    receipt: { project: DOCUMENT_PROJECT.uid, s3_key: 'synthetic-framework.md', content_sha256: 'a'.repeat(64), version: 1, intake_mode: 'form' },
    sidecar: {
      contract: 'messaging-document-output/v1',
      fields: { 'md.tagline': { value: 'Open, together', source: 'Synthetic source', status: 'approved' } },
    },
  };
  await page.route('**' + FOUNDATION_MESSAGE_INTAKE.endpoints.stored + '**', (route) => fulfillDocumentJson(route, prerequisite));
  await page.route('**' + MKTG_SLIDES_EXPORT_API_PATH + '**', (route) => fulfillDocumentJson(route, { last: null, latestRevision: null }));
  let stage: 'research' | 'between-rounds' | 'writing' | 'checking' | 'early-ready' | 'storing' | 'ready' | 'unconfirmed' = 'research';
  const posts: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (path === intake.endpoints.generate || path === intake.endpoints.answers)) posts.push(path);
  });
  const ack: MktgRunSessionResponse = { sessionId: 'synthetic-kit-session', ownerToken: 'synthetic-owner-proof', runId: 'b'.repeat(64) };
  await page.route('**' + intake.endpoints.generate, (route) => fulfillDocumentJson(route, ack));
  await page.route('**' + intake.endpoints.result, (route) => {
    if (stage === 'unconfirmed') return fulfillDocumentJson(route, { error: 'Synthetic invalid check' }, 400);
    let activityStage: 'research' | 'between-rounds' | 'writing' | 'checked' = 'writing';
    if (stage === 'research' || stage === 'between-rounds') activityStage = stage;
    if (stage === 'checking') activityStage = 'checked';
    const result: MktgRunResultResponse = { status: 'pending', activity: buildMktgRunActivity(noQuestionsActivityPayloads(activityStage, true)) };
    if (stage === 'ready' || stage === 'storing' || stage === 'early-ready') {
      result.status = 'ready';
      result.version = 1;
      result.documentMarkdown = markdown;
      result.brandKit = kit;
      result.activity = buildMktgRunActivity(noQuestionsActivityPayloads(stage === 'early-ready' ? 'writing' : 'checked', true));
    }
    if (stage === 'ready') {
      result.persistence = {
        project: DOCUMENT_PROJECT.uid,
        s3_key: 'synthetic-kit.json',
        content_sha256: digest,
        version: 1,
        document_location: { agent_key: type.agentKey, document_id: 'living', revision_id: summary.id },
      };
    }
    return fulfillDocumentJson(route, result);
  });
  await page.route(new RegExp('/documents/' + type.agentKey + '/living(?:\\?|$)'), (route) => {
    const runs: MktgDocumentRunProgress[] = [];
    if (stage !== 'ready') {
      runs.push({
        project: DOCUMENT_PROJECT.uid,
        agentKey: type.agentKey,
        documentId: 'living',
        runId: 'b'.repeat(64),
        state: stage === 'storing' ? 'storing' : 'writing',
        startedAt: '2026-10-20T10:00:05Z',
      });
    }
    return fulfillDocumentJson(route, { ...stored, revisions: stage === 'ready' ? [summary] : [], current: stage === 'ready' ? stored.current : null, runs });
  });
  await page.route('**/api/mktg-agents/documents/' + type.agentKey + '/living/revisions/**', (route) => fulfillDocumentJson(route, stored));
  const firstReading = buildMktgRunActivity(noQuestionsActivityPayloads('between-rounds', true)).find((step) => step.kind === 'reading');
  const lastReading = buildMktgRunActivity(noQuestionsActivityPayloads('writing', true))
    .filter((step) => step.kind === 'reading')
    .at(-1);
  if (!firstReading || !lastReading) throw new Error('Missing real producer research rows');
  return {
    posts,
    firstReadingId: firstReading.id,
    lastReadingId: lastReading.id,
    revision: summary,
    betweenRounds: () => {
      stage = 'between-rounds';
    },
    startChecking: () => {
      stage = 'checking';
    },
    earlyReady: () => {
      stage = 'early-ready';
    },
    startWriting: () => {
      stage = 'writing';
    },
    storing: () => {
      stage = 'storing';
    },
    finish: () => {
      stage = 'ready';
    },
    unconfirm: () => {
      stage = 'unconfirmed';
    },
    openAndGenerate: async () => {
      await page.evaluate((url) => {
        history.pushState({}, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      }, `/project/mktg-os-agents/${intake.agentId}?project=${DOCUMENT_PROJECT.slug}`);
      await expect(page.getByTestId('mktg-agent-run-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      for (const field of intake.fields) {
        if (field.optional) continue;
        if (field.kind !== 'text' && field.kind !== 'textarea') throw new Error('Unexpected required handoff fixture field');
        await page.locator(`[data-test="mktg-intake-${field.key}"]`).fill(field.format?.includes('url') ? 'https://synthetic.example' : 'Synthetic project');
      }
      const generate = page.getByTestId('mktg-agent-run-submit-button').getByRole('button');
      await expect(generate).toBeEnabled();
      await generate.click();
      const search = buildMktgRunActivity(noQuestionsActivityPayloads('research', true)).find((step) => step.kind === 'search');
      if (!search) throw new Error('Real activity producer did not emit research');
      await expect(page.getByTestId('mktg-run-activity')).toContainText(search.label, { timeout: DATA_LOAD_TIMEOUT });
      await expect(page).not.toHaveURL(/\/documents\//);
      await expect(page.getByTestId('mktg-agent-run-result')).toHaveCount(0);
      await expect(page.locator('textarea[data-test="mktg-agent-run-feedback"]')).toHaveCount(0);
    },
  };
}
