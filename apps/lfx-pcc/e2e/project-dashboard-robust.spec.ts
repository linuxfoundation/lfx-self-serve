// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('Project Dashboard - Robust Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage and search for a project
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search projects, committees, meetings, or mailing lists...' }).fill('test');
    await page.keyboard.press('Enter');

    // Click on the Academy Software Foundation project
    await page.locator('lfx-project-card').first().click();

    // Ensure we're on the dashboard tab
    await page.getByRole('link', { name: 'Dashboard' }).click();
  });

  test.describe('Page Structure and Components', () => {
    test('should have correct page structure with main content', async ({ page }) => {
      await expect(page).toHaveTitle('LFX Projects');
      await expect(page).toHaveURL(/\/project\/\w+$/);

      // Check main project component is present
      await expect(page.locator('lfx-project')).toBeVisible();

      // Check that main content sections are present
      await expect(page.locator('[data-testid="metrics-cards-container"]')).toBeVisible();
    });

    test('should display project component selector', async ({ page }) => {
      await expect(page.locator('lfx-project')).toBeVisible();
    });
  });

  test.describe('Metrics Cards', () => {
    test('should display all four metrics cards with proper structure', async ({ page }) => {
      const metricsContainer = page.locator('[data-testid="metrics-cards-container"]');
      await expect(metricsContainer).toBeVisible();

      // Verify individual cards by data-testid
      await expect(page.locator('[data-testid="total-members-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="total-committees-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="total-meetings-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="upcoming-meetings-card"]')).toBeVisible();
    });

    test('should display metrics with proper labels and values', async ({ page }) => {
      // Test Total Members card
      const totalMembersCard = page.locator('[data-testid="total-members-card"]');
      await expect(totalMembersCard.getByText('Total Members')).toBeVisible();
      await expect(totalMembersCard.getByText(/^\d+$/)).toBeVisible();

      // Test Total Committees card
      const totalCommitteesCard = page.locator('[data-testid="total-committees-card"]');
      await expect(totalCommitteesCard.getByText('Committees')).toBeVisible();
      await expect(totalCommitteesCard.getByText(/^\d+$/)).toBeVisible();

      // Test Total Meetings card
      const totalMeetingsCard = page.locator('[data-testid="total-meetings-card"]');
      await expect(totalMeetingsCard.getByText('Total Meetings')).toBeVisible();
      await expect(totalMeetingsCard.getByText(/^\d+$/)).toBeVisible();

      // Test Upcoming Meetings card
      const upcomingCard = page.locator('[data-testid="upcoming-meetings-card"]');
      await expect(upcomingCard.getByText('Upcoming')).toBeVisible();
      await expect(upcomingCard.getByText(/^\d+$/)).toBeVisible();
    });

    test('should display metrics with FontAwesome icons', async ({ page }) => {
      // Check for specific FontAwesome icons in each card
      await expect(page.locator('[data-testid="total-members-card"] i.fa-users')).toBeVisible();
      await expect(page.locator('[data-testid="total-committees-card"] i.fa-people-group')).toBeVisible();
      await expect(page.locator('[data-testid="total-meetings-card"] i.fa-calendar')).toBeVisible();
      await expect(page.locator('[data-testid="upcoming-meetings-card"] i.fa-calendar-clock')).toBeVisible();
    });

    test('should have proper card layout and components', async ({ page }) => {
      const metricsContainer = page.locator('[data-testid="metrics-cards-container"]');
      await expect(metricsContainer).toBeVisible();

      // Check that each card uses lfx-card component by checking tag name
      const cards = [
        page.locator('[data-testid="total-members-card"]'),
        page.locator('[data-testid="total-committees-card"]'),
        page.locator('[data-testid="total-meetings-card"]'),
        page.locator('[data-testid="upcoming-meetings-card"]'),
      ];

      for (const card of cards) {
        await expect(card).toBeVisible();
        // Check that it's an lfx-card element
        const tagName = await card.evaluate((el) => el.tagName.toLowerCase());
        expect(tagName).toBe('lfx-card');
      }

      // Verify all cards are present in the container
      await expect(metricsContainer.locator('lfx-card')).toHaveCount(4);
    });
  });

  test.describe('Project Health Indicators', () => {
    test('should display Project Health card with proper structure', async ({ page }) => {
      const healthCard = page.locator('[data-testid="project-health-card"]');
      await expect(healthCard).toBeVisible();

      // Check card has health indicators container
      await expect(healthCard.locator('[data-testid="activity-score-indicator"]')).toBeVisible();
      await expect(healthCard.locator('[data-testid="meeting-completion-indicator"]')).toBeVisible();
      await expect(healthCard.locator('[data-testid="meeting-trend-indicator"]')).toBeVisible();
      await expect(healthCard.locator('[data-testid="active-committees-indicator"]')).toBeVisible();
    });

    test('should display all four health indicators', async ({ page }) => {
      await expect(page.locator('[data-testid="activity-score-indicator"]')).toBeVisible();
      await expect(page.locator('[data-testid="meeting-completion-indicator"]')).toBeVisible();
      await expect(page.locator('[data-testid="meeting-trend-indicator"]')).toBeVisible();
      await expect(page.locator('[data-testid="active-committees-indicator"]')).toBeVisible();
    });

    test('should display charts in health indicators', async ({ page }) => {
      // Activity Score should have a doughnut chart
      await expect(page.locator('[data-testid="activity-score-indicator"] lfx-chart')).toBeVisible();

      // Meeting Completion should have a doughnut chart
      await expect(page.locator('[data-testid="meeting-completion-indicator"] lfx-chart')).toBeVisible();

      // Meeting Trend should have a line chart
      await expect(page.locator('[data-testid="meeting-trend-indicator"] lfx-chart')).toBeVisible();

      // Active Committees should have a doughnut chart
      await expect(page.locator('[data-testid="active-committees-indicator"] lfx-chart')).toBeVisible();
    });

    test('should display percentage overlays on doughnut charts', async ({ page }) => {
      // Activity Score percentage overlay
      await expect(page.locator('[data-testid="activity-score-indicator"] span').filter({ hasText: /%$/ })).toBeVisible();

      // Meeting Completion percentage overlay
      await expect(page.locator('[data-testid="meeting-completion-indicator"] span').filter({ hasText: /%$/ })).toBeVisible();

      // Active Committees percentage overlay
      await expect(page.locator('[data-testid="active-committees-indicator"] span').filter({ hasText: /%$/ })).toBeVisible();
    });

    test('should display proper labels and tooltips', async ({ page }) => {
      // Activity Score label and tooltip
      const activityIndicator = page.locator('[data-testid="activity-score-indicator"]');
      await expect(activityIndicator.getByText('Activity Score')).toBeVisible();
      await expect(activityIndicator.locator('i[pTooltip]')).toBeVisible();

      // Meeting Completion label and tooltip
      const meetingIndicator = page.locator('[data-testid="meeting-completion-indicator"]');
      await expect(meetingIndicator.getByText('Meeting Completion')).toBeVisible();
      await expect(meetingIndicator.locator('i[pTooltip]')).toBeVisible();

      // Meeting Trend label and tooltip
      const trendIndicator = page.locator('[data-testid="meeting-trend-indicator"]');
      await expect(trendIndicator.getByText('Meeting Trend (30 days)')).toBeVisible();
      await expect(trendIndicator.locator('i[pTooltip]')).toBeVisible();

      // Active Committees label and tooltip
      const committeesIndicator = page.locator('[data-testid="active-committees-indicator"]');
      await expect(committeesIndicator.getByText('Active Committees')).toBeVisible();
      await expect(committeesIndicator.locator('i[pTooltip]')).toBeVisible();
    });
  });

  test.describe('Quick Actions Menu', () => {
    test('should display Quick Actions card with menu component', async ({ page }) => {
      const quickActionsCard = page.locator('[data-testid="quick-actions-card"]');
      await expect(quickActionsCard).toBeVisible();

      // Check card contains quick actions menu
      await expect(quickActionsCard.getByText('Quick Actions')).toBeVisible();

      // Check that it contains lfx-menu component
      await expect(quickActionsCard.locator('lfx-menu')).toBeVisible();
    });

    test('should display all menu items with proper structure', async ({ page }) => {
      const menuContainer = page.locator('[data-testid="quick-actions-card"] lfx-menu');

      // Check for menu items - these should be rendered as menu items by PrimeNG
      await expect(menuContainer.locator('[role="menuitem"]')).toHaveCount(4);
    });

    test('should have proper menu styling', async ({ page }) => {
      const menu = page.locator('[data-testid="quick-actions-card"] lfx-menu');

      // Check menu styling attributes (these are passed as Angular attributes)
      await expect(menu).toHaveAttribute('styleclass', 'w-full border-0 p-0');
    });
  });

  test.describe('Recent Activity Section', () => {
    test('should display Recent Activity card', async ({ page }) => {
      const activityCard = page.locator('[data-testid="recent-activity-card"]');
      await expect(activityCard).toBeVisible();

      // Check card is properly structured - it should be an lfx-card
      const tagName = await activityCard.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('lfx-card');
    });

    test('should show empty state when no activity', async ({ page }) => {
      const activityCard = page.locator('[data-testid="recent-activity-card"]');

      // Check for empty state content
      await expect(activityCard.getByText('No recent activity')).toBeVisible();
      await expect(activityCard.locator('i.fa-clock-rotate-left')).toBeVisible();
    });

    test('should have proper activity container structure', async ({ page }) => {
      const activityCard = page.locator('[data-testid="recent-activity-card"]');
      // Activity container should be present
      await expect(activityCard).toBeVisible();
    });
  });

  test.describe('Layout and Responsive Design', () => {
    test('should have proper main layout structure', async ({ page }) => {
      // Check main project component
      await expect(page.locator('lfx-project')).toBeVisible();

      // Check main content sections are present
      await expect(page.locator('[data-testid="metrics-cards-container"]')).toBeVisible();
      await expect(page.locator('[data-testid="project-health-card"]')).toBeVisible();

      // Check sidebar content
      await expect(page.locator('[data-testid="quick-actions-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="recent-activity-card"]')).toBeVisible();
    });

    test('should display correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      // Main content should be visible
      await expect(page.locator('lfx-project')).toBeVisible();

      // All cards should still be visible and functional
      await expect(page.locator('[data-testid="total-members-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="project-health-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="quick-actions-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="recent-activity-card"]')).toBeVisible();

      // Header elements should adapt to mobile
      // Search bar should be hidden on mobile (responsive design)
      await expect(page.getByPlaceholder('Search projects...')).toBeHidden();

      // Projects text should be hidden on mobile
      await expect(page.getByText('Projects', { exact: true })).toBeHidden();

      // Logo should still be visible
      await expect(page.getByAltText('LFX Logo')).toBeVisible();
    });

    test('should display correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });

      // All components should be visible and functional
      await expect(page.locator('[data-testid="total-members-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="project-health-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="quick-actions-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="recent-activity-card"]')).toBeVisible();

      // Header elements should be visible on tablet (medium and up)
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible();
      await expect(page.getByText('Projects', { exact: true })).toBeVisible();
      await expect(page.getByAltText('LFX Logo')).toBeVisible();
    });
  });

  test.describe('Component Integration', () => {
    test('should properly integrate Angular signals and computed values', async ({ page }) => {
      // Check that percentage values are rendered (they would be 0% initially but should be present)
      const activityScore = page.locator('[data-testid="activity-score-indicator"] span').filter({ hasText: /%$/ });
      await expect(activityScore).toBeVisible();

      const meetingCompletion = page.locator('[data-testid="meeting-completion-indicator"] span').filter({ hasText: /%$/ });
      await expect(meetingCompletion).toBeVisible();

      const activeCommittees = page.locator('[data-testid="active-committees-indicator"] span').filter({ hasText: /%$/ });
      await expect(activeCommittees).toBeVisible();
    });

    test('should use lfx-card components consistently', async ({ page }) => {
      // Check that our test-targeted cards are present and are lfx-card components
      const testCards = [
        page.locator('[data-testid="total-members-card"]'),
        page.locator('[data-testid="total-committees-card"]'),
        page.locator('[data-testid="total-meetings-card"]'),
        page.locator('[data-testid="upcoming-meetings-card"]'),
        page.locator('[data-testid="project-health-card"]'),
        page.locator('[data-testid="quick-actions-card"]'),
        page.locator('[data-testid="recent-activity-card"]'),
      ];

      for (const card of testCards) {
        await expect(card).toBeVisible();
        const tagName = await card.evaluate((el) => el.tagName.toLowerCase());
        expect(tagName).toBe('lfx-card');
      }
    });

    test('should use lfx-chart components for visualizations', async ({ page }) => {
      // Check for specific chart components in the health indicators
      const healthCard = page.locator('[data-testid="project-health-card"]');

      // Each health indicator should have a chart
      await expect(healthCard.locator('[data-testid="activity-score-indicator"] lfx-chart')).toBeVisible();
      await expect(healthCard.locator('[data-testid="meeting-completion-indicator"] lfx-chart')).toBeVisible();
      await expect(healthCard.locator('[data-testid="meeting-trend-indicator"] lfx-chart')).toBeVisible();
      await expect(healthCard.locator('[data-testid="active-committees-indicator"] lfx-chart')).toBeVisible();
    });
  });
});
