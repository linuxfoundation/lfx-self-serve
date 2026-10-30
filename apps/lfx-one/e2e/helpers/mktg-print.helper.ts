// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, FrameLocator, Page } from '@playwright/test';
import { suppressCookieBanner } from './account-settings-email.helper';

/** The frame prints once its own stylesheets, faces and images settle, or at the service's cap. */
const PRINT_FRAME_TIMEOUT_MS = 10_000;

/** US Letter at CSS pixels: the initial containing block the print geometry is measured against. */
export const PRINT_FRAME_LETTER = { width: 8.5 * 96, height: 11 * 96 };

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
  await expect(frame.locator('html')).toHaveAttribute('data-mktg-frame-printed', 'yes', { timeout: PRINT_FRAME_TIMEOUT_MS });
}

/**
 * Lay the printed frame out for measurement: production keeps it at 1px and
 * transparent, so give the frame element a paper-sized, visible viewport and
 * put the page under print media (the frame inherits the emulation). The
 * document inside is untouched: what is measured is the production layout.
 */
export async function layoutMktgPrintFrame(page: Page, paper = PRINT_FRAME_LETTER): Promise<FrameLocator> {
  await page.getByTestId('lfx-print-frame').evaluate((element, size) => {
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    element.style.opacity = '1';
    element.style.zIndex = '2147483647';
  }, paper);
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
