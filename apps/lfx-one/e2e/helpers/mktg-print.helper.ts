// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { chromium, expect, FrameLocator, Locator, Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import { MKTG_PORTRAIT_PAGE_NAME, MKTG_PRINT_FRAME_PAPER_IN, MKTG_PRINT_PAGE_MARGINS_CLASS, MKTG_PRINT_PAGE_SETUPS } from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './account-settings-email.helper';

/** The frame prints once its own stylesheets, faces and images settle, or at the service's cap. */
const PRINT_FRAME_TIMEOUT_MS = 10_000;

/** The production frame's viewport at CSS pixels (Letter's width, a hair under its height): the initial containing block the print geometry is measured against. */
export const PRINT_FRAME_LETTER = { width: Math.round(MKTG_PRINT_FRAME_PAPER_IN.width * 96), height: Math.round(MKTG_PRINT_FRAME_PAPER_IN.height * 96) };

/** What a cover sized `calc(100vh - 1.2in)` must at least measure in that frame: the collapse this guards against left it at its content's height. */
export const PRINT_COVER_MIN_HEIGHT = 900;

export function mktgPrintFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="lfx-print-frame"]');
}

/** Install before the click: init scripts also run in the new same-origin print frame. */
export async function stubMktgPrintFrame(page: Page): Promise<void> {
  await suppressCookieBanner(page);
  await page.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset['mktgFramePrinted'] = 'yes';
    };
  });
}

/** Assert the isolated document, not the app window's print stub. */
export async function expectMktgPrintFrame(page: Page, bodyClass: string, documentSelector: string): Promise<void> {
  const frame = mktgPrintFrame(page);
  await expect(page.getByTestId('lfx-print-frame')).toHaveCount(1);
  // Also bind through this frame's window, never the application's window.
  // The init script covers a cache-hot frame that prints before this protocol round-trip.
  await frame.locator('html').evaluate((root) => {
    const view = root.ownerDocument.defaultView;
    if (view)
      view.print = () => {
        root.setAttribute('data-mktg-frame-printed', 'yes');
      };
  });
  await expect(frame.locator('body')).toHaveClass(new RegExp(bodyClass));
  await expect(frame.locator(documentSelector)).toHaveCount(1);
  await expect(frame.locator('script')).toHaveCount(0);
  // document.open() gave the frame the page's address (not about:blank), so default headers/footers print it.
  expect(await frame.locator('html').evaluate((root) => root.ownerDocument.location.href)).toBe(page.url().split('#')[0]);
  // The paper-sized frame is fixed, transparent and inert: hit testing skips it (elementsFromPoint
  // omits pointer-events:none boxes) and it adds no scrollable overflow, whatever the viewport, so the
  // page under it keeps working while the dialog is open. The probe is a point inside both the frame
  // and the viewport (its centre, pulled into view on the 393px project), over the main content.
  const overlay = await page.getByTestId('lfx-print-frame').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const root = element.ownerDocument.documentElement;
    const x = Math.min(rect.left + rect.width / 2, (view?.innerWidth ?? rect.width) / 2);
    const y = Math.min(rect.top + rect.height / 2, (view?.innerHeight ?? rect.height) / 2);
    const stack = element.ownerDocument.elementsFromPoint(x, y);
    return {
      probeInsideFrame: x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
      underProbe: stack.length,
      frameHit: stack.includes(element),
      addsScroll: root.scrollWidth > root.clientWidth && root.scrollWidth >= rect.right,
    };
  });
  expect(overlay.probeInsideFrame).toBe(true);
  expect(overlay.underProbe).toBeGreaterThan(0);
  expect(overlay.frameHit).toBe(false);
  expect(overlay.addsScroll).toBe(false);
  await expect(frame.locator('html')).toHaveAttribute('data-mktg-frame-printed', 'yes', { timeout: PRINT_FRAME_TIMEOUT_MS });
}

/**
 * Lay the printed frame out for measurement: production already gives it a
 * paper-sized viewport (asserted here, so the geometry below is production's),
 * but keeps it transparent. Make the frame element visible, on top, and put the
 * page under print media (the frame inherits the emulation). The document
 * inside is untouched: what is measured is the production layout.
 */
export async function layoutMktgPrintFrame(page: Page): Promise<FrameLocator> {
  const frame = page.getByTestId('lfx-print-frame');
  const box = await frame.boundingBox();
  expect(box && { width: Math.round(box.width), height: Math.round(box.height) }).toEqual(PRINT_FRAME_LETTER);
  await frame.evaluate((element) => {
    element.style.opacity = '1';
    element.style.zIndex = '2147483647';
  });
  await page.emulateMedia({ media: 'print' });
  return mktgPrintFrame(page);
}

/**
 * The portrait page setup the frame wrote, per engine: Chromium prints with no margin (no browser header or footer)
 * and the document's own room, 0.6in of it at the root's sides; WebKit, which prints a table's head and foot once,
 * prints on the page margins it had before, the named rule restated with them, the room collapsed under the body
 * class. Playwright's webkit project is the proof of the split.
 */
export async function expectMktgPrintPageSetup(frame: FrameLocator, root: Locator, browserName: string): Promise<void> {
  const webkit = browserName === 'webkit';
  const setup = webkit ? MKTG_PRINT_PAGE_SETUPS['mktg-framework-page-margins'] : MKTG_PRINT_PAGE_SETUPS['mktg-framework'];
  expect(await frame.locator('head style').last().textContent()).toBe(webkit ? `@page { ${setup} }\n@page mktg-framework { ${setup} }` : `@page { ${setup} }`);
  expect(setup).toBe(webkit ? 'size: portrait; margin: 0.55in 0.6in;' : 'size: portrait; margin: 0;');
  const marked = frame.locator(`body.${MKTG_PRINT_PAGE_MARGINS_CLASS}`);
  await expect(marked).toHaveCount(webkit ? 1 : 0);
  await expect(root).toHaveCSS('padding-left', webkit ? '0px' : '57.6px');
}

/**
 * The page setup of a document of portrait frames: US Letter with no margin in both engines, written unnamed and as
 * the frames' own named page, and never the page margins (a frame is the whole sheet). Given the document's `root`,
 * also its frames: the root lifts the flowing documents' side padding, and every frame (the grammar's
 * `lfx-mktg-portrait-page`, as many as the root's `data-pages` says, never none) sits at the page's edge, 816 by
 * 1056 px, on the named page, clipping what would pass its edge.
 */
export async function expectMktgPortraitPageSetup(frame: FrameLocator, root?: Locator): Promise<void> {
  const setup = MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];
  expect(setup).toBe('size: auto; margin: 0;');
  expect(await frame.locator('head style').last().textContent()).toBe(`@page { ${setup} }\n@page ${MKTG_PORTRAIT_PAGE_NAME} { ${setup} }`);
  await expect(frame.locator(`body.${MKTG_PRINT_PAGE_MARGINS_CLASS}`)).toHaveCount(0);
  if (!root) return;
  await expect(root).toHaveCSS('padding-left', '0px');
  const pages = root.getByTestId('lfx-mktg-portrait-page');
  const declared = Number(await root.getAttribute('data-pages'));
  expect(declared).toBeGreaterThan(0);
  await expect(pages).toHaveCount(declared);
  for (const page of await pages.all()) {
    const box = await page.boundingBox();
    expect({ x: Math.round(box?.x ?? -1), width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) }).toEqual({
      x: 0,
      width: 816,
      height: 1056,
    });
    await expect(page).toHaveCSS('page', MKTG_PORTRAIT_PAGE_NAME);
    await expect(page).toHaveCSS('overflow', 'hidden');
  }
}

/** A viewport-height cover in the laid-out frame fills the page: the 1px frame left it at its content's height. */
/**
 * A table box's computed length in px, to compare to a tenth: Chromium reports a table row's laid-out height snapped to
 * 1/64 px (52.7969px for 0.55in) and WebKit serialises 10pt with six decimals (13.333333px), so an exact string fails.
 */
export async function mktgPrintComputedPx(box: Locator, property: string): Promise<number> {
  return parseFloat(await box.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property));
}

export async function expectMktgPrintCover(cover: Locator): Promise<void> {
  await expect(cover).toBeVisible();
  const box = await cover.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(PRINT_COVER_MIN_HEIGHT);
}

/** Dispatched from the page, not from inside the frame: the service's afterprint cleanup removes the frame at once, and a
 *  call evaluated in the frame's own world would have no frame to return to (locator.evaluate: Frame was detached). */
export async function finishMktgPrintFrame(page: Page): Promise<void> {
  await page.getByTestId('lfx-print-frame').evaluate((frame) => {
    (frame as HTMLIFrameElement).contentWindow?.dispatchEvent(new Event('afterprint'));
  });
  await expect(page.getByTestId('lfx-print-frame')).toHaveCount(0);
}

/** The print frame's document as one self-contained page: its stylesheets inlined, its images silent. */
async function serializeMktgPrintFrame(frame: FrameLocator): Promise<string> {
  return frame.locator('html').evaluate(async (root) => {
    const clone = root.cloneNode(true) as HTMLElement;
    for (const link of Array.from(clone.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
      const style = root.ownerDocument.createElement('style');
      style.textContent = await fetch(link.href).then((response) => response.text());
      link.replaceWith(style);
    }
    // A logo the stub served from this context cannot be fetched from another browser; an image that fails to load
    // draws nothing (no alt text), and a frame's size never depends on one.
    clone.querySelectorAll('img').forEach((image) => image.setAttribute('alt', ''));
    return `<!doctype html>${clone.outerHTML}`;
  });
}

/** One print of the frame document by Google Chrome: the dialog's variant, the page count, the paper's box, the blank pages and each page's text. */
export interface MktgChromePrint {
  paper: 'Letter' | 'A4';
  headers: boolean;
  background: boolean;
  pages: number;
  /** The first page's box in CSS px (the PDF's points × 96 / 72), to compare with MKTG_PORTRAIT_PAPERS. */
  box: { width: number; height: number };
  blank: number[];
  text: string[];
}

/**
 * What the Save as PDF button saves, in the engine the editor uses: Google Chrome's own `Page.printToPDF` (Playwright's
 * `channel: 'chrome'`, not the bundled Chromium, which does not reproduce the blank sheet an inline host around a frame
 * cost in Chrome 156) on the frame document as the service built it, under the dialog's eight variants: the paper
 * Letter and A4 (the dialog's choice, never the CSS size: the grammar's `size: auto` makes the paper the page box and
 * scales the frames itself), the browser's headers and footers on and off, background graphics on and off. Returns
 * each print's page count, paper box, blank pages (a page with no text; a kit frame always prints its footer) and
 * text, so a test can assert the count against the plan and that the headers-on text equals the headers-off text (a
 * header or footer that reached the sheet shows as extra text). Returns nothing, naming it, where Google Chrome is not
 * installed.
 */
export async function printMktgFrameWithChrome(frame: FrameLocator): Promise<MktgChromePrint[]> {
  const html = await serializeMktgPrintFrame(frame);
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => null);
  if (!browser) return [];
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const prints: MktgChromePrint[] = [];
    for (const paper of ['Letter', 'A4'] as const) {
      for (const headers of [false, true]) {
        for (const background of [true, false]) {
          const bytes = new Uint8Array(
            await page.pdf({
              format: paper,
              preferCSSPageSize: false,
              margin: { top: 0, right: 0, bottom: 0, left: 0 },
              printBackground: background,
              displayHeaderFooter: headers,
            })
          );
          const pdf = await getDocumentProxy(bytes);
          const { text } = await extractText(pdf, { mergePages: false });
          const [, , width, height] = (await pdf.getPage(1)).view;
          prints.push({
            paper,
            headers,
            background,
            pages: pdf.numPages,
            box: { width: (width * 96) / 72, height: (height * 96) / 72 },
            blank: text.map((content, index) => (content.trim() ? -1 : index + 1)).filter((index) => index > 0),
            text: text.map((content) => content.replace(/\s+/g, ' ').trim()),
          });
        }
      }
    }
    return prints;
  } finally {
    await browser.close();
  }
}
