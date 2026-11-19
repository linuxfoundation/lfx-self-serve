// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Answering a mentor invitation (linuxfoundation/lfx-mentorship#378).
 *
 * The invitation email's link, `/mentorship/mentor/invites?token=`, answers only on a click, then shows the outcome:
 * accepted, declined, a link that can no longer be used (400/409, or a token that is missing or malformed, which is never
 * sent), another account's invitation (403), impersonation (403 read-only), or a failure with Try again. The mentor
 * profile drawer answers the same invitations by id (linuxfoundation/lfx-mentorship#346): Accept at once, Decline after a
 * confirm, and a 409 refreshes the list. Every write is stubbed (`mentorship-mentor-invite.helper.ts`), and the pages are
 * reached by client-side navigation (`openMentorPage`), so the browser makes the calls and the stubs answer them.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';
import {
  INVITATION_ID,
  INVITATION_PROGRAM,
  INVITE_PAGE_URL,
  INVITE_TOKEN,
  MENTOR_PROFILE_URL,
  stubDrawerInvitation,
  stubInviteResponse,
} from './helpers/mentorship-mentor-invite.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

async function openInvite(page: Page, url = INVITE_PAGE_URL): Promise<void> {
  await openMentorPage(page, url);
  await expect(page.getByTestId('mentorship-mentor-invite')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

const respond = (page: Page, decision: 'accept' | 'decline') => page.getByTestId(`mentorship-mentor-invite-${decision}-button`).getByRole('button').click();

test.describe('Mentor invite link — answering', () => {
  test('sends nothing until the mentor answers', async ({ page }) => {
    const writes = await stubInviteResponse(page);
    await openInvite(page);

    await expect(page.getByTestId('mentorship-mentor-invite-title')).toHaveText("You've been invited to mentor");
    expect(writes).toEqual([]);
  });

  test('accepts with the link token and links to My Programs', async ({ page }) => {
    const writes = await stubInviteResponse(page);
    await openInvite(page);

    await respond(page, 'accept');

    const accepted = page.getByTestId('mentorship-mentor-invite-accepted');
    await expect(accepted).toContainText('Invitation accepted');
    await expect(accepted.getByRole('link', { name: 'Go to My Programs' })).toHaveAttribute('href', MENTOR_PROGRAMS_URL);
    expect(writes).toEqual([{ method: 'POST', path: '/api/mentorship/mentor/invites/accept', body: { token: INVITE_TOKEN } }]);
  });

  test('declines with the link token and says the admins were told', async ({ page }) => {
    const writes = await stubInviteResponse(page);
    await openInvite(page);

    await respond(page, 'decline');

    await expect(page.getByTestId('mentorship-mentor-invite-declined')).toContainText("We've let the program admins know.");
    expect(writes).toEqual([{ method: 'POST', path: '/api/mentorship/mentor/invites/decline', body: { token: INVITE_TOKEN } }]);
  });

  for (const status of [400, 409]) {
    test(`says the link can no longer be used when the answer is refused (${status})`, async ({ page }) => {
      await stubInviteResponse(page, [{ status }]);
      await openInvite(page);

      await respond(page, 'accept');

      await expect(page.getByTestId('mentorship-mentor-invite-invalid-link')).toContainText('It may have expired or already been answered.');
    });
  }

  test('asks for the invited account when the invitation is for another one (403)', async ({ page }) => {
    await stubInviteResponse(page, [{ status: 403 }]);
    await openInvite(page);

    await respond(page, 'accept');

    await expect(page.getByTestId('mentorship-mentor-invite-forbidden')).toContainText('This invitation is for a different account');
  });

  test('says an answer is not available while impersonating (403 read-only)', async ({ page }) => {
    await stubInviteResponse(page, [{ status: 403, readOnly: true }]);
    await openInvite(page);

    await respond(page, 'decline');

    await expect(page.getByTestId('mentorship-mentor-invite-read-only')).toContainText("You're viewing as another user");
  });

  test('keeps the answer unrecorded on a failure, and Try again lets the mentor answer again', async ({ page }) => {
    const writes = await stubInviteResponse(page, [{ status: 503 }, { status: 204 }]);
    await openInvite(page);

    await respond(page, 'accept');
    const error = page.getByTestId('mentorship-mentor-invite-error');
    await expect(error).toContainText('Your answer was not recorded.');
    await error.getByRole('button', { name: 'Try again' }).click();
    await respond(page, 'accept');

    await expect(page.getByTestId('mentorship-mentor-invite-accepted')).toBeVisible();
    expect(writes.map((write) => write.path)).toEqual(['/api/mentorship/mentor/invites/accept', '/api/mentorship/mentor/invites/accept']);
  });
});

test.describe('Mentor invite link — without a usable token', () => {
  for (const [name, url] of [
    ['no token', '/mentorship/mentor/invites'],
    ['a malformed token', '/mentorship/mentor/invites?token=not-a-signed-token'],
  ] as const) {
    test(`shows the unusable-link state for ${name}, and sends nothing`, async ({ page }) => {
      const writes = await stubInviteResponse(page);
      await openInvite(page, url);

      await expect(page.getByTestId('mentorship-mentor-invite-invalid-link')).toContainText("This invitation link can't be used");
      await expect(page.getByTestId('mentorship-mentor-invite-confirm')).toHaveCount(0);
      expect(writes).toEqual([]);
    });
  }
});

test.describe('Mentor profile drawer — invitations', () => {
  async function openDrawer(page: Page): Promise<void> {
    await openMentorPage(page, MENTOR_PROFILE_URL);
    await page.getByTestId('mentorship-mentor-profile-details-edit').getByRole('button').click();
    await expect(page.getByTestId(`mentorship-mentor-invitation-row-${INVITATION_ID}`)).toContainText(INVITATION_PROGRAM.name, {
      timeout: MENTOR_PAGE_LOAD_TIMEOUT,
    });
  }

  const invitationButton = (page: Page, decision: 'accept' | 'decline') =>
    page.getByTestId(`mentorship-mentor-invitation-${decision}-${INVITATION_ID}`).getByRole('button');

  test('accepts at once, and the invitation leaves the list', async ({ page }) => {
    const state = await stubDrawerInvitation(page);
    await openDrawer(page);

    await invitationButton(page, 'accept').click();

    await expect(page.getByText('You are now a mentor of this program.')).toBeVisible();
    expect(state.writes.map((write) => `${write.method} ${write.path}`)).toEqual([`POST /api/mentorship/mentor/invitations/${INVITATION_ID}/accept`]);
    await expect(page.getByTestId(`mentorship-mentor-invitation-row-${INVITATION_ID}`)).toHaveCount(0);
  });

  test('declines only after the confirm, and not when it is cancelled', async ({ page }) => {
    const state = await stubDrawerInvitation(page);
    await openDrawer(page);
    const confirmation = page.locator('.p-confirmdialog');

    await invitationButton(page, 'decline').click();
    await expect(confirmation).toContainText('Only a program administrator can invite you again.');
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.writes).toEqual([]);

    await invitationButton(page, 'decline').click();
    await confirmation.getByRole('button', { name: 'Decline', exact: true }).click();

    await expect(page.getByText('You have declined the invitation to mentor this program.')).toBeVisible();
    expect(state.writes.map((write) => write.path)).toEqual([`/api/mentorship/mentor/invitations/${INVITATION_ID}/decline`]);
  });

  test('says an invitation was already answered (409) and reads the list again', async ({ page }) => {
    const state = await stubDrawerInvitation(page, { status: 409 });
    await openDrawer(page);
    const readsBefore = state.reads;

    await invitationButton(page, 'accept').click();

    await expect(page.getByText('This invitation has already been answered or withdrawn. Your requests have been refreshed.')).toBeVisible();
    await expect.poll(() => state.reads).toBeGreaterThan(readsBefore);
  });
});
