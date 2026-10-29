// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ICP_INTAKE } from '@lfx-one/shared/constants/mktg-run.constants';
import type { MktgRunAnswersRequest } from '@lfx-one/shared/interfaces/mktg-document-run.interface';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_PROJECT, DOCUMENT_TYPE, documentFixture, fulfillDocumentJson, setupDocuments } from './helpers/mktg-os-documents.helper';

async function publicRunAnswers({ page }: { page: Page }, info: TestInfo) {
  const alreadyAnswered = info.title.includes('already answered');
  const exactProduced = info.title.includes('produced revision');
  await suppressCookieBanner(page);
  await setupDocuments(page, { empty: true });
  const runId = 'c'.repeat(64);
  const questionsId = 'd'.repeat(64);
  let phase: 'questions' | 'writing' | 'landed' = 'questions';
  const submitted: MktgRunAnswersRequest[] = [];
  let releaseRead: () => void = () => undefined;
  const firstRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const history = documentFixture();
  const revision = history.revisions[0];
  if (!revision) throw new Error('Missing synthetic revision');
  const produced = { ...revision, id: '000009-' + '9'.repeat(64), number: 9, contentSha256: '9'.repeat(64) };
  const stored = { ...history, runs: [], revision, markdown: '# Synthetic cross-device draft', sidecar: null, approval: null };
  await page.route('**/api/mktg-agents/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/mktg-agents/runs/${runId}/answers`) {
      expect(route.request().method()).toBe('POST');
      submitted.push(route.request().postDataJSON());
      phase = 'writing';
      if (alreadyAnswered)
        return fulfillDocumentJson(route, { code: 'MKTG_RUN_ANSWERED', details: { answeredBy: 'Another Writer', answeredAt: '2026-10-28T10:01:00Z' } }, 409);
      return fulfillDocumentJson(route, { runId, state: 'writing' });
    }
    if (path.endsWith(`/documents/${DOCUMENT_TYPE.agentKey}/living`)) {
      await firstRead;
      if (phase === 'landed')
        return fulfillDocumentJson(
          route,
          exactProduced
            ? {
                ...stored,
                revisions: [produced, ...history.revisions],
                runs: [
                  {
                    project: DOCUMENT_PROJECT.uid,
                    agentKey: DOCUMENT_TYPE.agentKey,
                    documentId: 'living',
                    runId,
                    state: 'completed',
                    startedAt: '2026-10-28T10:00:00Z',
                    producedRevisionId: produced.id,
                  },
                ],
              }
            : stored
        );
      return fulfillDocumentJson(route, {
        project: DOCUMENT_PROJECT.uid,
        type: DOCUMENT_TYPE,
        documentId: 'living',
        revisions: [],
        approvedCurrent: null,
        runs: [
          {
            project: DOCUMENT_PROJECT.uid,
            agentKey: DOCUMENT_TYPE.agentKey,
            documentId: 'living',
            runId,
            startedAt: '2026-10-28T10:00:00Z',
            state: phase,
            ...(phase === 'questions' && {
              pendingQuestions: {
                questionsId,
                askedAt: '2026-10-28T10:01:00Z',
                questions: [{ key: 'audience', label: 'Audience', question: 'Who is this for?', why: '', suggestedAnswer: 'Synthetic maintainers', basis: [] }],
              },
            }),
          },
        ],
      });
    }
    if (path.includes('/revisions/'))
      return fulfillDocumentJson(
        route,
        exactProduced && path.endsWith(produced.id) ? { ...stored, revision: produced, markdown: '# Synthetic produced revision v9' } : stored
      );
    if (route.request().method() === 'POST' && (path.endsWith('/generate') || path.endsWith('/answers'))) {
      throw new Error('Public answers must never generate again or use the creator-only answers route');
    }
    return route.fallback();
  });
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${ICP_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&run=${runId}`);
  // #132/ea04412b3: the neutral shared skeleton exposes its checking label to assistive technology.
  await expect(page.getByTestId('mktg-run-progress-loading')).toHaveAttribute('aria-label', 'Checking the run…');
  await expect(page.getByTestId('mktg-run-progress-loading')).toHaveText('Checking the run…');
  await expect(page.getByTestId('mktg-run-public-progress').getByRole('heading')).toHaveCount(0);
  await expect(page.getByTestId('mktg-agent-run-form')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-progress-status')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-questions')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-progress-loading')).toHaveAttribute('aria-busy', 'true');
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('01-first-paint-neutral.png') });
  releaseRead();
  await expect(page.getByTestId('mktg-run-questions-title')).toHaveText('A few questions before the draft');
  const waitingUrl = page.url();
  const answer = page.locator('textarea[data-test="mktg-run-questions-answer-audience"]');
  await expect(answer).toHaveValue('Synthetic maintainers');
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('02-settled-questions.png') });
  await answer.fill('Synthetic project maintainers and contributors');
  await page.getByTestId('mktg-run-questions-send').getByRole('button').click();
  await expect(page.getByTestId('mktg-document-view-run-steps')).toContainText('Writing');
  if (alreadyAnswered) {
    await expect(page.getByTestId('mktg-run-progress-answered-note')).toHaveText('Another Writer already answered these — the agent is writing.');
    // 144-E: the conflict lives above THIS run's writing progress, never a toast followed by a redirect.
    await expect(page).toHaveURL(waitingUrl);
    await expect(page.getByTestId('mktg-run-questions')).toHaveCount(0);
  }
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('03-settled-writing.png') });
  expect(submitted).toEqual([
    {
      project: DOCUMENT_PROJECT.uid,
      questionsId,
      answers: [{ key: 'audience', text: 'Synthetic project maintainers and contributors', origin: 'edited' }],
    },
  ]);
  phase = 'landed';
  await expect(page.getByRole('heading', { name: exactProduced ? 'Synthetic produced revision v9' : 'Synthetic cross-device draft', exact: true })).toBeVisible(
    { timeout: 20000 }
  );
  if (exactProduced) expect(new URL(page.url()).searchParams.get('revision')).toBe(produced.id);
  else expect(new URL(page.url()).searchParams.has('revision')).toBe(false);
  expect(submitted).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('public-run-answers-landed.png'), fullPage: true });
}

test('another browser answers a waiting public kit run, follows writing and lands on the current document', publicRunAnswers);
test('another writer already answered the public run questions, so this browser follows writing without resending', publicRunAnswers);
test('a public follower opens the recorded produced revision rather than approved current', publicRunAnswers);
