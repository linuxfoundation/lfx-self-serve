// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Campaigns → Implement tab: "Already created for this event" (#4983).
 *
 * Campaigns already created from a brief were only ever listed on Optimize. On Implement, a second
 * create on the same platform looked like a new campaign while campaign-service quietly returned the
 * first. These pin what a person sees on Implement: the campaigns that exist, how many per platform,
 * and a failed read reported as a failure rather than as "none".
 *
 * Every API is stubbed with synthetic fixtures; nothing here writes to a shared environment.
 */

import type { CampaignBriefLoadResult, CampaignBriefOutput, CampaignIndexDoc, CampaignListResult } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, EVENT_URL, gotoPlanningTab, mockPlanningApis, notFound, paidPanel, typeEventUrl } from './helpers/campaign-planning.helper';

test.setTimeout(120_000);

const savedBrief: CampaignBriefLoadResult = {
  status: 'loaded',
  briefId: 'brief-e2e-1',
  etag: 'W/"7"',
  approved: true,
  brief: {
    eventDetails: {
      name: 'KubeCon NA 2026',
      slug: 'kubecon-na-2026',
      registrationUrl: EVENT_URL,
      dates: '',
      city: '',
      countryCode: '',
      audience: '',
      themes: [],
      speakers: [],
      formatNotes: '',
      description: '',
      agendaUrl: '',
      cfpUrl: '',
      venueUrl: '',
      sponsorshipUrl: '',
    },
    structuredCopy: null,
    keywords: [],
    hsUtm: null,
    totalBudget: null,
    driveFolderUrl: '',
    campaignGoal: 'conversions',
    programType: 'events',
    deliveryType: 'paid-marketing',
    selectedPlatforms: ['google-ads'],
  } as CampaignBriefOutput,
};

const doc = (id: string, platform: string, status: string, slot: number): CampaignIndexDoc => ({
  id,
  project_id: 'aswf',
  brief_id: 'brief-e2e-1',
  platform,
  campaign_name: `KubeCon NA 2026 | ${platform} | ${id}`,
  status,
  version: 1,
  slot_version: slot,
});

function listResult(campaigns: CampaignIndexDoc[]): CampaignListResult {
  return {
    campaigns,
    possiblyStale: false,
    statusToggleEnabled: false,
    demandGenEnabled: false,
    googleChannelsEnabled: false,
    googleCreativeEnabled: false,
    redditCreativeEnabled: false,
    redditAssetUploadEnabled: false,
    redditConversionPixelEnabled: false,
    googleAssetUploadEnabled: false,
    metaCreativeEnabled: false,
    metaAssetUploadEnabled: false,
    linkedInAssetUploadEnabled: false,
    linkedInTargetingEditEnabled: false,
    microsoftAssetUploadEnabled: false,
    biddingEnabled: false,
    microsoftScheduleEnabled: false,
    twitterCreateEnabled: false,
    metaInstagramDsaEnabled: false,
    googleAudienceSegmentsEnabled: false,
    googleGeoSearchEnabled: false,
  };
}

/** Restore the saved brief, which hands it to Implement and reads its campaigns. */
async function restoreToImplement(page: Page): Promise<void> {
  await gotoPlanningTab(page);
  await typeEventUrl(page);
  await expect(paidPanel(page).getByTestId('planning-saved-brief')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await paidPanel(page).getByTestId('planning-restore-brief').getByRole('button').click();
  await expect(page.getByTestId('campaigns-implementation-panel')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.describe('Campaigns Implement tab — already created for this event (#4983)', () => {
  test('lists the live campaigns and counts them per platform', async ({ page }) => {
    await mockPlanningApis(page, {
      lookup: notFound(),
      savedBrief,
      briefCampaigns: listResult([doc('g1', 'google-ads', 'active', 1), doc('g2', 'google-ads', 'paused', 2), doc('gone', 'google-ads', 'deleted', 3)]),
    });
    await restoreToImplement(page);

    const panel = page.getByTestId('implementation-existing-campaigns');
    await expect(panel).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('implementation-existing-notice-google-ads')).toHaveText('You already have 2 Google Ads campaigns for this event.');
    await expect(page.getByTestId('implementation-existing-row-g1')).toContainText('active');
    await expect(page.getByTestId('implementation-existing-row-gone')).toHaveCount(0);
  });

  test('says an empty answer may be missing campaigns created moments ago', async ({ page }) => {
    await mockPlanningApis(page, { lookup: notFound(), savedBrief, briefCampaigns: { ...listResult([]), possiblyStale: true } });
    await restoreToImplement(page);

    await expect(page.getByTestId('implementation-existing-stale')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('implementation-existing-campaigns')).toHaveCount(0);
  });

  test('reports a failed read as a failure, with Retry, rather than as nothing created', async ({ page }) => {
    await mockPlanningApis(page, { lookup: notFound(), savedBrief });
    await page.route('**/api/campaigns/list?**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await restoreToImplement(page);

    await expect(page.getByTestId('implementation-existing-unavailable')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('implementation-existing-retry')).toBeVisible();
    await expect(page.getByTestId('implementation-existing-campaigns')).toHaveCount(0);
  });
});
