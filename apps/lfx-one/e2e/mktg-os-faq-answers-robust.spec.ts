// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Structural pair of mktg-os-faq-answers.spec.ts: the `data-testid` and DOM contract of a rendered
 * FAQ answer, on the page and in the family PDF, independent of the copy.
 *
 *   - every answered question row `mktg-faq-view-question-<g>-<q>` holds one `mktg-faq-view-answer-<g>-<q>`,
 *     an `lfx-markdown-renderer` host whose content is `shared-markdown-renderer-content`
 *   - a plain answer: one `p`, no `ul`; a lead-in and list: `p` then `ul` with one `li` per item
 *   - no `img`, `script`, `[onerror]` or `a` inside any answer
 *   - in the family PDF (the portrait book, #5368) every answered question is one `family-print-faq-entry` in a
 *     `family-print-faq-column` of the book's FAQ page, holding one `family-print-faq-question`, one
 *     `family-print-faq-answer` (an `lfx-markdown-renderer` host, with the same shapes as on the page) and one
 *     `family-print-faq-source`; no `lfx-mktg-faq-print` in the frame
 */

import { expect, test } from '@playwright/test';
import { MKTG_FAMILY_PRINT_BODY_CLASS } from '@lfx-one/shared/constants/mktg-family-export.constants';
import { MKTG_FAMILY_PRINT_FAQ_LAYOUT } from '@lfx-one/shared/constants/mktg-family-print.constants';
import { FAQ_ANSWER_QUESTIONS, FAQ_LIST_ITEMS, faqAnswersContent } from '../src/app/shared/testing/mktg-faq-answers-test-data';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { nativeAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { familyBookFaqEntries, openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

test('FAQ answer structure on the page', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAssetDocument(page, 'faq', 200, true, false, { ...nativeAssetRevisionResponse('faq'), markdown: JSON.stringify(faqAnswersContent()) });
  const view = page.getByTestId('mktg-faq-view');
  await expect(view.locator('[data-testid^="mktg-faq-view-question-0-"]')).toHaveCount(FAQ_ANSWER_QUESTIONS.length);
  for (let q = 0; q < FAQ_ANSWER_QUESTIONS.length; q++) {
    const row = view.getByTestId(`mktg-faq-view-question-0-${q}`);
    const answer = row.getByTestId(`mktg-faq-view-answer-0-${q}`);
    await expect(answer).toHaveCount(1);
    expect(await answer.evaluate((element) => element.tagName.toLowerCase())).toBe('lfx-markdown-renderer');
    await expect(answer.getByTestId('shared-markdown-renderer-content')).toHaveCount(1);
    await expect(answer.locator('img, script, [onerror], a')).toHaveCount(0);
    await expect(row.getByTestId(`mktg-faq-view-source-0-${q}`)).toHaveCount(1);
  }
  // The plain answers: one paragraph, no list. The list answer: a paragraph, then one `li` per item.
  for (const q of [0, 2, 3]) {
    await expect(view.getByTestId(`mktg-faq-view-answer-0-${q}`).locator('p')).toHaveCount(1);
    await expect(view.getByTestId(`mktg-faq-view-answer-0-${q}`).locator('ul')).toHaveCount(0);
  }
  const list = view.getByTestId('mktg-faq-view-answer-0-1');
  await expect(list.locator('p')).toHaveCount(1);
  await expect(list.locator('p + ul')).toHaveCount(1);
  await expect(list.locator('ul > li')).toHaveCount(FAQ_LIST_ITEMS.length);
  // Nothing is unanswered in the seeded revision: no callout, no needs-answer marker.
  await expect(view.getByTestId('mktg-faq-view-unanswered-callout')).toHaveCount(0);
  await expect(view.locator('[data-testid^="mktg-faq-view-needs-answer-"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('faq-answers-structure.png'), fullPage: true });
});

test('FAQ answer structure in the family PDF frame', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await stubMktgPrintFrame(page);
  await openFamilyExports(page, { allAssets: true, faqContent: faqAnswersContent() });
  const pdf = page.getByTestId('family-export-pdf').getByRole('button');
  await expect(pdf).toBeEnabled();
  await pdf.click();
  await expectMktgPrintFrame(page, MKTG_FAMILY_PRINT_BODY_CLASS, '[data-testid="family-export-print-document"]');
  const frame = await layoutMktgPrintFrame(page);
  // The flowing FAQ print is not in the family PDF: the pairs are the entries of the book's own FAQ page, in its columns.
  await expect(frame.locator('lfx-mktg-faq-print')).toHaveCount(0);
  const pairs = familyBookFaqEntries(frame);
  await expect(pairs).toHaveCount(FAQ_ANSWER_QUESTIONS.length);
  await expect(frame.getByTestId('family-print-faq-grid').getByTestId('family-print-faq-column').getByTestId('family-print-faq-entry')).toHaveCount(
    FAQ_ANSWER_QUESTIONS.length
  );
  for (let q = 0; q < FAQ_ANSWER_QUESTIONS.length; q++) {
    const pair = pairs.nth(q);
    const answer = pair.getByTestId('family-print-faq-answer');
    await expect(pair.getByTestId('family-print-faq-question')).toHaveCount(1);
    await expect(answer).toHaveCount(1);
    expect(await answer.evaluate((element) => element.tagName.toLowerCase())).toBe('lfx-markdown-renderer');
    await expect(answer.getByTestId('shared-markdown-renderer-content')).toHaveCount(1);
    await expect(pair.getByTestId('family-print-faq-source')).toHaveCount(1);
    await expect(pair.locator('img, script, [onerror], a')).toHaveCount(0);
    // A pair never splits across columns or pages.
    await expect(pair).toHaveCSS('break-inside', 'avoid');
  }
  // The plain answers: one paragraph, no list. The list answer: a paragraph, then one `li` per item.
  for (const q of [0, 2, 3]) {
    await expect(pairs.nth(q).getByTestId('family-print-faq-answer').locator('p')).toHaveCount(1);
    await expect(pairs.nth(q).getByTestId('family-print-faq-answer').locator('ul')).toHaveCount(0);
  }
  const listAnswer = pairs.nth(1).getByTestId('family-print-faq-answer');
  await expect(listAnswer.locator('p')).toHaveCount(1);
  await expect(listAnswer.locator('p + ul')).toHaveCount(1);
  await expect(listAnswer.locator('ul > li')).toHaveCount(FAQ_LIST_ITEMS.length);
  // The list prints with visible disc markers, indented under its lead-in by what the plan's fit model narrows an item
  // by; the lead-in, its items and a plain answer are one size, leading, ink and typeface (the answer's own, the model's
  // size, not the renderer's screen prose nor the base layer's `p`).
  await expect(listAnswer.locator('ul')).toHaveCSS('list-style-type', 'disc');
  await expect(listAnswer.locator('ul')).toHaveCSS('padding-left', `${MKTG_FAMILY_PRINT_FAQ_LAYOUT.answerList.indent}px`);
  const metrics = (element: Element) => {
    const style = getComputedStyle(element);
    return { color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily };
  };
  const host = await listAnswer.evaluate(metrics);
  const lead = await listAnswer.locator('p').evaluate(metrics);
  const item = await listAnswer.locator('ul > li').first().evaluate(metrics);
  const plain = await pairs.nth(0).getByTestId('family-print-faq-answer').locator('p').evaluate(metrics);
  expect(host.fontSize).toBe(`${MKTG_FAMILY_PRINT_FAQ_LAYOUT.answer.size}px`);
  for (const printed of [lead, item, plain]) expect(printed).toEqual(host);
  const question = await pairs.nth(0).getByTestId('family-print-faq-question').evaluate(metrics);
  expect(host.fontFamily).toBe(question.fontFamily);
  await page.screenshot({ path: info.outputPath('faq-answers-print-structure.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});
