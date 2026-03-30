// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { test, expect, Page } from '@playwright/test';

/**
 * Marketing Dashboard E2E Tests
 *
 * Tests the Executive Director marketing overview section including:
 * - Marketing metric cards (Website Visits, Email CTR, Paid Social Reach, Social Media)
 * - North Star metric cards (Flywheel Conversion, Member Growth, Engaged Community)
 * - Drill-down drawers for each metric
 * - Carousel navigation
 *
 * Prerequisites:
 * - Dev server running on localhost:4200
 * - User authenticated via Auth0
 * - Dev toolbar visible (feature flag: dev-toolbar)
 */

// The dashboard loads at the root URL; persona must be set to executive-director
const DASHBOARD_URL = '/';

// Timeout for API-driven data to load
const DATA_LOAD_TIMEOUT = 30_000;

// Increase test timeout to account for SSR + persona switch + API loads
test.setTimeout(60_000);

/**
 * Switch to the Executive Director persona via the dev toolbar.
 * The dev toolbar renders a SelectButton with persona options.
 */
async function switchToExecutiveDirector(page: Page): Promise<void> {
  // Wait for dev toolbar to be visible
  await page.waitForSelector('[data-testid="dev-tools-bar"]', { timeout: 10_000 });

  // Click the "Executive Director" option in the persona selector
  const personaSelector = page.locator('[data-testid="dev-tools-bar-persona-selector"]');
  await personaSelector.locator('text=Executive Director').click();

  // Wait for the dashboard to re-render with the marketing overview section
  await page.waitForSelector('[data-testid="marketing-overview-section"]', { timeout: DATA_LOAD_TIMEOUT });
}

/**
 * Open a drawer by clicking a metric card. Scrolls into view if needed (carousel).
 * Waits for the drawer content to be visible before returning.
 */
async function openDrawer(page: Page, cardTestId: string, drawerContentTestId: string): Promise<void> {
  const card = page.locator(`[data-testid="${cardTestId}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  // Wait for drawer content — inner div is reliably visible even when p-drawer wrapper isn't
  await expect(page.locator(`[data-testid="${drawerContentTestId}"]`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.describe('Marketing Overview Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('renders the marketing overview section with title', async ({ page }) => {
    const section = page.locator('[data-testid="marketing-overview-section"]');
    await expect(section).toBeVisible();

    const heading = section.locator('h2');
    await expect(heading).toContainText('Executive Director Overview');

    const subtitle = section.locator('p');
    await expect(subtitle).toContainText('North Star KPIs');
  });

  test('renders carousel with navigation controls', async ({ page }) => {
    const carousel = page.locator('[data-testid="marketing-overview-carousel"]');
    await expect(carousel).toBeVisible();

    await expect(page.locator('[data-testid="marketing-overview-carousel-prev"]')).toBeVisible();
    await expect(page.locator('[data-testid="marketing-overview-carousel-next"]')).toBeVisible();
  });

  test('carousel scrolls when navigation buttons are clicked', async ({ page }) => {
    const carousel = page.locator('[data-testid="marketing-overview-carousel"]');
    const nextBtn = page.locator('[data-testid="marketing-overview-carousel-next"]');

    const initialScroll = await carousel.evaluate((el) => el.scrollLeft);
    await nextBtn.click();
    await page.waitForTimeout(500);
    const afterScroll = await carousel.evaluate((el) => el.scrollLeft);
    expect(afterScroll).toBeGreaterThan(initialScroll);
  });
});

test.describe('North Star Metric Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('renders Flywheel Conversion card', async ({ page }) => {
    const card = page.locator('[data-testid="flywheel-pulse-conversion"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Flywheel Conversion');
  });

  test('renders Member Growth card', async ({ page }) => {
    const card = page.locator('[data-testid="flywheel-pulse-member-growth"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Member Growth');
  });

  test('renders Engaged Community card', async ({ page }) => {
    const card = page.locator('[data-testid="flywheel-pulse-share-of-voice"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Engaged Community');
  });
});

test.describe('Marketing Metric Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('renders Website Visits card', async ({ page }) => {
    const card = page.locator('[data-testid="marketing-card-website-visits"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Website Visits');
  });

  test('renders Email CTR card', async ({ page }) => {
    const card = page.locator('[data-testid="marketing-card-email-ctr"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Email CTR');
  });

  test('renders Paid Social Reach card', async ({ page }) => {
    const card = page.locator('[data-testid="marketing-card-paid-social-reach"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Paid Social');
  });

  test('renders Social Media card', async ({ page }) => {
    const card = page.locator('[data-testid="marketing-card-social-media"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Social Media');
  });

  test('renders Key Insights card', async ({ page }) => {
    const card = page.locator('[data-testid="marketing-overview-key-insights"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Marketing Metrics');
    await expect(card).toContainText('Key Insights');
  });
});

test.describe('Website Visits Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-website-visits', 'website-visits-drawer-content');
    await expect(page.locator('[data-testid="website-visits-drawer-title"]')).toContainText('Website Visits');
  });

  test('shows stats section with data', async ({ page }) => {
    await openDrawer(page, 'marketing-card-website-visits', 'website-visits-drawer-stats');
    const statCards = page.locator('[data-testid="website-visits-drawer-stats"]').locator('lfx-card');
    await expect(statCards).toHaveCount(2);
  });

  test('shows trend chart section', async ({ page }) => {
    await openDrawer(page, 'marketing-card-website-visits', 'website-visits-drawer-content');
    await expect(page.locator('[data-testid="website-visits-drawer-trend-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-website-visits', 'website-visits-drawer-content');
    await page.locator('[data-testid="website-visits-drawer-close"]').click();
    await expect(page.locator('[data-testid="website-visits-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Email CTR Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-email-ctr', 'email-ctr-drawer-content');
    await expect(page.locator('[data-testid="email-ctr-drawer-title"]')).toContainText('Email Click-Through Rate');
  });

  test('shows stats and chart sections', async ({ page }) => {
    await openDrawer(page, 'marketing-card-email-ctr', 'email-ctr-drawer-stats');
    await expect(page.locator('[data-testid="email-ctr-drawer-chart-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-email-ctr', 'email-ctr-drawer-content');
    await page.locator('[data-testid="email-ctr-drawer-close"]').click();
    await expect(page.locator('[data-testid="email-ctr-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Paid Social Reach Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-paid-social-reach', 'paid-social-reach-drawer-content');
    await expect(page.locator('[data-testid="paid-social-reach-drawer-title"]')).toContainText('Paid Social Reach');
  });

  test('shows ROAS and impressions charts', async ({ page }) => {
    await openDrawer(page, 'marketing-card-paid-social-reach', 'paid-social-reach-drawer-stats');
    await expect(page.locator('[data-testid="paid-social-reach-drawer-roas-chart-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="paid-social-reach-drawer-chart-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-paid-social-reach', 'paid-social-reach-drawer-content');
    await page.locator('[data-testid="paid-social-reach-drawer-close"]').click();
    await expect(page.locator('[data-testid="paid-social-reach-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Social Media Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-social-media', 'social-media-drawer-content');
    await expect(page.locator('[data-testid="social-media-drawer-title"]')).toContainText('Social Media');
  });

  test('shows stats and platform breakdown', async ({ page }) => {
    await openDrawer(page, 'marketing-card-social-media', 'social-media-drawer-stats');
    await expect(page.locator('[data-testid="social-media-drawer-platforms-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'marketing-card-social-media', 'social-media-drawer-content');
    await page.locator('[data-testid="social-media-drawer-close"]').click();
    await expect(page.locator('[data-testid="social-media-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Member Growth Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-member-growth', 'member-acquisition-drawer-content');
    await expect(page.locator('[data-testid="member-acquisition-drawer-title"]')).toContainText('Member Growth');
  });

  test('shows stats section', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-member-growth', 'member-acquisition-drawer-stats');
    const statCards = page.locator('[data-testid="member-acquisition-drawer-stats"]').locator('lfx-card');
    await expect(statCards).toHaveCount(3);
  });

  test('shows quarterly acquisition chart section', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-member-growth', 'member-acquisition-drawer-content');
    await expect(page.locator('[data-testid="member-acquisition-drawer-chart-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-member-growth', 'member-acquisition-drawer-content');
    await page.locator('[data-testid="member-acquisition-drawer-close"]').click();
    await expect(page.locator('[data-testid="member-acquisition-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Flywheel Conversion Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens when card is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-conversion', 'flywheel-conversion-drawer-content');
    await expect(page.locator('[data-testid="flywheel-conversion-drawer-title"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-conversion', 'flywheel-conversion-drawer-content');
    await page.locator('[data-testid="flywheel-conversion-drawer-close"]').click();
    await expect(page.locator('[data-testid="flywheel-conversion-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Engaged Community Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens when card is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-share-of-voice', 'engaged-community-drawer-content');
    await expect(page.locator('[data-testid="engaged-community-drawer-title"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-share-of-voice', 'engaged-community-drawer-content');
    await page.locator('[data-testid="engaged-community-drawer-close"]').click();
    await expect(page.locator('[data-testid="engaged-community-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('API Response Validation', () => {
  /**
   * Validates the shape of each /api/analytics/* response intercepted during
   * the Executive Director marketing dashboard load. Uses page.waitForResponse()
   * to capture real API responses and asserts required fields + correct types.
   */

  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
  });

  test('web-activities-summary returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/web-activities-summary') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('totalSessions');
    expect(body).toHaveProperty('totalPageViews');
    expect(body).toHaveProperty('domainGroups');
    expect(body).toHaveProperty('dailyData');
    expect(body).toHaveProperty('dailyLabels');

    // Type checks
    expect(typeof body.totalSessions).toBe('number');
    expect(typeof body.totalPageViews).toBe('number');
    expect(Array.isArray(body.domainGroups)).toBe(true);
    expect(Array.isArray(body.dailyData)).toBe(true);
    expect(Array.isArray(body.dailyLabels)).toBe(true);

    // Domain group shape validation (if data exists)
    if (body.domainGroups.length > 0) {
      const group = body.domainGroups[0];
      expect(group).toHaveProperty('domainGroup');
      expect(group).toHaveProperty('totalSessions');
      expect(group).toHaveProperty('totalPageViews');
      expect(typeof group.domainGroup).toBe('string');
      expect(typeof group.totalSessions).toBe('number');
    }
  });

  test('email-ctr returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/email-ctr') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('currentCtr');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('monthlyData');
    expect(body).toHaveProperty('monthlyLabels');
    expect(body).toHaveProperty('campaignGroups');
    expect(body).toHaveProperty('monthlySends');
    expect(body).toHaveProperty('monthlyOpens');

    // Type checks
    expect(typeof body.currentCtr).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(Array.isArray(body.monthlyData)).toBe(true);
    expect(Array.isArray(body.monthlyLabels)).toBe(true);
    expect(Array.isArray(body.campaignGroups)).toBe(true);
    expect(Array.isArray(body.monthlySends)).toBe(true);
    expect(Array.isArray(body.monthlyOpens)).toBe(true);

    // Campaign group shape (if data exists)
    if (body.campaignGroups.length > 0) {
      const group = body.campaignGroups[0];
      expect(group).toHaveProperty('campaignName');
      expect(group).toHaveProperty('avgCtr');
      expect(typeof group.campaignName).toBe('string');
      expect(typeof group.avgCtr).toBe('number');
    }
  });

  test('social-reach returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/social-reach') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('totalReach');
    expect(body).toHaveProperty('roas');
    expect(body).toHaveProperty('totalSpend');
    expect(body).toHaveProperty('totalRevenue');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('monthlyData');
    expect(body).toHaveProperty('monthlyLabels');
    expect(body).toHaveProperty('monthlyRoas');
    expect(body).toHaveProperty('channelGroups');

    // Type checks
    expect(typeof body.totalReach).toBe('number');
    expect(typeof body.roas).toBe('number');
    expect(typeof body.totalSpend).toBe('number');
    expect(typeof body.totalRevenue).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(Array.isArray(body.monthlyData)).toBe(true);
    expect(Array.isArray(body.monthlyRoas)).toBe(true);
    expect(Array.isArray(body.channelGroups)).toBe(true);

    // Channel group shape (if data exists)
    if (body.channelGroups.length > 0) {
      const group = body.channelGroups[0];
      expect(group).toHaveProperty('channel');
      expect(group).toHaveProperty('totalImpressions');
      expect(typeof group.channel).toBe('string');
      expect(typeof group.totalImpressions).toBe('number');
    }
  });

  test('social-media returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/social-media') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('totalFollowers');
    expect(body).toHaveProperty('totalPlatforms');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('platforms');
    expect(body).toHaveProperty('monthlyData');

    // Type checks
    expect(typeof body.totalFollowers).toBe('number');
    expect(typeof body.totalPlatforms).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(Array.isArray(body.platforms)).toBe(true);
    expect(Array.isArray(body.monthlyData)).toBe(true);

    // Platform shape (if data exists)
    if (body.platforms.length > 0) {
      const platform = body.platforms[0];
      expect(platform).toHaveProperty('platform');
      expect(platform).toHaveProperty('followers');
      expect(platform).toHaveProperty('engagementRate');
      expect(platform).toHaveProperty('postsLast30Days');
      expect(platform).toHaveProperty('impressions');
      expect(typeof platform.platform).toBe('string');
      expect(typeof platform.followers).toBe('number');
    }

    // Monthly data shape (if data exists)
    if (body.monthlyData.length > 0) {
      const point = body.monthlyData[0];
      expect(point).toHaveProperty('month');
      expect(point).toHaveProperty('totalFollowers');
      expect(typeof point.month).toBe('string');
      expect(typeof point.totalFollowers).toBe('number');
    }
  });

  test('member-retention returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/member-retention') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('renewalRate');
    expect(body).toHaveProperty('netRevenueRetention');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('target');
    expect(body).toHaveProperty('monthlyData');

    // Type checks
    expect(typeof body.renewalRate).toBe('number');
    expect(typeof body.netRevenueRetention).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(typeof body.target).toBe('number');
    expect(Array.isArray(body.monthlyData)).toBe(true);

    // Monthly data shape (if data exists)
    if (body.monthlyData.length > 0) {
      const point = body.monthlyData[0];
      expect(point).toHaveProperty('month');
      expect(point).toHaveProperty('value');
      expect(typeof point.month).toBe('string');
      expect(typeof point.value).toBe('number');
    }
  });

  test('member-acquisition returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/member-acquisition') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('totalMembers');
    expect(body).toHaveProperty('totalMembersMonthlyData');
    expect(body).toHaveProperty('totalMembersMonthlyLabels');
    expect(body).toHaveProperty('newMembersThisQuarter');
    expect(body).toHaveProperty('newMemberRevenue');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('quarterlyData');

    // Type checks
    expect(typeof body.totalMembers).toBe('number');
    expect(typeof body.newMembersThisQuarter).toBe('number');
    expect(typeof body.newMemberRevenue).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(Array.isArray(body.totalMembersMonthlyData)).toBe(true);
    expect(Array.isArray(body.totalMembersMonthlyLabels)).toBe(true);
    expect(Array.isArray(body.quarterlyData)).toBe(true);

    // Quarterly data shape (if data exists)
    if (body.quarterlyData.length > 0) {
      const q = body.quarterlyData[0];
      expect(q).toHaveProperty('quarter');
      expect(q).toHaveProperty('newMembers');
      expect(q).toHaveProperty('revenue');
      expect(typeof q.quarter).toBe('string');
      expect(typeof q.newMembers).toBe('number');
      expect(typeof q.revenue).toBe('number');
    }
  });

  test('engaged-community returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/engaged-community') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('totalMembers');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('breakdown');
    expect(body).toHaveProperty('monthlyData');

    // Type checks
    expect(typeof body.totalMembers).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(Array.isArray(body.monthlyData)).toBe(true);

    // Breakdown shape
    const breakdown = body.breakdown;
    expect(breakdown).toHaveProperty('newsletterSubscribers');
    expect(breakdown).toHaveProperty('communityMembers');
    expect(breakdown).toHaveProperty('workingGroupMembers');
    expect(breakdown).toHaveProperty('certifiedIndividuals');
    expect(typeof breakdown.newsletterSubscribers).toBe('number');
    expect(typeof breakdown.communityMembers).toBe('number');
    expect(typeof breakdown.workingGroupMembers).toBe('number');
    expect(typeof breakdown.certifiedIndividuals).toBe('number');

    // Monthly data shape (if data exists)
    if (body.monthlyData.length > 0) {
      const point = body.monthlyData[0];
      expect(point).toHaveProperty('month');
      expect(point).toHaveProperty('value');
      expect(typeof point.month).toBe('string');
      expect(typeof point.value).toBe('number');
    }
  });

  test('flywheel-conversion returns valid response shape', async ({ page }) => {
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/analytics/flywheel-conversion') && resp.status() === 200, {
      timeout: DATA_LOAD_TIMEOUT,
    });

    await switchToExecutiveDirector(page);
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Required top-level fields
    expect(body).toHaveProperty('conversionRate');
    expect(body).toHaveProperty('changePercentage');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('funnel');
    expect(body).toHaveProperty('monthlyData');

    // Type checks
    expect(typeof body.conversionRate).toBe('number');
    expect(typeof body.changePercentage).toBe('number');
    expect(['up', 'down']).toContain(body.trend);
    expect(Array.isArray(body.monthlyData)).toBe(true);

    // Funnel shape
    const funnel = body.funnel;
    expect(funnel).toHaveProperty('eventAttendees');
    expect(funnel).toHaveProperty('convertedToNewsletter');
    expect(funnel).toHaveProperty('convertedToCommunity');
    expect(funnel).toHaveProperty('convertedToWorkingGroup');
    expect(typeof funnel.eventAttendees).toBe('number');
    expect(typeof funnel.convertedToNewsletter).toBe('number');
    expect(typeof funnel.convertedToCommunity).toBe('number');
    expect(typeof funnel.convertedToWorkingGroup).toBe('number');

    // Monthly data shape (if data exists)
    if (body.monthlyData.length > 0) {
      const point = body.monthlyData[0];
      expect(point).toHaveProperty('month');
      expect(point).toHaveProperty('value');
      expect(typeof point.month).toBe('string');
      expect(typeof point.value).toBe('number');
    }
  });
});

// Generated with [Claude Code](https://claude.ai/code)
