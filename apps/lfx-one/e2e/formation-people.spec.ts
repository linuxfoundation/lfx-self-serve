// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * "People on this formation" sidebar card (#2724) — content-based coverage on both checklist
 * hosts. Deterministic via route mocks; see formation-people-robust.spec.ts for the structural
 * testid contract.
 */

import { FORMATION_INVITE_DUPLICATE_MESSAGE, FORMATION_PEOPLE_FOOTER_NOTE } from '@lfx-one/shared/constants';
import { FormationPerson } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

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

  test('hides the Invite action from a caller without write access', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), canWrite: false });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

    const card = page.getByTestId('formation-people-card');
    await expect(card.getByTestId('formation-people-row-sam.chen')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card.getByTestId('formation-people-invite-btn')).toHaveCount(0);
  });

  test('lists exactly the fixture’s people, once each', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);

    const rows = page.getByTestId('formation-people-card').locator('[data-testid^="formation-people-row-"]');
    await expect(rows).toHaveCount(mockFormationPeopleResponse.people.length, { timeout: DATA_LOAD_TIMEOUT });
  });
});

/** One captured `POST /api/projects/:uid/permissions` body. */
interface CapturedAdd {
  body: Record<string, unknown>;
}

/**
 * Capture-and-respond stub for the add flow (the `newsletter-audience-email-add.spec.ts` shape):
 * records every POST body and lets each test decide the response per call. GET falls through to
 * the checklist helper's settings stub. Registered after `mockFormationChecklistApis`, so it takes
 * precedence for POST.
 */
async function stubPermissionAdd(page: Page, respond: (route: Route, call: number) => Promise<void>): Promise<CapturedAdd[]> {
  const calls: CapturedAdd[] = [];
  await page.route('**/api/projects/*/permissions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    calls.push({ body: route.request().postDataJSON() as Record<string, unknown> });
    await respond(route, calls.length);
  });
  return calls;
}

const created = (route: Route): Promise<void> => route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
const directoryMiss = (route: Route): Promise<void> =>
  route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'User not found', code: 'NOT_FOUND' }) });

const KIM: FormationPerson = {
  key: 'kim.park',
  username: 'kim.park',
  name: 'Kim Park',
  email: 'kim.park@partner-corp.example',
  role: 'view',
  group: 'invited',
  is_pending: false,
  job_title: null,
  organization: null,
  avatar: null,
};

async function openInviteDialog(page: Page): Promise<void> {
  await page.getByTestId('formation-people-invite-btn').click();
  await expect(page.getByTestId('formation-people-invite-dialog')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

async function fillInvite(page: Page, name: string, email: string): Promise<void> {
  // `lfx-input-text` renders `data-test`, not `data-testid`, on the native input.
  await page.locator('input[data-test="formation-people-invite-name"]').fill(name);
  await page.locator('input[data-test="formation-people-invite-email"]').fill(email);
}

test.describe('Formation people card — Invite (#2724, PR 2)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);
    await expect(page.getByTestId('formation-people-row-sam.chen')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('adds an address with an LF account in a single request, toasts Added, and re-reads the list', async ({ page }) => {
    const calls = await stubPermissionAdd(page, created);
    // The re-read after a successful add: serve the fixture plus the new person.
    await page.route('**/api/projects/*/formation/people', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'loaded', people: [...mockFormationPeopleResponse.people, KIM] }),
      })
    );

    await openInviteDialog(page);
    await fillInvite(page, 'Kim Park', 'Kim.Park@Partner-Corp.example');
    await page.getByTestId('formation-people-invite-submit').click();

    await expect(page.locator('.p-toast')).toContainText('Added', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-people-invite-dialog')).toBeHidden();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ email: 'kim.park@partner-corp.example', role: 'view' });
    await expect(page.getByTestId('formation-people-row-kim.park')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('re-sends with the name on a directory miss so upstream emails the invite, and toasts Invite sent', async ({ page }) => {
    const calls = await stubPermissionAdd(page, (route, call) => (call === 1 ? directoryMiss(route) : created(route)));

    await openInviteDialog(page);
    await fillInvite(page, 'Kim Park', 'kim.park@partner-corp.example');
    await page.getByTestId('formation-people-invite-submit').click();

    await expect(page.locator('.p-toast')).toContainText('Invite sent', { timeout: DATA_LOAD_TIMEOUT });
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual({ email: 'kim.park@partner-corp.example', role: 'view' });
    expect(calls[1].body).toEqual({ name: 'Kim Park', email: 'kim.park@partner-corp.example', role: 'view' });
  });

  test('sends the Manage role when chosen', async ({ page }) => {
    const calls = await stubPermissionAdd(page, created);

    await openInviteDialog(page);
    await fillInvite(page, 'Kim Park', 'kim.park@partner-corp.example');
    await page.getByLabel('Manage').check();
    await page.getByTestId('formation-people-invite-submit').click();

    await expect(page.locator('.p-toast')).toContainText('Added', { timeout: DATA_LOAD_TIMEOUT });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ email: 'kim.park@partner-corp.example', role: 'manage' });
  });

  test('rejects an address already on the project inline, with no request', async ({ page }) => {
    const calls = await stubPermissionAdd(page, created);

    await openInviteDialog(page);
    await fillInvite(page, 'Sam Chen', 'sam.chen@cascade-data.example');
    await expect(page.getByTestId('formation-people-invite-email-error')).toHaveText(FORMATION_INVITE_DUPLICATE_MESSAGE);
    await page.getByTestId('formation-people-invite-submit').click();

    await expect(page.getByTestId('formation-people-invite-dialog')).toBeVisible();
    expect(calls).toHaveLength(0);
  });

  test('blocks an empty or malformed submission with inline errors and no request', async ({ page }) => {
    const calls = await stubPermissionAdd(page, created);

    await openInviteDialog(page);
    await page.getByTestId('formation-people-invite-submit').click();
    await expect(page.getByTestId('formation-people-invite-name-error')).toBeVisible();
    await expect(page.getByTestId('formation-people-invite-email-error')).toBeVisible();

    await fillInvite(page, 'Kim Park', 'not-an-email');
    await page.getByTestId('formation-people-invite-submit').click();
    await expect(page.getByTestId('formation-people-invite-email-error')).toContainText('valid email');
    expect(calls).toHaveLength(0);
  });

  test('surfaces a failed add as an error toast and keeps the dialog open', async ({ page }) => {
    const calls = await stubPermissionAdd(page, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Upstream exploded' }) })
    );

    await openInviteDialog(page);
    await fillInvite(page, 'Kim Park', 'kim.park@partner-corp.example');
    await page.getByTestId('formation-people-invite-submit').click();

    await expect(page.locator('.p-toast')).toContainText('Invite failed', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-people-invite-dialog')).toBeVisible();
    expect(calls).toHaveLength(1);
  });
});
