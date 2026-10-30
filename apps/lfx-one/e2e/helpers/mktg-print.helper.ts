// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page } from '@playwright/test';
import { suppressCookieBanner } from './account-settings-email.helper';

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
  const frame = page.frameLocator('[data-testid="lfx-print-frame"]');
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
  await expect(frame.locator('html')).toHaveAttribute('data-mktg-frame-printed', 'yes', { timeout: 10_000 });
}

export async function finishMktgPrintFrame(page: Page): Promise<void> {
  await page
    .frameLocator('[data-testid="lfx-print-frame"]')
    .locator('html')
    .evaluate((root) => {
      root.ownerDocument.defaultView?.dispatchEvent(new Event('afterprint'));
    });
  await expect(page.getByTestId('lfx-print-frame')).toHaveCount(0);
}
