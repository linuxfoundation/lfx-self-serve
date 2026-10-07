// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the reads the admin enroll wizard makes on its first step (linuxfoundation/lfx-mentorship#259): the
 * programs the admin can import from, the program-name check and the Linux Foundation project search. All data is
 * synthetic. The wizard's writes are never stubbed here, so a spec that sends one fails loudly.
 */

import { Page, Route } from '@playwright/test';

type FulfillJson = (route: Route, body: unknown) => Promise<void>;

/** Answers the first-step reads with empty lists and an available name. */
export async function stubEnrollWizardReads(page: Page, fulfillJson: FulfillJson): Promise<void> {
  await page.route('**/api/mentorship/admin/programs*', (route) => fulfillJson(route, { data: [], total: 0 }));
  await page.route('**/api/mentorship/programs/name-available*', (route) => fulfillJson(route, { available: true }));
  await page.route('**/api/mentorship/lf-projects*', (route) => fulfillJson(route, { data: [], total: 0 }));
}
