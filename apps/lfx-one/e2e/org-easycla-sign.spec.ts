// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA corporate self-sign — content E2E (GH-1983).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-sign-robust.spec.ts` is
 * the structural half. This one walks the chain a signatory walks — Sign CLA, choose a CLA Group,
 * confirm both statements, hand off — and asserts on the words and the destination.
 *
 * The unit tests cover each dialog on its own, with the next one's inputs handed to it directly.
 * What they cannot cover is the chain: three dialogs opened in sequence by a parent that passes
 * each one's result into the next, an HTTP round trip in the middle, and a full-page navigation at
 * the end. Every join in that sequence is real here and stubbed there.
 *
 * **Nothing in this file may reach a real signing service.** The request creates a corporate
 * agreement and a *sent* envelope with no rehearsal mode, so the route that answers it is stubbed,
 * and the address it answers with is a reserved-domain address that is itself routed and fulfilled
 * locally. A run that navigated to a genuine address would leave an unsigned agreement behind on
 * every execution, against a real organization.
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 */

import { expect, Page, test } from '@playwright/test';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  fulfillJson,
  gotoEasyclaList,
  groupSearchInput,
  PAGE_LOAD_TIMEOUT,
  signOption,
  signOptionsResponse,
  skipWithoutCredentials,
  stubHandoff,
  STUB_SIGN_URL,
} from './helpers/org-easycla.helper';

const CASCADE = signOption();

function stubList(page: Page) {
  return fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
}

/** Opens the picker and chooses the one signable CLA Group, leaving the attestation dialog up. */
async function chooseClaGroup(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-sign-cla').click();
  await expect(page.getByTestId('org-easycla-group-select-dialog')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await groupSearchInput(page).fill('cascade');
  await page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`).click();
  await page.getByTestId('org-easycla-group-continue').locator('button').click();

  await expect(page.getByTestId('org-easycla-attestation-dialog')).toBeVisible();
}

/** Ticks both confirmations. The labels are the accessible handles PrimeNG wires to the boxes. */
async function confirmBoth(page: Page): Promise<void> {
  await page.locator('label[for="authorityAcked"]').click();
  await page.locator('label[for="embargoAcked"]').click();
}

test.describe('Org Lens EasyCLA corporate self-sign — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('walks the whole chain and hands off to the address the server returned', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p);
    });

    await chooseClaGroup(page);
    await confirmBoth(page);
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId('org-easycla-sign-ready')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('org-easycla-sign-review').locator('button').click();

    // The whole point of the hand-off: the address is the server's, byte for byte, and the
    // navigation is a full-page one in the same tab rather than a popup or an embedded frame.
    await expect(page).toHaveURL(STUB_SIGN_URL, { timeout: PAGE_LOAD_TIMEOUT });
  });

  /**
   * The attestation gate, driven the way a signatory would.
   *
   * This is the assertion the feature exists to make safe. Continuing without both confirmations
   * would transmit an affirmation the signatory did not make, and produce a legally binding
   * document that nothing downstream can distinguish from a genuine one.
   */
  test('will not continue until both confirmations are given', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p);
    });

    // No request may leave while the gate is shut, so any that does fails the test rather than
    // being quietly answered by the stub.
    let signRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/lens/cla-groups/sign') && request.method() === 'POST') signRequests += 1;
    });

    await chooseClaGroup(page);
    const continueButton = page.getByTestId('org-easycla-attestation-continue').locator('button');

    await expect(continueButton).toBeDisabled();

    await page.locator('label[for="authorityAcked"]').click();
    await expect(continueButton).toBeDisabled();

    await page.locator('label[for="embargoAcked"]').click();
    await expect(continueButton).toBeEnabled();

    // Withdrawing one closes the gate again, rather than leaving it open on a stale check.
    await page.locator('label[for="authorityAcked"]').click();
    await expect(continueButton).toBeDisabled();

    expect(signRequests).toBe(0);
  });

  /**
   * A refusal reaches the signatory in the CLA service's own words.
   *
   * The trade-compliance refusal is the case this is for: it names the reason and the route to
   * challenge it, and replacing it with generic copy would leave a signatory with no idea why
   * their organization cannot sign or who to ask.
   */
  test('shows a refusal in the words the CLA service used, not generic failure copy', async ({ page }) => {
    const refusal = 'This organization requires additional trade compliance review, so the CLA cannot be completed at this time. Contact EasyCLA Support.';

    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      // The envelope the BFF's error class really serialises to: the sentence under `error`.
      await stubHandoff(p, { sign: { status: 403, body: { error: refusal, code: 'FORBIDDEN' } } });
    });

    await chooseClaGroup(page);
    await confirmBoth(page);
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId('org-easycla-sign-failed')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-sign-failure-message')).toHaveText(refusal);
    await expect(page.getByTestId('org-easycla-sign-failure-message')).not.toContainText('We could not prepare this CLA');
  });

  // A response with no address is how the CLA service says it emailed a named signatory instead —
  // a shape this flow never asks for. Navigating anyway would send the signer to an empty URL.
  test('treats a response carrying no signing address as a failure', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p, { sign: { status: 200, body: { signUrl: '' } } });
    });

    await chooseClaGroup(page);
    await confirmBoth(page);
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId('org-easycla-sign-failed')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/org\/easycla/);
  });

  // A CLA Group with no resolvable project cannot be signed corporately. It stays on screen with
  // its reason — dropping it would leave the signatory hunting for something they can see in the
  // legacy console — but it must never become the one a request is built from.
  test('shows an unsignable CLA group with its reason and refuses to choose it', async ({ page }) => {
    const multiProject = signOption({ claGroupId: 'bbbbbbbb-2222-4222-8222-222222222222', claGroupName: 'Driftwood Umbrella CLA', projectSfid: undefined });

    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p, { search: signOptionsResponse([multiProject]) });
    });

    await page.getByTestId('org-easycla-sign-cla').click();
    await groupSearchInput(page).fill('driftwood');

    await expect(page.getByTestId(`org-easycla-group-disabled-${multiProject.claGroupId}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`org-easycla-group-select-${multiProject.claGroupId}`).click();

    await expect(page.getByTestId('org-easycla-group-continue').locator('button')).toBeDisabled();
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toHaveCount(0);
  });
});
