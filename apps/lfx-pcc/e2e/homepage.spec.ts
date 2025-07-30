// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Verify we're authenticated and on the homepage
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('should display the homepage title and subtitle', async ({ page }) => {
    // Check for the main heading
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your personalized control panel for managing projects, committees, and meetings.');

    // Check for the subtitle
    await expect(page.locator('p').first()).toContainText(
      'Get a comprehensive overview of all your active initiatives and upcoming events in one centralized dashboard.'
    );
  });

  test('should display header elements on desktop', async ({ page }) => {
    // Ensure we're in desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 });

    // Check for logo and brand
    await expect(page.getByRole('button', { name: 'Go to home page' })).toBeVisible();
    await expect(page.getByAltText('LFX Logo')).toBeVisible();
    await expect(page.getByText('Projects Self-Service')).toBeVisible();

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

    // Header search and brand text should be hidden on mobile
    await expect(page.getByPlaceholder('Search projects...')).toBeHidden();
    await expect(page.getByText('Projects Self-Service')).toBeHidden();

    // Check for tools menu button (should still be visible)
    await expect(page.getByRole('button', { name: 'Open tools menu' })).toBeVisible();
  });

  test('should have main search input field', async ({ page }) => {
    // Check for main search input in hero section
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Search projects, committees, meetings, or mailing lists...');
  });

  test('should display project cards when projects load', async ({ page }) => {
    // Wait for project data to load
    await page.waitForLoadState('networkidle');

    // Check if project cards are displayed
    const projectCards = page.locator('lfx-project-card');

    // Should have multiple project cards
    const cardCount = await projectCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Check first project card has expected elements
    const firstCard = projectCards.first();
    await expect(firstCard.getByRole('heading', { level: 3 })).toBeVisible();
    await expect(firstCard.locator('img')).toBeVisible(); // Project logo
    await expect(firstCard.locator('p')).toBeVisible(); // Description

    // Check for metrics in project cards
    await expect(firstCard.getByText('Meetings')).toBeVisible();
    await expect(firstCard.getByText('Committees')).toBeVisible();
    await expect(firstCard.getByText('Mailing Lists')).toBeVisible();
  });

  test('should filter projects when searching', async ({ page }) => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Get initial project count
    const initialCards = page.locator('lfx-project-card');
    const initialCount = await initialCards.count();
    expect(initialCount).toBeGreaterThan(1);

    // Search for specific project
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await searchInput.fill('CNCF');

    // Wait for search to complete
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');

    // Verify search results are displayed

    // Should show CNCF project in results
    await expect(page.getByRole('heading', { name: 'Cloud Native Computing Foundation' })).toBeVisible();

    // Verify search input has the search term
    await expect(searchInput).toHaveValue('CNCF');
  });

  test('should clear search and show all projects', async ({ page }) => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Search for specific project
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await searchInput.fill('CNCF');
    await page.waitForTimeout(500);

    // Clear search
    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');

    // Should show multiple projects again
    const allCards = page.locator('lfx-project-card');
    const finalCount = await allCards.count();
    expect(finalCount).toBeGreaterThanOrEqual(1);
  });

  test('should navigate to project detail when clicking a project card', async ({ page }) => {
    // Wait for project cards to load
    await page.waitForLoadState('networkidle');

    // Click on first project card
    const firstCard = page.locator('lfx-project-card').first();
    await expect(firstCard).toBeVisible();

    // Get the project name to verify navigation
    const projectName = await firstCard.getByRole('heading', { level: 3 }).innerText();

    // Click the project card
    await firstCard.click();

    // Wait for navigation
    await page.waitForLoadState('networkidle');

    // Verify navigation to project page
    expect(page.url()).toMatch(/\/project\/[\w-]+$/);

    // Verify project detail page elements - use heading that contains the project name
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: projectName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Meetings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Committees', exact: true })).toBeVisible();
  });

  test('should have proper responsive layout', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle');

    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    const projectCards = page.locator('lfx-project-card');
    await expect(projectCards.first()).toBeVisible();

    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(projectCards.first()).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(projectCards.first()).toBeVisible();

    // On mobile, header search and brand text should be hidden
    await expect(page.getByPlaceholder('Search projects...')).toBeHidden();
    await expect(page.getByText('Projects Self-Service')).toBeHidden();

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
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Search for something that should return no results
    const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
    await searchInput.fill('nonexistentproject12345');

    // Wait for search to complete
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');

    // Should have no project cards visible
    const projectCards = page.locator('lfx-project-card');
    await expect(projectCards).toHaveCount(0);
  });
});

// Generated with [Claude Code](https://claude.ai/code)
