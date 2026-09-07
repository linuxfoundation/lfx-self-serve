// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Group "About" tab — robust structural tests (LFXV2-1713). Asserts the data-testid contract. */

import { expect, Page, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';

import {
  buildBaseCommittee,
  DATA_LOAD_TIMEOUT,
  gotoCommitteeTab as gotoCommitteeTabHelper,
  mockCommitteeApis as mockCommitteeApisHelper,
} from './helpers/committee-about.helper';

test.beforeEach(() => skipWhenAuthMissing());

const COMMITTEE_UID = 'e2e-about-robust-committee';

function baseCommittee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return buildBaseCommittee(COMMITTEE_UID, {
    name: 'E2E About Tab Robust Working Group',
    description: 'A working group used to exercise the About tab structural contract in e2e tests.',
    website: 'https://example.org/e2e-about-robust',
    mailing_list: 'e2e-about-robust@example.org',
    chat_channel: 'https://slack.example.org/e2e-about-robust',
    my_role: 'Member',
    ...overrides,
  });
}

function mockCommitteeApis(page: Page, opts: { committee: Record<string, unknown>; meetings?: unknown[] }): Promise<void> {
  return mockCommitteeApisHelper(page, COMMITTEE_UID, opts);
}

function gotoCommitteeTab(page: Page, query = '?tab=about'): Promise<void> {
  return gotoCommitteeTabHelper(page, COMMITTEE_UID, query);
}

test.setTimeout(120_000);

test.describe('Group About tab — Robust Structural Tests (LFXV2-1713)', () => {
  test.beforeEach(async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee() });
    await gotoCommitteeTab(page);
    await expect(page.getByTestId('committee-about')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
  });

  test.describe('Container structure', () => {
    test('About root container carries the two-column grid layout contract', async ({ page }) => {
      const root = page.getByTestId('committee-about');
      await expect(root).toBeAttached();
      await expect(root).toHaveClass(/lg:grid-cols-2/);
    });

    test('description, cadence, parent, and key-information cards are nested inside the About root', async ({ page }) => {
      const about = page.getByTestId('committee-about');
      await expect(about.getByTestId('committee-about-description-card')).toBeAttached();
      await expect(about.getByTestId('committee-about-cadence-card')).toBeAttached();
      await expect(about.getByTestId('committee-about-parent-card')).toBeAttached();
      await expect(about.getByTestId('committee-about-key-info-card')).toBeAttached();
    });

    test('channels card is nested inside the About root and lists the configured chat/website rows', async ({ page }) => {
      const channelsCard = page.getByTestId('committee-about').getByTestId('committee-about-channels-card');
      await expect(channelsCard).toBeAttached();
      await expect(channelsCard.getByTestId('committee-about-chat-channel-row')).toBeAttached();
      await expect(channelsCard.getByTestId('committee-about-website-row')).toBeAttached();
    });

    test('cadence card contains the subscribe button and a summary node', async ({ page }) => {
      const cadenceCard = page.getByTestId('committee-about-cadence-card');
      await expect(cadenceCard.getByTestId('committee-about-subscribe-btn')).toBeAttached();
      await expect(cadenceCard.getByTestId('committee-about-cadence-summary')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    });
  });

  test.describe('Header/About duplication contract', () => {
    test('the header description/channels block toggles off for About and back on for Overview', async ({ page }) => {
      await expect(page.getByTestId('committee-view-description')).not.toBeAttached();
      await expect(page.getByTestId('committee-view-channels-card')).not.toBeAttached();

      await gotoCommitteeTab(page, '?tab=overview');
      await expect(page.getByTestId('committee-view-description')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('committee-view-channels-card')).toBeAttached();
    });

    test('the committee-view tab strip remains attached above the About body', async ({ page }) => {
      await expect(page.getByTestId('committee-view-tabs')).toBeAttached();
    });
  });

  test.describe('Join CTA nesting contract (visitor)', () => {
    test('the join CTA and its button are nested under the About root for a visitor', async ({ page }) => {
      await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'open' }) });
      await gotoCommitteeTab(page);
      await expect(page.getByTestId('committee-about')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });

      const about = page.getByTestId('committee-about');
      const joinCta = about.getByTestId('committee-about-join-cta');
      await expect(joinCta).toBeAttached();
      await expect(joinCta.getByTestId('group-join-cta-visitor-cta')).toBeAttached();
      await expect(joinCta.getByTestId('group-join-cta-join-btn')).toBeAttached();
    });
  });
});
