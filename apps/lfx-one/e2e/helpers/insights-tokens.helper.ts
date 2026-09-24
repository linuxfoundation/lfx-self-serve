// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared setup for the LFX Insights API tokens e2e specs (IN-1233): synthetic fixtures, BFF route
 * stubs, and the `insights-public-api` flag override. Stubbing keeps the suites independent of the
 * PAT service, the member-service tier endpoint, and the test user's Key Contact status.
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, INSIGHTS_PUBLIC_API_FLAG } from '@lfx-one/shared/constants';
import { CreateInsightsTokenResponse, InsightsToken, InsightsTokenEligibility } from '@lfx-one/shared/interfaces';
import { expect, Page } from '@playwright/test';

export const DATA_LOAD_TIMEOUT = 30_000;

export const ELIGIBLE: InsightsTokenEligibility = { canCreate: true, orgs: [{ uid: 'org-1', name: 'Acme Corporation' }], checkFailed: false };
export const NOT_KEY_CONTACT: InsightsTokenEligibility = { canCreate: false, orgs: [], checkFailed: false };
export const CHECK_FAILED: InsightsTokenEligibility = { canCreate: false, orgs: [], checkFailed: true };

export const EXISTING_TOKENS: InsightsToken[] = [
  {
    uid: '5f0c6f3e-2222-4a1a-9a1a-222222222222',
    name: 'weekly-report',
    lookupId: 'Qw7pR4sT8uVx',
    createdAt: '2026-09-01T00:00:00Z',
    lastUsedAt: '2026-09-20T00:00:00Z',
  },
  { uid: '5f0c6f3e-3333-4a1a-9a1a-333333333333', name: 'dashboard-sync', lookupId: 'Mn5bV2cX6zLk', createdAt: '2026-08-15T00:00:00Z', lastUsedAt: null },
];

export const CREATED: CreateInsightsTokenResponse = {
  token: { uid: '5f0c6f3e-1111-4a1a-9a1a-111111111111', name: 'ci-pipeline', lookupId: 'Ab3kZ9QmT2xL', createdAt: '2026-09-23T00:00:00Z', lastUsedAt: null },
  secret: 'lfi_Ab3kZ9QmT2xLe2eFakeSecretValueForTestsOnly',
};

export interface InsightsTokensStub {
  /** Token list to serve, or an HTTP status to fail the list call with. */
  tokens: InsightsToken[] | { status: number };
  eligibility: InsightsTokenEligibility;
}

/** Enable the flag, stub the BFF routes, open Developer Settings and wait for the group to render. */
export async function openInsightsTokens(page: Page, { tokens, eligibility }: InsightsTokensStub): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [INSIGHTS_PUBLIC_API_FLAG]: true }),
  ] as const);
  await page.route('**/api/profile/insights-tokens/eligibility', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eligibility) })
  );
  await page.route('**/api/profile/insights-tokens', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(CREATED) });
    }
    if (!Array.isArray(tokens)) {
      return route.fulfill({ status: tokens.status, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokens) });
  });
  await page.goto('/profile/settings#developer-settings', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('insights-tokens-group')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}
