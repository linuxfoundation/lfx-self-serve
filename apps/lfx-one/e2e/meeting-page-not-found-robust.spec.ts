// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Redesigned meeting not-found page (#4883): data-testid and ARIA contract, meetings-redesign flag on.
 * Same prerequisites as `meeting-page-not-found.spec.ts`: a non-production dev server and the authenticated storage state.
 */
import { expect, test } from '@playwright/test';

import { stubMeetingPageRedesign } from './helpers/meetings-v2-flag.helper';

const PAGE_LOAD_TIMEOUT = 30_000;
const UNKNOWN_MEETING_ID = '90000000000';

test.describe('Meeting not-found page - Robust Tests', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await stubMeetingPageRedesign(page, baseURL);
    await page.goto(`/meetings/${UNKNOWN_MEETING_ID}`);
    await expect(page.getByTestId('meeting-page-not-found')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('renders the top bar, the not-found content and the footer in order', async ({ page }) => {
    const root = page.getByTestId('meeting-page-not-found');
    const bar = await root.getByTestId('meeting-page-top-bar').boundingBox();
    const reasons = await root.getByTestId('meeting-page-not-found-reasons').boundingBox();
    const footer = await root.getByTestId('meeting-page-footer').boundingBox();

    expect(bar && reasons && footer).toBeTruthy();
    expect(bar!.y).toBeLessThan(reasons!.y);
    expect(reasons!.y).toBeLessThan(footer!.y);
  });

  test('has one h1, a reasons list of four, and both actions as buttons', async ({ page }) => {
    const root = page.getByTestId('meeting-page-not-found');

    await expect(root.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(root.getByTestId('meeting-page-not-found-reasons').getByRole('listitem')).toHaveCount(4);
    await expect(root.getByTestId('meeting-page-not-found-my-meetings').getByRole('button')).toBeEnabled();
    await expect(root.getByTestId('meeting-page-not-found-support').getByRole('button')).toBeEnabled();
  });
});
