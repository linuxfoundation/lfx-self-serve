// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA send-by-email — structural E2E (GH-2365).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-send-by-email.spec.ts`
 * is the content half. This one asserts the `data-testid` contract, the two entry points, and the
 * request that goes on the wire — not the copy — so the pair fails independently: reworded copy
 * breaks only the content spec, and a dialog rebuilt behind the same testids leaves this one green.
 *
 * Same standing constraint as the content spec: the signing request is stubbed, so no run emails
 * a real person or creates a real envelope.
 *
 * Prerequisites: as `org-easycla-sign.spec.ts`.
 */

import { expect, Locator, Page, Request, test } from '@playwright/test';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  fulfillJson,
  gotoEasyclaList,
  groupSearchInput,
  PAGE_LOAD_TIMEOUT,
  signOption,
  skipWithoutCredentials,
  stubHandoff,
} from './helpers/org-easycla.helper';

const CASCADE = signOption();
const SIGNATORY_NAME = 'Alex Contributor';
const SIGNATORY_EMAIL = 'contributor@example.org';

test.setTimeout(120_000);

const SEND_DIALOG = 'org-easycla-send-by-email-dialog';
const ATTESTATION = 'org-easycla-attestation-dialog';
const HANDOFF = 'org-easycla-sign-handoff-dialog';
const SEND_STATES = ['org-easycla-send-by-email-sending', 'org-easycla-send-by-email-sent', 'org-easycla-send-by-email-failed'];

function stubPage(page: Page) {
  return fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
}

function nameInput(page: Page): Locator {
  return page.locator('[data-test="org-easycla-send-by-email-name"]');
}

function emailInput(page: Page): Locator {
  return page.locator('[data-test="org-easycla-send-by-email-email"]');
}

async function reachPreview(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-sign-cla').locator('button').click();
  await expect(page.getByTestId('org-easycla-group-select-dialog')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await groupSearchInput(page).fill('cascade');
  await page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`).click();
  await page.getByTestId('org-easycla-group-continue').locator('button').click();

  await expect(page.getByTestId('org-easycla-detail-identify-someone-else')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

async function onlySendState(page: Page, expected: string): Promise<void> {
  await expect(page.getByTestId(expected)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  for (const other of SEND_STATES.filter((state) => state !== expected)) {
    await expect(page.getByTestId(other)).toHaveCount(0);
  }
}

test.describe('Org Lens EasyCLA send-by-email — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('opens send-by-email from Identify someone else, never the hand-off', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '', signatureId: '' } } });
    });

    await reachPreview(page);
    await page.getByTestId('org-easycla-detail-identify-someone-else').click();

    await expect(page.getByTestId(SEND_DIALOG)).toBeVisible();
    await expect(page.getByTestId(ATTESTATION)).toHaveCount(0);
    await expect(page.getByTestId(HANDOFF)).toHaveCount(0);
  });

  test('replaces attestation with send-by-email from I am not authorized', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '', signatureId: '' } } });
    });

    await reachPreview(page);
    await page.getByTestId('org-easycla-detail-start-cla').locator('button').click();
    await expect(page.getByTestId(ATTESTATION)).toBeVisible();

    await page.getByTestId('org-easycla-attestation-not-authorized').locator('button').click();

    await expect(page.getByTestId(SEND_DIALOG)).toBeVisible();
    await expect(page.getByTestId(ATTESTATION)).toHaveCount(0);
    await expect(page.getByTestId(HANDOFF)).toHaveCount(0);
  });

  test('posts sendAsEmail with the named signatory and never the two attestations', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '', signatureId: '' } } });
    });

    const signRequest = page.waitForRequest((request: Request) => request.url().includes('/lens/cla-groups/sign') && request.method() === 'POST');

    await reachPreview(page);
    await page.getByTestId('org-easycla-detail-identify-someone-else').click();
    await nameInput(page).fill(SIGNATORY_NAME);
    await emailInput(page).fill(SIGNATORY_EMAIL);
    await page.getByTestId('org-easycla-send-by-email-send').locator('button').click();

    const body = (await (await signRequest).postDataJSON()) as Record<string, unknown>;

    expect(body['sendAsEmail']).toBe(true);
    expect(body['authorityName']).toBe(SIGNATORY_NAME);
    expect(body['authorityEmail']).toBe(SIGNATORY_EMAIL);
    expect(body['claGroupId']).toBe(CASCADE.claGroupId);
    expect(body['projectSfid']).toBe(CASCADE.projectSfid);
    expect(body).not.toHaveProperty('authorityAcked');
    expect(body).not.toHaveProperty('embargoAcked');
  });

  test('settles on the sent state alone and does not leave the tab', async ({ page, context }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '', signatureId: '' } } });
    });

    await reachPreview(page);
    const pagesBefore = context.pages().length;
    const urlBefore = page.url();

    await page.getByTestId('org-easycla-detail-identify-someone-else').click();
    await nameInput(page).fill(SIGNATORY_NAME);
    await emailInput(page).fill(SIGNATORY_EMAIL);
    await page.getByTestId('org-easycla-send-by-email-send').locator('button').click();

    await onlySendState(page, 'org-easycla-send-by-email-sent');
    await expect(page).toHaveURL(urlBefore);
    expect(context.pages()).toHaveLength(pagesBefore);
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('settles on the failure state alone when the request is refused', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p, { sign: { status: 403, body: { error: 'Refused', code: 'FORBIDDEN' } } });
    });

    await reachPreview(page);
    await page.getByTestId('org-easycla-detail-identify-someone-else').click();
    await nameInput(page).fill(SIGNATORY_NAME);
    await emailInput(page).fill(SIGNATORY_EMAIL);
    await page.getByTestId('org-easycla-send-by-email-send').locator('button').click();

    await onlySendState(page, 'org-easycla-send-by-email-failed');
    await expect(page.getByTestId('org-easycla-send-by-email-failure-message')).toBeVisible();
    await expect(page.getByTestId('org-easycla-send-by-email-sent')).toHaveCount(0);
  });
});
