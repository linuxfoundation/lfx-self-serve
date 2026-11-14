// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter member benefit — structural tests (#3469).
 *
 * Locks the data-testid contract of the reader's member-benefit banner and members-only screen:
 * which test ids exist, where they nest, and which are absent per access decision and join outcome.
 * Content assertions live in newsletter-member-benefit.spec.ts.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { NewsletterReaderAccess, NewsletterReaderDeniedReason, Project } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { SYNTHETIC_ORG_DOMAIN, SYNTHETIC_ORG_NAME } from './fixtures/mock-data/synthetic-org.mock';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;

const PROJECT_SLUG = 'tlf';
const PROJECT_UID = 'p0000000-0000-0000-0000-000000000004';
const NEWSLETTER_ID = 'n0000000-0000-0000-0000-000000000004';

const MOCK_PROJECT: Project = {
  uid: PROJECT_UID,
  slug: PROJECT_SLUG,
  name: 'The Linux Foundation',
  writer: false,
  founded_at: '2020-01-01T00:00:00Z',
  status: 'active',
};

const SENT_NEWSLETTER = {
  id: NEWSLETTER_ID,
  project_uid: PROJECT_UID,
  subject: 'LF Weekly #2',
  body_html: '<p>Open source news.</p>',
  ed_reply_email: 'ed@example.org',
  committee_uids: ['c0000000-0000-0000-0000-000000000004'],
  status: 'sent',
  sent_at: '2026-10-09T10:00:00Z',
  total_recipients: 10,
  created_by: 'sender',
  version: 1,
  created_at: '2026-10-09T10:00:00Z',
  updated_at: '2026-10-09T10:00:00Z',
} as NewsletterReaderAccess['newsletter'];

const ELIGIBLE: NewsletterReaderAccess = {
  access: 'eligible',
  newsletter: SENT_NEWSLETTER,
  qualifying_email: `jane@${SYNTHETIC_ORG_DOMAIN}`,
  company_name: SYNTHETIC_ORG_NAME,
  committee_name: 'LF Weekly',
};

async function stubReader(page: Page, access: NewsletterReaderAccess, join?: { status: number; body: unknown }): Promise<void> {
  await page.route(`**/api/projects/${PROJECT_SLUG}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECT) })
  );
  await page.route(`**/api/newsletters/${PROJECT_UID}/${NEWSLETTER_ID}/reader`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(access) })
  );
  await page.route(`**/api/newsletters/${PROJECT_UID}/${NEWSLETTER_ID}/join`, (route) =>
    route.fulfill({ status: join?.status ?? 201, contentType: 'application/json', body: JSON.stringify(join?.body ?? {}) })
  );
}

async function openReader(page: Page): Promise<void> {
  await page.goto(`/newsletters/${PROJECT_SLUG}/${NEWSLETTER_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

test.describe('Newsletter member benefit — Structural Tests', () => {
  test('eligible + added: banner nests above the preview with the email test id', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, ELIGIBLE, {
      status: 201,
      body: { status: 'added', email: ELIGIBLE.qualifying_email, committee_name: 'LF Weekly', company_name: SYNTHETIC_ORG_NAME },
    });
    await openReader(page);

    const container = page.getByTestId('newsletter-reader-member-benefit');
    await expect(container.getByTestId('newsletter-member-benefit-added')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(container.getByTestId('newsletter-member-benefit-email')).toHaveCount(1);
    await expect(container.getByTestId('newsletter-member-benefit-failed')).toHaveCount(0);
    await expect(container.getByTestId('newsletter-member-benefit-joining')).toHaveCount(0);
    await expect(page.getByTestId('newsletter-reader-preview')).toBeVisible();
    await expect(page.getByTestId('newsletter-reader-members-only')).toHaveCount(0);
  });

  test('eligible + failed: only the failed state with its retry control renders', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, ELIGIBLE, { status: 502, body: { error: 'upstream unavailable', code: 'BAD_GATEWAY' } });
    await openReader(page);

    const failed = page.getByTestId('newsletter-member-benefit-failed');
    await expect(failed).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(failed.getByTestId('newsletter-member-benefit-retry')).toHaveCount(1);
    await expect(page.getByTestId('newsletter-member-benefit-added')).toHaveCount(0);
  });

  test('group member: preview without any member-benefit container', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, { access: 'group_member', newsletter: SENT_NEWSLETTER });
    await openReader(page);

    await expect(page.getByTestId('newsletter-reader-preview')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-reader-member-benefit')).toHaveCount(0);
  });

  const deniedCases: { reason: NewsletterReaderDeniedReason; addEmailButton: number }[] = [
    { reason: 'no_company_email', addEmailButton: 1 },
    { reason: 'not_member_company', addEmailButton: 1 },
    { reason: 'no_newsletter_group', addEmailButton: 0 },
  ];

  for (const { reason, addEmailButton } of deniedCases) {
    test(`denied (${reason}): members-only card replaces the issue`, async ({ page }) => {
      skipWhenAuthMissing();
      await stubReader(page, { access: 'denied', denied_reason: reason });
      await openReader(page);

      const membersOnly = page.getByTestId('newsletter-reader-members-only');
      await expect(membersOnly).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(membersOnly.getByTestId('newsletter-not-found-card')).toHaveCount(1);
      await expect(membersOnly.getByTestId('error-title')).toHaveCount(1);
      await expect(membersOnly.getByTestId('add-company-email-button')).toHaveCount(addEmailButton);
      await expect(membersOnly.getByTestId('back-to-newsletters-button')).toHaveCount(1);
      await expect(page.getByTestId('newsletter-reader-preview')).toHaveCount(0);
    });
  }
});
