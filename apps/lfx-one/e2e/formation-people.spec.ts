// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * "People on this formation" sidebar card (#2724) — content-based coverage on both checklist
 * hosts. Deterministic via route mocks; see formation-people-robust.spec.ts for the structural
 * testid contract.
 */

import { FORMATION_PEOPLE_FOOTER_NOTE } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';

import { mockFormationPeopleResponse } from './fixtures/mock-data';
import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoFormationDetail,
  gotoProjectFormation,
  mockFormationChecklistApis,
  setPersonaCookie,
  stubFoundationProject,
  stubFormationFlag,
  stubNavLensItems,
  stubPersona,
} from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

test.describe('Formation people card (#2724)', () => {
  test('groups LF staff apart from invited people, with status chips, subtitles and the grants note', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

    const card = page.getByTestId('formation-page-sidebar').getByTestId('formation-people-card');
    await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card).toContainText('People on this formation');

    const staffGroup = card.getByTestId('formation-people-group-staff');
    await expect(staffGroup).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(staffGroup).toContainText('LF Staff');
    await expect(staffGroup.getByTestId('formation-people-row-alex.rivera')).toContainText('Alex Rivera');
    await expect(staffGroup.getByTestId('formation-people-row-alex.rivera')).toContainText('Program Manager · 1 item');
    // Staff rows carry no status chip — only externals are "invited" in any sense.
    await expect(card.getByTestId('formation-people-status-alex.rivera')).toHaveCount(0);

    const invitedGroup = card.getByTestId('formation-people-group-invited');
    await expect(invitedGroup).toContainText('Invited');
    const accepted = invitedGroup.getByTestId('formation-people-row-sam.chen');
    await expect(accepted).toContainText('Sam Chen');
    await expect(accepted).toContainText('Partner contact · Cascade Data · 1 item');
    await expect(card.getByTestId('formation-people-status-sam.chen')).toHaveText('Invited');

    // A pending invite (email-only settings entry) shows the email as its subtitle and "Invite Sent".
    const pendingRow = invitedGroup.getByTestId('formation-people-row-jordan.lee@partner-corp.example');
    await expect(pendingRow).toContainText('Jordan Lee');
    await expect(pendingRow).toContainText('jordan.lee@partner-corp.example');
    await expect(card.getByTestId('formation-people-status-jordan.lee@partner-corp.example')).toHaveText('Invite Sent');

    await expect(card.getByTestId('formation-people-footer')).toHaveText(FORMATION_PEOPLE_FOOTER_NOTE);
  });

  test('renders the same people on the foundation drill-down, for the child project', async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await stubFoundationProject(page);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    const card = page.getByTestId('formation-detail-sidebar').getByTestId('formation-people-card');
    await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card.getByTestId('formation-people-row-sam.chen')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card.getByTestId('formation-people-status-jordan.lee@partner-corp.example')).toHaveText('Invite Sent');
  });

  test('shows a quiet unavailable state when the BFF could not read the project settings', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), people: { state: 'unavailable', people: [] } });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

    const card = page.getByTestId('formation-people-card');
    await expect(card.getByTestId('formation-people-unavailable')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card.getByTestId('formation-people-empty')).toHaveCount(0);
    // The checklist beside it still renders — only the list is missing.
    await expect(page.getByTestId('formation-checklist-section')).toBeVisible();
  });

  test('shows the empty state when no one is on the formation yet', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), people: { state: 'loaded', people: [] } });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

    const card = page.getByTestId('formation-people-card');
    await expect(card.getByTestId('formation-people-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card.locator('[data-testid^="formation-people-group-"]')).toHaveCount(0);
  });

  test('lists exactly the fixture’s people, once each', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

    const rows = page.getByTestId('formation-people-card').locator('[data-testid^="formation-people-row-"]');
    await expect(rows).toHaveCount(mockFormationPeopleResponse.people.length, { timeout: DATA_LOAD_TIMEOUT });
  });
});
