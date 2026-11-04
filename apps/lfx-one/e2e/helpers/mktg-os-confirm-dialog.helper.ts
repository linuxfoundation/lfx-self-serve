// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Locator, Page } from '@playwright/test';

/**
 * Locator only: page setup and cookie handling remain the caller's responsibility.
 *
 * PrimeNG's ConfirmDialog appends its dialog to `<body>` when it opens (`appendTo` defaults to `'body'`), so the
 * `<p-confirmdialog>` host and its test id never contain the open dialog: only an empty `<p-dialog role="alertdialog">`
 * host stays behind. One active-run dialog is open at a time, so the page's last alertdialog is the open one (the
 * inner dialog, after its empty host).
 */
export function activeRunConfirmDialog(page: Page): Locator {
  return page.getByRole('alertdialog').last();
}
