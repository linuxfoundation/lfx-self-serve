// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter member benefit — #3469.
 *
 * Opening a newsletter permalink as an employee of a Linux Foundation member company shows the
 * issue and adds the reader's work email to the newsletter group automatically, with an on-page
 * confirmation. Readers who neither belong to the group nor work for a member company get a
 * members-only screen instead of the issue.
 *
 * The BFF reader / join endpoints are mocked: eligibility itself is covered by the server specs.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { NewsletterJoinResult, NewsletterReaderAccess, Project } from '@lfx-one/shared/interfaces';
import { expect, Page, Request, test } from '@playwright/test';

import { SYNTHETIC_ORG_DOMAIN, SYNTHETIC_ORG_NAME } from './fixtures/mock-data/synthetic-org.mock';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;

const PROJECT_SLUG = 'tlf';
const PROJECT_UID = 'p0000000-0000-0000-0000-000000000003';
const NEWSLETTER_ID = 'n0000000-0000-0000-0000-000000000003';
const WORK_EMAIL = `jane@${SYNTHETIC_ORG_DOMAIN}`;
const GROUP_NAME = 'LF Weekly';

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
  subject: 'LF Weekly #1',
  body_html: '<p>Open source news.</p>',
  ed_reply_email: 'ed@example.org',
  committee_uids: ['c0000000-0000-0000-0000-000000000003'],
  status: 'sent',
  sent_at: '2026-10-09T10:00:00Z',
  total_recipients: 10,
  created_by: 'sender',
  version: 1,
  created_at: '2026-10-09T10:00:00Z',
  updated_at: '2026-10-09T10:00:00Z',
};

async function stubReader(page: Page, access: NewsletterReaderAccess): Promise<void> {
  await page.route(`**/api/projects/${PROJECT_SLUG}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECT) })
  );
  await page.route(`**/api/newsletters/${PROJECT_UID}/${NEWSLETTER_ID}/reader`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(access) })
  );
}

async function stubJoin(page: Page, respond: () => { status: number; body: unknown }): Promise<Request[]> {
  const calls: Request[] = [];
  await page.route(`**/api/newsletters/${PROJECT_UID}/${NEWSLETTER_ID}/join`, (route) => {
    calls.push(route.request());
    const { status, body } = respond();
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

test.describe('Newsletter member benefit', () => {
  test('an eligible member employee reads the issue and is added automatically', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, {
      access: 'eligible',
      newsletter: SENT_NEWSLETTER as NewsletterReaderAccess['newsletter'],
      qualifying_email: WORK_EMAIL,
      company_name: SYNTHETIC_ORG_NAME,
      committee_name: GROUP_NAME,
    });
    const added: NewsletterJoinResult = { status: 'added', email: WORK_EMAIL, committee_name: GROUP_NAME, company_name: SYNTHETIC_ORG_NAME };
    const joinCalls = await stubJoin(page, () => ({ status: 201, body: added }));

    await page.goto(`/newsletters/${PROJECT_SLUG}/${NEWSLETTER_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('newsletter-reader-preview').getByText('Open source news.'), 'the issue should render for a member employee').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    const confirmation = page.getByTestId('newsletter-member-benefit-added');
    await expect(confirmation, 'the reader should be told they were added').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(confirmation).toContainText("You're on the list");
    await expect(page.getByTestId('newsletter-member-benefit-email')).toHaveText(WORK_EMAIL);
    expect(joinCalls, 'the join must fire exactly once, with no click').toHaveLength(1);
    expect(joinCalls[0].method()).toBe('POST');
  });

  test('a failed add can be retried from the banner', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, {
      access: 'eligible',
      newsletter: SENT_NEWSLETTER as NewsletterReaderAccess['newsletter'],
      qualifying_email: WORK_EMAIL,
      company_name: SYNTHETIC_ORG_NAME,
      committee_name: GROUP_NAME,
    });
    let attempts = 0;
    await stubJoin(page, () => {
      attempts += 1;
      if (attempts === 1) return { status: 502, body: { error: 'upstream unavailable', code: 'BAD_GATEWAY' } };
      return { status: 200, body: { status: 'already_member', email: '', committee_name: '', company_name: '' } };
    });

    await page.goto(`/newsletters/${PROJECT_SLUG}/${NEWSLETTER_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('newsletter-member-benefit-failed')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await page.getByTestId('newsletter-member-benefit-retry').click();
    await expect(page.getByTestId('newsletter-member-benefit-already')).toContainText("You're already on the list", { timeout: ELEMENT_TIMEOUT });
  });

  test('a reader outside the group and outside member companies gets the members-only screen', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, { access: 'denied', denied_reason: 'no_company_email' });
    const joinCalls = await stubJoin(page, () => ({ status: 403, body: { error: 'forbidden', code: 'FORBIDDEN' } }));

    await page.goto(`/newsletters/${PROJECT_SLUG}/${NEWSLETTER_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('newsletter-reader-members-only')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByText('This newsletter is a member benefit')).toBeVisible();
    await expect(page.getByTestId('add-company-email-button')).toBeVisible();
    await expect(page.getByText('Open source news.'), 'the issue body must not render').toHaveCount(0);
    expect(joinCalls, 'a denied reader is never joined').toHaveLength(0);
  });

  test('an existing group member reads the issue with no join and no banner', async ({ page }) => {
    skipWhenAuthMissing();
    await stubReader(page, { access: 'group_member', newsletter: SENT_NEWSLETTER as NewsletterReaderAccess['newsletter'] });
    const joinCalls = await stubJoin(page, () => ({ status: 200, body: {} }));

    await page.goto(`/newsletters/${PROJECT_SLUG}/${NEWSLETTER_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('newsletter-reader-preview').getByText('Open source news.')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-reader-member-benefit')).toHaveCount(0);
    expect(joinCalls).toHaveLength(0);
  });
});
