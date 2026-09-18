// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Approval List — content E2E (GH-2410).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-approval-robust.spec.ts`
 * is the structural half. This one walks add / edit / remove the way a CLA manager does — including
 * the invalidation copy that has to be on screen *before* a destructive write leaves — and asserts
 * on the words they end up looking at and the delta that goes on the wire.
 *
 * The unit tests cover each dialog and the confirm path with the next step's inputs handed in
 * directly. What they cannot cover is the chain: the tab that mounts the panel, the GET that
 * fills it, the dialog or confirm that names the consequence, the PUT, and the toast that
 * confirms it. Every join in that sequence is real here and stubbed there.
 *
 * **Nothing in this file may reach a real CLA service.** Every removal invalidates the
 * acknowledgements that matched the removed rule, with no rehearsal mode, so both verbs on the
 * approval-list path are stubbed. A run that let a PUT fall through would revoke real coverage.
 *
 * Prerequisites: as `org-easycla-detail.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import {
  approvalDialogValue,
  approvalList,
  countPutRequests,
  gotoApproval,
  isApprovalListPut,
  PAGE_LOAD_TIMEOUT,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const DOMAIN = 'example.com';
const NEXT_DOMAIN = 'acme.test';

const EXISTING = approvalList({ entries: [{ kind: 'domain', value: DOMAIN, addedOn: '2026-03-04T00:00:00Z' }] });

function putRequest(page: Page) {
  return page.waitForRequest(isApprovalListPut);
}

test.describe('Org Lens EasyCLA approval — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('adds a domain and confirms it, with no invalidation warning', async ({ page }) => {
    const added = approvalList({ entries: [{ kind: 'domain', value: NEXT_DOMAIN }] });

    await gotoApproval(page, { get: approvalList(), put: added });

    await expect(page.getByTestId('org-easycla-approval-empty')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('org-easycla-approval-add').locator('button').click();
    await expect(page.getByTestId('org-easycla-approval-dialog')).toBeVisible();
    await expect(page.getByTestId('org-easycla-approval-dialog-edit-warning')).toHaveCount(0);

    await approvalDialogValue(page).fill(NEXT_DOMAIN);

    const pending = putRequest(page);
    await page.getByTestId('org-easycla-approval-dialog-submit').locator('button').click();

    const body = (await (await pending).postDataJSON()) as { add: unknown; remove: unknown };
    expect(body).toEqual({ add: [{ kind: 'domain', value: NEXT_DOMAIN }], remove: [] });

    await expect(page.locator('.p-toast')).toContainText('The entry was added.');
    await expect(page.getByTestId('org-easycla-approval-value')).toHaveText(NEXT_DOMAIN);
  });

  test('warns that the previous value must be acknowledged again, then invalidates it', async ({ page }) => {
    const afterEdit = approvalList({ entries: [{ kind: 'domain', value: NEXT_DOMAIN }] });

    await gotoApproval(page, { get: EXISTING, put: afterEdit });

    await expect(page.getByTestId('org-easycla-approval-value')).toHaveText(DOMAIN, { timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('org-easycla-approval-edit').locator('button').click();
    await expect(page.getByTestId('org-easycla-approval-dialog-edit-warning')).toBeVisible();
    await expect(page.getByTestId('org-easycla-approval-dialog-edit-warning')).toContainText(
      'Contributors covered only by the previous value will need to acknowledge this CLA again.'
    );
    await expect(page.getByTestId('org-easycla-approval-dialog-edit-warning')).not.toContainText('invalidated');

    await approvalDialogValue(page).fill(NEXT_DOMAIN);

    const pending = putRequest(page);
    await page.getByTestId('org-easycla-approval-dialog-submit').locator('button').click();

    const body = (await (await pending).postDataJSON()) as { add: unknown; remove: unknown };
    expect(body).toEqual({
      add: [{ kind: 'domain', value: NEXT_DOMAIN }],
      remove: [{ kind: 'domain', value: DOMAIN }],
    });

    await expect(page.locator('.p-toast')).toContainText('invalidated');
    await expect(page.getByTestId('org-easycla-approval-value')).toHaveText(NEXT_DOMAIN);
  });

  test('names the invalidation in the confirmation, before anything is sent', async ({ page }) => {
    await gotoApproval(page, { get: EXISTING, put: approvalList() });

    await expect(page.getByTestId('org-easycla-approval-value')).toHaveText(DOMAIN, { timeout: PAGE_LOAD_TIMEOUT });

    const puts = countPutRequests(page);

    await page.getByTestId('org-easycla-approval-delete').locator('button').click();

    const confirm = page.locator('.p-confirmdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Remove this approval list entry?');
    await expect(confirm).toContainText('email domain');
    await expect(confirm).toContainText(`"${DOMAIN}"`);
    await expect(confirm).toContainText('invalidated');
    expect(puts.count).toBe(0);

    const pending = putRequest(page);
    await confirm.getByRole('button', { name: 'Remove entry' }).click();

    const body = (await (await pending).postDataJSON()) as { add: unknown; remove: unknown };
    expect(body).toEqual({ add: [], remove: [{ kind: 'domain', value: DOMAIN }] });

    await expect(page.locator('.p-toast')).toContainText('invalidated');
    await expect(page.getByTestId('org-easycla-approval-empty')).toBeVisible();
  });

  test('sends nothing if the confirmation is dismissed', async ({ page }) => {
    await gotoApproval(page, { get: EXISTING, put: approvalList() });

    await expect(page.getByTestId('org-easycla-approval-value')).toHaveText(DOMAIN, { timeout: PAGE_LOAD_TIMEOUT });

    const puts = countPutRequests(page);

    await page.getByTestId('org-easycla-approval-delete').locator('button').click();
    const confirm = page.locator('.p-confirmdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    await expect(confirm).not.toBeVisible();
    expect(puts.count).toBe(0);
    await expect(page.getByTestId('org-easycla-approval-value')).toHaveText(DOMAIN);
  });
});
