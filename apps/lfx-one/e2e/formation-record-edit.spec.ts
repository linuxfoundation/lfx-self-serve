// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation card edit panel (#5134) — content-based, upstream mocked. A formation-team writer opens
 * the drawer from the sidebar card, changes the stage or legal entity, and the BFF is called with
 * only the changed keys. Never run against a real project: the PUT is always intercepted here.
 */

import { expect, Page, Request, test } from '@playwright/test';

import { getMockFormation } from './fixtures/mock-data/formation.mock';
import {
  buildBaseProject,
  FORMATION_PROJECT_SLUG,
  gotoProjectFormation,
  mockFormationChecklistApis,
  setPersonaCookie,
  stubFormationFlag,
  stubPersona,
  stubProjectLensItems,
} from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const DRAWER_TIMEOUT = 20_000;

async function openDrawer(page: Page, putStatus = 200): Promise<Request[]> {
  // The card opens the drawer for the checklist's `parent_project_uid`, so the project, checklist and the
  // GET/PUT interceptors must all agree on that UID rather than buildBaseProject's generated one.
  const projectUid = getMockFormation(FORMATION_PROJECT_SLUG)?.parent_project_uid;
  if (!projectUid) throw new Error(`No mock formation for ${FORMATION_PROJECT_SLUG}`);
  const project = buildBaseProject(FORMATION_PROJECT_SLUG, {
    uid: projectUid,
    stage: 'Formation - Engaged',
    category: 'project',
    legal_entity_name: 'Cascade Data LLC',
    legal_entity_type: 'Series LLC',
  });
  const puts: Request[] = [];
  await stubProjectLensItems(page, project);
  await mockFormationChecklistApis(page, { project });
  await page.route(`**/api/projects/${project.uid}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) }));
  await page.route(`**/api/projects/${project.uid}/formation-record`, (route) => {
    puts.push(route.request());
    const body = putStatus === 409 ? { code: 'FORMATION_RECORD_CONFLICT' } : project;
    return route.fulfill({ status: putStatus, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await gotoProjectFormation(page, FORMATION_PROJECT_SLUG);
  await page.getByTestId('formation-card-edit-button').click({ timeout: DRAWER_TIMEOUT });
  await expect(page.getByTestId('formation-record-edit-drawer')).toBeVisible({ timeout: DRAWER_TIMEOUT });
  return puts;
}

test.describe('Formation record edit drawer (#5134)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, false);
    await setPersonaCookie(page);
  });

  test('saves only the changed legal entity name', async ({ page }) => {
    const puts = await openDrawer(page);

    await page.getByTestId('formation-record-legal-entity-name').locator('input').fill('Cascade Data Inc.');
    await page.getByTestId('formation-record-save').click();

    await expect.poll(() => puts.length, { timeout: DRAWER_TIMEOUT }).toBe(1);
    expect(puts[0].postDataJSON()).toEqual({ legal_entity_name: 'Cascade Data Inc.' });
  });

  test('clears the legal entity type with the Not set option', async ({ page }) => {
    const puts = await openDrawer(page);

    await page.getByTestId('formation-record-legal-entity-type').click();
    await page.getByRole('option', { name: 'Not set' }).click();
    await page.getByTestId('formation-record-save').click();

    await expect.poll(() => puts.length, { timeout: DRAWER_TIMEOUT }).toBe(1);
    expect(puts[0].postDataJSON()).toEqual({ legal_entity_type: '' });
  });

  test('asks for a dissolution date before archiving', async ({ page }) => {
    const puts = await openDrawer(page);

    await page.getByTestId('formation-record-stage').click();
    await page.getByRole('option', { name: 'Archived' }).click();
    await page.getByTestId('formation-record-save').click();

    await expect(page.getByTestId('formation-record-edit-drawer')).toContainText('Archiving needs a dissolution date.');
    expect(puts).toHaveLength(0);
  });

  test('confirms before moving to Active and then saves', async ({ page }) => {
    const puts = await openDrawer(page);

    await page.getByTestId('formation-record-stage').click();
    await page.getByRole('option', { name: 'Active' }).click();
    await page.getByTestId('formation-record-save').click();

    await expect(page.getByTestId('formation-record-confirmation')).toContainText('completes its formation.');
    expect(puts).toHaveLength(0);

    await page.getByTestId('formation-record-confirm').click();
    await expect.poll(() => puts.length, { timeout: DRAWER_TIMEOUT }).toBe(1);
    expect(puts[0].postDataJSON()).toEqual({ stage: 'Active' });
  });

  test('shows the conflict copy with a reload action when someone else changed the project', async ({ page }) => {
    await openDrawer(page, 409);

    await page.getByTestId('formation-record-legal-entity-name').locator('input').fill('Changed');
    await page.getByTestId('formation-record-save').click();

    await expect(page.getByTestId('formation-record-edit-error')).toContainText('Someone else changed this project. Reload to see the latest, then try again.');
    await expect(page.getByTestId('formation-record-edit-reload')).toBeVisible();
  });
});
