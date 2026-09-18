// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * "People on this formation" sidebar card (#2724) — robust structural tests. Asserts the
 * data-testid contract and container nesting independent of copy; see formation-people.spec.ts
 * for the content-based coverage.
 */

import { expect, test } from '@playwright/test';

import { mockFormationPeopleResponse } from './fixtures/mock-data';
import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoProjectFormation,
  mockFormationChecklistApis,
  stubFormationFlag,
} from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const PEOPLE = mockFormationPeopleResponse.people;

test.describe('Formation people card — structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);
    await expect(page.getByTestId('formation-people-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('sits in the page sidebar directly after the formation card', async ({ page }) => {
    const sidebar = page.getByTestId('formation-page-sidebar');
    const children = sidebar.locator(':scope > *');

    await expect(children.nth(0).getByTestId('formation-card')).toBeAttached();
    await expect(children.nth(1).getByTestId('formation-people-card')).toBeAttached();
  });

  test('nests every row under exactly one group container, keyed by the fixture', async ({ page }) => {
    const card = page.getByTestId('formation-people-card');
    await expect(card.locator('[data-testid^="formation-people-row-"]')).toHaveCount(PEOPLE.length, { timeout: DATA_LOAD_TIMEOUT });

    for (const person of PEOPLE) {
      const group = card.getByTestId(`formation-people-group-${person.group}`);
      await expect(group.getByTestId(`formation-people-row-${person.key}`)).toBeAttached();
    }

    const groupKeys = [...new Set(PEOPLE.map((person) => person.group))];
    await expect(card.locator('[data-testid^="formation-people-group-"]')).toHaveCount(groupKeys.length);
  });

  test('renders a status chip for every invited row and none for staff', async ({ page }) => {
    const card = page.getByTestId('formation-people-card');
    await expect(card.locator('[data-testid^="formation-people-row-"]')).toHaveCount(PEOPLE.length, { timeout: DATA_LOAD_TIMEOUT });

    for (const person of PEOPLE) {
      const chip = card.getByTestId(`formation-people-status-${person.key}`);
      await expect(chip).toHaveCount(person.group === 'invited' ? 1 : 0);
    }
  });

  test('exposes the invite dialog’s testid contract for a writer (PR 2)', async ({ page }) => {
    await page.getByTestId('formation-people-invite-btn').click();

    const dialog = page.getByTestId('formation-people-invite-dialog');
    await expect(dialog).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    expect(await dialog.evaluate((el) => el.tagName)).toBe('FORM');
    await expect(dialog.locator('input[data-test="formation-people-invite-name"]')).toBeAttached();
    await expect(dialog.locator('input[data-test="formation-people-invite-email"]')).toBeAttached();
    await expect(dialog.getByTestId('formation-people-invite-role').locator('input[type="radio"]')).toHaveCount(2);
    await expect(dialog.getByTestId('formation-people-invite-submit')).toBeAttached();
    await expect(dialog.getByTestId('formation-people-invite-cancel')).toBeAttached();

    await dialog.getByTestId('formation-people-invite-cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('renders an avatar per row and the footer note', async ({ page }) => {
    const card = page.getByTestId('formation-people-card');
    await expect(card.locator('[data-testid^="formation-people-row-"]')).toHaveCount(PEOPLE.length, { timeout: DATA_LOAD_TIMEOUT });

    await expect(card.getByTestId('person-avatar')).toHaveCount(PEOPLE.length);
    await expect(card.getByTestId('formation-people-footer')).toBeAttached();
  });
});
