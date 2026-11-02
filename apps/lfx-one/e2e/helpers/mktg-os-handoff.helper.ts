// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { BRAND_KIT_CONTRACT_ID } from '@lfx-one/shared/constants/brand-kit.constants';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants/mktg-document-store.constants';
import { MKTG_SLIDES_EXPORT_API_PATH } from '@lfx-one/shared/constants/mktg-slides-export.constants';
import { MKTG_FAMILY_EXPORT_API_PATH } from '@lfx-one/shared/constants/mktg-family-export.constants';
import { MKTG_LAST_INTAKE_API, MKTG_RUN_NEW_MODE } from '@lfx-one/shared/constants/mktg-last-intake.constants';
import type { MktgArtifactStoredResponse } from '@lfx-one/shared/interfaces/mktg-artifact.interface';
import type { MktgDocumentRunProgress, MktgRunPendingQuestions } from '@lfx-one/shared/interfaces/mktg-document-run.interface';
import type { MktgDocumentsResponse, MktgRevisionResponse } from '@lfx-one/shared/interfaces/mktg-document-store.interface';
import type { MktgRunResultResponse, MktgRunSessionResponse } from '@lfx-one/shared/interfaces/mktg-run.interface';
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
  await page.route('**' + MKTG_LAST_INTAKE_API + '/' + type.agentKey + '/last?*', (route) => fulfillDocumentJson(route, { intake: null }));
  const framework = assetRevision();
  framework.project = DOCUMENT_PROJECT.uid;
  framework.approval = { approvedAt: '2026-10-19T08:00:00Z', approvedBy: null };
  framework.revision.approval = framework.approval;
  framework.approvedCurrent = { revisionId: framework.revision.id, number: framework.revision.number };
  const listing: MktgDocumentsResponse = {
    project: DOCUMENT_PROJECT.uid,
    approvedFramework: {
      agentKey: framework.type.agentKey,
      revisionId: framework.revision.id,
      revisionNumber: framework.revision.number,
      contentSha256: framework.revision.contentSha256,
    },
    groups: MKTG_DOCUMENT_TYPES.map((entry) => ({
      type: entry,
      documents:
        entry.agentKey === framework.type.agentKey
          ? [
              {
                agentKey: entry.agentKey,
                documentId: 'living',
                revisionCount: 1,
                latestRevisionId: framework.revision.id,
                approvedCurrent: framework.approvedCurrent,
                createdAt: framework.revision.createdAt,
                updatedAt: framework.revision.createdAt,
              },
            ]
          : [],
    })),
  };
  await page.route('**/api/mktg-agents/documents?*', (route) => fulfillDocumentJson(route, listing));
  await page.route('**/api/mktg-agents/documents/' + framework.type.agentKey + '/living**', (route) => fulfillDocumentJson(route, framework));
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
    documentMarkdown: framework.markdown,
    format: 'json',
    revisionNumber: 1,
    receipt: { project: DOCUMENT_PROJECT.uid, s3_key: 'synthetic-framework.md', content_sha256: 'a'.repeat(64), version: 1, intake_mode: 'form' },
    sidecar: JSON.parse(framework.markdown) as Record<string, unknown>,
  };
  await page.route('**' + FOUNDATION_MESSAGE_INTAKE.endpoints.stored + '**', (route) => fulfillDocumentJson(route, prerequisite));
  await page.route('**' + MKTG_SLIDES_EXPORT_API_PATH + '**', (route) => fulfillDocumentJson(route, { last: null, latestRevision: null }));
  await page.route('**' + MKTG_FAMILY_EXPORT_API_PATH + '/last?*', (route) =>
    fulfillDocumentJson(route, { last: null, currentMembers: [], skippedMembers: [], stale: false })
  );
  let stage: 'research' | 'between-rounds' | 'questions' | 'writing' | 'checking' | 'early-ready' | 'storing' | 'ready' | 'unconfirmed' = 'research';
  let pendingQuestions: MktgRunPendingQuestions | null = null;
  const posts: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (path === intake.endpoints.generate || path === intake.endpoints.answers)) posts.push(path);
  });
  const ack: MktgRunSessionResponse = { sessionId: 'synthetic-kit-session', ownerToken: 'synthetic-owner-proof', runId: 'b'.repeat(64) };
  await page.route('**' + intake.endpoints.generate, (route) => fulfillDocumentJson(route, ack));
  await page.route('**' + intake.endpoints.result, (route) => {
    if (stage === 'unconfirmed') return fulfillDocumentJson(route, { error: 'Synthetic invalid check' }, 400);
    if (stage === 'questions' && pendingQuestions)
      return fulfillDocumentJson(route, { status: 'questions', questionsId: pendingQuestions.questionsId, questions: pendingQuestions.questions });
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
      let state: MktgDocumentRunProgress['state'] = 'writing';
      if (stage === 'questions') state = 'questions';
      else if (stage === 'storing') state = 'storing';
      runs.push({
        project: DOCUMENT_PROJECT.uid,
        agentKey: type.agentKey,
        documentId: 'living',
        runId: 'b'.repeat(64),
        state,
        ...(stage === 'questions' && pendingQuestions && { pendingQuestions }),
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
    documentUrl: `/project/mktg-os-agents/documents/${type.agentKey}/living?project=${DOCUMENT_PROJECT.slug}`,
    // Rule 1/#4592: advance private and canonical projections together, never a cache-only question state.
    askQuestions: (questions: MktgRunPendingQuestions) => {
      pendingQuestions = questions;
      stage = 'questions';
    },
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
    openAndGenerate: async (navigate = true) => {
      if (navigate) {
        await page.evaluate((url) => {
          history.pushState({}, '', url);
          dispatchEvent(new PopStateEvent('popstate'));
        }, `/project/mktg-os-agents/${intake.agentId}?project=${DOCUMENT_PROJECT.slug}`);
      }
      await expect(page.getByTestId('mktg-agent-run-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      const sourcesEntry = new URL(page.url()).searchParams.get('mode') === MKTG_RUN_NEW_MODE;
      if (sourcesEntry) await page.getByTestId('mktg-run-sources-edit').getByRole('button').click();
      for (const field of intake.fields) {
        if (field.optional) continue;
        if (field.kind !== 'text' && field.kind !== 'textarea') throw new Error('Unexpected required handoff fixture field');
        await page.locator(`[data-test="mktg-intake-${field.key}"]`).fill(field.format?.includes('url') ? 'https://synthetic.example' : 'Synthetic project');
      }
      const generate = page.getByTestId(sourcesEntry ? 'mktg-run-start' : 'mktg-agent-run-submit-button').getByRole('button');
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
