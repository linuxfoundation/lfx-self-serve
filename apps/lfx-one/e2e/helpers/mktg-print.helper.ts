// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, FrameLocator, Locator, Page } from '@playwright/test';
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
 * A document of fixed portrait frames (the framework's book) prints on Letter with no margin in both engines: the
 * frame's unnamed rule and the frames' own named page, restated with the same values; the root lifts the flowing
 * documents' side padding, so every frame sits at the page's edge, 816 by 1056 px.
 */
export async function expectMktgPortraitPageSetup(frame: FrameLocator, root: Locator): Promise<void> {
  const setup = MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];
  expect(setup).toBe('size: 8.5in 11in; margin: 0;');
  expect(await frame.locator('head style').last().textContent()).toBe(`@page { ${setup} }\n@page ${MKTG_PORTRAIT_PAGE_NAME} { ${setup} }`);
  await expect(root).toHaveCSS('padding-left', '0px');
  const pages = root.locator(':scope > section.fwp-page');
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
