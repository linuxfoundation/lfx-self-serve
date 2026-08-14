// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { mockApiResponse, setupPage } from './playwright/fixtures';

test.describe('Newsletter Reader Page', () => {
  test('renders sent newsletter with breadcrumb and copy-link button', async ({ page }) => {
    // Mock the project get by slug
    await mockApiResponse(page, '/api/projects?**', {
      uid: 'proj-123',
      slug: 'kubernetes',
      name: 'Kubernetes',
      writer: false,
    });

    // Mock the newsletter single get
    await mockApiResponse(page, '/api/projects/proj-123/newsletters/news-456', {
      id: 'news-456',
      subject: 'K8s Weekly #42',
      body_html: '<p>This is the newsletter body.</p>',
      status: 'sent',
      sent_at: '2026-08-13T10:00:00Z',
    });

    await setupPage(page);
    await page.goto('/newsletters/kubernetes/news-456');

    // Breadcrumb and title
    await expect(page.getByTestId('newsletter-reader-title')).toContainText('Kubernetes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('K8s Weekly #42');
    await expect(page.getByTestId('newsletter-reader-received')).toContainText('Received Aug 13, 2026');

    // Copy-link button present
    await expect(page.getByTestId('newsletter-reader-copy-link')).toBeVisible();

    // Newsletter preview renders
    await expect(page.getByTestId('newsletter-reader-preview')).toBeVisible();
  });

  test('renders in-place 404 for draft newsletter when user is not a writer', async ({ page, context }) => {
    // Mock the project get by slug with writer=false
    await mockApiResponse(page, '/api/projects?**', {
      uid: 'proj-123',
      slug: 'kubernetes',
      name: 'Kubernetes',
      writer: false,
    });

    // Mock the newsletter single get (draft)
    await mockApiResponse(page, '/api/projects/proj-123/newsletters/news-draft', {
      id: 'news-draft',
      subject: 'Draft Newsletter',
      body_html: '<p>This is a draft.</p>',
      status: 'draft',
    });

    await setupPage(page);
    await page.goto('/newsletters/kubernetes/news-draft');

    // Should render in-place 404 for draft
    await expect(page.getByTestId('newsletter-not-found-card')).toBeVisible();
    await expect(page.getByText('Draft Newsletter')).toBeVisible();
    await expect(page.getByText(/Only project managers can view draft newsletters/)).toBeVisible();
  });

  test('allows manager (writer) to view draft newsletter', async ({ page }) => {
    // Mock the project get with writer=true
    await mockApiResponse(page, '/api/projects?**', {
      uid: 'proj-123',
      slug: 'kubernetes',
      name: 'Kubernetes',
      writer: true,
    });

    // Mock the newsletter single get (draft)
    await mockApiResponse(page, '/api/projects/proj-123/newsletters/news-draft', {
      id: 'news-draft',
      subject: 'Draft Newsletter',
      body_html: '<p>This is a draft for review.</p>',
      status: 'draft',
    });

    await setupPage(page);
    await page.goto('/newsletters/kubernetes/news-draft');

    // Draft should render (not 404) because user is a writer
    await expect(page.getByTestId('newsletter-reader-preview')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Draft Newsletter');
  });

  test('renders in-place 404 when project slug does not exist', async ({ page }) => {
    // Mock the project get to fail
    await mockApiResponse(page, '/api/projects?**', undefined);

    await setupPage(page);
    await page.goto('/newsletters/nonexistent-project/news-123');

    // Should render in-place 404
    await expect(page.getByTestId('newsletter-not-found-card')).toBeVisible();
    await expect(page.getByText('Newsletter Not Found')).toBeVisible();
  });

  test('renders in-place 404 when newsletter id does not exist', async ({ page }) => {
    // Mock the project get by slug
    await mockApiResponse(page, '/api/projects?**', {
      uid: 'proj-123',
      slug: 'kubernetes',
      name: 'Kubernetes',
      writer: false,
    });

    // Mock the newsletter get to fail
    await mockApiResponse(page, '/api/projects/proj-123/newsletters/nonexistent', undefined);

    await setupPage(page);
    await page.goto('/newsletters/kubernetes/nonexistent');

    // Should render in-place 404
    await expect(page.getByTestId('newsletter-not-found-card')).toBeVisible();
    await expect(page.getByText('Newsletter Not Found')).toBeVisible();
  });

  test('copy-link button copies absolute URL to clipboard', async ({ page, context }) => {
    // Mock the project get by slug
    await mockApiResponse(page, '/api/projects?**', {
      uid: 'proj-123',
      slug: 'kubernetes',
      name: 'Kubernetes',
      writer: false,
    });

    // Mock the newsletter single get
    await mockApiResponse(page, '/api/projects/proj-123/newsletters/news-456', {
      id: 'news-456',
      subject: 'K8s Weekly #42',
      body_html: '<p>This is the newsletter body.</p>',
      status: 'sent',
      sent_at: '2026-08-13T10:00:00Z',
    });

    await setupPage(page);
    await page.goto('/newsletters/kubernetes/news-456');

    // Click copy-link button
    await page.getByTestId('newsletter-reader-copy-link').click();

    // Check for success toast
    await expect(page.getByText('Link Copied')).toBeVisible();
  });
});
