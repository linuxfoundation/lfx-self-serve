// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_LFX_ONE_PLATINUM_SCHEMA } from '@lfx-one/shared/constants';

/**
 * Guards `LFX_ONE_PLATINUM_SCHEMA` before it's interpolated into a SQL identifier: only
 * `WORD.WORD`-shaped (exactly two segments) values pass, everything else — a stray quote, space,
 * SQL keyword, single segment, or a three-plus-segment value — is rejected in favor of the
 * default schema. Restricted to exactly two segments (not `{1,2}`) because every call site
 * appends a table name unconditionally (e.g. `committeeEngagementTable()`:
 * `` `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEETING_ATTENDANCE` ``) — a 3-segment
 * override would produce an invalid 4-part Snowflake identifier (`database.schema.object` is the
 * max), silently breaking the query for exactly the operator input this override is documented to
 * accept.
 */
function snowflakeQualifier(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^[A-Z0-9_]+\.[A-Z0-9_]+$/i.test(trimmed) ? trimmed.toUpperCase() : null;
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

/**
 * The finalized `platinum_lfx_one_committee_meeting_attendance` dbt model (LFXV2-1705, `lf-dbt#2694`)
 * — dbt's alias generation strips the `platinum_lfx_one_` schema prefix, so the materialized table
 * is `COMMITTEE_MEETING_ATTENDANCE`. Shared by `committee-engagement.service.ts` (per-committee read)
 * and `groups-engagement-stats.service.ts` (cross-committee `active_members` aggregate) — same table,
 * one place to update if it's ever renamed.
 */
export function committeeEngagementTable(): string {
  return `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEETING_ATTENDANCE`;
}

/**
 * The Octolens-sourced mentions feed behind Social Listening (LFXV2-3002), materialized hourly by
 * the `platinum_social_listening_feed` dbt model (`lf-dbt`). It lives in PCC's dbt schema —
 * `ANALYTICS.PLATINUM` — not this repo's `PLATINUM_LFX_ONE` schema, so it gets its own fully
 * qualified `database.schema.table` override (`LFX_ONE_SOCIAL_LISTENING_FEED_TABLE`) rather than
 * reusing `resolveLfxOnePlatinumSchema()`. The override is guarded to exactly three `WORD` segments
 * for the same reason as `snowflakeQualifier()`: anything else is rejected in favor of the default.
 */
export function socialListeningFeedTable(): string {
  const override = process.env['LFX_ONE_SOCIAL_LISTENING_FEED_TABLE']?.trim();
  const qualified = override && /^[A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_]+$/i.test(override) ? override.toUpperCase() : null;
  return qualified ?? 'ANALYTICS.PLATINUM.SOCIAL_LISTENING_FEED';
}
