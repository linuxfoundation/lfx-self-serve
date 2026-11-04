// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_REPORT_ASSET_LABELS, BRAND_KIT_SOURCES_EMPTY_LINES, BRAND_KIT_SOURCES_GROUP_TITLES } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openBrandKitSources } from './helpers/mktg-os-brand-kit-sources.helper';

const ACCEPTED_MARKER = 'Accepted when v1 was approved';

test.describe('Brand kit Sources tab: the report in the agent’s words', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));

  test('a v2 report shows its failed sources, missing assets, warnings and colour conflicts as the agent wrote them', async ({ page }, info) => {
    const { report } = await openBrandKitSources(page);
    const findings = report.findings;
    if (!findings || !report.color_conflicts) throw new Error('The v2 fixture lost its findings');
    const panel = page.getByTestId('brand-kit-web-view-panel-sources');
    for (const title of Object.values(BRAND_KIT_SOURCES_GROUP_TITLES)) await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();

    const failed = page.getByTestId('brand-kit-web-view-sources-failed');
    await expect(failed.locator('li')).toHaveCount(findings.sources_failed.length);
    await expect(failed).toContainText(findings.sources_failed[0].source);
    await expect(failed).toContainText(findings.sources_failed[0].reason);
    await expect(failed).toContainText(findings.sources_failed[0].detail ?? 'fixture');

    const missing = page.getByTestId('brand-kit-web-view-missing-assets');
    await expect(missing.locator(':scope > li')).toHaveCount(findings.missing_assets.length);
    for (const asset of findings.missing_assets) {
      await expect(missing).toContainText(BRAND_KIT_REPORT_ASSET_LABELS[asset.asset]);
      await expect(missing).toContainText(asset.reason);
      if (asset.fix) await expect(missing).toContainText(`Fix: ${asset.fix}`);
    }

    const warnings = page.getByTestId('brand-kit-web-view-warnings');
    await expect(warnings.locator(':scope > li')).toHaveCount(findings.warnings.length);
    for (const warning of findings.warnings) {
      await expect(warnings).toContainText(warning.text);
      if (warning.source) await expect(warnings.getByRole('link', { name: new RegExp(warning.source) })).toHaveAttribute('href', warning.source);
    }

    const conflicts = page.getByTestId('brand-kit-web-view-color-conflicts');
    await expect(conflicts.locator(':scope > li')).toHaveCount(report.color_conflicts.length);
    for (const conflict of report.color_conflicts) {
      await expect(conflicts).toContainText(conflict.name);
      for (const value of conflict.values) await expect(conflicts).toContainText(value.hex);
      await expect(conflicts).toContainText(`kept ${conflict.chosen}`);
    }
    await expect(conflicts.locator('div[style]')).toHaveCount(report.color_conflicts.reduce((count, conflict) => count + conflict.values.length, 0));

    await expect(panel).not.toContainText('lf-reference');
    await expect(page.getByTestId('brand-kit-web-view-accepted')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('sources-v2.png'), fullPage: true });
  });

  test('a v1 report shows its legacy failed list under Failed sources and the empty line in each other group', async ({ page }, info) => {
    const { report } = await openBrandKitSources(page, { report: 'v1' });
    const failed = page.getByTestId('brand-kit-web-view-sources-failed');
    await expect(failed.locator('li')).toHaveCount(report.sources_failed.length);
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
