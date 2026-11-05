// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_REPORT_ASSET_LABELS, BRAND_KIT_SOURCES_EMPTY_LINES, BRAND_KIT_SOURCES_GROUP_TITLES } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openBrandKitSources } from './helpers/mktg-os-brand-kit-sources.helper';

const ACCEPTED_MARKER = 'Accepted when v1 was approved';
// One literal per group, exactly as the agent's fixture writes it: the view never rewrites a reason.
const FAILED_REASON = 'This page does not exist on the site (the server answered 404).';
const STACKED_FIX =
  'Fix: Upload the stacked file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on aaif.io/brand is likely too large to send.';
const CONFLICT_WARNING = "Coral is #FF702D on the brand page but the site's stylesheet also uses #FF7D2D; the kit keeps #FF702D.";
const KEPT_CORAL = 'kept #FF702D';
const FAILED_DETAIL = 'HTTP 404';

test.describe('Brand kit Sources tab: the report in the agent’s words', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));

  test('a v2 report shows its failed sources, missing assets, warnings and colour conflicts as the agent wrote them', async ({ page }, info) => {
    const { report } = await openBrandKitSources(page);
    const findings = report.findings;
    if (!findings || !report.color_conflicts) throw new Error('The v2 fixture lost its findings');
    const panel = page.getByTestId('brand-kit-web-view-panel-sources');
    for (const title of Object.values(BRAND_KIT_SOURCES_GROUP_TITLES)) await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();

    const failed = page.getByTestId('brand-kit-web-view-sources-failed');
    await expect(failed.getByTestId('brand-kit-web-view-failed-item')).toHaveCount(findings.sources_failed.length);
    const firstFailed = failed.getByTestId('brand-kit-web-view-failed-item').first();
    await expect(firstFailed).toContainText(findings.sources_failed[0].source);
    await expect(firstFailed.getByTestId('brand-kit-web-view-failed-reason')).toHaveText(FAILED_REASON);
    await expect(firstFailed.getByTestId('brand-kit-web-view-failed-detail')).toHaveText(FAILED_DETAIL);

    const missing = page.getByTestId('brand-kit-web-view-missing-assets');
    const missingItems = missing.getByTestId('brand-kit-web-view-missing-item');
    await expect(missingItems).toHaveCount(findings.missing_assets.length);
    for (const [index, asset] of findings.missing_assets.entries()) {
      await expect(missingItems.nth(index)).toContainText(BRAND_KIT_REPORT_ASSET_LABELS[asset.asset]);
      await expect(missingItems.nth(index).getByTestId('brand-kit-web-view-missing-reason')).toHaveText(asset.reason);
      if (asset.fix) await expect(missingItems.nth(index).getByTestId('brand-kit-web-view-missing-fix')).toHaveText(`Fix: ${asset.fix}`);
    }
    await expect(missingItems.nth(1).getByTestId('brand-kit-web-view-missing-fix')).toHaveText(STACKED_FIX);

    const warnings = page.getByTestId('brand-kit-web-view-warnings');
    const warningItems = warnings.getByTestId('brand-kit-web-view-warning-item');
    await expect(warningItems).toHaveCount(findings.warnings.length);
    for (const [index, warning] of findings.warnings.entries()) await expect(warningItems.nth(index)).toContainText(warning.text);
    await expect(warningItems.first().getByTestId('brand-kit-web-view-warning-text')).toHaveText(CONFLICT_WARNING);
    // The links, in the report's order: one per warning that names an http(s) source.
    const links = warnings.getByTestId('brand-kit-web-view-warning-source-link');
    const expectedHrefs = findings.warnings.map((warning) => warning.source).filter((source): source is string => /^https?:\/\//.test(source ?? ''));
    await expect(links).toHaveCount(expectedHrefs.length);
    expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).toEqual(expectedHrefs);

    const conflicts = page.getByTestId('brand-kit-web-view-color-conflicts');
    const conflictItems = conflicts.getByTestId('brand-kit-web-view-conflict-item');
    await expect(conflictItems).toHaveCount(report.color_conflicts.length);
    for (const [index, conflict] of report.color_conflicts.entries()) {
      await expect(conflictItems.nth(index)).toContainText(conflict.name);
      await expect(conflictItems.nth(index).getByTestId('brand-kit-web-view-conflict-value')).toHaveCount(conflict.values.length);
      for (const value of conflict.values)
        await expect(conflictItems.nth(index).getByTestId(`brand-kit-web-view-swatch-${value.hex.slice(1)}`)).toHaveText(value.hex);
      await expect(conflictItems.nth(index)).toContainText(`kept ${conflict.chosen}`);
    }
    await expect(conflictItems.first().getByTestId('brand-kit-web-view-conflict-kept')).toHaveText(KEPT_CORAL);

    await expect(panel).not.toContainText('lf-reference');
    await expect(page.getByTestId('brand-kit-web-view-accepted')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('sources-v2.png'), fullPage: true });
  });

  test('a v1 report shows its legacy failed list under Failed sources and the empty line in each other group', async ({ page }, info) => {
    const { report } = await openBrandKitSources(page, { report: 'v1' });
    const failed = page.getByTestId('brand-kit-web-view-sources-failed');
    await expect(failed.getByTestId('brand-kit-web-view-failed-item')).toHaveCount(report.sources_failed.length);
    await expect(failed).toContainText(report.sources_failed[0].name);
    await expect(failed).toContainText(report.sources_failed[0].reason);
    await expect(page.getByTestId('brand-kit-web-view-missing-assets-empty')).toHaveText(BRAND_KIT_SOURCES_EMPTY_LINES.missing);
    await expect(page.getByTestId('brand-kit-web-view-warnings-empty')).toHaveText(BRAND_KIT_SOURCES_EMPTY_LINES.warnings);
    await expect(page.getByTestId('brand-kit-web-view-color-conflicts-empty')).toHaveText(BRAND_KIT_SOURCES_EMPTY_LINES.conflicts);
    await expect(page.getByTestId('brand-kit-web-view-accepted')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('sources-v1.png'), fullPage: true });
  });

  test('approving marks every listed item as accepted at that approval', async ({ page }, info) => {
    const { accepted, approve } = await openBrandKitSources(page);
    await expect(page.getByTestId('brand-kit-web-view-accepted')).toHaveCount(0);
    await approve();
    const markers = page.getByTestId('brand-kit-web-view-accepted');
    const listed =
      accepted.sources_failed.length + accepted.missing_assets.length + accepted.warnings.length + accepted.color_conflicts.length + accepted.gaps.length;
    await expect(markers).toHaveCount(listed);
    await expect(markers.first()).toHaveText(ACCEPTED_MARKER);
    await expect(page.getByTestId('brand-kit-web-view-gaps').getByTestId('brand-kit-web-view-accepted')).toHaveCount(accepted.gaps.length);
    // The per-item markers stand in for the derived line.
    await expect(page.getByTestId('brand-kit-web-view-gaps-accepted')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('sources-accepted.png'), fullPage: true });
  });

  test('an approval made before the snapshot existed keeps the derived gaps line and marks nothing', async ({ page }, info) => {
    await openBrandKitSources(page, { approval: 'legacy' });
    await expect(page.getByTestId('brand-kit-web-view-gaps-accepted')).toHaveText('Accepted when v1 was approved; still open.');
    await expect(page.getByTestId('brand-kit-web-view-accepted')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('sources-legacy-approval.png'), fullPage: true });
  });
});
