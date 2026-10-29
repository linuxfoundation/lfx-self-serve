// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { setupStructuredComments } from './helpers/mktg-os-kit-comments.helper';
import { ASSET_PROJECT, ASSET_REVISION } from './helpers/mktg-os-assets.helper';

test('FAQ: server-resolved answer comments clear the team callout and unanswered count even before the asset changes', async ({ page }) => {
  // setupStructuredComments calls suppressCookieBanner and stubs the page's reads and writer access.
  const fixture = await setupStructuredComments(page, 'faq');
  fixture.state.rows.push({
    id: 'synthetic-resolved-answer',
    revisionId: ASSET_REVISION,
    anchor: { kind: 'field', key: fixture.key },
    author: { name: 'Project writer' },
    text: 'Membership is free for this synthetic project.',
    createdAt: '2026-10-21T10:00:00Z',
    status: 'resolved',
    sentInRun: 'c'.repeat(64),
    resultRevisionId: fixture.nextId,
    resolution: 'Added the supplied answer as Notes.',
  });
  await fixture.open();
  await expect(page.getByTestId('mktg-comments-panel')).toContainText('Resolved by the agent');
  await expect(page.getByTestId('mktg-faq-view-unanswered-callout')).toHaveCount(0);
  await expect(page.locator('[data-testid^="mktg-faq-view-needs-answer-"]')).toHaveCount(0);
  await expect(page.getByTestId('mktg-faq-view-question-0-2').getByTestId('mktg-field-comment-open')).toHaveText('Comment');
  await expect(page.getByTestId('mktg-faq-view-tab-unanswered')).toHaveText('Needs an answer');
  await page.getByTestId('mktg-faq-view-tab-unanswered').click();
  await expect(page.getByTestId('mktg-faq-view-unanswered-list')).toHaveCount(0);
  await expect(page.getByTestId('mktg-faq-view-unanswered-empty')).toBeVisible();
  expect(fixture.state.sends).toHaveLength(0);
  await page.screenshot({ path: test.info().outputPath('faq-resolved-answer-count.png'), fullPage: true });
});

test('FAQ: answer a gap by commenting and sending; the new Draft shows Notes and no unanswered question', async ({ page }) => {
  // setupStructuredComments calls suppressCookieBanner through its fixture helper.
  const fixture = await setupStructuredComments(page, 'faq');
  await fixture.open();
  const panel = page.getByTestId('mktg-comments-panel');
  await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
  await expect(page.getByTestId('mktg-faq-view-unanswered-callout')).toHaveText(
    '1 question needs an answer from your team. Answer it by commenting on it; the agent adds your answer as Notes.'
  );
  const answered = page.getByTestId('mktg-faq-view-question-0-0');
  await answered.hover();
  await expect(answered.getByTestId('mktg-field-comment-open').getByRole('button')).toBeVisible();
  await expect(answered.getByTestId('mktg-field-comment-open').locator('..')).toHaveCSS('opacity', '1');
  const openQuestion = page.getByTestId('mktg-faq-view-question-0-2');
  await expect(openQuestion.getByRole('button', { name: /^Answer / })).toBeVisible();
  await expect(page.getByTestId('mktg-faq-view-unanswered-chip')).toHaveCount(0);
  await expect(page.getByTestId('mktg-faq-view-unanswered-open')).toHaveCount(0);
  await openQuestion.getByRole('button', { name: /^Answer / }).click();
  await expect(openQuestion.getByRole('textbox')).toBeVisible();
  await openQuestion.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('mktg-faq-view-tab-unanswered').click();
  const gaps = page.getByTestId('mktg-faq-view-unanswered-list');
  await expect(gaps).toContainText('How much does membership cost?');
  const field = gaps.getByTestId(`mktg-field-comments-${fixture.key}`);
  await field.getByRole('button', { name: /^Answer / }).click();
  await field.getByRole('textbox').fill('Membership is free for this synthetic project.');
  await field.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(field.getByTestId('mktg-comment-thread')).toContainText('Membership is free for this synthetic project.');
  expect(fixture.state.adds[0]).toMatchObject({ revisionId: ASSET_REVISION, anchor: { kind: 'field', key: 'faq[0][1][2][1]' } });
  await panel.getByRole('button', { name: 'Send 1 open comment to the agent', exact: true }).click();
  await expect(panel.getByTestId('mktg-comments-feed')).toBeVisible();
  expect(fixture.state.sends).toHaveLength(1);
  expect(fixture.state.sends[0]).toMatchObject({ project: ASSET_PROJECT.uid, revisionId: ASSET_REVISION, commentIds: ['synthetic-pinned-comment'] });
  expect(Object.keys(fixture.state.sends[0]).sort()).toEqual(['clientRequestId', 'commentIds', 'project', 'revisionId']);
  fixture.state.done = true;
  await expect(page).toHaveURL(new RegExp(`revision=${fixture.nextId}`), { timeout: 20_000 });
  await page.getByTestId('mktg-faq-view-tab-unanswered').click();
  await expect(page.getByTestId('mktg-faq-view-unanswered-empty')).toBeVisible();
  await expect(page.getByTestId('mktg-faq-view-tab-unanswered')).toHaveText('Needs an answer');
  await page.getByTestId('mktg-faq-view-tab-faq').click();
  await expect(page.getByTestId('mktg-faq-view-question-0-2')).toContainText('Membership is free for this synthetic project.');
  await expect(page.getByTestId('mktg-faq-view-source-0-2')).toHaveText('Notes');
  await expect(page.getByTestId('mktg-faq-view-needs-answer-0-2')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-revision-label-2')).toContainText('Draft');
  await expect(panel).toContainText('Added the supplied answer as Notes.');
  await page.screenshot({ path: test.info().outputPath('faq-answer-redraft.png'), fullPage: true });
});
