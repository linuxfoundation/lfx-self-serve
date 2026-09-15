// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Structural coverage for the composer's Guests section in CREATE mode (#1452).
 *
 * Content companion: `meeting-composer-guests-create.spec.ts`.
 * Shared setup: `helpers/meeting-composer-guests.helper.ts`.
 *
 * This half asserts the contract the other half depends on — testids, ARIA state, and the two
 * simultaneously-mounted rails — so a renamed testid or a dropped `aria-disabled` fails here with
 * a name attached, instead of surfacing as "element not found" somewhere in the content spec.
 */

import { expect, Page, test } from '@playwright/test';

import { openComposerCreate, openGuestsSection } from './helpers/meeting-composer-guests.helper';

test.setTimeout(120_000);

const railRow = (page: Page, sectionId: string) => page.getByTestId(`meeting-composer-rail-${sectionId}`);
const compactRailRow = (page: Page, sectionId: string) => page.getByTestId(`meeting-composer-rail-compact-${sectionId}`);

test.describe('Meeting composer — Guests section structure', () => {
  test('exposes the section rail as a labelled nav, once per variant', async ({ page }) => {
    await openComposerCreate(page);

    const rail = page.getByTestId('meeting-composer-rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('aria-label', 'Composer sections');

    // The stepper rail and the narrow-viewport chip row are BOTH in the DOM at every width — the
    // chip row is hidden by a CSS breakpoint, not by a conditional block. Distinct testid prefixes
    // are therefore the only thing keeping a locator from matching two rows at once, so each has to
    // resolve to exactly one element rather than merely being present.
    await expect(railRow(page, 'guests')).toHaveCount(1);
    await expect(compactRailRow(page, 'guests')).toHaveCount(1);
    // Attached, not visible: at desktop width the chip row is laid out to nothing.
    await expect(compactRailRow(page, 'guests')).toBeAttached();
  });

  test('marks Guests unreachable until an earlier required section is satisfied', async ({ page }) => {
    await openComposerCreate(page);

    // Cold start: Details & access is the active step and the first required section is empty, so
    // the advance limit sits at index 0 and every later row is inert.
    await expect(railRow(page, 'details-access')).toHaveAttribute('aria-current', 'step');
    await expect(railRow(page, 'guests')).toHaveAttribute('aria-disabled', 'true');

    // Clicking an unreachable row is a no-op, not a navigation — asserted because the row is a
    // real `<button>`, so nothing in the markup stops the click from landing.
    await railRow(page, 'guests').click();
    await expect(page.getByTestId('composer-details-access')).toBeVisible();
    await expect(page.getByTestId('composer-guests')).toHaveCount(0);
  });

  test('hands Guests the active step once the organizer reaches it', async ({ page }) => {
    await openGuestsSection(page);

    await expect(railRow(page, 'guests')).toHaveAttribute('aria-current', 'step');
    // The lock is gone, not merely overridden: an active row must carry no disabled state at all.
    await expect(railRow(page, 'guests')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(railRow(page, 'details-access')).not.toHaveAttribute('aria-current', 'step');
  });

  test('keeps the Guests section testid contract the content spec targets', async ({ page }) => {
    await openGuestsSection(page);

    await expect(page.getByTestId('composer-guests')).toBeVisible();

    // The search input's id is what the section's own `<label for>` points at, so it is part of the
    // accessibility contract rather than a convenience selector.
    const search = page.locator('#composer-guest-search');
    await expect(search).toBeVisible();
    await expect(page.locator('label[for="composer-guest-search"]')).toHaveText('Search and add guests');

    await expect(page.getByTestId('composer-guest-manual-link')).toBeVisible();
    await expect(page.getByTestId('composer-guests-empty')).toBeVisible();

    // Nothing invited yet, so every list-bearing testid must be absent rather than empty — an
    // empty-but-rendered list would mean the empty state and the list can show at the same time.
    await expect(page.getByTestId('composer-guests-list')).toHaveCount(0);
    await expect(page.getByTestId('composer-guests-stats')).toHaveCount(0);
    await expect(page.locator('[data-testid^="composer-guest-remove-"]')).toHaveCount(0);

    // No load was attempted in create mode, so neither the loading nor the failure branch renders.
    await expect(page.getByTestId('composer-guests-loading')).toHaveCount(0);
    await expect(page.getByTestId('composer-guests-load-error')).toHaveCount(0);
  });

  test('offers the footer controls a middle create-mode section needs', async ({ page }) => {
    await openGuestsSection(page);

    const footer = page.getByTestId('meeting-composer-footer');
    await expect(footer).toBeVisible();

    // `lfx-button` carries the testid on its host, so the button itself is one level in.
    await expect(footer.getByTestId('meeting-composer-cancel').locator('button')).toBeVisible();
    // Back only renders past the first section, so arriving at Guests is what brings it in.
    await expect(footer.getByTestId('meeting-composer-back').locator('button')).toBeVisible();
    await expect(footer.getByTestId('meeting-composer-next').locator('button')).toBeVisible();

    // Guests is not the last section, so the terminal action is still Next: Create meeting belongs
    // to Agenda & resources and Save changes to edit mode. Either one here would mean the composer
    // is offering to submit a meeting the organizer has not finished describing.
    await expect(footer.getByTestId('meeting-composer-create')).toHaveCount(0);
    await expect(footer.getByTestId('meeting-composer-save')).toHaveCount(0);
  });
});
