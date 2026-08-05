// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { test, expect, Page } from '@playwright/test';

import type { TrainingCertificationSummaryResponse } from '@lfx-one/shared/interfaces';

/**
 * Marketing Dashboard E2E Tests
 *
 * Tests the Executive Director marketing overview section including:
 * - North Star metric cards (Events, Members, Adoption, Email, Paid Media, Attribution)
 * - Brand metric cards (Social, Web, Sentiment) and the Education card
 * - Drill-down drawers for each metric
 * - Carousel navigation and filter pills
 *
 * Two layers of coverage, deliberately kept separate:
 * - Live-data suites hit the real API and assert invariants that hold under any data
 *   shape. They catch integration breakage — contract changes, serialization bugs.
 * - Fixture-driven suites stub the endpoint to force a specific branch. They catch
 *   rendering regressions in cases live data does not reach (see the Education
 *   fixture-driven block for the untracked-revenue and concentration-risk branches).
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

  // Wait for the dashboard to re-render with the ED evolution section
  await page.waitForSelector('[data-testid="ed-evolution-section"]', { timeout: DATA_LOAD_TIMEOUT });
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

/**
 * Open a drawer and wait for its data to load (loading skeleton cleared).
 * dataTestId is the element behind the drawer's loading gate (typically `*-drawer-stats`).
 */
async function openDrawerAndWaitForData(page: Page, cardTestId: string, drawerContentTestId: string, dataTestId: string): Promise<void> {
  await openDrawer(page, cardTestId, drawerContentTestId);
  await expect(page.locator(`[data-testid="${dataTestId}"]`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.describe('Marketing Overview Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('renders the marketing overview section with title', async ({ page }) => {
    const section = page.locator('[data-testid="ed-evolution-section"]');
    await expect(section).toBeVisible();

    const heading = section.locator('h2');
    await expect(heading).toContainText('Marketing Overview');

    const subtitle = section.locator('p');
    await expect(subtitle).toContainText('North Star KPIs');
  });

  test('renders Foundation Health before Marketing Overview', async ({ page }) => {
    const healthSection = page.locator('[data-testid="foundation-health-section"]');
    const edSection = page.locator('[data-testid="ed-evolution-section"]');

    // Both sections should be visible
    await expect(healthSection).toBeVisible();
    await expect(edSection).toBeVisible();

    // Foundation Health should appear before Marketing Overview in the DOM
    const healthBox = await healthSection.boundingBox();
    const edBox = await edSection.boundingBox();
    expect(healthBox!.y).toBeLessThan(edBox!.y);
  });

  test('renders carousel with navigation controls and count', async ({ page }) => {
    const carousel = page.locator('[data-testid="ed-evolution-carousel"]');
    await expect(carousel).toBeVisible();

    await expect(page.locator('[data-testid="ed-evolution-carousel-prev"]')).toBeVisible();
    await expect(page.locator('[data-testid="ed-evolution-carousel-next"]')).toBeVisible();

    const carouselCount = page.locator('[data-testid="ed-evolution-carousel-count"]');
    await expect(carouselCount).toBeVisible();
    await expect(carouselCount).toContainText(/\d+\s*\/\s*\d+/);
  });

  test('carousel scrolls when navigation buttons are clicked', async ({ page }) => {
    const carousel = page.locator('[data-testid="ed-evolution-carousel"]');
    const nextBtn = page.locator('[data-testid="ed-evolution-carousel-next"]');

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

  test('renders Email card', async ({ page }) => {
    const card = page.locator('[data-testid="ed-evo-campaign-performance"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Email');
  });

  test('renders Paid Media card', async ({ page }) => {
    const card = page.locator('[data-testid="ed-evo-paid-media"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Paid Media');
  });

  test('renders Social card', async ({ page }) => {
    const card = page.locator('[data-testid="ed-evo-brand-reach"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Social');
  });

  test('renders Web card', async ({ page }) => {
    const card = page.locator('[data-testid="ed-evo-web-sessions"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Web');
  });

  // The card is conditional on non-zero enrollments upstream, so it is asserted on
  // attachment first — it renders off-screen in the carousel until scrolled to. TLF
  // always reports training activity, so an absent card is a real regression here.
  test('renders Education card', async ({ page }) => {
    const card = page.locator('[data-testid="ed-evo-education"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Education');
  });

  test('renders filter pills', async ({ page }) => {
    const filters = page.locator('[data-testid="ed-evolution-filters"]');
    await expect(filters).toBeVisible();
  });
});

/**
 * Stub the training-certification endpoint so a test can exercise a specific data
 * shape instead of whatever TLF currently returns. Must be called before `page.goto`:
 * the Education card is built during SSR, so a route registered after navigation
 * would only affect subsequent client-side fetches and leave the card on live data.
 */
async function stubEducationSummary(page: Page, summary: TrainingCertificationSummaryResponse): Promise<void> {
  await page.route('**/api/analytics/training-certification-summary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) })
  );
}

/** Baseline fixture: every format active, revenue measured, no single format dominant. */
const EDUCATION_BALANCED: TrainingCertificationSummaryResponse = {
  projectId: 'tlf-test-project',
  range: 'YTD',
  enrollment: { instructorLed: 300, eLearning: 300, certExams: 250, edx: 150 },
  revenue: { instructorLed: 120_000, eLearning: 60_000, certExams: 45_000 },
};

/**
 * All-edX fixture: enrollments exist (so the card renders) but every revenue-bearing
 * format is empty, making net revenue genuinely untracked rather than zero. This is
 * the branch the card/drawer contradiction lived in and that live TLF data never hits.
 */
const EDUCATION_ALL_EDX: TrainingCertificationSummaryResponse = {
  projectId: 'tlf-test-project',
  range: 'YTD',
  enrollment: { instructorLed: 0, eLearning: 0, certExams: 0, edx: 900 },
  revenue: { instructorLed: 0, eLearning: 0, certExams: 0 },
};

/**
 * Measured-zero fixture: instructor-led enrollments exist but earned $0. Distinct from
 * the all-edX case above — here revenue IS tracked and happens to be zero, so both card
 * and drawer must render `$0` rather than the untracked em dash.
 */
const EDUCATION_MEASURED_ZERO: TrainingCertificationSummaryResponse = {
  projectId: 'tlf-test-project',
  range: 'YTD',
  enrollment: { instructorLed: 120, eLearning: 40, certExams: 20, edx: 60 },
  revenue: { instructorLed: 0, eLearning: 0, certExams: 0 },
};

/**
 * Concentration-risk fixture: one format above the 70% threshold with zero cert exams,
 * which drives both the "Diversify education formats" and "No certification exam
 * activity" actions into Needs Your Attention deterministically.
 */
const EDUCATION_CONCENTRATED: TrainingCertificationSummaryResponse = {
  projectId: 'tlf-test-project',
  range: 'YTD',
  enrollment: { instructorLed: 900, eLearning: 50, certExams: 0, edx: 50 },
  revenue: { instructorLed: 250_000, eLearning: 5_000, certExams: 0 },
};

test.describe('Education Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'ed-evo-education', 'education-drawer-content');
    await expect(page.locator('[data-testid="education-drawer-title"]')).toContainText('Education');
  });

  test('shows stats section with data', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-stats');
    const statCards = page.locator('[data-testid="education-drawer-stats"]').locator('lfx-card');
    await expect(statCards).toHaveCount(3);
  });

  test('shows format breakdown section', async ({ page }) => {
    await openDrawer(page, 'ed-evo-education', 'education-drawer-content');
    await expect(page.locator('[data-testid="education-drawer-formats"]')).toBeVisible();
  });

  // Guards the null-vs-zero distinction: edX revenue is hardcoded null (COURSE_PURCHASES
  // carries no revenue column) and must render "not tracked", while every other format
  // has measured revenue and renders a currency figure — $0 included. A refactor that
  // coalesced null to 0 would silently report edX as having earned nothing.
  test('distinguishes untracked revenue from a measured zero', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-formats');

    const edxRow = page.locator('[data-testid="education-drawer-format-row"]', { hasText: 'edX' });
    await expect(edxRow).toContainText('not tracked');
    await expect(edxRow).not.toContainText('$');

    // Instructor Led revenue is measured, so it must show a currency value rather than
    // the untracked placeholder — $0 is a legitimate reading here.
    const instructorLedRow = page.locator('[data-testid="education-drawer-format-row"]', { hasText: 'Instructor Led' });
    await expect(instructorLedRow).toContainText('$');
    await expect(instructorLedRow).not.toContainText('not tracked');
  });

  // The Net Revenue stat card is gated by `hasTrackedRevenue`, a separate signal from
  // the per-row null check above, and the card subtitle is gated by an equivalent
  // boolean in buildEdEvolutionMetrics. Live TLF data is not all-edX, so rather than
  // asserting one branch this asserts the invariant that must hold under either data
  // shape: the card and the drawer it opens never disagree about whether revenue is
  // tracked. That is the contradiction that regressed — the card read "$0.00 net
  // revenue" while the drawer showed an em dash for the same figure.
  test('card and drawer agree on whether revenue is tracked', async ({ page }) => {
    const card = page.locator('[data-testid="ed-evo-education"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    const cardSaysUntracked = (await card.textContent())?.includes('net revenue not tracked') ?? false;

    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-stats');
    const netRevenueStat = page.locator('[data-testid="education-drawer-stats"] > *', { hasText: 'Net Revenue' });
    const drawerSaysUntracked = (await netRevenueStat.textContent())?.includes('—') ?? false;

    expect(drawerSaysUntracked).toBe(cardSaysUntracked);

    // And whichever way they agree, the rendering is the expected one on both sides.
    if (cardSaysUntracked) {
      await expect(netRevenueStat).not.toContainText('$');
    } else {
      await expect(card).toContainText('net revenue');
      await expect(netRevenueStat).toContainText('$');
    }
  });

  // The attention/performing sections are driven by computed thresholds (concentration
  // risk >70%, cert attach rate, balanced-portfolio) and routed by splitByPriority.
  // TLF's live mix decides which of the two renders, so assert the invariant that holds
  // either way: at least one section renders, and whichever renders carries content.
  test('renders a priority-routed insight section', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-formats');

    const attention = page.locator('[data-testid="education-drawer-attention"]');
    const performing = page.locator('[data-testid="education-drawer-performing"]');
    const facts = page.locator('[data-testid="education-drawer-facts"]');

    const sectionCount = (await attention.count()) + (await performing.count()) + (await facts.count());
    expect(sectionCount).toBeGreaterThan(0);

    // Whichever sections rendered must be non-empty — an empty shell means the
    // computed logic produced a section with nothing routed into it.
    for (const section of [attention, performing, facts]) {
      if ((await section.count()) > 0) {
        await expect(section.first()).not.toBeEmpty();
      }
    }
  });

  // Guards the specific regression Copilot caught in an earlier round: the leading and
  // highest-earning formats were `info` insights, and splitByPriority routes every
  // non-warning insight into "Performing Well" — so the same format was praised there
  // while being flagged as a concentration risk under "Needs Your Attention". They now
  // render as neutral facts carrying no verdict. Asserting the contradiction is absent
  // works against any data shape, where asserting a specific threshold outcome would
  // need an all-edX or concentration-risk fixture that live TLF data does not provide.
  test('never flags and praises the same education format', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-formats');

    const attention = page.locator('[data-testid="education-drawer-attention"]');
    const performing = page.locator('[data-testid="education-drawer-performing"]');
    if ((await attention.count()) === 0 || (await performing.count()) === 0) {
      test.skip(true, 'Needs both sections rendered; TLF live mix produced only one.');
    }

    const attentionText = (await attention.first().textContent()) ?? '';
    const performingText = (await performing.first().textContent()) ?? '';
    for (const format of ['Instructor Led', 'eLearning', 'Cert Exams', 'edX']) {
      const flagged = attentionText.includes(format);
      const praised = performingText.includes(format);
      expect(flagged && praised, `"${format}" appears in both Needs Your Attention and Performing Well`).toBe(false);
    }
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'ed-evo-education', 'education-drawer-content');
    await page.locator('[data-testid="education-drawer-close"]').click();
    await expect(page.locator('[data-testid="education-drawer-content"]')).not.toBeVisible();
  });
});

/**
 * Education branches that live TLF data does not reach.
 *
 * The suite above asserts invariants against whatever the API currently returns, which
 * catches real integration breakage but leaves the interesting branches unexercised:
 * TLF has revenue-bearing enrollments, so the untracked-revenue path never runs, and its
 * format mix decides on its own whether the concentration-risk action fires. A rendering
 * regression in either branch would pass unnoticed. These tests pin the response instead,
 * so each branch fails deterministically when it breaks.
 */
test.describe('Education Drawer — fixture-driven branches', () => {
  test('renders a measured $0 as $0 on both card and drawer', async ({ page }) => {
    await stubEducationSummary(page, EDUCATION_MEASURED_ZERO);
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);

    // Revenue is tracked (instructor-led enrollments exist) and happens to be zero, so
    // the card must state the figure rather than fall back to the untracked wording.
    const card = page.locator('[data-testid="ed-evo-education"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('$0');
    await expect(card).not.toContainText('net revenue not tracked');

    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-stats');
    const netRevenueStat = page.locator('[data-testid="education-drawer-stats"] > *', { hasText: 'Net Revenue' });
    await expect(netRevenueStat).toContainText('$0');
    await expect(netRevenueStat).not.toContainText('—');
  });

  test('renders untracked revenue as a dash on both card and drawer', async ({ page }) => {
    await stubEducationSummary(page, EDUCATION_ALL_EDX);
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);

    // edX carries enrollments but no revenue column, so net revenue is untracked rather
    // than zero. This is the case where the card previously read "$0.00 net revenue"
    // while the drawer showed an em dash for the same figure.
    const card = page.locator('[data-testid="ed-evo-education"]');
    await expect(card).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('net revenue not tracked');
    await expect(card).not.toContainText('$0');

    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-stats');
    const netRevenueStat = page.locator('[data-testid="education-drawer-stats"] > *', { hasText: 'Net Revenue' });
    await expect(netRevenueStat).toContainText('—');
    await expect(netRevenueStat).not.toContainText('$');
  });

  test('routes a dominant format into Needs Your Attention only', async ({ page }) => {
    await stubEducationSummary(page, EDUCATION_CONCENTRATED);
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-formats');

    // 900 of 1000 enrollments clears the >70% concentration threshold, and zero cert
    // exams triggers the credential-gap action — both are high priority.
    const attention = page.locator('[data-testid="education-drawer-attention"]');
    await expect(attention).toBeVisible();
    await expect(attention).toContainText('Diversify education formats');
    await expect(attention).toContainText('No certification exam activity');

    // The same dominant format must not also be praised. It is reported as a neutral
    // fact instead, which is the fix for the earlier flag-and-praise contradiction.
    await expect(page.locator('[data-testid="education-drawer-facts"]')).toContainText('Instructor Led leads');
    const performing = page.locator('[data-testid="education-drawer-performing"]');
    if ((await performing.count()) > 0) {
      await expect(performing).not.toContainText('Instructor Led');
    }
  });

  test('routes a balanced mix into Performing Well without a concentration flag', async ({ page }) => {
    await stubEducationSummary(page, EDUCATION_BALANCED);
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-formats');

    // Four active formats, none above 50%, so the balanced-portfolio insight fires and
    // the concentration-risk action must not.
    const performing = page.locator('[data-testid="education-drawer-performing"]');
    await expect(performing).toBeVisible();
    await expect(performing).toContainText('Balanced format mix');

    const attention = page.locator('[data-testid="education-drawer-attention"]');
    if ((await attention.count()) > 0) {
      await expect(attention).not.toContainText('Diversify education formats');
    }
  });

  test('keeps edX untracked while other formats show measured revenue', async ({ page }) => {
    await stubEducationSummary(page, EDUCATION_BALANCED);
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
    await openDrawerAndWaitForData(page, 'ed-evo-education', 'education-drawer-content', 'education-drawer-formats');

    // Four rows, one per format — a regression that dropped or merged rows would pass
    // a mere visibility assertion on the container.
    await expect(page.locator('[data-testid="education-drawer-format-row"]')).toHaveCount(4);

    const edxRow = page.locator('[data-testid="education-drawer-format-row"]', { hasText: 'edX' });
    await expect(edxRow).toContainText('not tracked');
    await expect(edxRow).not.toContainText('$');

    const instructorLedRow = page.locator('[data-testid="education-drawer-format-row"]', { hasText: 'Instructor Led' });
    await expect(instructorLedRow).toContainText('$120,000');
    await expect(instructorLedRow).not.toContainText('not tracked');
  });
});

test.describe('Website Visits Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'ed-evo-web-sessions', 'website-visits-drawer-content');
    await expect(page.locator('[data-testid="website-visits-drawer-title"]')).toContainText('Website Visits');
  });

  test('shows stats section with data', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-web-sessions', 'website-visits-drawer-content', 'website-visits-drawer-stats');
    const statCards = page.locator('[data-testid="website-visits-drawer-stats"]').locator('lfx-card');
    await expect(statCards).toHaveCount(2);
  });

  test('shows trend chart section', async ({ page }) => {
    await openDrawer(page, 'ed-evo-web-sessions', 'website-visits-drawer-content');
    await expect(page.locator('[data-testid="website-visits-drawer-trend-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'ed-evo-web-sessions', 'website-visits-drawer-content');
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
    await openDrawer(page, 'ed-evo-campaign-performance', 'email-ctr-drawer-content');
    await expect(page.locator('[data-testid="email-ctr-drawer-title"]')).toContainText('Email');
  });

  test('shows stats and email sections', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-campaign-performance', 'email-ctr-drawer-content', 'email-ctr-drawer-stats');
    await expect(page.locator('[data-testid="email-ctr-drawer-email-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'ed-evo-campaign-performance', 'email-ctr-drawer-content');
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
    await openDrawer(page, 'ed-evo-paid-media', 'paid-social-reach-drawer-content');
    await expect(page.locator('[data-testid="paid-social-reach-drawer-title"]')).toContainText('Paid Media');
  });

  test('shows ROAS and impressions charts', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'ed-evo-paid-media', 'paid-social-reach-drawer-content', 'paid-social-reach-drawer-stats');
    await expect(page.locator('[data-testid="paid-social-reach-drawer-roas-chart-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="paid-social-reach-drawer-chart-section"]')).toBeVisible();
  });

  test('closes when close button is clicked', async ({ page }) => {
    await openDrawer(page, 'ed-evo-paid-media', 'paid-social-reach-drawer-content');
    await page.locator('[data-testid="paid-social-reach-drawer-close"]').click();
    await expect(page.locator('[data-testid="paid-social-reach-drawer-content"]')).not.toBeVisible();
  });
});

test.describe('Member Growth Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await switchToExecutiveDirector(page);
  });

  test('opens and shows title when card is clicked', async ({ page }) => {
    await openDrawer(page, 'flywheel-pulse-member-growth', 'member-acquisition-drawer-content');
    await expect(page.locator('[data-testid="member-acquisition-drawer-title"]')).toContainText('Members');
  });

  test('shows stats section', async ({ page }) => {
    await openDrawerAndWaitForData(page, 'flywheel-pulse-member-growth', 'member-acquisition-drawer-content', 'member-acquisition-drawer-stats');
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
    expect(breakdown).toHaveProperty('webVisitors');
    expect(breakdown).toHaveProperty('codeContributors');
    expect(breakdown).toHaveProperty('trainingEnrollees');
    expect(typeof breakdown.newsletterSubscribers).toBe('number');
    expect(typeof breakdown.communityMembers).toBe('number');
    expect(typeof breakdown.workingGroupMembers).toBe('number');
    expect(typeof breakdown.certifiedIndividuals).toBe('number');
    expect(typeof breakdown.webVisitors).toBe('number');
    expect(typeof breakdown.codeContributors).toBe('number');
    expect(typeof breakdown.trainingEnrollees).toBe('number');

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
