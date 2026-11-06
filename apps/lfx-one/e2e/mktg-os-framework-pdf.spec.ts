// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_PRINT_BODY_CLASS, MKTG_PRINT_LF_LOOK, MKTG_PRINT_PAGE_FRAME_PT } from '@lfx-one/shared/constants';
import type { MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { expect, FrameLocator, Page, test } from '@playwright/test';
import { columnAssetRevisionResponse, draftFrameworkAsset, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import {
  expectMktgPrintFrame,
  expectMktgPrintLandscapePageSetup,
  layoutMktgPrintFrame,
  PRINT_FRAME_LANDSCAPE,
  stubMktgPrintFrame,
} from './helpers/mktg-print.helper';

/** The deck's pages for the synthetic draft framework (one goal, one segment, one pillar, one number): the cover and these, in framework-print.ts order. */
const CONTENT_TITLES = ['Framework', 'Goal columns', 'Say and avoid', 'Every piece of content answers', 'ICPs', 'Message house', 'Audiences', 'Key numbers'];

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The synthetic draft framework with one phrase to avoid, so the Say and avoid page has a struck row. */
function frameworkWithAvoid(): MktgRevisionResponse {
  const { content } = draftFrameworkAsset();
  const response = columnAssetRevisionResponse('foundation-message');
  return { ...response, markdown: JSON.stringify({ ...content, mf: { ...content.mf, avoid: [['closed by default', 'open by default']] } }) };
}

/** Open the approved framework, click Download PDF and lay the landscape print frame out; the framework print's root inside it. */
async function openFrameworkPdf(
  page: Page,
  response: MktgRevisionResponse = columnAssetRevisionResponse('foundation-message')
): Promise<{ frame: FrameLocator; print: ReturnType<FrameLocator['getByTestId']> }> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, response);
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
  const print = frame.getByTestId('mktg-framework-print');
  await expect(print).toBeVisible();
  return { frame, print };
}

test.describe('Messaging framework PDF: the deck’s pages', () => {
  test('Download PDF prints the framework as the deck’s nine landscape pages, in its order, with its headings, running heads and page numbers', async ({
    page,
  }, info) => {
    const { frame, print } = await openFrameworkPdf(page);
    await expectMktgPrintLandscapePageSetup(frame);
    // The cover and the eight content pages: the deck's slide count for this framework. No back cover: the deck has none for it.
    await expect(print).toHaveAttribute('data-pages', String(CONTENT_TITLES.length + 1));
    await expect(print.getByTestId('framework-print-cover')).toHaveCount(1);
    await expect(print.locator('lfx-mktg-print-back-cover')).toHaveCount(0);
    const pages = print.getByTestId('framework-print-page');
    await expect(pages).toHaveCount(CONTENT_TITLES.length);
    const titles = await pages.evaluateAll((nodes) => nodes.map((node) => node.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-title')));
    expect(titles).toEqual(CONTENT_TITLES);
    // The running head: the section left, the document right; the footer: the page number alone, right (the deck's slide number).
    await expect(pages.first().getByTestId('mktg-print-page-head')).toHaveText(['01 Framework', 'Asset Example Messaging Framework']);
    await expect(pages.nth(4).getByTestId('mktg-print-page-head').first()).toHaveText('02 ICPs');
    await expect(pages.nth(5).getByTestId('mktg-print-page-head').first()).toHaveText('03 Message house');
    await expect(pages.last().getByTestId('mktg-print-page-head').first()).toHaveText('04 Key numbers');
    await expect(pages.first().getByTestId('mktg-print-page-footer')).toHaveText(['', '2']);
    await expect(pages.last().getByTestId('mktg-print-page-footer').last()).toHaveText(String(CONTENT_TITLES.length + 1));
    // No inner page shows the version: the cover does.
    for (let index = 0; index < CONTENT_TITLES.length; index++) {
      await expect(pages.nth(index)).not.toContainText('Version 1');
    }
    await page.screenshot({ path: info.outputPath('framework-pdf-pages.png'), fullPage: true });
  });

  test('the cover is the deck’s: Messaging Framework over the tagline, the project’s eyebrow, the version top right and the line of sections, on the brand’s dark', async ({
    page,
  }, info) => {
    const { print } = await openFrameworkPdf(page);
    const cover = print.getByTestId('framework-print-cover');
    await expect(cover.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'cover');
    await expect(cover.getByTestId('mktg-print-page-title')).toHaveText('Messaging Framework');
    await expect(cover.getByTestId('mktg-print-page-subtitle')).toHaveText('Build openly.');
    await expect(cover).toContainText('Asset Example · a Linux Foundation project');
    await expect(cover).toContainText('Version 1');
    await expect(cover).toContainText(/01\s+Framework\s+02\s+ICPs\s+03\s+Message house\s+04\s+Key numbers/);
    // No kit: the LF look's dark on the slide area; the bands around it stay white (the deck's cover). No logo on the cover.
    await expect(cover.getByTestId('mktg-print-page-slide')).toHaveCSS('background-color', rgb(MKTG_PRINT_LF_LOOK.dark));
    await expect(cover.locator('img')).toHaveCount(0);
    await cover.screenshot({ path: info.outputPath('framework-pdf-cover.png') });
  });

  test('the Framework page sets the three statements in cards and the tagline in a tinted panel; the goal column its value proposition, key message, proof and sound bite', async ({
    page,
  }, info) => {
    const { content } = draftFrameworkAsset();
    const { print } = await openFrameworkPdf(page);
    const framework = print.locator('[data-testid="framework-print-page"]:has([data-title="Framework"])');
    for (const text of ['Vision', content.mf.vision, 'Mission', content.mf.mission, 'Positioning', content.mf.positioning, 'Tagline', content.mf.tagline]) {
      await expect(framework).toContainText(text);
    }
    const goals = print.locator('[data-testid="framework-print-page"]:has([data-title="Goal columns"])');
    const goal = content.mf.goals[0];
    await expect(goals).toContainText(goal.t);
    await expect(goals).toContainText(`Goal ${goal.n}`);
    await expect(goals).toContainText(goal.vp);
    await expect(goals).toContainText(goal.key);
    await expect(goals).toContainText(goal.proof[0][0]);
    await expect(goals).toContainText(goal.proof[0][1].toUpperCase());
    await expect(goals).toContainText(`“${goal.bite}”`);
    await expect(goals).toContainText(`For ${content.icp[0].name}`);
    await expect(goals).toContainText(content.mf.crosscut);
    await framework.screenshot({ path: info.outputPath('framework-pdf-framework.png') });
  });

  test('the Say and avoid page sets the say chips and, with nothing to avoid, says so; the anchor page numbers the questions', async ({ page }, info) => {
    const { content } = draftFrameworkAsset();
    const { print } = await openFrameworkPdf(page);
    const sayAvoid = print.locator('[data-testid="framework-print-page"]:has([data-title="Say and avoid"])');
    await expect(sayAvoid).toContainText('Say');
    await expect(sayAvoid).toContainText(content.mf.say[0]);
    await expect(sayAvoid).toContainText('Avoid');
    await expect(sayAvoid).toContainText('Nothing to avoid was stated.');
    const anchor = print.locator('[data-testid="framework-print-page"]:has([data-title="Every piece of content answers"])');
    await expect(anchor).toContainText(`1.  ${content.mf.anchor[0]}`);
    await sayAvoid.screenshot({ path: info.outputPath('framework-pdf-say-avoid.png') });
  });

  test('a phrase to avoid is struck through beside what to say instead, as the deck strikes it', async ({ page }, info) => {
    const { print } = await openFrameworkPdf(page, frameworkWithAvoid());
    const sayAvoid = print.locator('[data-testid="framework-print-page"]:has([data-title="Say and avoid"])');
    // The paragraph that holds each phrase (the text sits in a span inside it): the avoided one struck, the replacement not.
    const avoided = sayAvoid.locator('p', { hasText: /^closed by default$/ });
    await expect(avoided).toHaveCSS('text-decoration-line', 'line-through');
    const instead = sayAvoid.locator('p', { hasText: /^open by default$/ });
    await expect(instead).toHaveCSS('text-decoration-line', 'none');
    await expect(sayAvoid).not.toContainText('Nothing to avoid was stated.');
    await sayAvoid.screenshot({ path: info.outputPath('framework-pdf-say-avoid-strike.png') });
  });

  test('every page frame fits Letter and A4 landscape whole, so the saved PDF turns one sheet per page on either paper', async ({ page }) => {
    const { print } = await openFrameworkPdf(page);
    const frames = print.getByTestId('mktg-print-page');
    await expect(frames).toHaveCount(CONTENT_TITLES.length + 1);
    const sizes = await frames.evaluateAll((nodes) => nodes.map((node) => [node.getBoundingClientRect().width, node.getBoundingClientRect().height]));
    const px = (pt: number) => (pt * 96) / 72;
    const letter = { w: px(792), h: px(612) };
    const a4 = { w: px(842), h: px(595) };
    for (const [w, h] of sizes) {
      expect(Math.round(w)).toBe(Math.round(px(MKTG_PRINT_PAGE_FRAME_PT.w)));
      expect(Math.round(h)).toBe(Math.round(px(MKTG_PRINT_PAGE_FRAME_PT.h)));
      expect(w).toBeLessThanOrEqual(letter.w);
      expect(h).toBeLessThanOrEqual(letter.h);
      expect(w).toBeLessThanOrEqual(a4.w);
      expect(h).toBeLessThanOrEqual(a4.h);
    }
  });

  test('the ICP page sets the segment left and its label-and-value rows right; the message house the umbrella on the dark, the pillar and the foundation; the key numbers as tiles', async ({
    page,
  }, info) => {
    const { content } = draftFrameworkAsset();
    const segment = content.icp[0];
    const { print } = await openFrameworkPdf(page);
    const icp = print.locator('[data-testid="framework-print-page"]:has([data-title="ICPs"])');
    await expect(icp).toContainText(segment.name);
    await expect(icp).toContainText(`${segment.kind} · Basis: ${segment.basis}`);
    await expect(icp).toContainText(`Goals: ${content.mf.goals[0].t}`);
    for (const label of ['Need', 'Value', 'Lead', 'Proof', 'Call to action', 'Channels', 'Objection', 'Personas']) {
      await expect(icp).toContainText(label);
    }
    await expect(icp).toContainText(segment.objection[0]);
    await expect(icp).toContainText(`${segment.personas[0][0]} — ${segment.personas[0][1]}`);
    const house = print.locator('[data-testid="framework-print-page"]:has([data-title="Message house"])');
    await expect(house).toContainText('Umbrella');
    await expect(house).toContainText(content.mh.umbrella);
    await expect(house).toContainText(content.mh.pillars[0].t);
    await expect(house).toContainText(content.mh.pillars[0].m);
    await expect(house).toContainText('Foundation');
    await expect(house).toContainText(content.mh.found);
    const audiences = print.locator('[data-testid="framework-print-page"]:has([data-title="Audiences"])');
    await expect(audiences).toContainText(content.mh.aud[0][0]);
    await expect(audiences).toContainText(content.mh.aud[0][1]);
    const numbers = print.locator('[data-testid="framework-print-page"]:has([data-title="Key numbers"])');
    await expect(numbers).toContainText(content.nums[0][0]);
    await expect(numbers).toContainText(content.nums[0][1]);
    await expect(numbers).toContainText('Asset Example · a Linux Foundation project');
    await house.screenshot({ path: info.outputPath('framework-pdf-message-house.png') });
  });
});
