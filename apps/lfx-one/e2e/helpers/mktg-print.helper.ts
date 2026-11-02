// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, FrameLocator, Page } from '@playwright/test';
import { MKTG_PRINT_FRAME_PAPER_IN } from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './account-settings-email.helper';

/** The frame prints once its own stylesheets, faces and images settle, or at the service's cap. */
const PRINT_FRAME_TIMEOUT_MS = 10_000;

/** US Letter at CSS pixels: the production frame's viewport, the initial containing block the print geometry is measured against. */
export const PRINT_FRAME_LETTER = { width: MKTG_PRINT_FRAME_PAPER_IN.width * 96, height: MKTG_PRINT_FRAME_PAPER_IN.height * 96 };

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
  // The paper-sized frame is fixed, transparent and inert: it takes no pointer events and adds no
  // scrollable overflow, whatever the viewport, so the page under it keeps working while the dialog is open.
  const overlay = await page.getByTestId('lfx-print-frame').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const root = element.ownerDocument.documentElement;
    return {
      hit: element.ownerDocument.elementFromPoint(rect.left + 4, rect.top + 4) === element,
      addsScroll: root.scrollWidth > root.clientWidth && root.scrollWidth >= rect.right,
    };
  });
  expect(overlay).toEqual({ hit: false, addsScroll: false });
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

export async function finishMktgPrintFrame(page: Page): Promise<void> {
  await mktgPrintFrame(page)
    .locator('html')
    .evaluate((root) => {
      root.ownerDocument.defaultView?.dispatchEvent(new Event('afterprint'));
    });
  await expect(page.getByTestId('lfx-print-frame')).toHaveCount(0);
}
