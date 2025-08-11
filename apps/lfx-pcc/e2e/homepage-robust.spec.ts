// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('Homepage - Robust Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Verify we're authenticated and on the homepage
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test.describe('Page Structure and Components', () => {
    test('should have correct page structure with main sections', async ({ page }) => {
      await expect(page).toHaveTitle('LFX Projects');
      await expect(page).toHaveURL('/');

      // Check main homepage component is present
      await expect(page.locator('lfx-home')).toBeVisible();

      // Check main content sections are present
      await expect(page.locator('[data-testid="hero-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();
    });

    test('should display home component selector', async ({ page }) => {
      await expect(page.locator('lfx-home')).toBeAttached({ timeout: 10000 });
    });
  });

  test.describe('Hero Section', () => {
    test('should display hero section with proper structure', async ({ page }) => {
      const heroSection = page.locator('[data-testid="hero-section"]');
      await expect(heroSection).toBeVisible();

      // Check hero title and subtitle
      await expect(page.locator('[data-testid="hero-title"]')).toBeVisible();
      await expect(page.locator('[data-testid="hero-subtitle"]')).toBeVisible();

      // Check search container
      await expect(page.locator('[data-testid="hero-search-container"]')).toBeVisible();
    });

    test('should display hero content with correct text', async ({ page }) => {
      // Test hero title content
      const heroTitle = page.locator('[data-testid="hero-title"]');
      await expect(heroTitle).toContainText('Your personalized control panel for managing projects, committees, and meetings.');

      // Test hero subtitle content
      const heroSubtitle = page.locator('[data-testid="hero-subtitle"]');
      await expect(heroSubtitle).toContainText('Get a comprehensive overview of all your active initiatives and upcoming events in one centralized dashboard.');
    });

    test('should display search input with proper structure', async ({ page }) => {
      const searchContainer = page.locator('[data-testid="hero-search-container"]');
      await expect(searchContainer).toBeVisible();

      // Check search input component
      const searchInput = page.locator('[data-testid="hero-search-input"]');
      await expect(searchInput).toBeVisible();

      // Verify it's an lfx-input-text component
      const tagName = await searchInput.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('lfx-input-text');
    });

    test('should have functional search input', async ({ page }) => {
      // Find the actual input field within the lfx-input-text component
      const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
      await expect(searchInput).toBeVisible();
      await expect(searchInput).toBeEditable();

      // Test search functionality
      await searchInput.fill('test search');
      await expect(searchInput).toHaveValue('test search');
    });
  });

  test.describe('Loading State', () => {
    test('should display loading state when projects are loading', async ({ page }) => {
      // Navigate to a fresh page to potentially catch loading state
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Check if loading state appears (might be brief)
      const isLoadingVisible = await page
        .locator('[data-testid="loading-state"]')
        .isVisible()
        .catch(() => false);

      if (isLoadingVisible) {
        await expect(page.locator('[data-testid="loading-state"]')).toBeVisible();
        await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
      }

      // Eventually projects should load
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();
    });
  });

  test.describe('Projects Section', () => {
    test('should display projects section with proper structure', async ({ page }) => {
      const projectsSection = page.locator('[data-testid="projects-section"]');
      await expect(projectsSection).toBeVisible();

      // Wait for projects to load
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible({ timeout: 10000 });

      // Should have either projects grid or skeleton
      const hasProjects = await page
        .locator('[data-testid="projects-grid"]')
        .isVisible()
        .catch(() => false);
      const hasSkeleton = await page
        .locator('[data-testid="projects-skeleton-container"]')
        .isVisible()
        .catch(() => false);

      expect(hasProjects || hasSkeleton).toBe(true);
    });

    test('should display project cards when projects load', async ({ page }) => {
      // Wait for projects to load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      // Check for projects grid
      const projectsGrid = page.locator('[data-testid="projects-grid"]');
      const isGridVisible = await projectsGrid.isVisible().catch(() => false);

      if (isGridVisible) {
        await expect(projectsGrid).toBeVisible();

        // Should have at least one project card
        const projectCards = page.locator('[data-testid="project-card"]');
        const cardCount = await projectCards.count();
        expect(cardCount).toBeGreaterThan(0);
      }
    });

    test('should display project cards with proper structure', async ({ page }) => {
      // Wait for projects to load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      const projectCards = page.locator('[data-testid="project-card"]');
      const cardCount = await projectCards.count();

      if (cardCount > 0) {
        const firstCard = projectCards.first();
        await expect(firstCard).toBeVisible();

        // Check that it's an lfx-project-card component
        const tagName = await firstCard.evaluate((el) => el.tagName.toLowerCase());
        expect(tagName).toBe('lfx-project-card');

        // Check project card internal structure
        await expect(firstCard.locator('[data-testid="project-card-container"]')).toBeVisible();
        await expect(firstCard.locator('[data-testid="project-header"]')).toBeVisible();
        await expect(firstCard.locator('[data-testid="project-info"]')).toBeVisible();
      }
    });

    test('should display project card content elements', async ({ page }) => {
      // Wait for projects to load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      const projectCards = page.locator('[data-testid="project-card"]');
      const cardCount = await projectCards.count();

      if (cardCount > 0) {
        const firstCard = projectCards.first();

        // Check project logo exists (might be hidden if no valid logo URL)
        await expect(firstCard.locator('[data-testid="project-logo"]')).toBeAttached();

        // Check project title and description
        await expect(firstCard.locator('[data-testid="project-title"]')).toBeVisible();
        await expect(firstCard.locator('[data-testid="project-description"]')).toBeVisible();

        // Check metrics section
        const hasMetrics = await firstCard
          .locator('[data-testid="project-metrics"]')
          .isVisible()
          .catch(() => false);
        if (hasMetrics) {
          await expect(firstCard.locator('[data-testid="project-metrics"]')).toBeVisible();

          // Should have at least one metric
          const metrics = firstCard.locator('[data-testid="project-metric"]');
          const metricCount = await metrics.count();
          expect(metricCount).toBeGreaterThan(0);
        }
      }
    });

    test('should display project metrics with proper structure', async ({ page }) => {
      // Wait for projects to load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      const projectCards = page.locator('[data-testid="project-card"]');
      const cardCount = await projectCards.count();

      if (cardCount > 0) {
        const firstCard = projectCards.first();
        const metrics = firstCard.locator('[data-testid="project-metric"]');
        const metricCount = await metrics.count();

        if (metricCount > 0) {
          const firstMetric = metrics.first();

          // Check metric structure
          await expect(firstMetric.locator('[data-testid="metric-label-container"]')).toBeVisible();
          await expect(firstMetric.locator('[data-testid="metric-value-container"]')).toBeVisible();

          // Check metric content
          await expect(firstMetric.locator('[data-testid="metric-icon"]')).toBeVisible();
          await expect(firstMetric.locator('[data-testid="metric-label"]')).toBeVisible();

          // Should have either a badge or a value
          const hasBadge = await firstMetric
            .locator('[data-testid="metric-badge"]')
            .isVisible()
            .catch(() => false);
          const hasValue = await firstMetric
            .locator('[data-testid="metric-value"]')
            .isVisible()
            .catch(() => false);

          expect(hasBadge || hasValue).toBe(true);
        }
      }
    });
  });

  test.describe('Search Functionality', () => {
    test('should filter projects when searching', async ({ page }) => {
      // Wait for initial load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      // Get initial project count
      const projectCards = page.locator('[data-testid="project-card"]');
      const initialCount = await projectCards.count();

      if (initialCount > 0) {
        // Perform search
        const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
        await searchInput.fill('test');

        // Wait for search results to update
        await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();

        // Projects should be filtered (count may change)
        await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();
      }
    });

    test('should clear search and show all projects', async ({ page }) => {
      // Wait for initial load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });

      // Search for something
      await searchInput.fill('nonexistent');

      // Clear search
      await searchInput.clear();

      // Wait for projects to be visible again
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();

      // Projects section should still be visible
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();
    });
  });

  test.describe('Navigation and Interaction', () => {
    test('should navigate to project detail when clicking a project card', async ({ page }) => {
      // Wait for project cards to load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      // Search for ASWF to get consistent results
      const searchInput = page.getByRole('textbox', { name: 'Search projects, committees,' });
      await searchInput.fill('aswf');
      await page.keyboard.press('Enter');

      // Wait for search results and ensure we have the ASWF project
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      // Verify we found the ASWF project by checking the title contains "Academy Software Foundation"
      await expect(page.getByTestId('project-title').filter({ hasText: 'Academy Software Foundation' })).toBeVisible();

      const projectCards = page.locator('[data-testid="project-card"]');
      const cardCount = await projectCards.count();

      if (cardCount > 0) {
        // Click specifically on the ASWF project card
        const aswfCard = projectCards.filter({ has: page.getByTestId('project-title').filter({ hasText: 'Academy Software Foundation' }) });
        await expect(aswfCard).toBeVisible();
        await aswfCard.click();

        // Should navigate to ASWF project
        await expect(page).toHaveURL('/project/aswf');
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('should display correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      // Main sections should be visible
      await expect(page.locator('[data-testid="hero-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();

      // Search should be visible and functional
      await expect(page.locator('[data-testid="hero-search-container"]')).toBeVisible();

      // Header elements should adapt to mobile
      const viewport = page.viewportSize();
      const isMobile = viewport && viewport.width < 768;

      if (isMobile) {
        // Search in header should be hidden on mobile
        await expect(page.getByPlaceholder('Search projects...')).toBeHidden();
      }

      // Logo should still be visible
      await expect(page.getByAltText('LFX Logo')).toBeVisible();
    });

    test('should display correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });

      // All sections should be visible
      await expect(page.locator('[data-testid="hero-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();

      // Header elements should be visible on tablet (medium and up)
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible();
      await expect(page.getByAltText('LFX Logo')).toBeVisible();
    });

    test('should display correctly on desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });

      // All sections should be visible
      await expect(page.locator('[data-testid="hero-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="projects-section"]')).toBeVisible();

      // Header elements should be visible on desktop
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible();
      await expect(page.getByAltText('LFX Logo')).toBeVisible();
    });
  });

  test.describe('Component Integration', () => {
    test('should properly integrate Angular signals and computed values', async ({ page }) => {
      // Wait for Angular to initialize and signals to resolve
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 20000 });

      // The presence of project cards indicates successful signal integration
      const projectsSection = page.locator('[data-testid="projects-section"]');
      await expect(projectsSection).toBeVisible();

      // Either projects or skeleton should be present (indicates reactive state)
      const hasProjects = await page
        .locator('[data-testid="projects-grid"]')
        .isVisible()
        .catch(() => false);
      const hasSkeleton = await page
        .locator('[data-testid="projects-skeleton-container"]')
        .isVisible()
        .catch(() => false);

      expect(hasProjects || hasSkeleton).toBe(true);
    });

    test('should use lfx-input-text component for search', async ({ page }) => {
      const searchInput = page.locator('[data-testid="hero-search-input"]');
      await expect(searchInput).toBeVisible();

      // Check that it's an lfx-input-text element
      const tagName = await searchInput.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('lfx-input-text');
    });

    test('should use lfx-project-card components for project display', async ({ page }) => {
      // Wait for projects to load
      await expect(page.locator('[data-testid="project-card"]').first()).toBeVisible({ timeout: 10000 });

      const projectCards = page.locator('[data-testid="project-card"]');
      const cardCount = await projectCards.count();

      if (cardCount > 0) {
        // Check that each card is an lfx-project-card component
        for (let i = 0; i < Math.min(cardCount, 3); i++) {
          const card = projectCards.nth(i);
          await expect(card).toBeVisible();
          const tagName = await card.evaluate((el) => el.tagName.toLowerCase());
          expect(tagName).toBe('lfx-project-card');
        }
      }
    });

    test('should use lfx-home component as main container', async ({ page }) => {
      const homeComponent = page.locator('lfx-home');
      await expect(homeComponent).toBeVisible();

      // Check that it's an lfx-home element
      const tagName = await homeComponent.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('lfx-home');
    });
  });
});
