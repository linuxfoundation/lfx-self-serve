// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_LFX_ONE_PLATINUM_SCHEMA } from '@lfx-one/shared/constants';

/**
 * Guards `LFX_ONE_PLATINUM_SCHEMA` before it's interpolated into a SQL identifier: only
 * `WORD(.WORD){1,2}`-shaped values pass, everything else (including anything with a stray quote,
 * space, or SQL keyword) is rejected in favor of the default schema.
 */
function snowflakeQualifier(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^[A-Z0-9_]+(\.[A-Z0-9_]+){1,2}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

/**
 * Resolves the `ANALYTICS.PLATINUM_LFX_ONE`-style schema every dbt-backed Snowflake read in this
 * app is qualified with, env-overridable via `LFX_ONE_PLATINUM_SCHEMA`.
 *
 * TODO(LFXV2-1705 follow-up): `org-lens-meetings.service.ts`, `org-lens-project-detail.service.ts`,
 * and `org-lens-projects.service.ts` each still carry a byte-identical private copy of this
 * qualifier/resolver pair predating this helper. Migrate them here so a future regex tightening
 * doesn't silently miss three of the four call sites.
 */
export function resolveLfxOnePlatinumSchema(): string {
  return snowflakeQualifier(process.env['LFX_ONE_PLATINUM_SCHEMA']) ?? DEFAULT_LFX_ONE_PLATINUM_SCHEMA;
}
