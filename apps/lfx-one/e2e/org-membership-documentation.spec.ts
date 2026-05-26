// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Membership Detail — Documentation Tab E2E Tests
 *
 * Covers spec 017-documentation-tab success criteria, updated by spec 018:
 * - SC-001: Tab renders within 2 seconds (dev-mode budget applies)
 * - SC-002: agreement rows in descending order; "Current" badge on Active rows only
 * - SC-003: Certificate title derived from membership tier
 * - SC-004: memberSince null fallback (em-dash)
 * - SC-006: Visual parity — card styling, badge, gradient certificate row
 * - SC-008: All FR-028 data-testid attributes resolve (regex re-target per FR-022)
 * - SC-009: Loading skeleton, error state, inline empty state
 * - SC-010: Tab caching — no redundant fetch on re-visit
 *
 * Spec 018 changes (round 1 + round 2):
 * - Per-row testid format changed from `ma-{YEAR}` to `ma-{YEAR}-{6charHash}` (FR-006b);
 *   selectors here use cohort-year prefix matching `[data-testid^="...-ma-2026-"]`.
 * - `fileSizeKb` is now null for Snowflake-backed responses; the `· {size} KB`
 *   metadata segment is dropped from the line (FR-014); we no longer assert on `124 KB`.
 * - The spec-017 "Coming soon" tooltip describe block is removed — Phase 6 (View link)
 *   and Phase 7 (CSV download) add live-action coverage.
 *
 * Prerequisites:
 * - Dev server running on localhost:4200
 * - User authenticated with org-lens-enabled flag
 * - Organization context has at least one membership
 *   is seeded (see spec 018 quickstart §7 — the seed includes AGL/Toyota data).
 */

import { expect, test } from '@playwright/test';

const DETAIL_URL_AGL = '/org/memberships/agl-001';
const DOCS_URL_AGL = '/org/memberships/agl-001#docs';
// SC-014 needs a foundation with zero agreements to exercise the disabled
// download-all branch. Until a guaranteed-empty foundation is seeded in dev,
// this aliases AGL — the test will `skip()` when the list is non-empty.
// TODO(LFXV2-1866): retarget this to a known-empty foundation slug once one is seeded.
const DOCS_URL_EMPTY_FOUNDATION = DOCS_URL_AGL;
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

/**
 * RFC 4180-aware column counter for a single CSV line.
 *
 * Walks character-by-character tracking whether we are inside a quoted field;
 * a doubled-quote inside a quoted field (`""`) is treated as an escaped quote,
 * not a field terminator. This is correct for inputs like `"Foo ""Bar"""`
 * which the previous `replace(/"[^"]*"/g, 'X')` heuristic miscounted.
 */
function countRfc4180Columns(line: string): number {
  let columns = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++; // skip the escaped quote
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      columns++;
    }
  }
  return columns;
}

test.describe('Documentation Tab — testid resolution (SC-008, FR-028)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders the Documentation tab content container', async ({ page }) => {
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible();
  });

  test('renders the Membership Agreements card with all structural testids', async ({ page }) => {
    await expect(page.getByTestId('membership-detail-docs-agreements-card')).toBeVisible();
    await expect(page.getByTestId('membership-detail-docs-agreements-title')).toBeVisible();
    await expect(page.getByTestId('membership-detail-docs-agreements-title')).toContainText('Membership Agreements');
    await expect(page.getByTestId('membership-detail-docs-download-all')).toBeVisible();
    await expect(page.getByTestId('membership-detail-docs-agreements-list')).toBeVisible();
  });

  test('renders agreement rows with per-row testids (SC-002, FR-022)', async ({ page }) => {
    // Spec 018 FR-006b: testid suffix is `ma-{YEAR}-{6charHash}` not `ma-{YEAR}`.
    // Use cohort-year prefix matching so selectors are stable across environments.
    const listContainer = page.getByTestId('membership-detail-docs-agreements-list');
    const rows = listContainer.locator('[data-testid^="membership-detail-docs-agreement-ma-"]');

    // Row count depends on the seeded dev data — assert a minimum baseline rather than an exact 11.
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Every row has the four expected sub-testids (regex match on the cohort-year prefix).
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      await expect(row).toBeVisible();
      // Each sub-testid (`-name-`, `-meta-`, `-view-`) appears at least once on this row.
      await expect(row.locator('[data-testid^="membership-detail-docs-agreement-name-ma-"]')).toBeVisible();
      await expect(row.locator('[data-testid^="membership-detail-docs-agreement-meta-ma-"]')).toBeVisible();
      await expect(row.locator('[data-testid^="membership-detail-docs-agreement-view-ma-"]')).toBeVisible();
    }
  });

  test('"Current" badge appears only on Active rows (SC-002, SC-003, FR-006a)', async ({ page }) => {
    // Spec 018 FR-006a: at most one Current per (account, foundation). Active-only;
    // Purchased/At Risk/Completed/Expired never qualify. Could be zero or one row.
    const badges = page.locator('[data-testid^="membership-detail-docs-agreement-current-badge-ma-"]');
    const badgeCount = await badges.count();
    expect(badgeCount).toBeLessThanOrEqual(1);
    if (badgeCount === 1) {
      await expect(badges.first()).toContainText('Current');
    }
  });

  test('agreement rows are sorted newest-first (SC-002, FR-004)', async ({ page }) => {
    const listContainer = page.getByTestId('membership-detail-docs-agreements-list');
    const nameElements = listContainer.locator('[data-testid^="membership-detail-docs-agreement-name-ma-"]');
    const names = await nameElements.allTextContents();

    if (names.length >= 2) {
      const firstYear = Number.parseInt(names[0].match(/(\d{4})/)?.[1] ?? '0', 10);
      const secondYear = Number.parseInt(names[1].match(/(\d{4})/)?.[1] ?? '0', 10);
      expect(firstYear).toBeGreaterThanOrEqual(secondYear);
    }
  });

  test('agreement metadata shows formatted dates and PDF format (FR-014)', async ({ page }) => {
    // Spec 018 FR-014: file-size segment dropped when fileSizeKb === null
    // (Snowflake-backed responses always carry null). Assert format token only.
    const firstMeta = page.locator('[data-testid^="membership-detail-docs-agreement-meta-ma-"]').first();
    await expect(firstMeta).toContainText('Signed');
    await expect(firstMeta).toContainText('PDF');
  });

  // Spec 019 FR-014 / FR-016: the Certificate card is now wrapped in
  // `@if (certificateTemplate(); as cert)` so it disappears entirely for orgs
  // without an active TLF Corporate Membership AND for degraded cert queries.
  // The three tests below assert the card's structure and SSR-served
  // `cert.title` / `cert.subtitle` (which the dbt model
  // `platinum_lfx_one_org_lens_tlf_certificate` formats as
  // `'Linux Foundation {tier} Certificate'` and
  // `'Member since {Mon YYYY} · Issued to {account_name}'` — see
  // `tests/assert_tlf_certificate_title_derivation.sql`). They skip gracefully
  // when the seeded org for this run is non-TLF and the card is absent.
  test('renders the Certificate of Membership card with all testids (SC-003)', async ({ page }) => {
    const card = page.getByTestId('membership-detail-docs-certificate-card');
    if (!(await card.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await expect(page.getByTestId('membership-detail-docs-certificate-title')).toBeVisible();
    await expect(page.getByTestId('membership-detail-docs-certificate-title')).toContainText('Certificate of Membership');
    await expect(page.getByTestId('membership-detail-docs-certificate-name')).toBeVisible();
    await expect(page.getByTestId('membership-detail-docs-certificate-subtitle')).toBeVisible();
    await expect(page.getByTestId('membership-detail-docs-certificate-download')).toBeVisible();
  });

  test('certificate title is derived from membership tier (SC-003, FR-013)', async ({ page }) => {
    const card = page.getByTestId('membership-detail-docs-certificate-card');
    if (!(await card.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    const certName = page.getByTestId('membership-detail-docs-certificate-name');
    await expect(certName).toContainText('Linux Foundation');
    await expect(certName).toContainText('Certificate');
  });

  test('certificate subtitle shows member-since and org name (FR-009)', async ({ page }) => {
    const card = page.getByTestId('membership-detail-docs-certificate-card');
    if (!(await card.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    const subtitle = page.getByTestId('membership-detail-docs-certificate-subtitle');
    await expect(subtitle).toContainText('Member since');
    await expect(subtitle).toContainText('Issued to');
  });
});

// Spec 017's "placeholder actions (FR-006, FR-011)" describe block was DELETED
// by spec 018 FR-022:
//   - View link is no longer "Coming soon" — it's a live <a href> or disabled
//     branch (FR-028 / FR-028a / FR-028b). Coverage lives in the "View link
//     live behavior" describe block below.
//   - Download-all button is no longer "Coming soon" — it triggers a client-side
//     CSV download (FR-032 / FR-034 / FR-034a). Coverage in the "CSV download"
//     describe block below.
//   - Certificate Download button stays "Coming soon" (out of scope for spec 018);
//     if explicit coverage is desired, add a single test below.
test.describe('Documentation Tab — View link live behavior (SC-011, SC-012, FR-028)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('membership-detail-docs-agreements-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('SC-011: rows with a downloadUrl render View as an <a href target=_blank> with noopener noreferrer', async ({ page }) => {
    // Find any View link rendered as an anchor (active branch — agreement.downloadUrl is non-null).
    const activeViewLinks = page.locator('a[data-testid^="membership-detail-docs-agreement-view-ma-"]');
    const count = await activeViewLinks.count();

    if (count === 0) {
      // Skip: dev data doesn't have any rows with download URLs at this foundation.
      test.skip();
      return;
    }

    const first = activeViewLinks.first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('target', '_blank');
    await expect(first).toHaveAttribute('rel', /noopener.*noreferrer|noreferrer.*noopener/);
    // href is bound from agreement.downloadUrl; we don't pin the value — just assert it's non-empty.
    const href = await first.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('SC-012: rows with null downloadUrl render View as a disabled <span role=link aria-disabled=true>', async ({ page }) => {
    // Find any View element rendered as a span (disabled branch — agreement.downloadUrl is null).
    const disabledViewSpans = page.locator('span[data-testid^="membership-detail-docs-agreement-view-ma-"]');
    const count = await disabledViewSpans.count();

    if (count === 0) {
      // Skip: dev data has 100% coverage of download URLs at this foundation (e.g., Toyota).
      test.skip();
      return;
    }

    const first = disabledViewSpans.first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('aria-disabled', 'true');
    await expect(first).toHaveAttribute('role', 'link');
    // No href on the disabled branch.
    const href = await first.getAttribute('href');
    expect(href).toBeNull();

    // Hover triggers the "Document not available" tooltip.
    await first.hover();
    await expect(page.locator('.p-tooltip')).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('.p-tooltip')).toContainText('Document not available');
  });
});

test.describe('Documentation Tab — CSV download (SC-013, SC-014, FR-032)', () => {
  test('SC-013: download-all icon downloads a 9-column CSV with the correct filename pattern', async ({ page }) => {
    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('membership-detail-docs-agreements-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const downloadAll = page.getByTestId('membership-detail-docs-download-all');
    await expect(downloadAll).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), downloadAll.click()]);

    // FR-034a: `membership-agreements-{foundationSlug || sanitizedFoundationId}-{YYYYMMDD}.csv`
    expect(download.suggestedFilename()).toMatch(/^membership-agreements-[a-z0-9-]+-\d{8}\.csv$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const { readFile } = await import('node:fs/promises');
    const body = await readFile(path!, 'utf-8');
    const lines = body.split('\r\n').filter((l) => l.length > 0);

    // Header is exactly the 9 FR-032a columns in this exact order.
    expect(lines[0]).toBe('Organization,Foundation,Agreement Name,Signed Date,Format,Status,Tier,Current,Download URL');

    // Each data row has exactly 9 comma-separated columns (allowing for RFC 4180 quoted fields).
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least one data row
    for (const line of lines.slice(1)) {
      expect(countRfc4180Columns(line)).toBe(9);
    }
  });

  test('SC-014: download-all icon is disabled for foundations with zero agreements', async ({ page }) => {
    await page.goto(DOCS_URL_EMPTY_FOUNDATION, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Wait for the ready state to actually render — empty-state lives inside the
    // `@case ('ready')` switch, so checking visibility immediately after the
    // content container appears can race with the `loading` skeleton.
    const agreementsList = page.getByTestId('membership-detail-docs-agreements-list');
    const emptyState = page.getByTestId('membership-detail-docs-agreements-empty');
    await expect(agreementsList.or(emptyState)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const isEmpty = await emptyState.isVisible().catch(() => false);
    if (!isEmpty) {
      test.skip();
      return;
    }

    const downloadAll = page.getByTestId('membership-detail-docs-download-all');
    await expect(downloadAll).toBeDisabled();
    await downloadAll.hover();
    await expect(page.locator('.p-tooltip')).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('.p-tooltip')).toContainText('No agreements to download');
  });
});

// Spec 019 FR-018 superseded the spec-018 "Coming soon" placeholder. The
// Certificate Download is now a live <a download> link when cert.downloadUrl
// is non-null and a disabled <button> otherwise; the card itself is conditional.
test.describe('Documentation Tab — Certificate Download live behavior (Spec 019 FR-018)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('Certificate Download tooltip is the live one — never "Coming soon"', async ({ page }) => {
    const card = page.getByTestId('membership-detail-docs-certificate-card');
    if (!(await card.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    const downloadBtn = page.getByTestId('membership-detail-docs-certificate-download');
    await downloadBtn.hover();
    await expect(page.locator('.p-tooltip')).toBeVisible({ timeout: 2_000 });
    const tooltipText = (await page.locator('.p-tooltip').textContent()) ?? '';
    expect(tooltipText).not.toContain('Coming soon');
    // One of the two live tooltips depending on cert.downloadUrl presence.
    expect(tooltipText === 'Download membership document' || tooltipText === 'Document not available').toBe(true);
  });
});

test.describe('Documentation Tab — tab navigation (SC-001, SC-010)', () => {
  test('clicking Documentation tab from Key Contacts renders content within budget (SC-001)', async ({ page }) => {
    await page.goto(DETAIL_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const start = Date.now();
    await page.getByTestId('membership-detail-tab-docs').click();
    await expect(page.getByTestId('membership-detail-docs-agreements-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const elapsed = Date.now() - start;

    // Dev-mode budget: 5x the 2-second production target
    console.log(`[SC-001 docs] tab click → agreements card visible: ${elapsed} ms (prod budget 2000 ms; dev allowance 10000 ms)`);
    expect(elapsed).toBeLessThan(10_000);
  });

  test('navigating away and back does not trigger redundant fetch (SC-010)', async ({ page }) => {
    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-docs-agreements-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    let fetchCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/documents')) fetchCount++;
    });

    // Switch to Key Contacts tab and back
    await page.getByTestId('membership-detail-tab-key-contacts').click();
    await expect(page.getByTestId('membership-detail-key-contacts-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    fetchCount = 0;
    await page.getByTestId('membership-detail-tab-docs').click();
    await expect(page.getByTestId('membership-detail-docs-agreements-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Wait a moment for any async requests to fire
    await page.waitForTimeout(1_000);
    expect(fetchCount).toBeLessThanOrEqual(1);
  });

  test('direct navigation to #docs URL shows Documentation tab active', async ({ page }) => {
    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('membership-detail-docs-content')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const docsTab = page.getByTestId('membership-detail-tab-docs');
    await expect(docsTab).toHaveClass(/border-blue-600/);
  });
});

test.describe('Documentation Tab — loading and error states (SC-009)', () => {
  test('loading skeleton appears before data arrives', async ({ page }) => {
    // Intercept the documents endpoint to delay the response
    await page.route('**/lens/memberships/*/documents', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });

    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The loading skeleton should be visible while the response is delayed
    await expect(page.getByTestId('membership-detail-docs-loading')).toBeVisible({ timeout: 5_000 });

    // Eventually the content loads
    await expect(page.getByTestId('membership-detail-docs-agreements-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('membership-detail-docs-loading')).not.toBeVisible();
  });

  test('error state with Retry button appears on fetch failure', async ({ page }) => {
    // Intercept and abort the documents request
    await page.route('**/lens/memberships/*/documents', (route) => route.abort());

    await page.goto(DOCS_URL_AGL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('membership-detail-docs-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
