// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Reader Page — GH-1550.
 *
 * Shareable per-issue newsletter permalinks at /newsletters/:projectSlug/:id.
 * Reader page fetches the full newsletter body via the project-scoped get endpoint
 * (open to any authenticated user). Draft gating enforced in-app: non-managers see 404.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { Project } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;

const PROJECT_SLUG = 'kubernetes';
const PROJECT_UID = 'p0000000-0000-0000-0000-000000000001';

const MOCK_PROJECT_SENT: Project = {
  uid: PROJECT_UID,
  slug: PROJECT_SLUG,
  name: 'Kubernetes',
  writer: false,
  founded_at: '2020-01-01T00:00:00Z',
  status: 'active',
};

const MOCK_PROJECT_MANAGER: Project = {
  ...MOCK_PROJECT_SENT,
  writer: true,
};

const MOCK_NEWSLETTER_BODY_HTML = '<p data-e2e="newsletter-body-marker">K8s Weekly #42 update.</p>';

async function stubProjectApi(page: Page, project: Project | null): Promise<void> {
  await page.route('**/api/projects?**', (route) => {
    if (!project) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not found' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(project),
    });
  });
}

async function stubNewsletterApi(
  page: Page,
  projectUid: string,
  newsletterId: string,
  status: string = 'sent',
  shouldExist: boolean = true,
): Promise<void> {
  await page.route(`**/api/projects/${projectUid}/newsletters/${newsletterId}`, (route) => {
    if (!shouldExist) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not found' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: newsletterId,
        subject: 'K8s Weekly #42',
        body_html: MOCK_NEWSLETTER_BODY_HTML,
        status,
        sent_at: '2026-08-13T10:00:00Z',
        project_uid: projectUid,
        ed_reply_email: 'ed@example.com',
        total_recipients: 12,
        created_by: 'sender',
        version: 1,
        created_at: '2026-08-13T10:00:00Z',
        updated_at: '2026-08-13T10:00:00Z',
      }),
    });
  });
}

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

test.describe('Newsletter Reader Page', () => {
  test('renders sent newsletter with breadcrumb and copy-link button', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_SENT);
    await stubNewsletterApi(page, PROJECT_UID, 'news-456', 'sent', true);

    await page.goto(`/newsletters/${PROJECT_SLUG}/news-456`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Breadcrumb and title
    await expect(page.getByTestId('newsletter-reader-title')).toContainText('Kubernetes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('K8s Weekly #42', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-reader-received')).toContainText('Received Aug 13, 2026');

    // Copy-link button present
    await expect(page.getByTestId('newsletter-reader-copy-link')).toBeVisible();

    // Newsletter preview renders
    await expect(page.locator('[data-e2e="newsletter-body-marker"]')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('renders in-place 404 for draft newsletter when user is not a writer', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_SENT);
    await stubNewsletterApi(page, PROJECT_UID, 'news-draft', 'draft', true);

    await page.goto(`/newsletters/${PROJECT_SLUG}/news-draft`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Should render in-place 404 for draft
    await expect(page.getByTestId('newsletter-not-found-card')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByText('Draft Newsletter')).toBeVisible();
    await expect(page.getByText(/Only project managers can view draft newsletters/)).toBeVisible();
  });

  test('allows manager (writer) to view draft newsletter', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_MANAGER);
    await stubNewsletterApi(page, PROJECT_UID, 'news-draft', 'draft', true);

    await page.goto(`/newsletters/${PROJECT_SLUG}/news-draft`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Draft should render (not 404) because user is a writer
    await expect(page.locator('[data-e2e="newsletter-body-marker"]')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('K8s Weekly #42');
  });

  test('renders in-place 404 when project slug does not exist', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, null);

    await page.goto(`/newsletters/nonexistent-project/news-123`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Should render in-place 404
    await expect(page.getByTestId('newsletter-not-found-card')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByText('Newsletter Not Found')).toBeVisible();
  });

  test('renders in-place 404 when newsletter id does not exist', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_SENT);
    await stubNewsletterApi(page, PROJECT_UID, 'nonexistent', 'sent', false);

    await page.goto(`/newsletters/${PROJECT_SLUG}/nonexistent`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Should render in-place 404
    await expect(page.getByTestId('newsletter-not-found-card')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByText('Newsletter Not Found')).toBeVisible();
  });
});
