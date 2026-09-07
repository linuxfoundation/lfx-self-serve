// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Campaigns → Planning tab: the HubSpot UTM surface, end to end (LFXV2-2641).
 *
 * WHY THIS SURFACE. It is the one place in the campaign flow where what the UI *says* decides
 * whether a non-idempotent write happens: the operator clicks Create when, and only when, the
 * panel tells them no campaign was found. A HubSpot campaign created twice cannot be removed
 * from this UI and is visible to everyone on that portal, so every state below is really a
 * question about money and shared namespace, not about pixels.
 *
 * The unit tests cover the component's signals; these cover what a person can actually DO with
 * a browser in front of them — which is the thing no spec in this repo checked before.
 */

import { expect, test } from '@playwright/test';

import {
  DATA_LOAD_TIMEOUT,
  found,
  gotoPlanningTab,
  inconclusive,
  mockPlanningApis,
  notFound,
  paidPanel,
  typeEventUrl,
} from './helpers/campaign-planning.helper';

test.setTimeout(120_000);

test.describe('Campaigns Planning tab — HubSpot UTM (LFXV2-2641)', () => {
  test('an existing campaign is shown with its token, and no create is offered', async ({ page }) => {
    const counts = { lookups: 0, creates: 0 };
    await mockPlanningApis(page, { lookup: found('kubecon-na-2026'), counts });
    await gotoPlanningTab(page);

    await expect(paidPanel(page).getByTestId('planning-url-section')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await typeEventUrl(page);

    // The token is surfaced for the brief to use.
    await expect(paidPanel(page).getByTestId('planning-hubspot-status')).toContainText(/Found/i, { timeout: DATA_LOAD_TIMEOUT });

    // And crucially: no create offer, because the campaign already exists. Offering one here is
    // exactly how a duplicate gets made.
    await expect(paidPanel(page).getByTestId('planning-hubspot-create-btn')).toHaveCount(0);
    expect(counts.creates, 'a create was attempted for a campaign that already exists').toBe(0);
  });

  test('a settled not-found offers the create, with the portal-exposure warning', async ({ page }) => {
    await mockPlanningApis(page, { lookup: notFound() });
    await gotoPlanningTab(page);

    await expect(paidPanel(page).getByTestId('planning-url-section')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await typeEventUrl(page);

    // This is the ONE state where creating is legitimate: nothing matched, and the search could
    // prove it.
    await expect(paidPanel(page).getByTestId('planning-hubspot-create-btn')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The warning is a contract requirement, not decoration: the campaign lands in a namespace
    // shared by everyone on that HubSpot portal, and the name is whatever the operator typed.
    await expect(paidPanel(page).getByTestId('planning-hubspot-global-warning')).toBeVisible();
  });

  test('an inconclusive search offers NO create, and says why', async ({ page }) => {
    const counts = { lookups: 0, creates: 0 };
    await mockPlanningApis(page, { lookup: inconclusive(), counts });
    await gotoPlanningTab(page);

    await expect(paidPanel(page).getByTestId('planning-url-section')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await typeEventUrl(page);

    // Absence that could not be PROVEN must not read as licence to create: the campaign may sit
    // below the search cap, and creating then duplicates it.
    await expect(paidPanel(page).getByTestId('planning-hubspot-capped')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(paidPanel(page).getByTestId('planning-hubspot-create-btn')).toHaveCount(0);

    // The operator is told what to do instead, rather than left with a dead panel.
    await expect(paidPanel(page).getByTestId('planning-hubspot-capped')).toContainText(/narrower|check HubSpot/i);
    expect(counts.creates, 'created a campaign on a search that settled nothing').toBe(0);
  });

  test('creating writes the returned token back into the panel', async ({ page }) => {
    const counts = { lookups: 0, creates: 0 };
    await mockPlanningApis(page, {
      lookup: notFound(),
      create: { created: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026' },
      counts,
    });
    await gotoPlanningTab(page);

    await expect(paidPanel(page).getByTestId('planning-url-section')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await typeEventUrl(page);
    await paidPanel(page).getByTestId('planning-hubspot-create-btn').click({ timeout: DATA_LOAD_TIMEOUT });

    await expect(paidPanel(page).getByTestId('planning-hubspot-status')).toContainText(/Created/i, { timeout: DATA_LOAD_TIMEOUT });
    // Exactly once. A double-submit here is a duplicate campaign, not a retry.
    expect(counts.creates, 'the create was sent more than once').toBe(1);

    // And the offer is withdrawn now that the campaign exists.
    await expect(paidPanel(page).getByTestId('planning-hubspot-create-btn')).toHaveCount(0);
  });

  test('a definite create failure keeps the offer and blames the request, not HubSpot', async ({ page }) => {
    await mockPlanningApis(page, { lookup: notFound(), create: { status: 400 } });
    await gotoPlanningTab(page);

    await expect(paidPanel(page).getByTestId('planning-url-section')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await typeEventUrl(page);
    await paidPanel(page).getByTestId('planning-hubspot-create-btn').click({ timeout: DATA_LOAD_TIMEOUT });

    // A 400 PROVES nothing was created, so the operator can correct and retry — the offer stays.
    //
    // Asserts UPSTREAM'S text, not the hard-coded prompt. campaign-service uses 400 for 39 distinct
    // reasons -- "invalid credentials payload" among them -- so createFailureMessage now prefers the
    // message it actually sent, and this stub sends one. The previous expectation pinned the no-body
    // fallback, which this stub can never produce.
    await expect(paidPanel(page).getByTestId('planning-hubspot-status')).toContainText(/refused/i, { timeout: DATA_LOAD_TIMEOUT });
    await expect(paidPanel(page).getByTestId('planning-hubspot-create-btn')).toBeVisible();
    // And it must NOT tell them to go hunting in HubSpot for something never attempted.
    await expect(paidPanel(page).getByTestId('planning-hubspot-status')).not.toContainText(/may or may not/i);
  });

  test('an unconfirmed create withdraws the offer and leaves a way to recover', async ({ page }) => {
    await mockPlanningApis(page, { lookup: notFound(), create: { status: 503 } });
    await gotoPlanningTab(page);

    await expect(paidPanel(page).getByTestId('planning-url-section')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await typeEventUrl(page);
    await paidPanel(page).getByTestId('planning-hubspot-create-btn').click({ timeout: DATA_LOAD_TIMEOUT });

    // The campaign MAY exist, so re-offering Create would invite the duplicate.
    await expect(paidPanel(page).getByTestId('planning-hubspot-status')).toContainText(/may or may not/i, { timeout: DATA_LOAD_TIMEOUT });
    await expect(paidPanel(page).getByTestId('planning-hubspot-create-btn')).toHaveCount(0);

    // But withdrawing it must not strand the operator: a re-check is the only thing that can
    // establish what actually happened, and retyping the same url cannot start one.
    await expect(paidPanel(page).getByTestId('planning-hubspot-recheck-btn')).toBeVisible();
  });
});
