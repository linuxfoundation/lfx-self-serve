// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Campaigns → Planning tab: open the event's saved brief to edit it (#4983).
 *
 * Before this, a saved brief could only be restored straight to Implement, and regenerating for the
 * event was refused, so the only way to change a brief was to pick another event. These pin what a
 * person can now do in the browser: open the saved brief in the editor, see that its event is fixed,
 * and save it back over the SAME row with the version they opened as the precondition.
 *
 * Every API is stubbed with synthetic fixtures; nothing here writes to a shared environment.
 */

import type { CampaignBriefLoadResult, CampaignBriefOutput } from '@lfx-one/shared/interfaces';
import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, EVENT_URL, gotoPlanningTab, mockPlanningApis, notFound, paidPanel, typeEventUrl } from './helpers/campaign-planning.helper';

test.setTimeout(120_000);

const SLUG = 'kubecon-na-2026';

const savedBrief: CampaignBriefLoadResult = {
  status: 'loaded',
  briefId: 'brief-e2e-1',
  etag: 'W/"7"',
  approved: true,
  brief: {
    eventDetails: {
      name: 'KubeCon NA 2026',
      slug: SLUG,
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
    structuredCopy: { google_search: { headlines: ['Saved headline'], descriptions: ['Saved description'] } },
    keywords: [{ term: 'kubecon', matchType: 'Exact', intentLevel: 'High', notes: '' }],
    hsUtm: null,
    totalBudget: null,
    driveFolderUrl: '',
    campaignGoal: 'conversions',
    programType: 'events',
    deliveryType: 'paid-marketing',
    selectedPlatforms: ['google-ads'],
  } as CampaignBriefOutput,
};

test.describe('Campaigns Planning tab — open the saved brief to edit (#4983)', () => {
  test('opens the saved brief in the editor with its event fixed, and saves it over the same row', async ({ page }) => {
    const persisted: { query: Record<string, string>; brief: CampaignBriefOutput }[] = [];
    await mockPlanningApis(page, { lookup: notFound(), savedBrief, persisted });
    await gotoPlanningTab(page);
    await typeEventUrl(page);

    const panel = paidPanel(page);
    await expect(panel.getByTestId('planning-saved-brief')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await panel.getByTestId('planning-open-saved-brief').getByRole('button').click();

    // In the editor, on the saved copy, with the event shown read-only.
    await expect(panel.getByTestId('planning-review-step')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(panel.getByTestId('planning-success-banner')).toContainText("Editing this event's brief");
    await expect(panel.getByTestId('planning-edit-existing-url')).toHaveText(EVENT_URL);
    await expect(panel.getByTestId('planning-save-proceed-btn')).toBeVisible();

    await panel.getByTestId('planning-save-proceed-btn').getByRole('button').click();

    // One save, replacing THIS row with the version that was opened as If-Match, for the same event.
    await expect.poll(() => persisted.length, { timeout: DATA_LOAD_TIMEOUT }).toBe(1);
    expect(persisted[0].query['brief_id']).toBe('brief-e2e-1');
    expect(persisted[0].query['etag']).toBe('W/"7"');
    expect(persisted[0].brief.eventDetails.slug).toBe(SLUG);
  });

  test('without a saved brief there is nothing to open', async ({ page }) => {
    await mockPlanningApis(page, { lookup: notFound() });
    await gotoPlanningTab(page);
    await typeEventUrl(page);

    await expect(paidPanel(page).getByTestId('planning-open-saved-brief')).toHaveCount(0);
  });
});
