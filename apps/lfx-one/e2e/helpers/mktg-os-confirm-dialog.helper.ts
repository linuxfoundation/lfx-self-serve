// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Locator, Page } from '@playwright/test';

/**
 * Locator only: page setup and cookie handling remain the caller's responsibility.
 *
 * PrimeNG's ConfirmDialog appends its open dialog to `<body>` (`appendTo` defaults to `'body'`) inside a `.p-dialog-mask`
 * overlay it renders only while the dialog is open, and keeps an empty `<p-dialog role="alertdialog">` host inside the
 * `<p-confirmdialog>` whether open or closed. Scoping to the overlay therefore finds the open dialog on every host and
 * counts 0 once it has closed; the host's test id would never contain it, and the page's last alertdialog never reaches 0.
 */
export function activeRunConfirmDialog(page: Page): Locator {
  return page.locator('.p-dialog-mask').getByRole('alertdialog');
}
