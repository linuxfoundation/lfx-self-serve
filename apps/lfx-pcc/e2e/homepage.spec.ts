// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Verify we're authenticated and on the homepage
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('should display the homepage title and subtitle', async ({ page }) => {
    // Check for the main heading using data-testid
    await expect(page.getByTestId('hero-title')).toContainText('Your personalized control panel for managing projects, committees, and meetings.');

    // Check for the subtitle using data-testid
    await expect(page.getByTestId('hero-subtitle')).toContainText(
      'Get a comprehensive overview of all your active initiatives and upcoming events in one centralized dashboard.'
    );
  });

  test('should display header elements on desktop', async ({ page }) => {
    // Ensure we're in desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 });

    // Check for logo
    await expect(page.getByRole('button', { name: 'Go to home page' })).toBeVisible();
    await expect(page.getByAltText('LFX Logo')).toBeVisible();

    // Header search should be visible on desktop (md and larger)
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible();

    // Check for tools menu button
    await expect(page.getByRole('button', { name: 'Open tools menu' })).toBeVisible();
  });

  test('should display header elements on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Check for logo and home button (should be visible)
    await expect(page.getByRole('button', { name: 'Go to home page' })).toBeVisible();
    await expect(page.getByAltText('LFX Logo')).toBeVisible();

    // Header search should be hidden on mobile
    await expect(page.getByPlaceholder('Search projects...')).toBeHidden();

    // Mobile search toggle button should be visible
    await expect(page.getByTestId('mobile-search-toggle')).toBeVisible();

    // Check for tools menu button (should still be visible)
    await expect(page.getByRole('button', { name: 'Open tools menu' })).toBeVisible();
  });

  test('should open mobile search overlay when clicking search button', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Click mobile search toggle button
    await page.getByTestId('mobile-search-toggle').click();

    // Mobile search overlay should be visible
    await expect(page.getByTestId('mobile-search-overlay')).toBeVisible();

    // Mobile search input should be visible
    const mobileSearchInput = page.getByTestId('mobile-search-input');
    await expect(mobileSearchInput).toBeVisible();

    // Close button should be visible
    await expect(page.getByTestId('mobile-search-close')).toBeVisible();

    // Type in the mobile search
    await mobileSearchInput.fill('test search');
    await expect(mobileSearchInput).toHaveValue('test search');

    // Close the search overlay
    await page.getByTestId('mobile-search-close').click();
    await expect(page.getByTestId('mobile-search-overlay')).toBeHidden();
  });

  test('should have main search input field', async ({ page }) => {
    // Check for main search input in hero section
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Search projects, committees, meetings, or mailing lists...');
  });

  test('should display project cards when projects load', async ({ page }) => {
    // Wait for project cards to appear
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });

    // Check if project cards are displayed
    const projectCards = page.getByTestId('project-card');

    // Should have multiple project cards
    const cardCount = await projectCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Check first project card has expected elements using data-testids
    const firstCard = projectCards.first();
    await expect(firstCard.getByTestId('project-title')).toBeVisible();
    await expect(firstCard.getByTestId('project-logo')).toBeAttached();
    await expect(firstCard.getByTestId('project-description')).toBeVisible();

    // Check for metrics in project cards using data-testids
    await expect(firstCard.getByTestId('metric-label').filter({ hasText: 'Meetings' })).toBeVisible();
    await expect(firstCard.getByTestId('metric-label').filter({ hasText: 'Committees' })).toBeVisible();
    await expect(firstCard.getByTestId('metric-label').filter({ hasText: 'Mailing Lists' })).toBeVisible();
  });

  test('should filter projects when searching', async ({ page }) => {
    // Wait for project cards to appear
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });

    // Get initial project count
    const initialCards = page.getByTestId('project-card');
    const initialCount = await initialCards.count();
    expect(initialCount).toBeGreaterThan(1);

    // Search for specific project using hero search input
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await searchInput.fill('CNCF');

    // Wait for search results to update by checking that the count has decreased
    await expect(async () => {
      const filteredCards = page.getByTestId('project-card');
      const filteredCount = await filteredCards.count();
      expect(filteredCount).toBeLessThan(initialCount);
    }).toPass({ timeout: 5000 });

    // Verify the CNCF project is visible
    await expect(page.getByTestId('project-title').filter({ hasText: 'Cloud Native Computing Foundation' })).toBeVisible();

    // Verify search results are filtered (should have fewer results)
    const filteredCards = page.getByTestId('project-card');
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBeLessThan(initialCount);

    // Verify search input has the search term
    await expect(searchInput).toHaveValue('CNCF');
  });

  test('should clear search and show all projects', async ({ page }) => {
    // Wait for project cards to appear
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });

    // Search for specific project using hero search input
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await searchInput.fill('CNCF');

    // Wait for search to filter results
    await expect(page.getByTestId('project-title').filter({ hasText: 'Cloud Native Computing Foundation' })).toBeVisible();

    // Clear search
    await searchInput.clear();

    // Wait for all projects to show again by checking for multiple project cards
    await expect(page.getByTestId('project-card').nth(1)).toBeVisible();

    // Should show multiple projects again
    const allCards = page.getByTestId('project-card');
    const finalCount = await allCards.count();
    expect(finalCount).toBeGreaterThanOrEqual(1);
  });

  test('should navigate to project detail when clicking a project card', async ({ page }) => {
    // Wait for project cards to appear
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });

    // Click on a specific project card (CNCF) for consistent testing
    const cncfCard = page
      .getByTestId('project-card')
      .filter({ has: page.getByTestId('project-title').filter({ hasText: 'Cloud Native Computing Foundation' }) });
    await expect(cncfCard).toBeVisible();

    // Get the project name to verify navigation
    const projectName = await cncfCard.getByTestId('project-title').innerText();

    // Click the project card
    await cncfCard.click();

    // Wait for navigation by checking URL change
    await expect(page).toHaveURL(/\/project\/[\w-]+$/, { timeout: 10000 });

    // Verify project detail page elements - use heading that contains the project name
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: projectName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Meetings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Committees', exact: true })).toBeVisible();
  });

  test('should have proper responsive layout', async ({ page }) => {
    // Wait for project cards to appear
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });

    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    const projectCards = page.getByTestId('project-card');
    await expect(projectCards.first()).toBeVisible();

    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(projectCards.first()).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(projectCards.first()).toBeVisible();

    // On mobile, header search should be hidden
    await expect(page.getByPlaceholder('Search projects...')).toBeHidden();

    // Logo should still be visible
    await expect(page.getByAltText('LFX Logo')).toBeVisible();
  });

  test('should display footer elements', async ({ page }) => {
    // Check for footer content
    await expect(page.getByText('Copyright © 2025 The Linux Foundation®')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Platform Usage' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Policies' })).toBeVisible();
  });

  test('should handle search with no results', async ({ page }) => {
    // Wait for project cards to appear first
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });

    // Search for something that should return no results
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await searchInput.fill('nonexistentproject12345');

    // Wait for search to complete by checking that project cards are hidden
    await expect(page.getByTestId('project-card')).toHaveCount(0);
  });
});

// Generated with [Claude Code](https://claude.ai/code)
