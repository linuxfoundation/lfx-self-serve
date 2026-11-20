// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { healthMetricsAccountLogoJoinSql, healthMetricsAccountLogoSql } from './health-metrics-logo.helper';

describe('healthMetricsAccountLogoJoinSql', () => {
  it('left-joins the account logo mapping on the given account id', () => {
    expect(healthMetricsAccountLogoJoinSql('logos', 'page.account_id')).toBe(
      'LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ACCOUNT_TO_CDEV_ORG_MAPPING logos ON logos.account_id = page.account_id'
    );
  });
});

describe('healthMetricsAccountLogoSql', () => {
  it('reads a blank logo as NULL', () => {
    expect(healthMetricsAccountLogoSql('logos')).toBe("NULLIF(TRIM(logos.logo_url), '')");
  });

  it("falls back to the view's own logo", () => {
    expect(healthMetricsAccountLogoSql('logos', 'page.logo_url')).toBe("COALESCE(NULLIF(TRIM(logos.logo_url), ''), NULLIF(TRIM(page.logo_url), ''))");
  });
});
