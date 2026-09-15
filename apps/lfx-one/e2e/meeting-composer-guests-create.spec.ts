// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Content coverage for the composer's Guests section in CREATE mode (#1452).
 *
 * Structural companion: `meeting-composer-guests-create-robust.spec.ts`.
 * Shared setup: `helpers/meeting-composer-guests.helper.ts`.
 *
 * The behaviour under test is the one the old wizard could not do: invite guests while the meeting
 * does not exist yet. Every assertion below runs with no meeting uid anywhere — the guests live on
 * the composer's own form until the single create call these tests never make.
 */

import { expect, Locator, Page, test } from '@playwright/test';

import { DIRECTORY_GUEST, MANUAL_GUEST, openGuestsSection } from './helpers/meeting-composer-guests.helper';

// Four sections' worth of walking, on an SSR page with a hydration wait.
test.setTimeout(120_000);

const guestList = (page: Page) => page.getByTestId('composer-guests-list');
const guestStats = (page: Page) => page.getByTestId('composer-guests-stats');
const emptyState = (page: Page) => page.getByTestId('composer-guests-empty');
const removeButtons = (page: Page) => page.locator('[data-testid^="composer-guest-remove-"]');
/** `lfx-button` puts `data-testid` on the host, so the clickable element is one level in. */
const hostedButton = (scope: Page | Locator, testId: string) => scope.getByTestId(testId).locator('button');

/** Types past the 2-character floor, then waits out the two debounces the search box stacks. */
async function searchDirectory(page: Page, term: string): Promise<Locator> {
  // pressSequentially rather than fill: this drives p-autocomplete's own keydown/input path the way
  // a person does, instead of relying on a single synthetic input event to start its 300ms delay.
  await page.locator('#composer-guest-search').pressSequentially(term, { delay: 50 });

  // p-autocomplete's 300ms delay and the component's own debounceTime(300) run back to back before
  // a request even goes out, so the option is awaited rather than clicked blind.
  const option = page.getByRole('option', { name: /Ada Byron/ });
  await expect(option).toBeVisible();
  return option;
}

test.describe('Meeting composer — inviting guests before the meeting exists', () => {
  test('offers an empty, usable guest list instead of a "create the meeting first" gate', async ({ page }) => {
    await openGuestsSection(page);

    await expect(emptyState(page)).toBeVisible();
    await expect(emptyState(page)).toContainText('No guests yet');

    // Nothing invited yet, so neither the list nor the stats line is rendered at all.
    await expect(guestList(page)).toHaveCount(0);
    await expect(guestStats(page)).toHaveCount(0);

    // Both add affordances are live with no meeting behind them — the point of the story.
    await expect(page.locator('#composer-guest-search')).toBeEnabled();
    await expect(page.getByTestId('composer-guest-manual-link')).toBeEnabled();
  });

  test('adds a directory hit directly, and removing it restores the empty state', async ({ page }) => {
    await openGuestsSection(page);
    const option = await searchDirectory(page, 'ada');
    await option.click();

    // A directory result carries first name, last name and email, which is everything the add
    // payload requires — so it lands in the list outright rather than via the manual dialog.
    const row = guestList(page).locator('li').first();
    await expect(row).toContainText('Ada Byron');
    // One assertion for the whole secondary line: `email · org`, joined in that order.
    await expect(row).toContainText(`${DIRECTORY_GUEST.email} · Acme Motors`);
    await expect(guestStats(page)).toContainText('1 direct guest');
    await expect(emptyState(page)).toHaveCount(0);

    // The row is brand new, so it has no uid — hence the testid prefix rather than a known id.
    await expect(removeButtons(page)).toHaveCount(1);
    await removeButtons(page).first().click();

    await expect(guestList(page)).toHaveCount(0);
    await expect(emptyState(page)).toBeVisible();
  });

  test('adds a guest who is not in the directory through the manual dialog', async ({ page }) => {
    await openGuestsSection(page);

    await page.getByTestId('composer-guest-manual-link').click();

    const dialog = page.getByTestId('composer-guest-manual-dialog');
    await expect(dialog).toBeVisible();

    // `manualOnly` flips the registrant form straight to its individual fields, so there is no
    // directory step to skip inside the dialog. Each testid sits on an `lfx-input-text` host.
    await dialog.getByTestId('registrant-form-firstname-input').locator('input').fill(MANUAL_GUEST.first_name);
    await dialog.getByTestId('registrant-form-lastname-input').locator('input').fill(MANUAL_GUEST.last_name);
    await dialog.getByTestId('registrant-form-email-input').locator('input').fill(MANUAL_GUEST.email);

    // Submit only enables on a valid form — asserting that first turns a validation regression into
    // a failure that names the cause, rather than a click that silently does nothing.
    const submit = hostedButton(dialog, 'composer-guest-manual-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(dialog).toHaveCount(0);
    const row = guestList(page).locator('li').first();
    await expect(row).toContainText('Grace Hopper');
    await expect(row).toContainText(MANUAL_GUEST.email);
    await expect(guestStats(page)).toContainText('1 direct guest');
  });
});
