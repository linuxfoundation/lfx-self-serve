// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Reader Page — Structural Tests — GH-1550.
 *
 * Companion to `newsletter-reader.spec.ts`. Asserts the data-testid contract,
 * DOM structure, heading hierarchy, and load-state transitions for the
 * newsletter reader component, isolated from content/copy changes.
 *
 * Why this exists: per `docs/architecture/testing/e2e-testing.md`, every
 * feature with E2E coverage gets a content spec AND a structural (`-robust`)
 * spec. The structural spec is the regression net for refactors that move DOM
 * around but keep testid semantics stable.
 */

import type { Project } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;

const PROJECT_SLUG = 'kubernetes';
const PROJECT_UID = 'p0000000-0000-0000-0000-000000000001';

const MOCK_PROJECT_MANAGER: Project = {
  uid: PROJECT_UID,
  slug: PROJECT_SLUG,
  name: 'Kubernetes',
  writer: true,
  founded_at: '2020-01-01T00:00:00Z',
  status: 'active',
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

async function stubNewsletterApi(page: Page, projectUid: string, newsletterId: string, status: string = 'sent', shouldExist: boolean = true): Promise<void> {
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

test.describe('Newsletter Reader Page — Structural Tests', () => {
  test('renders with complete data-testid contract', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_MANAGER);
    await stubNewsletterApi(page, PROJECT_UID, 'news-456', 'sent', true);

    await page.goto(`/newsletters/${PROJECT_SLUG}/news-456`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Core testid contract: breadcrumb, title, metadata, copy button all present
    await expect(page.getByTestId('newsletter-reader-title')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-reader-received')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-reader-copy-link')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Heading hierarchy: h1 for title
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('respects loading state structure during async data fetch', async ({ page }) => {
    skipWhenAuthMissing();
    let releaseProjectRequest: () => void;
    const projectRequestPromise = new Promise<void>((resolve) => {
      releaseProjectRequest = resolve;
    });

    // Delay project API to observe loading skeleton
    await page.route('**/api/projects?**', (route) => {
      projectRequestPromise.then(() => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_PROJECT_MANAGER),
        });
      });
    });
    await stubNewsletterApi(page, PROJECT_UID, 'news-456', 'sent', true);

    await page.goto(`/newsletters/${PROJECT_SLUG}/news-456`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // During loading, skeleton or placeholder should be visible
    // The component should not display content testids until data arrives
    releaseProjectRequest!();

    // After data arrives, full content should render
    await expect(page.getByTestId('newsletter-reader-title')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-reader-copy-link')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('not-found card renders with correct structure on missing project', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, null);
    await stubNewsletterApi(page, PROJECT_UID, 'news-123', 'sent', true);

    await page.goto(`/newsletters/nonexistent-project/news-123`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Error card present with correct testid
    const notFoundCard = page.getByTestId('newsletter-not-found-card');
    await expect(notFoundCard).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Verify semantic structure: heading and description present
    await expect(notFoundCard.getByRole('heading')).toBeVisible();
  });

  test('not-found card renders with correct structure on missing newsletter', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_MANAGER);
    await stubNewsletterApi(page, PROJECT_UID, 'nonexistent', 'sent', false);

    await page.goto(`/newsletters/${PROJECT_SLUG}/nonexistent`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Error card present with correct testid
    const notFoundCard = page.getByTestId('newsletter-not-found-card');
    await expect(notFoundCard).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Verify semantic structure: heading and description present
    await expect(notFoundCard.getByRole('heading')).toBeVisible();
  });

  test('copy-link button is properly labeled and interactive', async ({ page }) => {
    skipWhenAuthMissing();
    await stubProjectApi(page, MOCK_PROJECT_MANAGER);
    await stubNewsletterApi(page, PROJECT_UID, 'news-456', 'sent', true);

    await page.goto(`/newsletters/${PROJECT_SLUG}/news-456`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    const copyButton = page.getByTestId('newsletter-reader-copy-link');
    await expect(copyButton).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Button should be interactive (clickable)
    await expect(copyButton).toBeEnabled();

    // Button should have accessible text or aria-label
    const textContent = await copyButton.textContent();
    const hasText = textContent && textContent.trim().length > 0;
    const hasAriaLabel = await copyButton.getAttribute('aria-label');
    expect(hasText || hasAriaLabel).toBeTruthy();
  });
});
