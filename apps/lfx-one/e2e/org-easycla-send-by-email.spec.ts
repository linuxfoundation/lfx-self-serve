// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA send-by-email — content E2E (GH-2365).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-send-by-email-robust.spec.ts`
 * is the structural half. This one walks the chain a CLA manager walks when they are not the
 * signatory — Identify someone else, or I am not authorized — and asserts on the words and that
 * the browser stays in Org Lens.
 *
 * The unit tests cover the dialog on its own, with its inputs handed to it directly. What they
 * cannot cover is the chain: two entry points on a parent, an HTTP round trip in the middle, and
 * the absence of a full-page navigation at the end.
 *
 * **Nothing in this file may reach a real signing service.** The request creates a corporate
 * agreement and emails a named person, so the route that answers it is stubbed.
 *
 * Prerequisites: as `org-easycla-sign.spec.ts`.
 */

import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import { expect, Locator, Page, test } from '@playwright/test';

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

test.setTimeout(120_000);

const CASCADE = signOption();
const SIGNATORY_NAME = 'Alex Contributor';
const SIGNATORY_EMAIL = 'contributor@example.org';

function stubList(page: Page) {
  return fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
}

function nameInput(page: Page): Locator {
  return page.locator('[data-test="org-easycla-send-by-email-name"]');
}

function emailInput(page: Page): Locator {
  return page.locator('[data-test="org-easycla-send-by-email-email"]');
}

async function chooseClaGroup(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-sign-cla').locator('button').click();
  await expect(page.getByTestId('org-easycla-group-select-dialog')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await groupSearchInput(page).fill('cascade');
  await page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`).click();
  await page.getByTestId('org-easycla-group-continue').locator('button').click();

  await expect(page).toHaveURL(new RegExp(`/org/easycla/${CASCADE.claGroupId}$`), { timeout: PAGE_LOAD_TIMEOUT });
}

async function fillAndSend(page: Page): Promise<void> {
  await nameInput(page).fill(SIGNATORY_NAME);
  await emailInput(page).fill(SIGNATORY_EMAIL);
  await page.getByTestId('org-easycla-send-by-email-send').locator('button').click();
}

test.describe('Org Lens EasyCLA send-by-email — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('emails the CCLA from Identify someone else and stays in Org Lens', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '', signatureId: '' } } });
    });

    await chooseClaGroup(page);
    await page.getByTestId('org-easycla-detail-identify-someone-else').click();
    await expect(page.getByTestId('org-easycla-send-by-email-dialog')).toBeVisible();
    await expect(page.getByTestId('org-easycla-send-by-email-heading')).toHaveText(CCLA_SIGN_COPY.sendByEmail.header);

    await fillAndSend(page);

    await expect(page.getByTestId('org-easycla-send-by-email-sent')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-send-by-email-sent-body')).toHaveText(CCLA_SIGN_COPY.sendByEmail.successBody(SIGNATORY_EMAIL));
    await expect(page).toHaveURL(new RegExp(`/org/easycla/${CASCADE.claGroupId}$`));
  });

  test('opens the same dialog from I am not authorized', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '', signatureId: '' } } });
    });

    await chooseClaGroup(page);
    await page.getByTestId('org-easycla-detail-start-cla').locator('button').click();
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toBeVisible();

    await page.getByTestId('org-easycla-attestation-not-authorized').locator('button').click();

    await expect(page.getByTestId('org-easycla-send-by-email-dialog')).toBeVisible();
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-send-by-email-heading')).toHaveText(CCLA_SIGN_COPY.sendByEmail.header);
  });

  test('shows a refusal in the words the CLA service used, not the self-sign prepare sentence', async ({ page }) => {
    const refusal = 'This organization requires additional trade compliance review, so the CLA cannot be completed at this time. Contact EasyCLA Support.';

    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p, { sign: { status: 403, body: { error: refusal, code: 'FORBIDDEN' } } });
    });

    await chooseClaGroup(page);
    await page.getByTestId('org-easycla-detail-identify-someone-else').click();
    await fillAndSend(page);

    await expect(page.getByTestId('org-easycla-send-by-email-failed')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-send-by-email-failure-message')).toHaveText(refusal);
    await expect(page.getByTestId('org-easycla-send-by-email-failure-message')).not.toContainText(CCLA_SIGN_COPY.failure.body);
    await expect(page).toHaveURL(new RegExp(`/org/easycla/${CASCADE.claGroupId}$`));
  });
});
