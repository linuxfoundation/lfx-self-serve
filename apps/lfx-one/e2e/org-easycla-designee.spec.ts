// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA — the CLA manager question before a CCLA starts (#2780). Every case denies the
 * Sign check, which puts the question in front of Start; the sign specs stub it allowed and cover
 * the path that skips it. Both writes are stubbed: neither may grant a real ACS role or email anyone.
 */

import { expect, Page, test } from '@playwright/test';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  fulfillJson,
  gotoEasyclaDetail,
  PAGE_LOAD_TIMEOUT,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const ASSIGN_ROUTE = '**/api/orgs/*/lens/cla-groups/designee';
const NOMINATE_ROUTE = '**/api/orgs/*/lens/cla-groups/designee/nominations';
const NOT_STARTED = claGroup({ status: 'not-started', signed: false, signedOn: undefined });

async function openQuestion(page: Page, stubWrites: (page: Page) => Promise<void>): Promise<void> {
  await gotoEasyclaDetail(
    page,
    NOT_STARTED.claGroupId,
    async (p) => {
      await fulfillJson(p, CLA_GROUPS_ROUTE, claGroupList([NOT_STARTED]));
      await stubWrites(p);
    },
    undefined,
    false
  );
  await page.getByTestId('org-easycla-detail-start-cla').locator('button').click();
  await expect(page.getByTestId('org-easycla-manager-question-dialog')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('org-easycla-attestation-dialog')).toHaveCount(0);
}

test.describe('Org Lens EasyCLA — CLA manager question', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(() => skipWithoutCredentials());

  test('Yes assigns the viewer with only the signing project, then opens attestation', async ({ page }) => {
    await openQuestion(page, (p) => fulfillJson(p, ASSIGN_ROUTE, { assigned: true }));
    const assign = page.waitForRequest((request) => request.url().endsWith('/lens/cla-groups/designee') && request.method() === 'POST');

    await page.getByTestId('org-easycla-manager-question-yes').locator('button').click();

    // The address is the session's, so the body must not carry one a caller could swap.
    expect((await assign).postDataJSON()).toEqual({ projectSfid: NOT_STARTED.projects[0].projectSfid });
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('a refused Yes keeps the viewer on the overview with Start still offered', async ({ page }) => {
    await openQuestion(page, (p) =>
      p.route(ASSIGN_ROUTE, (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Failed to assign the CLA manager designee: refused (already-signed)',
            code: 'UPSTREAM_ERROR',
            upstreamCode: 'already-signed',
          }),
        })
      )
    );

    await page.getByTestId('org-easycla-manager-question-yes').locator('button').click();

    await expect(page.getByTestId('org-easycla-manager-question-dialog')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-start-cla').locator('button')).toBeEnabled();
  });

  test('No nominates the named person and reports it on the overview', async ({ page }) => {
    await openQuestion(page, (p) => fulfillJson(p, NOMINATE_ROUTE, { outcome: 'lf-login-requested', email: 'contributor@example.org' }));
    const nominate = page.waitForRequest((request) => request.url().endsWith('/designee/nominations') && request.method() === 'POST');

    await page.getByTestId('org-easycla-manager-question-no').locator('button').click();
    await page.locator('[data-test="org-easycla-identify-manager-name"]').fill('Pat Contributor');
    await page.locator('[data-test="org-easycla-identify-manager-email"]').fill('contributor@example.org');
    await page.getByTestId('org-easycla-identify-manager-submit').locator('button').click();

    expect((await nominate).postDataJSON()).toEqual({
      projectSfid: NOT_STARTED.projects[0].projectSfid,
      fullName: 'Pat Contributor',
      email: 'contributor@example.org',
    });
    await expect(page.getByTestId('org-easycla-detail-designee-notice')).toContainText('contributor@example.org');
    await expect(page.getByTestId('org-easycla-attestation-dialog')).toHaveCount(0);
  });
});
