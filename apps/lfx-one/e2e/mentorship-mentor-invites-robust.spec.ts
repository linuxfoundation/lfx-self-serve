// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Answering a mentor invitation — structural / data-testid contract (linuxfoundation/lfx-mentorship#378).
 *
 * Companion to `mentorship-mentor-invites.spec.ts` (content). This spec asserts, by testid, role and attribute rather
 * than copy, that the email link's page asks with a heading and two buttons, holds the other button while an answer is
 * in flight, and announces each outcome in a polite live region; and that the profile drawer's invitation row carries
 * its status, a program link that opens a new tab safely, and Accept and Decline buttons named for the program. Every
 * write is stubbed with synthetic data and the pages are reached by client-side navigation.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  INVITATION_ID,
  INVITATION_PROGRAM,
  INVITE_PAGE_URL,
  MENTOR_PROFILE_URL,
  stubDrawerInvitation,
  stubInviteResponse,
} from './helpers/mentorship-mentor-invite.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Mentor invite link — structure', () => {
  test('asks under a level-one heading, with Accept and Decline both enabled', async ({ page }) => {
    await stubInviteResponse(page);
    await openMentorPage(page, INVITE_PAGE_URL);

    const confirm = page.getByTestId('mentorship-mentor-invite-confirm');
    await expect(confirm.getByRole('heading', { level: 1 })).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-invite-accept-button').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mentorship-mentor-invite-decline-button').getByRole('button')).toBeEnabled();
  });

  test('holds Decline while an Accept is in flight', async ({ page }) => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/mentorship/mentor/invites/*', async (route) => {
      await hold;
      return route.fulfill({ status: 204 });
    });
    await openMentorPage(page, INVITE_PAGE_URL);

    await page.getByTestId('mentorship-mentor-invite-accept-button').getByRole('button').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-mentor-invite-decline-button').getByRole('button')).toBeDisabled();
    release();
    await expect(page.getByTestId('mentorship-mentor-invite-accepted')).toBeVisible();
  });

  test('announces the outcome in a polite live region', async ({ page }) => {
    await stubInviteResponse(page);
    await openMentorPage(page, INVITE_PAGE_URL);

    await page.getByTestId('mentorship-mentor-invite-decline-button').getByRole('button').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    const outcome = page.getByTestId('mentorship-mentor-invite-declined');
    await expect(outcome).toHaveAttribute('role', 'status');
    await expect(outcome).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('mentorship-mentor-invite-confirm')).toHaveCount(0);
  });
});

test.describe('Mentor profile drawer — invitation row structure', () => {
  test('carries the status, a safe program link, and Accept and Decline named for the program', async ({ page }) => {
    await stubDrawerInvitation(page);
    await openMentorPage(page, MENTOR_PROFILE_URL);
    await page.getByTestId('mentorship-mentor-profile-details-edit').getByRole('button').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    const row = page.getByTestId(`mentorship-mentor-invitation-row-${INVITATION_ID}`);
    await expect(row).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(row.getByTestId(`mentorship-mentor-invitation-status-${INVITATION_ID}`)).toBeVisible();

    const link = row.getByTestId(`mentorship-mentor-invitation-program-link-${INVITATION_ID}`);
    await expect(link).toHaveAttribute('href', new RegExp(`/programs/${INVITATION_PROGRAM.id}$`));
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await expect(row.getByRole('button', { name: `Accept invitation to mentor ${INVITATION_PROGRAM.name}` })).toBeVisible();
    await expect(row.getByRole('button', { name: `Decline invitation to mentor ${INVITATION_PROGRAM.name}` })).toBeVisible();
  });
});
