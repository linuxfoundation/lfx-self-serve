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

import { ORG_EASYCLA_RETURN_ORG_PARAM } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  EASYCLA_URL,
  fulfillJson,
  gotoEasyclaList,
  groupSearchInput,
  MOCK_ACCOUNT_ID,
  PAGE_LOAD_TIMEOUT,
  signOption,
  signOptionsResponse,
  skipWithoutCredentials,
  stubHandoff,
  STUB_SIGNATURE_ID,
  STUB_SIGN_URL,
} from './helpers/org-easycla.helper';

// The default budget is one authenticated boot; these cases are a boot plus a four-step chain, and
// the return trip is a second boot on top of that. The neighbouring Org Lens specs all raise it for
// the same reason, and the same figure.
test.setTimeout(120_000);

const CASCADE = signOption();

function stubList(page: Page) {
  return fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
}

/**
 * Opens the picker and chooses the one signable CLA Group, landing on the preview page.
 *
 * The inner `button`, not the `lfx-button` host the test id sits on. Sign CLA is disabled until the
 * organization context settles, and Playwright's actionability check reads the element it is given
 * — a custom element, which is never "disabled" — so a click on the host lands on a dead control
 * instead of waiting for a live one. The whole file's other controls are already reached this way.
 */
async function chooseClaGroup(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-sign-cla').locator('button').click();
  await expect(page.getByTestId('org-easycla-group-select-dialog')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await groupSearchInput(page).fill('cascade');
  await page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`).click();
  await page.getByTestId('org-easycla-group-continue').locator('button').click();

  await expect(page).toHaveURL(/\/org\/easycla\/new$/, { timeout: PAGE_LOAD_TIMEOUT });
}

/**
 * Chooses the CLA Group and starts the process from the preview, leaving the attestation up.
 *
 * The preview between them is the part no unit test reaches: the choice crosses a router navigation
 * as state, and the page it lands on has to read it back before Start can build a request from it.
 */
async function chooseThenStart(page: Page): Promise<void> {
  await chooseClaGroup(page);

  await page.getByTestId('org-easycla-detail-start-cla').locator('button').click();
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

    await chooseThenStart(page);
    await confirmBoth(page);
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId('org-easycla-sign-ready')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('org-easycla-sign-review').locator('button').click();

    // The whole point of the hand-off: the address is the server's, byte for byte, and the
    // navigation is a full-page one in the same tab rather than a popup or an embedded frame.
    await expect(page).toHaveURL(STUB_SIGN_URL, { timeout: PAGE_LOAD_TIMEOUT });
  });

  /**
   * The preview page the picker now hands the choice to, and the reason it exists as a page rather
   * than a fourth dialog: it names the agreement the two legally operative steps are about.
   *
   * Only reachable this way. There is no fetch-a-CLA-group-by-id endpoint, so the address carries
   * nothing that could rebuild this page — which is also what the case below is about.
   */
  test('previews the chosen CLA Group before anything is confirmed', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p);
    });

    await chooseClaGroup(page);

    await expect(page.getByTestId('org-easycla-detail-title')).toHaveText(CASCADE.claGroupName);
    await expect(page.getByTestId('org-easycla-detail-not-started')).toBeVisible();
    // The row-shaped states of a page that fetches a list. This one fetches none, and either of
    // them here would tell a signatory the agreement they are about to sign does not exist.
    await expect(page.getByTestId('org-easycla-detail-not-found-state')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-list-loading')).toHaveCount(0);
  });

  /**
   * A pasted, bookmarked or linked preview address arrives on a fresh history entry, which carries
   * no choice — and nothing on the page can rebuild one. Sent back to the list, which is where the
   * picker is, rather than left on a page headed with a blank name and offering a Start that would
   * build a request from nothing.
   *
   * A reload is *not* this case, which is why it is not the one exercised here: the browser keeps a
   * history entry's state across a reload, and Angular copies it onto the navigation it synthesises
   * for one, so a reloaded preview still has the choice it was opened with.
   */
  test('sends a preview address that carries no choice back to the list', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p);
    });

    await page.goto(`${EASYCLA_URL}/new`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/org\/easycla$/, { timeout: PAGE_LOAD_TIMEOUT });
  });

  /**
   * The return trip, which is the half of the hand-off no dialog can assert.
   *
   * `return_url` is an input to the signing request, so it is fixed before the signature exists and
   * cannot name it. The signature crosses in `sessionStorage` instead, and this is the test that the
   * two halves meet: the signatory comes back to the list address and is put on the agreement they
   * just signed.
   */
  test('returns the signatory to the agreement they just signed', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p);
    });

    await chooseThenStart(page);
    await confirmBoth(page);
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId('org-easycla-sign-ready')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('org-easycla-sign-review').locator('button').click();
    await expect(page).toHaveURL(STUB_SIGN_URL, { timeout: PAGE_LOAD_TIMEOUT });

    // What EasyCLA does at the end of the ceremony: sends the browser to the address the request
    // named, which is the list plus the organization the session was opened for.
    await page.goto(`${EASYCLA_URL}?${ORG_EASYCLA_RETURN_ORG_PARAM}=${MOCK_ACCOUNT_ID}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/org/easycla/${STUB_SIGNATURE_ID}$`), { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-title')).toBeVisible();
  });

  // Single-use, and spent on the visit that finds it. Otherwise an abandoned ceremony leaves a
  // signature behind that hijacks an ordinary visit to the list — days later, on any return trip.
  test('does not divert an ordinary visit to the list', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubList(p);
      await stubHandoff(p);
    });

    await chooseThenStart(page);
    await confirmBoth(page);
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId('org-easycla-sign-ready')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('org-easycla-sign-review').locator('button').click();
    await expect(page).toHaveURL(STUB_SIGN_URL, { timeout: PAGE_LOAD_TIMEOUT });

    // Back to the list without the return parameter — a bookmark, or the signatory navigating there
    // themselves rather than being sent by EasyCLA.
    //
    // Waiting on a card, not on the page shell: the shell arrives in the server-rendered HTML, so
    // asserting it is satisfied before the client bundle has run — and the stash is read by the
    // client. Navigating away on the shell alone leaves it unspent and the case asserts nothing. A
    // card can only come from the list request the client makes.
    await page.goto(EASYCLA_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('org-easycla-card').first()).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/org\/easycla$/);

    // And spent by that visit, so the genuine return address no longer has one to follow either.
    await page.goto(`${EASYCLA_URL}?${ORG_EASYCLA_RETURN_ORG_PARAM}=${MOCK_ACCOUNT_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('org-easycla-card').first()).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/org\/easycla$/);
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

    await chooseThenStart(page);
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

    await chooseThenStart(page);
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

    await chooseThenStart(page);
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

    await page.getByTestId('org-easycla-sign-cla').locator('button').click();
    await groupSearchInput(page).fill('driftwood');

    await expect(page.getByTestId(`org-easycla-group-disabled-${multiProject.claGroupId}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Forced past the actionability check, which reads `aria-disabled` and would simply refuse to
    // click. Refusing is not the assertion: what has to be proven is that a click that does land —
    // as one from a pointing device would — still selects nothing.
    await page.getByTestId(`org-easycla-group-select-${multiProject.claGroupId}`).click({ force: true });

    await expect(page.getByTestId('org-easycla-group-continue').locator('button')).toBeDisabled();
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toHaveCount(0);
  });
});
