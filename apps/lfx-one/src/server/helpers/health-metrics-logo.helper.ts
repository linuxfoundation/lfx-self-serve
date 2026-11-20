// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** One row per Salesforce account, so a left join on `account_id` adds its logo without adding rows. */
const ACCOUNT_LOGO_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ACCOUNT_TO_CDEV_ORG_MAPPING';

/**
 * A left join adding each company's mapped logo, read back with `healthMetricsAccountLogoSql(alias)`. Both arguments
 * are trusted SQL from the service, never request input.
 */
export function healthMetricsAccountLogoJoinSql(alias: string, accountIdExpression: string): string {
  return `LEFT JOIN ${ACCOUNT_LOGO_VIEW} ${alias} ON ${alias}.account_id = ${accountIdExpression}`;
}

/** The joined logo, blank as `NULL`; a view's own logo column, when it has one, is the fallback. */
export function healthMetricsAccountLogoSql(alias: string, fallbackExpression?: string): string {
  const mapped = `NULLIF(TRIM(${alias}.logo_url), '')`;
  return fallbackExpression ? `COALESCE(${mapped}, NULLIF(TRIM(${fallbackExpression}), ''))` : mapped;
}
