// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { BRAND_KIT_INTAKE } from '../../../packages/shared/src/constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES, MKTG_DOCUMENTS_API_PATH } from '../../../packages/shared/src/constants/mktg-document-store.constants';
import { MKTG_INTAKE_LINK_ADVICE } from '../../../packages/shared/src/constants/mktg-intake-link-advice.constants';
import { MKTG_LAST_INTAKE_API, MKTG_RUN_RESUME_QUERY_CLEAR } from '../../../packages/shared/src/constants/mktg-last-intake.constants';
import { mktgSentenceCaseLabel } from '../../../packages/shared/src/utils/mktg-navigation.utils';
import { DOCUMENT_PROJECT } from './helpers/mktg-os-documents.helper';
import { setupFreshSources, withDesktopSourcesSetup } from './helpers/mktg-os-sources.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';

test.describe('Marketing OS new run Sources', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));
  for (const choice of ['Open it', 'Discard and start over'])
    test(`catalog active-run conflict: ${choice}`, async ({ page }, info) => {
      const sources = await setupFreshSources(page);
      const bodies: Record<string, unknown>[] = [];
      const activeRunId = 'b'.repeat(64);
      const pendingQuestions = {
        questionsId: 'c'.repeat(64),
        askedAt: '2026-10-29T05:00:00Z',
        questions: [{ key: 'goal', label: 'Goal', question: 'Which synthetic goal?', why: '', suggestedAnswer: 'Grow adoption', basis: [] }],
      };
      await page.route(`**${BRAND_KIT_INTAKE.endpoints.generate}`, (route) => {
        bodies.push(route.request().postDataJSON());
        if (!bodies.at(-1)?.['discard'])
          return route.fulfill({
            status: 409,
            json: {
              code: 'MKTG_RUN_ACTIVE',
              message: 'A run is in progress.',
              activeRunId,
              state: 'writing',
              agentKey: 'brand-kit',
              documentId: 'living',
              startedBy: 'Synthetic writer',
              startedByViewer: false,
              startedAt: '2026-10-19T12:00:00.000Z',
            },
          });
        // #4592 records the block before exposing the accepted replacement's private questions.
        sources.handoff.askQuestions(pendingQuestions);
        return route.fallback();
      });
      await page.route(`**${BRAND_KIT_INTAKE.endpoints.result}`, (route) =>
        route.fulfill({
          json: {
            status: 'questions',
            questionsId: pendingQuestions.questionsId,
            questions: pendingQuestions.questions,
          },
        })
      );
      await sources.open();
      await page.getByTestId('mktg-run-start').getByRole('button').click();
      // PrimeNG assigns alertdialog to both host and inner dialog; target the content-bearing leaf.
      const dialog = page.getByRole('alertdialog').filter({ hasText: "Synthetic writer's Brand Kit run is in progress" }).last();
      await expect(dialog).toContainText("Synthetic writer's Brand Kit run is in progress");
      await dialog.getByRole('button', { name: choice, exact: true }).click();
      if (choice === 'Open it') {
        // #4594: active progress belongs on its recorded run page, never the document reader.
        await expect(page.getByTestId('mktg-run-public-progress')).toBeVisible();
        await expect(page.getByTestId('mktg-run-progress-status')).toContainText('Writing…');
        expect(new URL(page.url()).searchParams.get('run')).toBe(activeRunId);
        await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('mktg-run-questions')).toContainText('Which synthetic goal?');
        expect(bodies.at(-1)).toEqual({ ...bodies[0], discard: activeRunId });
      }
      expect(bodies.length).toBeGreaterThanOrEqual(choice === 'Open it' ? 2 : 3);
      expect(bodies.filter((body) => body['discard'])).toHaveLength(choice === 'Open it' ? 0 : 1);
      await page.screenshot({ path: info.outputPath('catalog-active-run-choice.png'), fullPage: true });
    });
  test('a waiting run is reachable through Documents and a fresh entry without creating another session', async ({ page }) => {
    const sources = await setupFreshSources(page);
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === BRAND_KIT_INTAKE.agentId);
    if (!type) throw new Error('Missing waiting-run fixture type');
    const runId = 'b'.repeat(64);
    let activeRunId = runId;
    let releaseAck: () => void = () => undefined;
    const ack = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    let acknowledged = false;
    let askQuestions = false;
    const pendingQuestions = {
      questionsId: 'c'.repeat(64),
      askedAt: new Date().toISOString(),
      questions: [{ key: 'goal', label: 'Goal', question: 'Which synthetic goal?', why: '', suggestedAnswer: 'Grow adoption', basis: [] }],
    };
    const recordedRun = () => ({
      project: DOCUMENT_PROJECT.uid,
      agentKey: type.agentKey,
      documentId: 'living',
      runId: activeRunId,
      state: askQuestions ? 'questions' : 'writing',
      startedAt: new Date().toISOString(),
      ...(askQuestions && { pendingQuestions }),
    });
    await page.route(`**${BRAND_KIT_INTAKE.endpoints.generate}`, async (route) => {
      await ack;
      acknowledged = true;
      const generation = sources.generated.length;
      activeRunId = generation === 1 ? runId : 'd'.repeat(64);
      return route.fulfill({ json: { sessionId: `synthetic-waiting-session-${generation}`, ownerToken: `synthetic-proof-${generation}`, runId: activeRunId } });
    });
    await page.route(`**${BRAND_KIT_INTAKE.endpoints.result}`, (route) =>
      route.fulfill({
        json: askQuestions
          ? {
              status: 'questions',
              questionsId: pendingQuestions.questionsId,
              questions: pendingQuestions.questions,
            }
          : { status: 'pending' },
      })
    );
    await sources.open();
    // Retain the helper's synthetic approved prerequisite while adding this scenario's active run.
    const listing = await page.evaluate(async ({ path, project }) => (await fetch(`${path}?project=${encodeURIComponent(project)}`)).json(), {
      path: MKTG_DOCUMENTS_API_PATH,
      project: DOCUMENT_PROJECT.uid,
    });
    const recordedDetail = await page.evaluate(async ({ path, project }) => (await fetch(`${path}?project=${encodeURIComponent(project)}`)).json(), {
      path: `${MKTG_DOCUMENTS_API_PATH}/${type.agentKey}/living`,
      project: DOCUMENT_PROJECT.uid,
    });
    await page.route(new RegExp(`/documents/${type.agentKey}/living(?:[?]|$)`), (route) =>
      route.fulfill({ json: { ...recordedDetail, revisions: [], current: null, runs: acknowledged ? [recordedRun()] : [] } })
    );
    await page.getByTestId('mktg-run-start').getByRole('button').click();
    await expect.poll(() => sources.generated.length).toBe(1);
    await expect(page.getByTestId('mktg-agent-run-starting-note')).toHaveText('Getting started… Stay on this page for a few seconds.');
    await expect(page.getByTestId('mktg-agent-run-leave-note')).toHaveCount(0);
    const questions = page.getByTestId('mktg-run-questions');
    await page.route('**/api/mktg-agents/documents?*', (route) =>
      route.fulfill({
        json: {
          ...listing,
          runs: acknowledged ? [recordedRun()] : [],
        },
      })
    );
    const base = '/project/mktg-os-agents';
    const open = async (path: string) =>
      page.evaluate((url) => {
        history.pushState({}, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      }, path);
    const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === BRAND_KIT_INTAKE.endpoints.generate);
    try {
      await open(`${base}/documents?project=${DOCUMENT_PROJECT.slug}`); // Leave before the ACK: the service must keep its POST alive.
      await expect(page.getByTestId('mktg-documents-page')).toBeVisible();
    } finally {
      releaseAck();
    }
    await accepted;
    await open(`${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&mode=new`);
    await expect(page.getByTestId('mktg-run-waiting-notice')).toContainText(`This ${mktgSentenceCaseLabel(type.itemLabel)} is being written.`);
    await expect(page.getByTestId('mktg-run-waiting-open').getByRole('link', { name: 'Open it', exact: true })).toHaveAttribute(
      'href',
      `${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&run=${runId}`
    );
    await expect(page.getByTestId('mktg-run-sources')).toHaveCount(0);
    expect(sources.generated).toHaveLength(1);
    await page.getByTestId('mktg-run-waiting-open').getByRole('link').click();
    await expect(page.getByTestId('mktg-run-public-progress')).toBeVisible();
    await expect(page.getByTestId('mktg-run-progress-status')).toContainText('Writing… You can leave this page');
    await expect(page).not.toHaveURL(/\/documents\//);
    expect(sources.generated).toHaveLength(1);
    await open(`${base}/documents?project=${DOCUMENT_PROJECT.slug}`);
    await expect(page.getByTestId(`mktg-documents-started-run-${runId}`)).toContainText('Writing the document');
    askQuestions = true;
    await open(`${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}`);
    await expect(questions).toContainText('Which synthetic goal?');
    await open(`${base}/documents?project=${DOCUMENT_PROJECT.slug}`);
    const answer = page.getByTestId(`mktg-documents-open-started-${runId}`);
    await expect(answer).toHaveText('Answer the questions');
    await expect(answer).toHaveAttribute('href', new RegExp(`${base}/${BRAND_KIT_INTAKE.agentId}[?]project=${DOCUMENT_PROJECT.slug}&run=${runId}$`));
    await answer.click();
    await expect(questions).toContainText('Which synthetic goal?');
    await open(`${base}/documents?project=${DOCUMENT_PROJECT.slug}`);
    const waiting = page.getByTestId(`mktg-documents-nav-${type.agentKey}`);
    await expect(waiting).toContainText('Needs answers');
    await expect(waiting).toHaveAttribute('href', new RegExp(`${base}/${BRAND_KIT_INTAKE.agentId}[?]project=${DOCUMENT_PROJECT.slug}&run=${runId}$`));
    await waiting.click();
    await expect(questions).toContainText('Which synthetic goal?');
    await page.evaluate((url) => {
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&mode=new`);
    await expect(page.getByTestId('mktg-run-waiting-notice')).toContainText('This run is waiting for your answers.');
    await expect(page.getByTestId('mktg-run-sources')).toHaveCount(0);
    await expect(page.getByTestId('mktg-agent-run-form')).toBeHidden();
    // Rule 1/#4592: a fresh mode=new entry exposes the recorded block via Answer the questions,
    // not a Continue button inferred solely from this browser's former private poll.
    const recordedQuestions = page.getByTestId('mktg-run-waiting-open').getByRole('link', { name: 'Answer the questions', exact: true });
    await expect(recordedQuestions).toHaveAttribute('href', `${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&run=${runId}`);
    await recordedQuestions.click();
    await expect(questions).toContainText('Which synthetic goal?');
    // This any-browser route renders the recorded writer questions, not a private-cache return note.
    await expect(page.getByTestId('mktg-run-progress-status')).toContainText('Waiting for your answers.');
    await expect(page.getByTestId('mktg-run-progress-owner-note')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('run')).toBe(runId);
    expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
    expect(sources.generated).toHaveLength(1);
    await open(`${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&mode=new`);
    await expect(page.getByTestId('mktg-run-waiting-notice')).toBeVisible();
    await page.getByTestId('mktg-run-waiting-start-over').click();
    const title = `Discard the ${mktgSentenceCaseLabel(type.itemLabel)} run?`;
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Keep it', exact: true }).click();
    await expect(questions).toContainText('Which synthetic goal?');
    await expect(page.getByTestId('mktg-run-waiting-notice')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
    expect(sources.generated).toHaveLength(1);
    await open(`${base}/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&mode=new`);
    await expect(page.getByTestId('mktg-run-waiting-notice')).toBeVisible();
    await page.getByTestId('mktg-run-waiting-start-over').click();
    await page.getByRole('button', { name: 'Discard and start over', exact: true }).click();
    await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
    await expect(page.getByTestId('mktg-run-waiting-notice')).toHaveCount(0);
    expect(sources.generated).toHaveLength(1); // Discard reveals Sources; it never POSTs by itself.
    await page.getByTestId('mktg-run-start').getByRole('button').click();
    await expect(questions).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    expect(sources.generated).toHaveLength(2); // Exactly ONE new Generate, no second confirmation in this visit.
    expect(sources.generated[1]['answers']).toEqual(sources.generated[0]['answers']);
    await page.screenshot({ path: test.info().outputPath('waiting-questions-recovered.png'), fullPage: true });
  });
  test('dates stale public questions without starting over automatically', async ({ page }) => {
    const sources = await setupFreshSources(page);
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === BRAND_KIT_INTAKE.agentId);
    if (!type) throw new Error('Missing living fixture');
    await page.route('**/api/mktg-agents/documents?*', (route) =>
      route.fulfill({
        json: {
          project: DOCUMENT_PROJECT.uid,
          groups: [],
          runs: [
            {
              project: DOCUMENT_PROJECT.uid,
              agentKey: type.agentKey,
              documentId: 'living',
              runId: 'e'.repeat(64),
              state: 'questions',
              startedAt: '2026-10-01T12:00:00Z',
            },
          ],
        },
      })
    );
    await page.evaluate((url) => {
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&mode=new`);
    await expect(page.getByTestId('mktg-run-waiting-notice')).toContainText(
      'Waiting for your answers since 1 Oct. Continue to answer them — if the agent no longer responds, start over.'
    );
    await expect(page.getByTestId('mktg-run-waiting-open').getByRole('link')).toBeVisible();
    await expect(page.getByTestId('mktg-run-waiting-start-over')).toBeVisible();
    expect(sources.generated).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('stale-public-questions.png'), fullPage: true });
  });

  test('Drive and duplicate source warnings leave Start enabled', async ({ page }) => {
    const sources = await setupFreshSources(page);
    await sources.open();
    await page.getByTestId('mktg-run-sources-edit').getByRole('button').click();
    const url = 'https://drive.google.com/drive/folders/synthetic';
    await page.locator('[data-test="mktg-intake-website_url"]').fill(url);
    await expect(page.getByTestId('mktg-agent-run-link-warning-website_url')).toContainText(MKTG_INTAKE_LINK_ADVICE.drivePrivate);
    const start = page.getByTestId('mktg-run-start').getByRole('button');
    await expect(start).toBeEnabled();
    await page.locator('[data-test="mktg-intake-brand_page_url"]').fill(url + '/?usp=sharing');
    await expect(page.getByTestId('mktg-agent-run-link-warning-brand_page_url')).toContainText(MKTG_INTAKE_LINK_ADVICE.duplicate);
    await expect(start).toBeEnabled();
    expect(sources.generated).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('nonblocking-link-advice.png'), fullPage: true });
  });
  for (const mount of ['project', 'foundation'] as const) {
    test(`${mount}: accepted Start consumes entry mode and reload restores questions without a second session`, async ({ page }) => {
      const sources = await setupFreshSources(page);
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === BRAND_KIT_INTAKE.agentId);
      if (!type) throw new Error('Missing questions-record fixture type');
      let recorded = false;
      let questionsAsked = false;
      const pendingQuestions = {
        questionsId: 'c'.repeat(64),
        askedAt: new Date().toISOString(),
        questions: [
          {
            key: 'goal',
            label: 'Goal',
            question: 'Which synthetic goal should guide this run?',
            why: 'Synthetic research gap.',
            suggestedAnswer: 'Grow adoption',
            basis: [],
          },
        ],
      };
      const recordedRun = () => ({
        project: DOCUMENT_PROJECT.uid,
        agentKey: type.agentKey,
        documentId: 'living',
        runId: 'b'.repeat(64),
        state: questionsAsked ? 'questions' : 'writing',
        startedAt: new Date().toISOString(),
        ...(questionsAsked && { pendingQuestions }),
      });
      let releaseAck: () => void = () => undefined;
      const accepted = new Promise<void>((resolve) => {
        releaseAck = resolve;
      });
      await page.route(`**${BRAND_KIT_INTAKE.endpoints.generate}`, async (route) => {
        await accepted;
        recorded = true;
        await route.fulfill({ json: { sessionId: 'synthetic-questions-session', ownerToken: 'synthetic-questions-proof', runId: 'b'.repeat(64) } });
      });
      await page.route(`**${BRAND_KIT_INTAKE.endpoints.result}`, (route) => {
        questionsAsked = true;
        return route.fulfill({ json: { status: 'questions', questionsId: pendingQuestions.questionsId, questions: pendingQuestions.questions } });
      });
      await sources.open(mount);
      const listing = await page.evaluate(async ({ path, project }) => (await fetch(`${path}?project=${encodeURIComponent(project)}`)).json(), {
        path: MKTG_DOCUMENTS_API_PATH,
        project: DOCUMENT_PROJECT.uid,
      });
      const recordedDetail = await page.evaluate(async ({ path, project }) => (await fetch(`${path}?project=${encodeURIComponent(project)}`)).json(), {
        path: `${MKTG_DOCUMENTS_API_PATH}/${type.agentKey}/living`,
        project: DOCUMENT_PROJECT.uid,
      });
      await page.route('**/api/mktg-agents/documents?*', (route) => route.fulfill({ json: { ...listing, runs: recorded ? [recordedRun()] : [] } }));
      await page.route(new RegExp(`/documents/${type.agentKey}/living(?:[?]|$)`), (route) =>
        route.fulfill({ json: { ...recordedDetail, revisions: [], current: null, runs: recorded ? [recordedRun()] : [] } })
      );
      const start = page.getByTestId('mktg-run-start').getByRole('button');
      await expect(start).toBeEnabled();
      expect(sources.generated).toHaveLength(0);
      try {
        await start.click();
        await expect.poll(() => sources.generated.length).toBe(1);
        expect(new URL(page.url()).searchParams.get('mode')).toBe('new');
      } finally {
        releaseAck();
      }
      await expect.poll(() => new URL(page.url()).searchParams.has('mode')).toBe(false);
      const questions = page.getByTestId('mktg-run-questions');
      await expect(questions).toContainText('Which synthetic goal should guide this run?');
      await expect(page.getByTestId('mktg-run-sources')).toHaveCount(0);
      await withDesktopSourcesSetup(page, async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(questions).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      });
      await expect(questions).toContainText('Which synthetic goal should guide this run?');
      await expect(page.locator('[data-test="mktg-run-questions-answer-goal"]')).toHaveValue('Grow adoption');
      await expect(page.getByTestId('mktg-run-start')).toHaveCount(0);
      expect(sources.generated).toHaveLength(1);
      await page.screenshot({ path: test.info().outputPath(`questions-reload-no-second-session-${mount}.png`), fullPage: true });
    });

    test(`${mount}: asset header Run again opens prefilled Sources, then edit and Start land the revision`, async ({ page }) => {
      const sources = await setupFreshSources(page);
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === BRAND_KIT_INTAKE.agentId);
      if (!type) throw new Error('Missing synthetic asset type');
      sources.handoff.finish();
      await page.evaluate((destination) => {
        history.pushState({}, '', destination);
        dispatchEvent(new PopStateEvent('popstate'));
      }, `/${mount}/mktg-os-agents/documents/${type.agentKey}/living?project=${DOCUMENT_PROJECT.slug}`);
      const again = page.getByTestId('mktg-document-view-run-again');
      await expect(again).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await again.click();
      await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
      const opened = new URL(page.url());
      expect(opened.searchParams.get('mode')).toBe('new');
      for (const selector of Object.keys(MKTG_RUN_RESUME_QUERY_CLEAR)) expect(opened.searchParams.has(selector)).toBe(false);
      await expect(page.getByTestId('mktg-run-source-website_url')).toContainText(sources.answers.website_url);
      expect(sources.generated).toHaveLength(0);
      expect(sources.polls()).toBe(0);
      await page.getByTestId('mktg-run-sources-edit').getByRole('button').click();
      await page.locator('[data-test="mktg-intake-website_url"]').fill('https://rerun.example');
      await page.getByTestId('mktg-run-start').getByRole('button').click();
      await expect(page).toHaveURL(new RegExp('revision=' + sources.handoff.revision.id), { timeout: DATA_LOAD_TIMEOUT });
      expect(sources.generated).toHaveLength(1);
      expect(sources.generated[0]).toMatchObject({ answers: { website_url: 'https://rerun.example' } });
      await page.screenshot({ path: test.info().outputPath(`asset-run-again-explicit-start-${mount}.png`), fullPage: true });
    });
  }

  for (const mount of ['project', 'foundation'] as const) {
    test(`${mount}: prefill, edit and explicit Start land the exact new asset`, async ({ page }) => {
      const deviceViewport = page.viewportSize();
      const sources = await setupFreshSources(page);
      expect(page.viewportSize()).toEqual(deviceViewport);
      await sources.open(mount);
      await expect(page.getByTestId('mktg-run-source-website_url')).toContainText(sources.answers.website_url);
      await expect(page.getByTestId('mktg-run-source-notes')).toContainText('From last time');
      const start = page.getByTestId('mktg-run-start').getByRole('button');
      await expect(start).toBeEnabled();
      expect(sources.generated).toHaveLength(0);
      expect(sources.polls()).toBe(0);
      await page.getByTestId('mktg-run-sources-edit').getByRole('button').click();
      const website = page.locator('[data-test="mktg-intake-website_url"]');
      await expect(website).toHaveValue(sources.answers.website_url);
      await website.fill('https://edited.example');
      await page.locator('[data-test="mktg-intake-notes"]').fill('');
      sources.handoff.finish();
      await start.click();
      await expect(page).toHaveURL(new RegExp('revision=' + sources.handoff.revision.id), { timeout: DATA_LOAD_TIMEOUT });
      expect(sources.generated).toHaveLength(1);
      expect(sources.generated[0]).toMatchObject({ answers: { website_url: 'https://edited.example', notes: '' } });
      await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('fresh-run-exact-asset.png'), fullPage: true });
    });
  }

  for (const status of [404, 503]) {
    test(`collapsed Sources explains and recovers a dependency failure (${status})`, async ({ page }) => {
      const sources = await setupFreshSources(page);
      await page.route('**/api/mktg-agents/foundation-message/stored**', (route) =>
        route.fulfill({ status, json: { error: 'Synthetic dependency unavailable' } })
      );
      await sources.open();
      const card = page.getByTestId('mktg-run-sources');
      await expect(page.getByTestId('mktg-agent-run-form')).not.toBeVisible();
      await expect(card.getByTestId('mktg-agent-run-missing-dependency')).toBeVisible();
      await expect(card.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
      await expect(card.getByTestId('mktg-run-start-reason')).toBeVisible();
      if (status === 503) {
        await page.route('**/api/mktg-agents/foundation-message/stored**', (route) =>
          route.fulfill({ status: 404, json: { error: 'No approved synthetic framework' } })
        );
        await card.getByTestId('mktg-agent-run-dependency-retry').getByRole('button').click();
      }
      await expect(card.getByTestId('mktg-agent-run-missing-dependency-link').getByRole('button')).toBeVisible();
      expect(sources.generated).toHaveLength(0);
      await page.screenshot({ path: test.info().outputPath(`collapsed-dependency-${status}.png`), fullPage: true });
    });
  }

  test('reload restores durable scalar values but requires an explicit decision about previous logos', async ({ page }) => {
    const sources = await setupFreshSources(page, { logoCount: 1 });
    await sources.open();
    await expect(page.getByTestId('mktg-run-reattach-logos')).toContainText('(1)');
    // Reload the shell to discard service memory; SPA entry keeps synthetic project reads in page.route.
    await withDesktopSourcesSetup(page, async () => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    });
    await sources.open();
    await expect(page.getByTestId('mktg-run-source-notes')).toContainText(sources.answers.notes);
    await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mktg-run-start-reason')).toContainText('Re-attach');
    expect(sources.generated).toHaveLength(0);
    await page.getByTestId('mktg-run-drop-missing').getByRole('button').click();
    await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
    expect(sources.generated).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('reload-reattachment-explicit-choice.png'), fullPage: true });
  });

  for (const state of ['empty', 'error', 'denied', 'loading'] as const) {
    test(`${state} history remains an honest no-auto-start state`, async ({ page }) => {
      const sources = await setupFreshSources(page, { state });
      const historyRead =
        state === 'loading'
          ? page.waitForRequest((request) => new URL(request.url()).pathname.startsWith(MKTG_LAST_INTAKE_API + '/') && request.url().includes('/last?'))
          : null;
      await sources.open();
      if (state === 'loading') {
        // Rule 5 /119.2: no partial Sources form before its first server observation resolves.
        await expect(page.getByTestId('mktg-agent-run-checking')).toBeVisible();
        await expect(page.getByTestId('mktg-agent-run-checking')).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByTestId('mktg-run-sources')).toHaveCount(0);
        expect(sources.generated).toHaveLength(0);
        expect(sources.polls()).toBe(0);
        await historyRead;
        const heldAt = Date.now();
        // Deliberately delay the NETWORK answer for six real seconds (143 runtime repro), not a UI synchronization sleep.
        await new Promise<void>((resolve) => setTimeout(resolve, 6000));
        await expect(page.getByTestId('mktg-agent-run-checking')).toBeVisible();
        await expect(page.getByTestId('mktg-run-sources')).toHaveCount(0);
        sources.releaseHistory();
        await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
        await expect(page.getByTestId('mktg-run-source-notes')).toContainText(sources.answers.notes);
        await test.info().attach('delayed-history-runtime.json', {
          body: JSON.stringify({ heldMs: Date.now() - heldAt, landedOnSources: true, generates: sources.generated.length, privatePolls: sources.polls() }),
          contentType: 'application/json',
        });
      } else if (state === 'denied') {
        await expect(page.getByTestId('mktg-run-sources-denied')).toContainText('write access');
        await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
        await expect(page.getByTestId('mktg-run-start-reason')).toContainText('write access');
        await expect(page.getByTestId('mktg-run-source-notes')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('mktg-run-sources-note')).toContainText(state === 'empty' ? 'Suggested defaults' : 'could not be loaded');
        if (state === 'error') {
          // A failed history read settles to usable Sources; explicit browser retry can load recovered server inputs.
          await page.screenshot({ path: test.info().outputPath('sources-history-failed-usable.png'), fullPage: true });
          await page.route(`**${MKTG_LAST_INTAKE_API}/*/last?*`, (route) =>
            route.fulfill({ json: { intake: { answers: sources.answers, documentCount: 0, logoCount: 0 } } })
          );
          await page.reload({ waitUntil: 'domcontentloaded' });
          await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
          await expect(page.getByTestId('mktg-run-source-notes')).toContainText(sources.answers.notes);
          await test.info().attach('failed-history-retry-runtime.json', {
            body: JSON.stringify({ failureSettledToSources: true, explicitReloadRecoveredInputs: true, generates: sources.generated.length }),
            contentType: 'application/json',
          });
        }
      }
      expect(sources.generated).toHaveLength(0);
      expect(sources.polls()).toBe(0);
      await page.screenshot({ path: test.info().outputPath(`sources-${state}.png`), fullPage: true });
    });
  }
});
