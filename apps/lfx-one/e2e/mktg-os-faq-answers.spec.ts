// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * FAQ answers as the faq agent writes them, on the FAQ page and in the family PDF.
 *
 * An answer is either plain sentences or one lead-in sentence followed by "- " lines. The page
 * and the print render it through the restricted Markdown renderer, so the lead-in is a paragraph
 * and the lines are a real bulleted list; a plain answer reads exactly as before; thousands
 * separators stay verbatim; injected HTML never reaches the DOM. The seeded revision is
 * `faqAnswersContent()` (src/app/shared/testing/mktg-faq-answers-test-data.ts): its four answers
 * are the strings a tester reads on the served build.
 *
 * Coverage:
 *   A1  FAQ tab at 1440 and 390: the plain answer's text, the lead-in then five items in order,
 *       "$5,000 to $75,000" verbatim, nothing injected survives
 *   A2  Family PDF (Download PDF on /project/mktg-os-agents/families/positioning-brand, the isolated
 *       print frame): the list pair prints a paragraph and five items; the plain pairs one paragraph
 *
 * Every read is stubbed (`openAssetDocument`, `openFamilyExports`): no edit rights, no Guild key
 * and no live document store are needed. The Marketing OS pages are dark-launched behind
 * `mktg-os-agents-enabled`; the helpers pin the flag through the local-storage override.
 */

import { expect, test } from '@playwright/test';
import { MKTG_FAMILY_PRINT_BODY_CLASS } from '@lfx-one/shared/constants/mktg-family-export.constants';
import { FAQ_LIST_ITEMS, FAQ_LIST_LEAD_IN, FAQ_PLAIN_ANSWER, FAQ_PRICE_ANSWER, faqAnswersContent } from '../src/app/shared/testing/mktg-faq-answers-test-data';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { nativeAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

for (const width of [1440, 390]) {
  test(`A1: the FAQ tab renders a plain answer, a lead-in with its list, separators and nothing injected (${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openAssetDocument(page, 'faq', 200, true, false, { ...nativeAssetRevisionResponse('faq'), markdown: JSON.stringify(faqAnswersContent()) });
    await expect(page.getByTestId('mktg-faq-view-panel-faq')).toBeVisible();

    // (a) A plain answer reads as one paragraph, exactly as stored, with its source beside it, at the question's size and
    //     the answer's own leading (styles.scss gives a bare `p` text-base; the host's font size must win).
    const plain = page.getByTestId('mktg-faq-view-answer-0-0');
    await expect(plain).toHaveText(FAQ_PLAIN_ANSWER);
    await expect(plain.locator('p')).toHaveCount(1);
    await expect(plain.locator('ul')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-source-0-0')).toHaveText('Website');
    const metrics = (element: Element) => ({ fontSize: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight });
    const question = await page.getByTestId('mktg-faq-view-question-0-0').locator('dt').evaluate(metrics);
    const host = await plain.evaluate(metrics);
    const paragraph = await plain.locator('p').evaluate(metrics);
    expect(paragraph.fontSize).toBe(question.fontSize);
    expect(paragraph.lineHeight).toBe(host.lineHeight);

    // (b) The lead-in is a paragraph, then the five items as a bulleted list, in order, with no "- " left in the text.
    const list = page.getByTestId('mktg-faq-view-answer-0-1');
    await expect(list.locator('p')).toHaveText(FAQ_LIST_LEAD_IN);
    await expect(list.locator('p + ul')).toHaveCount(1);
    await expect(list.locator('ul > li')).toHaveText([...FAQ_LIST_ITEMS]);
    await expect(list).not.toContainText('- ');
    await expect(page.getByTestId('mktg-faq-view-source-0-1')).toHaveText('Docs');
    const item = await list.locator('ul > li').first().evaluate(metrics);
    expect(item.fontSize).toBe(question.fontSize);
    expect(item.lineHeight).toBe(host.lineHeight);
    // The bullet is in the answer's text colour, not the typography plugin's light grey (the tester, hand test round 1).
    const marker = await list
      .locator('ul > li')
      .first()
      .evaluate((element) => getComputedStyle(element, '::marker').color);
    const text = await list.locator('p').evaluate((element) => getComputedStyle(element).color);
    expect(marker).toBe(text);

    // (c) Thousands separators stay verbatim.
    const price = page.getByTestId('mktg-faq-view-answer-0-2');
    await expect(price).toHaveText(FAQ_PRICE_ANSWER);
    await expect(price).toContainText('$5,000 to $75,000');

    // (d) Nothing injected reaches the DOM: no image, script, handler or link; the words around them still read.
    const injected = page.getByTestId('mktg-faq-view-answer-0-3');
    await expect(injected).toContainText('the docs');
    await expect(injected.locator('img, script, [onerror], a')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-question-0-3').locator('img, script, [onerror]')).toHaveCount(0);

    await page.screenshot({ path: info.outputPath(`faq-answers-${width}.png`), fullPage: true });
  });
}

test('A2: the family PDF prints the lead-in as a paragraph and its items as a list, and a plain answer as one paragraph', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await stubMktgPrintFrame(page);
  await openFamilyExports(page, { allAssets: true, faqContent: faqAnswersContent() });
  const pdf = page.getByTestId('family-export-pdf').getByRole('button');
  await expect(pdf).toBeEnabled();
  await pdf.click();
  await expectMktgPrintFrame(page, MKTG_FAMILY_PRINT_BODY_CLASS, '[data-testid="family-export-print-document"]');
  const frame = await layoutMktgPrintFrame(page);
  const faqPrint = frame.getByTestId('mktg-faq-print');
  const pairs = faqPrint.getByTestId('mktg-faq-print-pair');
  await expect(pairs).toHaveCount(4);

  // (a) and (c): one paragraph each, the exact text.
  await expect(pairs.nth(0).getByTestId('mktg-faq-print-answer').locator('p')).toHaveText([FAQ_PLAIN_ANSWER]);
  await expect(pairs.nth(2).getByTestId('mktg-faq-print-answer').locator('p')).toHaveText([FAQ_PRICE_ANSWER]);
  // (b): the lead-in paragraph, then the five items, inside the pair that stays together on a page.
  const listAnswer = pairs.nth(1).getByTestId('mktg-faq-print-answer');
  await expect(listAnswer.locator('p')).toHaveText([FAQ_LIST_LEAD_IN]);
  await expect(listAnswer.locator('p + ul')).toHaveCount(1);
  await expect(listAnswer.locator('ul > li')).toHaveText([...FAQ_LIST_ITEMS]);
  await expect(pairs.nth(1)).toHaveCSS('break-inside', 'avoid');
  await expect(pairs.nth(1)).toContainText('Source: Docs');
  // (d): nothing injected survives in print either.
  await expect(pairs.nth(3).locator('img, script, [onerror], a')).toHaveCount(0);
  // The flowing prints' own stylesheet (mktg-flow-print.scss) still reaches the FAQ root inside the family document: the
  // sides' room styles.scss gives every print root (0.6 in, no page-margins body class in a document of portrait frames),
  // the brand's color printed as it shows, and the group heading in the document's typeface, not the base layer's Inter.
  await expect(faqPrint).toHaveCSS('padding-left', '57.6px');
  await expect(faqPrint).toHaveCSS('print-color-adjust', 'exact');
  // The FAQ's host is a block (MKTG_PORTRAIT_BLOCK_HOST): an inline host around its page break costs a blank sheet in Google Chrome.
  await expect(frame.locator('lfx-mktg-faq-print')).toHaveCSS('display', 'block');
  const [rootFont, headingFont, listMarker] = await faqPrint.evaluate((root) => [
    getComputedStyle(root).fontFamily,
    getComputedStyle(root.querySelector('[data-testid="mktg-faq-print-group"]') as Element).fontFamily,
    getComputedStyle(root.querySelector('[data-testid="mktg-faq-print-answer"] ul') as Element).listStyleType,
  ]);
  expect(headingFont).toBe(rootFont);
  expect(rootFont).not.toMatch(/Inter/);
  expect(listMarker).toBe('disc');

  await page.screenshot({ path: info.outputPath('faq-answers-print.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});
