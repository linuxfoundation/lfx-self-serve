// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Locator, Page } from '@playwright/test';

/** Locator only: page setup and cookie handling remain the caller's responsibility. */
export function activeRunConfirmDialog(page: Page, hostTestId?: string): Locator {
  const host = hostTestId ? page.getByTestId(hostTestId) : page;
  // PrimeNG exposes alertdialog on both its host and inner dialog. Select the inner one.
  return host.getByRole('alertdialog').last();
}
