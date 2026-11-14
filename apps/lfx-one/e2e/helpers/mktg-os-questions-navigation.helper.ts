// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { BOILERPLATES_INTAKE, MKTG_LAST_INTAKE_API } from '@lfx-one/shared/constants';
import { buildMktgRunActivity } from '@lfx-one/shared/utils/mktg-run-activity.utils';
import { noQuestionsActivityPayloads } from '@lfx-one/shared/utils/__fixtures__/mktg-run-activity.no-questions';
import { Page } from '@playwright/test';
import { columnAssetRevisionResponse } from './mktg-os-asset-views.helper';
import { DOCUMENT_PROJECT, fulfillDocumentJson } from './mktg-os-documents.helper';
import { setupNoQuestionsHandoff } from './mktg-os-handoff.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

/** The actual Boilerplates questions-before-first-handoff path, not questions injected after a Brand Kit handoff. */
export async function setupQuestionsNavigation(page: Page) {
  const historyTrace: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('MKTG_NAV_TRACE ')) historyTrace.push(message.text().slice('MKTG_NAV_TRACE '.length));
  });
  await page.addInitScript(() => {
    const record = (method: string, target?: string | URL | null) => {
      const url = new URL(String(target ?? location.href), location.href);
      console.info('MKTG_NAV_TRACE ' + JSON.stringify({ method, path: url.pathname, queryKeys: [...url.searchParams.keys()].sort() }));
    };
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (...args: Parameters<History['pushState']>) => {
        record(method, args[2]);
        original(...args);
      };
    }
    addEventListener('popstate', () => record('popstate'));
  });
  await suppressCookieBanner(page);
  await setupNoQuestionsHandoff(page);
  const intake = BOILERPLATES_INTAKE;
  if (!intake.endpoints.answers) throw new Error('Missing Boilerplates answers contract');
  const view = columnAssetRevisionResponse('boilerplates');
  view.project = DOCUMENT_PROJECT.uid;
  await page.route('**' + MKTG_LAST_INTAKE_API + '/' + view.type.agentKey + '/last?*', (route) => fulfillDocumentJson(route, { intake: null }));
  const digest = createHash('sha256').update(view.markdown).digest('hex');
  const revision = { ...view.revision, id: `000001-${digest}`, contentSha256: digest };
  const stored = { ...view, revision, revisions: [revision], current: { revisionId: revision.id, changedAt: revision.createdAt, changedBy: null } };
  const runId = 'd'.repeat(64);
  const pendingQuestions = {
    questionsId: 'e'.repeat(64),
    askedAt: '2026-10-23T14:34:01Z',
    questions: [{ key: 'goal', label: 'Goal', question: 'Which synthetic goal?', why: 'A missing source.', suggestedAnswer: 'Grow adoption', basis: [] }],
  };
  let stage: 'questions' | 'writing' | 'ready' = 'questions';
  const posts: string[] = [];
  const activity = buildMktgRunActivity(noQuestionsActivityPayloads('writing', true));
  for (const path of [intake.endpoints.generate, intake.endpoints.answers]) {
    await page.route('**' + path, (route) => {
      posts.push(path);
      if (path === intake.endpoints.answers) stage = 'writing';
      return fulfillDocumentJson(route, { sessionId: 'synthetic-boilerplates-session', ownerToken: 'synthetic-boilerplates-proof', runId });
    });
  }
  await page.route('**' + intake.endpoints.result, (route) => {
    if (stage === 'questions') {
      return fulfillDocumentJson(route, {
        status: 'questions',
        questionsId: pendingQuestions.questionsId,
        questions: pendingQuestions.questions,
      });
    }
    if (stage === 'writing') return fulfillDocumentJson(route, { status: 'pending', activity });
    return fulfillDocumentJson(route, {
      status: 'ready',
      version: 1,
      documentMarkdown: stored.markdown,
      persistence: {
        project: DOCUMENT_PROJECT.uid,
        s3_key: 'synthetic-boilerplates.json',
        content_sha256: digest,
        version: 1,
        document_location: { agent_key: stored.type.agentKey, document_id: 'living', revision_id: revision.id },
      },
    });
  });
  await page.route('**/api/mktg-agents/documents/' + stored.type.agentKey + '/living?*', (route) =>
    fulfillDocumentJson(route, {
      ...stored,
      revisions: stage === 'ready' ? [revision] : [],
      current: stage === 'ready' ? stored.current : null,
      runs:
        stage === 'ready'
          ? []
          : [
              {
                project: DOCUMENT_PROJECT.uid,
                agentKey: stored.type.agentKey,
                documentId: 'living',
                runId,
                state: stage,
                // Rule 1/#4592: the BFF records the same block before the private poll exposes it.
                ...(stage === 'questions' && { pendingQuestions }),
                startedAt: '2026-10-23T14:34:00Z',
                activity,
              },
            ],
    })
  );
  await page.route('**/api/mktg-agents/documents/' + stored.type.agentKey + '/living/revisions/**', (route) => fulfillDocumentJson(route, stored));
  return {
    intake,
    runId,
    revision,
    posts,
    historyTrace,
    finish: () => {
      stage = 'ready';
    },
  };
}
