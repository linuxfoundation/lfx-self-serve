// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA corporate self-sign — structural E2E (GH-1983).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-sign.spec.ts` is the
 * content half. This one asserts the `data-testid` contract, the dialog sequence, and the request
 * that goes on the wire — not the copy — so the pair fails independently: reworded legal text
 * breaks only the content spec, and a dialog rebuilt behind the same testids leaves this one green.
 *
 * The hand-off's three states are mutually exclusive by construction, so each is pinned together
 * with the absence of the others. A regression that renders "preparing" alongside "ready" is
 * otherwise invisible to a spec that only asserts presence — and on this flow that pairing would
 * show a signatory a spinner above a button that opens a legal agreement.
 *
 * Same standing constraint as the content spec: the signing request is stubbed and the address it
 * returns is intercepted, so no run creates a real agreement or a real envelope.
 *
 * Prerequisites: as `org-easycla-sign.spec.ts`.
 */

import { expect, Page, Request, test } from '@playwright/test';

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
  STUB_SIGN_URL,
} from './helpers/org-easycla.helper';

const CASCADE = signOption();

// The default budget is one authenticated boot; these cases are a boot plus a four-step chain. The
// neighbouring Org Lens specs all raise it for the same reason, and the same figure.
test.setTimeout(120_000);

/** The dialogs, in the order the flow opens them. */
const PICKER = 'org-easycla-group-select-dialog';
const ATTESTATION = 'org-easycla-attestation-dialog';
const HANDOFF = 'org-easycla-sign-handoff-dialog';

/** Start, on the preview page the picker hands the choice to — the step between picker and dialogs. */
const PREVIEW_START = 'org-easycla-detail-start-cla';

const HANDOFF_STATES = ['org-easycla-sign-preparing', 'org-easycla-sign-ready', 'org-easycla-sign-failed'];

function stubPage(page: Page) {
  return fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
}

/** Asserts exactly one hand-off state is on screen. */
async function onlyState(page: Page, expected: string): Promise<void> {
  await expect(page.getByTestId(expected)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  for (const other of HANDOFF_STATES.filter((state) => state !== expected)) {
    await expect(page.getByTestId(other)).toHaveCount(0);
  }
}

/**
 * Picks the CLA Group, which now lands on the preview page rather than opening the attestation.
 *
 * The inner `button`, not the `lfx-button` host the test id sits on. Sign CLA is disabled until the
 * organization context settles, and Playwright's actionability check reads the element it is given
 * — a custom element, which is never "disabled" — so a click on the host lands on a dead control
 * instead of waiting for a live one.
 */
async function reachPreview(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-sign-cla').locator('button').click();
  await expect(page.getByTestId(PICKER)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await groupSearchInput(page).fill('cascade');
  await page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`).click();
  await page.getByTestId('org-easycla-group-continue').locator('button').click();

  await expect(page.getByTestId(PREVIEW_START)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

async function reachAttestation(page: Page): Promise<void> {
  await reachPreview(page);
  await page.getByTestId(PREVIEW_START).locator('button').click();
}

async function reachHandoff(page: Page): Promise<void> {
  await reachAttestation(page);
  await page.locator('label[for="authorityAcked"]').click();
  await page.locator('label[for="embargoAcked"]').click();
  await page.getByTestId('org-easycla-attestation-continue').locator('button').click();
}

test.describe('Org Lens EasyCLA corporate self-sign — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  // One step at a time. The flow replaces each with the next rather than stacking them, so a
  // regression that leaves the picker mounted behind the attestation would let a signatory change
  // the CLA Group under a confirmation they have already given.
  //
  // The picker and the two dialogs are separated by a page: the choice is carried to the preview by
  // a router navigation, and both dialogs are opened by that page rather than by the list.
  test('opens the picker, the preview, then the two dialogs in sequence', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p);
    });

    await page.getByTestId('org-easycla-sign-cla').locator('button').click();
    await expect(page.getByTestId(PICKER)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(ATTESTATION)).toHaveCount(0);
    await expect(page.getByTestId(HANDOFF)).toHaveCount(0);

    await groupSearchInput(page).fill('cascade');
    await page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`).click();
    await page.getByTestId('org-easycla-group-continue').locator('button').click();

    await expect(page).toHaveURL(/\/org\/easycla\/new$/, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(PREVIEW_START)).toBeVisible();
    // The picker does not survive the navigation, and neither dialog opens before Start is pressed —
    // so nothing is confirmed by arriving here.
    await expect(page.getByTestId(PICKER)).toHaveCount(0);
    await expect(page.getByTestId(ATTESTATION)).toHaveCount(0);
    await expect(page.getByTestId(HANDOFF)).toHaveCount(0);

    await page.getByTestId(PREVIEW_START).locator('button').click();

    await expect(page.getByTestId(ATTESTATION)).toBeVisible();
    await expect(page.getByTestId(HANDOFF)).toHaveCount(0);

    await page.locator('label[for="authorityAcked"]').click();
    await page.locator('label[for="embargoAcked"]').click();
    await page.getByTestId('org-easycla-attestation-continue').locator('button').click();

    await expect(page.getByTestId(HANDOFF)).toBeVisible();
    await expect(page.getByTestId(ATTESTATION)).toHaveCount(0);
  });

  test('settles the hand-off on exactly one state', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p);
    });

    await reachHandoff(page);

    await onlyState(page, 'org-easycla-sign-ready');
    await expect(page.getByTestId('org-easycla-sign-review')).toBeVisible();
    // No way out but forward: the agreement and its envelope exist by now, and the address behind
    // this control is the only thing that reaches them.
    await expect(page.getByTestId('org-easycla-sign-cancel')).toHaveCount(0);
  });

  test('settles on the failure state alone when the request is refused', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p, { sign: { status: 403, body: { error: 'Refused', code: 'FORBIDDEN' } } });
    });

    await reachHandoff(page);

    await onlyState(page, 'org-easycla-sign-failed');
    await expect(page.getByTestId('org-easycla-sign-failure-message')).toBeVisible();
    await expect(page.getByTestId('org-easycla-sign-review')).toHaveCount(0);
  });

  /**
   * What actually goes on the wire.
   *
   * Both confirmations must travel as the booleans the signatory gave, the organization must come
   * from the path rather than the body, and no signing address may be composed by the client. A
   * component test cannot see any of this: it asserts on the arguments handed to a stubbed
   * service, one layer above the request that is the thing the CLA service reads.
   */
  test('sends both confirmations as booleans, keyed to the chosen CLA group', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p);
    });

    const signRequest = page.waitForRequest((request: Request) => request.url().includes('/lens/cla-groups/sign') && request.method() === 'POST');

    await reachHandoff(page);

    const body = (await (await signRequest).postDataJSON()) as Record<string, unknown>;

    expect(body['authorityAcked']).toBe(true);
    expect(body['embargoAcked']).toBe(true);
    expect(body['claGroupId']).toBe(CASCADE.claGroupId);
    expect(body['projectSfid']).toBe(CASCADE.projectSfid);
    // The return address is the server's to derive: a client-supplied one turns the hand-off into
    // an open redirect, since the CLA service stores it and redirects to it verbatim.
    expect(body).not.toHaveProperty('claReturnUrl');
    expect(body).not.toHaveProperty('returnUrl');
  });

  // The picker is a combobox and the focused element is the text box, so that is where the
  // combobox state has to live. On the listbox — which nothing ever focuses — it is never
  // announced, which looks identical on screen and is silent to a screen reader.
  test('wires the combobox state onto the focused search input', async ({ page }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p);
    });

    await page.getByTestId('org-easycla-sign-cla').locator('button').click();
    const input = groupSearchInput(page);

    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-controls', 'org-easycla-group-select-results');

    await input.fill('cascade');
    await expect(page.getByTestId(`org-easycla-group-select-${CASCADE.claGroupId}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', `org-easycla-group-option-${CASCADE.claGroupId}`);

    // And the keyboard alone completes the choice, which is the reason the wiring exists.
    await input.press('Enter');
    await expect(page.getByTestId('org-easycla-group-continue').locator('button')).toBeEnabled();
  });

  // The hand-off is a full-page navigation in the same tab, not a popup and not an iframe: the
  // signing service sets its own cookies and redirects back to the return address, neither of
  // which survives being embedded.
  test('leaves the app in the same tab, to the address the server returned', async ({ page, context }) => {
    await gotoEasyclaList(page, async (p) => {
      await stubPage(p);
      await stubHandoff(p);
    });

    await reachHandoff(page);
    await expect(page.getByTestId('org-easycla-sign-ready')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const pagesBefore = context.pages().length;
    await page.getByTestId('org-easycla-sign-review').locator('button').click();

    await expect(page).toHaveURL(STUB_SIGN_URL, { timeout: PAGE_LOAD_TIMEOUT });
    expect(context.pages()).toHaveLength(pagesBefore);
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});
