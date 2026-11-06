// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter guest access — #5235.
 *
 * Signed-out readers of a member-benefit newsletter: the invite link landing (`/newsletters/invite#token=`)
 * and a shared issue permalink (`/newsletters/:projectSlug/:id`). Both show the guest modal over a blurred,
 * chrome-less page (no LFX sidebar); Continue opens the newsletter. The public API is mocked, so the
 * member-company check and group add are covered by the BFF unit specs.
 *
 * Prerequisites: dev server reachable at the Playwright baseURL (default http://localhost:4200). Runs with
 * an empty storage state — every test is signed out.
 */

import type { NewsletterGuestInviteInfo, NewsletterGuestIssue, NewsletterGuestIssueResponse } from '@lfx-one/shared/interfaces';
import { expect, test } from '@playwright/test';

test.setTimeout(60_000);
test.use({ storageState: { cookies: [], origins: [] } });

const ELEMENT_TIMEOUT = 30_000;
const SHARED_ISSUE_PATH = '/newsletters/acme-foundation/11111111-2222-4333-8444-555555555555';

const FOUNDATION = { uid: 'f-1', slug: 'acme-foundation', name: 'Acme Foundation', logo_url: null };
const INVITE: NewsletterGuestInviteInfo = {
  status: 'valid',
  foundation: FOUNDATION,
  membership_name: 'Acme Foundation',
  committee_uid: 'c-news',
  masked_email: 'ja***@acme***.example',
  company_name: 'Acme Motors',
  teaser: { subject: 'Acme Weekly — October', image_url: null, excerpt: 'This month at Acme: new members and events.' },
};
const ISSUE: NewsletterGuestIssue = {
  foundation: FOUNDATION,
  masked_email: 'ja***@acme***.example',
  newsletter: { id: 'n-1', subject: 'Acme Weekly — October', sent_at: '2026-10-01T00:00:00Z', body_html: '<p>Hello members of Acme</p>' },
  confirmation_sent: false,
};

test.describe('Newsletter invite link (signed out)', () => {
  test('shows the member-benefit modal, then the latest issue after Continue', async ({ page }) => {
    await page.route('**/public/api/newsletters/invites/inspect', (route) => route.fulfill({ json: INVITE }));
    await page.route('**/public/api/newsletters/invites/accept', (route) => route.fulfill({ json: ISSUE }));

    await page.goto('/newsletters/invite#token=signed.token');

    const heading = page.getByTestId('newsletter-guest-modal-heading');
    await expect(heading).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(heading).toContainText('Be the first to hear about new stories from Acme Foundation');
    await expect(page.getByTestId('newsletter-guest-modal-description')).toContainText('Acme Motors is a member of Acme Foundation');
    const email = page.getByTestId('newsletter-guest-modal-email').locator('input');
    await expect(email).toBeDisabled();
    await expect(email).toHaveValue('ja***@acme***.example');
    await expect(page.getByTestId('newsletter-guest-reader-teaser-subject')).toHaveText('Acme Weekly — October');
    await expect(page.getByTestId('newsletter-guest-modal-privacy')).toHaveAttribute('href', 'https://www.linuxfoundation.org/legal/privacy-policy');
    await expect(page.getByTestId('newsletter-guest-modal-terms')).toHaveAttribute('href', 'https://www.linuxfoundation.org/legal/terms');
    await expect(page.locator('html')).toHaveClass(/lfx-consent-prompt-hidden/);
    await expect(page.getByTestId('newsletter-guest-modal-sign-in')).toHaveAttribute(
      'href',
      `/login?returnTo=${encodeURIComponent('/newsletters/my/acme-foundation?invite=c-news')}`
    );
    await expect(page.locator('lfx-navbar')).toHaveCount(0);

    await page.getByTestId('newsletter-guest-modal-continue').click();

    await expect(page.getByText('Hello members of Acme')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-guest-modal')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('');
  });

  test('tells a new subscriber when the newsletter has not sent an issue yet', async ({ page }) => {
    await page.route('**/public/api/newsletters/invites/inspect', (route) => route.fulfill({ json: INVITE }));
    await page.route('**/public/api/newsletters/invites/accept', (route) =>
      route.fulfill({ json: { ...ISSUE, newsletter: null } satisfies NewsletterGuestIssue })
    );

    await page.goto('/newsletters/invite#token=signed.token');
    await page.getByTestId('newsletter-guest-modal-continue').click({ timeout: ELEMENT_TIMEOUT });

    const empty = page.getByTestId('newsletter-guest-reader-empty');
    await expect(empty).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(empty).toContainText('No issues yet');
    await expect(empty).toContainText('ja***@acme***.example');
  });

  test('offers only Sign in for an expired link', async ({ page }) => {
    await page.route('**/public/api/newsletters/invites/inspect', (route) => route.fulfill({ json: { status: 'expired' } }));

    await page.goto('/newsletters/invite#token=old.token');

    // Scoped to the field: the modal's sr-only live region repeats the same text.
    await expect(page.getByTestId('newsletter-guest-modal-email').getByText('This invite link has expired or is invalid.')).toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-guest-modal-continue')).toHaveCount(0);
    await expect(page.getByTestId('newsletter-guest-modal-sign-in')).toBeVisible();
    // The consent prompt stays hidden here, so cookie preferences must remain reachable from the modal.
    await expect(page.getByTestId('newsletter-guest-modal-cookie-settings')).toBeVisible();
  });
});

test.describe('Shared newsletter link (signed out)', () => {
  const prompt: NewsletterGuestIssueResponse = { issue: null, foundation: FOUNDATION, membership_name: 'Acme Foundation' };

  test.beforeEach(async ({ page }) => {
    await page.route('**/public/api/newsletters/acme-foundation/*/preview', (route) => route.fulfill({ json: { subject: 'Acme Weekly — October' } }));
    await page.route('**/public/api/newsletters/guest/acme-foundation/*', (route) => route.fulfill({ json: prompt }));
  });

  test('asks for a work email and shows the refusal for a non-member address', async ({ page }) => {
    await page.route('**/public/api/newsletters/acme-foundation/*/guest-access', (route) =>
      route.fulfill({
        status: 400,
        json: {
          error: 'Validation failed for email',
          errors: [{ field: 'email', message: 'This newsletter is a member benefit of Acme Foundation. Use your work email, or sign in.' }],
        },
      })
    );

    await page.goto(SHARED_ISSUE_PATH);

    await expect(page.getByTestId('newsletter-guest-modal-description')).toContainText('Enter your work email to read it', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-guest-modal-confirm-copy')).toContainText("we'll email you a confirmation link");
    await expect(page.getByText('Hello members of Acme')).toHaveCount(0);
    await page.getByTestId('newsletter-guest-modal-email').locator('input').fill('someone@personal-mail.example');
    await page.getByTestId('newsletter-guest-modal-continue').click();

    await expect(page.getByTestId('newsletter-guest-modal-email').getByText('Use your work email, or sign in.')).toBeVisible();
  });

  test('opens the issue for a member-company email and notes the confirmation email', async ({ page }) => {
    await page.route('**/public/api/newsletters/acme-foundation/*/guest-access', (route) =>
      route.fulfill({ json: { ...ISSUE, confirmation_sent: true } satisfies NewsletterGuestIssue })
    );

    await page.goto(SHARED_ISSUE_PATH);

    await page.getByTestId('newsletter-guest-modal-email').locator('input').fill('jane.doe@acme-motors.example');
    await page.getByTestId('newsletter-guest-modal-continue').click();

    await expect(page.getByText('Hello members of Acme')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-guest-reader-confirm-note')).toContainText('ja***@acme***.example');
    await expect(page.getByTestId('newsletter-guest-reader-sign-in')).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(SHARED_ISSUE_PATH)}`);
  });
});
