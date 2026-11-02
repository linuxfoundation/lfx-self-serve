// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FAQ_INTAKE } from '@lfx-one/shared/constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants/mktg-document-store.constants';
import type { MktgDocumentRunProgress, MktgRunPendingQuestions } from '@lfx-one/shared/interfaces/mktg-document-run.interface';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_PROJECT, documentFixture, fulfillDocumentJson, setupDocuments } from './helpers/mktg-os-documents.helper';

/**
 * The waiting-for-answers run page is driven by its own poll (laws 1 and 3): the server is the
 * only truth and the open screen updates itself. A poll that omits the questions (a reader the BFF
 * could not verify, or a non-writer) never deletes the block the page holds; only a newer round or
 * another state replaces it, and no Refresh button is offered.
 */
type Phase = 'questions' | 'omitted' | 'newer-round' | 'writing' | 'landed';

const POLL_TIMEOUT = 30000;
const runId = 'c'.repeat(64);
const firstRound: MktgRunPendingQuestions = {
  questionsId: 'd'.repeat(64),
  askedAt: '2026-10-28T10:01:00Z',
  questions: [{ key: 'audience', label: 'Audience', question: 'Who is this for?', why: '', suggestedAnswer: 'Synthetic maintainers', basis: [] }],
};
const secondRound: MktgRunPendingQuestions = {
  questionsId: 'e'.repeat(64),
  askedAt: '2026-10-28T10:03:00Z',
  questions: [{ key: 'tone', label: 'Tone', question: 'Which tone should the answers take?', why: '', suggestedAnswer: 'Synthetic plain tone', basis: [] }],
};

async function openWaitingRun(page: Page, info: TestInfo) {
  await suppressCookieBanner(page);
  await setupDocuments(page, { empty: true });
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === FAQ_INTAKE.agentId);
  if (!type || !FAQ_INTAKE.endpoints.answers) throw new Error('Missing answerable synthetic FAQ contract');
  const history = { ...documentFixture(), type };
  const base = history.revisions[0];
  if (!base) throw new Error('Missing synthetic revision');
  const produced = { ...base, id: '000009-' + '9'.repeat(64), number: 9, contentSha256: '9'.repeat(64), format: 'json' as const };
  const faq = JSON.stringify({ faq: [['Synthetic section', [['Synthetic produced question', 'A synthetic answer.', 'Docs']]]] });
  const stored = { ...history, revisions: [produced, ...history.revisions], runs: [], revision: produced, markdown: faq, sidecar: null, approval: null };
  const state = { phase: 'questions' as Phase, polls: 0 };
  const common = { project: DOCUMENT_PROJECT.uid, agentKey: type.agentKey, documentId: 'living', runId, startedAt: '2026-10-28T10:00:00Z' };
  const rows: Record<Phase, MktgDocumentRunProgress> = {
    questions: { ...common, state: 'questions', pendingQuestions: firstRound },
    omitted: { ...common, state: 'questions' },
    'newer-round': { ...common, state: 'questions', pendingQuestions: secondRound },
    writing: { ...common, state: 'writing' },
    landed: { ...common, state: 'completed', producedRevisionId: produced.id },
  };
  const row = (): MktgDocumentRunProgress => rows[state.phase];
  await page.route('**/api/mktg-agents/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/documents/${type.agentKey}/living`)) {
      if (url.searchParams.get('poll') === '1') state.polls++;
      if (state.phase === 'landed') return fulfillDocumentJson(route, { ...stored, runs: [row()] });
      return fulfillDocumentJson(route, { project: DOCUMENT_PROJECT.uid, type, documentId: 'living', revisions: [], approvedCurrent: null, runs: [row()] });
    }
    if (url.pathname.includes('/revisions/')) return fulfillDocumentJson(route, stored);
    if (route.request().method() === 'POST') throw new Error('The waiting page must never generate, answer or refresh by itself');
    return route.fallback();
  });
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${FAQ_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&run=${runId}`);
  const answer = page.locator('textarea[data-test="mktg-run-questions-answer-audience"]');
  await expect(page.getByTestId('mktg-run-questions-title')).toHaveText('A few questions before the draft');
  await expect(answer).toHaveValue('Synthetic maintainers');
  await answer.fill('Synthetic project maintainers and contributors');
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('01-waiting-with-questions.png') });
  /** Move the stubbed server on and wait until the page has read it at least once. */
  const serve = async (phase: Phase) => {
    const seen = state.polls;
    state.phase = phase;
    await expect.poll(() => state.polls, { timeout: POLL_TIMEOUT }).toBeGreaterThan(seen);
  };
  return { answer, serve };
}

test('a poll that omits the questions keeps the answer form and the unsent edit', async ({ page }, info) => {
  const { answer, serve } = await openWaitingRun(page, info);
  await serve('omitted');
  await serve('omitted');
  await expect(page.getByTestId('mktg-run-questions-title')).toHaveText('A few questions before the draft');
  await expect(answer).toHaveValue('Synthetic project maintainers and contributors');
  await expect(page.getByTestId('mktg-run-progress-owner-note')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-progress-status')).toContainText('Waiting for your answers');
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('02-kept-after-omitting-poll.png') });
});

test('a newer questions round replaces the held one', async ({ page }, info) => {
  const { serve } = await openWaitingRun(page, info);
  await serve('omitted');
  await serve('newer-round');
  const tone = page.locator('textarea[data-test="mktg-run-questions-answer-tone"]');
  await expect(tone).toHaveValue('Synthetic plain tone', { timeout: POLL_TIMEOUT });
  await expect(page.locator('textarea[data-test="mktg-run-questions-answer-audience"]')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-progress-status')).toContainText('Waiting for your answers');
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('02-newer-round.png') });
});

test('a terminal state clears the questions and lands on the produced revision', async ({ page }, info) => {
  const { serve } = await openWaitingRun(page, info);
  await serve('omitted');
  await serve('landed');
  await expect(page.getByTestId('mktg-faq-view')).toContainText('Synthetic produced question', { timeout: POLL_TIMEOUT });
  await expect(page.getByTestId('mktg-run-questions')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('02-landed.png'), fullPage: true });
});

test('the waiting state offers no Refresh button and re-renders on its next poll', async ({ page }, info) => {
  const { serve } = await openWaitingRun(page, info);
  const live = page.getByTestId('mktg-run-progress-live');
  await expect(live.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-progress-questions-refresh')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-refresh-progress')).toHaveCount(0);
  await serve('writing');
  await expect(page.getByTestId('mktg-document-view-run-steps')).toContainText('Writing', { timeout: POLL_TIMEOUT });
  await expect(page.getByTestId('mktg-run-questions')).toHaveCount(0);
  await expect(live.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  await page.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('02-writing-without-a-click.png') });
});
