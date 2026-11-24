// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FAQ_INTAKE, MKTG_DOCUMENT_TYPES, MKTG_RUN_NEW_MODE } from '@lfx-one/shared/constants';
import type { MktgRunAnswersRequest } from '@lfx-one/shared/interfaces';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_PROJECT, fulfillDocumentJson, setupDocuments } from './helpers/mktg-os-documents.helper';
import { setupQuestionsNavigation } from './helpers/mktg-os-questions-navigation.helper';

/**
 * The robustness side of the public answers form: two windows hold the same questions and one of them
 * answers. The other learns it from its own poll (the read-time half of the optimistic-lock conflict;
 * a send that lost is the write-time half) and, when it had typed something, keeps that draft read-only
 * under the notice (pull request 4888, hand test round 2). An untouched form moves on to Writing quietly.
 */

// Each case waits for the real questions poll (MKTG_RUN_POLL.questionsIntervalMs) after the other window's send.
test.describe.configure({ timeout: 60000 });

/** One questions poll (10 s) plus the read it triggers, with room for a slow machine. */
const HEARD_TIMEOUT = 20000;
const TEAM_NOTE = 'Someone on your team already answered these — the agent is writing. Your draft is kept below.';
const OTHER_WINDOW_NOTE = 'These were answered in another window — the agent is writing. Your draft is kept below.';
const runId = 'c'.repeat(64);
const questionsId = 'd'.repeat(64);
const typedAnswer = 'Synthetic project maintainers who review the docs';

/** The server's one truth, read by every window's stubs: the run waits until the first accepted send, then writes. */
interface SharedRun {
  phase: 'questions' | 'writing';
  posts: Record<string, MktgRunAnswersRequest[]>;
}

const faqType = () => {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === FAQ_INTAKE.agentId);
  if (!type || !FAQ_INTAKE.endpoints.answers) throw new Error('Missing answerable synthetic FAQ contract');
  return type;
};

/** A public follower's window on the FAQ run: the document poll and the public answers route, against the shared run. */
async function routeFollower(page: Page, who: string, shared: SharedRun): Promise<void> {
  const type = faqType();
  shared.posts[who] = [];
  await setupDocuments(page, { empty: true });
  await page.route('**/api/mktg-agents/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/mktg-agents/runs/${runId}/answers`) {
      expect(route.request().method()).toBe('POST');
      shared.posts[who].push(route.request().postDataJSON());
      if (shared.phase !== 'questions') {
        return fulfillDocumentJson(route, { code: 'MKTG_RUN_ANSWERED', details: { answeredBy: 'Another Writer', answeredAt: '2026-10-28T10:01:00Z' } }, 409);
      }
      shared.phase = 'writing';
      return fulfillDocumentJson(route, { runId, state: 'writing' });
    }
    if (path.endsWith(`/documents/${type.agentKey}/living`)) {
      return fulfillDocumentJson(route, {
        project: DOCUMENT_PROJECT.uid,
        type,
        documentId: 'living',
        revisions: [],
        approvedCurrent: null,
        runs: [
          {
            project: DOCUMENT_PROJECT.uid,
            agentKey: type.agentKey,
            documentId: 'living',
            runId,
            startedAt: '2026-10-28T10:00:00Z',
            state: shared.phase,
            ...(shared.phase === 'questions' && {
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
    if (route.request().method() === 'POST' && (path.endsWith('/generate') || path.endsWith('/answers'))) {
      throw new Error('Public answers must never generate again or use the creator-only answers route');
    }
    return route.fallback();
  });
}

async function openFollower(page: Page): Promise<void> {
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${FAQ_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&run=${runId}`);
  await expect(page.getByTestId('mktg-run-questions-title')).toHaveText('A few questions before the draft');
  await expect(page.locator('textarea[data-test="mktg-run-questions-answer-audience"]')).toHaveValue('Synthetic maintainers');
  // A marker only a reload would lose: the notice arrives in place, never through a reload or a redirect.
  await page.evaluate(() => ((window as unknown as { __mktgWindowMarker: string }).__mktgWindowMarker = 'synthetic-marker'));
}

const windowMarker = (page: Page) => page.evaluate(() => (window as unknown as { __mktgWindowMarker?: string }).__mktgWindowMarker ?? null);

async function sendFrom(page: Page): Promise<void> {
  await page.locator('textarea[data-test="mktg-run-questions-answer-audience"]').fill('Synthetic answer from the other window');
  await page.getByTestId('mktg-run-questions-send').getByRole('button').click();
  await expect(page.getByTestId('mktg-document-view-run-steps')).toContainText('Writing');
}

/** The kept block under the notice: the typed text in a disabled box, nothing to send, the questions still browsable. */
async function expectKeptDraft(page: Page, answerKey: string, text: string): Promise<void> {
  const kept = page.getByTestId('mktg-run-questions-locked');
  const box = kept.locator(`textarea[data-test="mktg-run-questions-answer-${answerKey}"]`);
  await expect(box).toBeDisabled();
  await expect(box).toHaveValue(text);
  await expect(kept.getByTestId('mktg-run-questions-send')).toHaveCount(0);
  await expect(kept.getByTestId('mktg-run-questions-chips')).toBeVisible();
}

/** Two people: two browser contexts (precedent e2e/docs/url-stability.spec.ts), each with the project's session. */
async function twoPeople(info: TestInfo, newContext: (options: { storageState?: string }) => Promise<BrowserContext>) {
  const storageState = typeof info.project.use.storageState === 'string' ? info.project.use.storageState : undefined;
  const other = await newContext({ storageState });
  const mine = await newContext({ storageState });
  const [otherPage, myPage] = await Promise.all([other.newPage(), mine.newPage()]);
  await Promise.all([suppressCookieBanner(otherPage), suppressCookieBanner(myPage)]);
  return { other, mine, otherPage, myPage };
}

test('a typed public draft hears from its own poll that someone else answered, and keeps the draft read-only', async ({ browser }, info) => {
  const shared: SharedRun = { phase: 'questions', posts: {} };
  const { other, mine, otherPage, myPage } = await twoPeople(info, (options) => browser.newContext(options));
  try {
    await Promise.all([routeFollower(otherPage, 'other', shared), routeFollower(myPage, 'mine', shared)]);
    await Promise.all([openFollower(otherPage), openFollower(myPage)]);
    const waitingUrl = myPage.url();
    await myPage.locator('textarea[data-test="mktg-run-questions-answer-audience"]').fill(typedAnswer);
    await sendFrom(otherPage);
    // No click here: the poll alone brings the notice, the draft stays, nothing was sent from this window.
    await expect(myPage.getByTestId('mktg-run-progress-answered-note')).toHaveText(TEAM_NOTE, { timeout: HEARD_TIMEOUT });
    await expectKeptDraft(myPage, 'audience', typedAnswer);
    await expect(myPage.getByTestId('mktg-document-view-run-steps')).toContainText('Writing');
    await expect(myPage).toHaveURL(waitingUrl);
    expect(await windowMarker(myPage)).toBe('synthetic-marker');
    expect(shared.posts['mine']).toEqual([]);
    expect(shared.posts['other']).toHaveLength(1);
    await myPage.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('typed-draft-kept-under-the-notice.png') });
  } finally {
    await Promise.all([other.close(), mine.close()]);
  }
});

test('an untouched public form moves on to Writing quietly when someone else answers', async ({ browser }, info) => {
  const shared: SharedRun = { phase: 'questions', posts: {} };
  const { other, mine, otherPage, myPage } = await twoPeople(info, (options) => browser.newContext(options));
  try {
    await Promise.all([routeFollower(otherPage, 'other', shared), routeFollower(myPage, 'mine', shared)]);
    await Promise.all([openFollower(otherPage), openFollower(myPage)]);
    await sendFrom(otherPage);
    await expect(myPage.getByTestId('mktg-document-view-run-steps')).toContainText('Writing', { timeout: HEARD_TIMEOUT });
    await expect(myPage.getByTestId('mktg-run-progress-answered-note')).toHaveCount(0);
    await expect(myPage.getByTestId('mktg-run-questions-locked')).toHaveCount(0);
    await expect(myPage.getByTestId('mktg-run-questions')).toHaveCount(0);
    expect(shared.posts['mine']).toEqual([]);
    await myPage.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('untouched-form-moved-on.png') });
  } finally {
    await Promise.all([other.close(), mine.close()]);
  }
});

/**
 * One browser profile, two windows of the private Boilerplates run page: the sibling starts the run and gets the questions;
 * the second window resumes the stored attempt and types. Both read the shared run; its phase is the server's one truth.
 */
async function sameProfileWindows(context: BrowserContext, sibling: Page) {
  const fixture = await setupQuestionsNavigation(sibling);
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === fixture.intake.agentId);
  if (!type) throw new Error('Missing synthetic Boilerplates document type');
  const mine = await context.newPage();
  const mineFixture = await setupQuestionsNavigation(mine);
  const shared = { phase: 'questions' as 'questions' | 'writing', posts: { sibling: 0, mine: 0 } };
  const runRow = () => ({
    project: DOCUMENT_PROJECT.uid,
    agentKey: type.agentKey,
    documentId: 'living',
    runId: fixture.runId,
    startedAt: '2026-10-23T14:34:00Z',
    state: shared.phase,
    ...(shared.phase === 'questions' && { pendingQuestions: mineFixture.pendingQuestions }),
  });
  // Both windows read the same run: the helper's per-page stage gives way to the shared one.
  for (const [who, window] of [
    ['sibling', sibling],
    ['mine', mine],
  ] as const) {
    await window.route('**' + fixture.intake.endpoints.answers, (route) => {
      shared.posts[who]++;
      shared.phase = 'writing';
      return fulfillDocumentJson(route, { sessionId: 'synthetic-boilerplates-session', ownerToken: 'synthetic-boilerplates-proof', runId: fixture.runId });
    });
    await window.route('**' + fixture.intake.endpoints.result, (route) =>
      shared.phase === 'questions'
        ? fulfillDocumentJson(route, {
            status: 'questions',
            questionsId: mineFixture.pendingQuestions.questionsId,
            questions: mineFixture.pendingQuestions.questions,
          })
        : fulfillDocumentJson(route, { status: 'pending' })
    );
    await window.route('**/api/mktg-agents/documents/' + type.agentKey + '/living?*', (route) =>
      fulfillDocumentJson(route, { project: DOCUMENT_PROJECT.uid, type, documentId: 'living', revisions: [], approvedCurrent: null, runs: [runRow()] })
    );
  }
  const run = (window: Page, query: string) =>
    window.evaluate((url) => {
      window.history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/mktg-os-agents/${fixture.intake.agentId}?project=${DOCUMENT_PROJECT.slug}${query}`);
  // The sibling starts the run and gets the questions; its stored attempt is what the second window resumes.
  await run(sibling, `&mode=${MKTG_RUN_NEW_MODE}`);
  await sibling.getByTestId('mktg-run-start').getByRole('button').click();
  await expect(sibling.locator('textarea[data-test="mktg-run-questions-answer-goal"]')).toHaveValue('Grow adoption');
  await run(mine, '');
  const myAnswer = mine.locator('textarea[data-test="mktg-run-questions-answer-goal"]');
  await expect(myAnswer).toHaveValue('Grow adoption');
  await myAnswer.fill('Grow synthetic adoption among reviewers');
  return { sibling, mine, shared, myUrl: mine.url() };
}

test('a second window of the same profile hears that its sibling answered, and keeps its typed draft read-only', async ({ context, page }, info) => {
  const { sibling, mine, shared, myUrl } = await sameProfileWindows(context, page);
  await sibling.getByTestId('mktg-run-questions-send').getByRole('button').click();
  await expect(sibling.getByTestId('mktg-run-questions')).toHaveCount(0);
  await expect(mine.getByTestId('mktg-run-progress-answered-note')).toHaveText(OTHER_WINDOW_NOTE, { timeout: HEARD_TIMEOUT });
  await expectKeptDraft(mine, 'goal', 'Grow synthetic adoption among reviewers');
  await expect(mine.getByTestId('mktg-agent-run-questions')).toHaveCount(0);
  await expect(mine).toHaveURL(myUrl);
  expect(shared.posts).toEqual({ sibling: 1, mine: 0 });
  await mine.screenshot({ path: info.outputPath('same-profile-window-kept-draft.png'), fullPage: true });
});

test('a private window hears that someone on the team answered when nobody in this profile sent', async ({ context, page }, info) => {
  const { mine, shared, myUrl } = await sameProfileWindows(context, page);
  // Another person answered through their own route: the server moved on, and no window of this profile has a marker.
  shared.phase = 'writing';
  await expect(mine.getByTestId('mktg-run-progress-answered-note')).toHaveText(TEAM_NOTE, { timeout: HEARD_TIMEOUT });
  await expectKeptDraft(mine, 'goal', 'Grow synthetic adoption among reviewers');
  // Directly under the line, as on the public page: the writing steps come after the kept draft.
  const noteBox = await mine.getByTestId('mktg-run-progress-answered-note').boundingBox();
  const keptBox = await mine.getByTestId('mktg-run-questions-locked').boundingBox();
  const liveBox = await mine.getByTestId('mktg-run-progress-live').boundingBox();
  expect(noteBox && keptBox && liveBox && noteBox.y < keptBox.y && keptBox.y < liveBox.y).toBe(true);
  await expect(mine.getByTestId('mktg-agent-run-questions')).toHaveCount(0);
  await expect(mine).toHaveURL(myUrl);
  expect(shared.posts).toEqual({ sibling: 0, mine: 0 });
  await mine.screenshot({ path: info.outputPath('private-window-team-note-kept-draft.png'), fullPage: true });
});

test('a send that lost to another writer keeps the sent draft read-only under the named notice', async ({ browser }, info) => {
  const shared: SharedRun = { phase: 'questions', posts: {} };
  const { other, mine, otherPage, myPage } = await twoPeople(info, (options) => browser.newContext(options));
  try {
    await Promise.all([routeFollower(otherPage, 'other', shared), routeFollower(myPage, 'mine', shared)]);
    await Promise.all([openFollower(otherPage), openFollower(myPage)]);
    await sendFrom(otherPage);
    // This window sends before its next poll could tell it: the server's 409 does, and the draft stays below.
    await myPage.locator('textarea[data-test="mktg-run-questions-answer-audience"]').fill(typedAnswer);
    await myPage.getByTestId('mktg-run-questions-send').getByRole('button').click();
    await expect(myPage.getByTestId('mktg-run-progress-answered-note')).toHaveText(
      'Another Writer already answered these — the agent is writing. Your draft is kept below.'
    );
    await expectKeptDraft(myPage, 'audience', typedAnswer);
    expect(shared.posts['mine']).toHaveLength(1);
    await myPage.getByTestId('mktg-run-public-progress').screenshot({ path: info.outputPath('lost-send-kept-draft.png') });
  } finally {
    await Promise.all([other.close(), mine.close()]);
  }
});
