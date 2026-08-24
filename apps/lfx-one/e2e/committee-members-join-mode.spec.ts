// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Group Members tab join-mode E2E (LFXV2-2690). Deterministic via route mocks. */

import { expect, Page, test } from '@playwright/test';

import {
  buildBaseCommittee,
  DATA_LOAD_TIMEOUT,
  gotoCommitteeTab as gotoCommitteeTabHelper,
  mockCommitteeApis as mockCommitteeApisHelper,
} from './helpers/committee-about.helper';

const COMMITTEE_UID = 'e2e-join-mode-committee';

function baseCommittee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return buildBaseCommittee(COMMITTEE_UID, overrides);
}

async function mockCommitteeApis(page: Page, opts: { committee: Record<string, unknown> }): Promise<void> {
  await mockCommitteeApisHelper(page, COMMITTEE_UID, opts);
}

function gotoMembersTab(page: Page): Promise<void> {
  return gotoCommitteeTabHelper(page, COMMITTEE_UID, '?tab=members');
}

test.setTimeout(120_000);

test.describe('Group Members tab join modes (LFXV2-2690)', () => {
  test('admin: Add Member button visible in closed mode; pending invites section hidden when no invites exist', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Chair', writer: true, join_mode: 'closed' }) });
    await gotoMembersTab(page);

    await expect(page.getByTestId('add-member-btn')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // Hidden because there are no pending invites in the response, not because of join_mode.
    await expect(page.getByTestId('pending-invites')).toHaveCount(0);
  });

  test('admin: pending invites section visible in closed mode when invites exist', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Chair', writer: true, join_mode: 'closed' }) });

    // Override the default empty invites mock with a real pending invite.
    await page.route(`**/api/committees/${COMMITTEE_UID}/invites*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            uid: 'invite-1',
            committee_uid: COMMITTEE_UID,
            invitee_email: 'pending@example.com',
            role: 'Member',
            status: 'pending',
            created_at: '2026-08-24T16:05:00Z',
          },
        ]),
      });
    });

    await gotoMembersTab(page);

    await expect(page.getByTestId('pending-invites')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('member in invite_only group: Invite Someone button visible, not Add Member', async ({ page }) => {
    await mockCommitteeApis(page, {
      committee: baseCommittee({ my_role: 'Member', writer: false, join_mode: 'invite_only' }),
    });
    await gotoMembersTab(page);

    await expect(page.getByTestId('invite-member-btn')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('add-member-btn')).toHaveCount(0);
  });

  test('member in invite_only group with hidden roster: Members tab shows invite-only view', async ({ page }) => {
    await mockCommitteeApis(page, {
      committee: baseCommittee({ my_role: 'Member', writer: false, join_mode: 'invite_only', member_visibility: 'hidden' }),
    });
    await gotoMembersTab(page);

    await expect(page.getByTestId('members-invite-only')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('invite-member-btn')).toBeVisible();
    await expect(page.getByTestId('members-hidden-placeholder')).toHaveCount(0);
    await expect(page.getByTestId('add-member-btn')).toHaveCount(0);
  });

  test('admin in application mode: pending applications section renders when applications exist', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Chair', writer: true, join_mode: 'application' }) });

    // Register after mockCommitteeApis — Playwright runs the last matching route first.
    await page.route(`**/api/committees/${COMMITTEE_UID}/applications*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            uid: 'app-1',
            committee_uid: COMMITTEE_UID,
            applicant_email: 'applicant@example.com',
            status: 'pending',
            message: 'I would like to contribute.',
            created_at: '2025-06-01T00:00:00Z',
          },
        ]),
      });
    });

    await gotoMembersTab(page);

    await expect(page.getByTestId('pending-applications')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('pending-application-applicant@example.com')).toBeVisible();
    await expect(page.getByTestId('approve-application-applicant@example.com')).toBeVisible();
  });
});
