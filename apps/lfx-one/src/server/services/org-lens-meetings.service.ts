// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_LFX_ONE_PLATINUM_SCHEMA, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgInfluenceBreakdownSegment,
  OrgInfluenceRow,
  OrgLensProjectBand,
  OrgMeetingsDeltaDirection,
  OrgMeetingsInfluenceWarehouseRow,
  OrgMeetingsKpiSummary,
  OrgMeetingsKpiWarehouseRow,
  OrgMeetingsSpendBreakdown,
  OrgMeetingsSpendOtherItem,
  OrgMeetingsSpendSegment,
  OrgMeetingsSpendWarehouseRow,
  OrgMeetingsSupportedTimeRange,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Bands the influence model emits; anything else degrades to the lowest band rather than breaking the chip. */
const INFLUENCE_BANDS: readonly OrgLensProjectBand[] = ['silent', 'participating', 'contributing', 'leading'];

/** Directions `TREND_DIRECTION` emits; verified exhaustive in prod, guarded anyway. */
const TREND_DIRECTIONS: readonly OrgMeetingsDeltaDirection[] = ['up', 'down', 'flat'];

const KPI_NO_CHANGE_LABEL = 'No change vs. prior period';
const INFLUENCE_NO_CHANGE_LABEL = 'No change';
const NEW_LABEL = 'New';

/**
 * For an influence row whose `PRIOR_YEAR_SCORE` is absent — not zero, and not small. There is no
 * percentage to render because there is no baseline to divide by. An oversized ratio is a different
 * case and renders its number.
 */
const UNKNOWN_BASELINE_LABEL = 'No comparable prior period';

/**
 * `PRIOR_YEAR_SCORE` is a continuous score, so an exact `=== 0` test would let a stored 1e-7 fall
 * through to a ratio in the millions. Anything below this counts as no prior-year influence.
 */
const INFLUENCE_ZERO_SCORE_EPSILON = 1e-6;

/** The four `BREAKDOWN_KIND` values the spend model emits; typed so a typo can't silently yield an empty card. */
type SpendBreakdownKind = 'foundation' | 'project' | 'meeting_type' | 'role';

/**
 * A formatted delta plus which branch produced it. The influence rule needs to know whether a real
 * percentage was rendered, and matching on the label text would silently change behaviour the next
 * time someone edits one of the label constants.
 */
interface FormattedDelta {
  kind: 'no-change' | 'pct';
  label: string;
  direction: OrgMeetingsDeltaDirection;
}

/**
 * Read-only Org Lens Meetings analytics over the three `ORG_LENS_MEETINGS_*` warehouse models.
 *
 * All three responses are functions of `(accountId, range)` alone — nothing varies per caller — so
 * each is served through the plain org-scoped cache with no per-user key and no post-cache merge.
 * Authorization is enforced upstream in the controller (`assertOrgLensRead`) before anything here
 * runs, so a cache hit can never bypass the gate.
 *
 * Presentation lives here rather than in the warehouse: the models carry raw counts and prior-period
 * counterparts, and this service turns them into the delta labels and rank strings the contract
 * specifies.
 */
export class OrgLensMeetingsService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  /** Four org-level counts with period-over-period deltas. A missing row is a quiet org, not an error. */
  public async getKpiSummary(req: Request, accountId: string, range: OrgMeetingsSupportedTimeRange): Promise<OrgMeetingsKpiSummary> {
    return withOrgCache(
      accountId,
      // `v2`: entries written before the delta ceiling was retired hold the old "No comparable prior
      // period" label. The shape is unchanged, so `isKpiSummary` accepts them and they would serve
      // the retired label for up to a TTL. Versioning the sub-resource key moves reads to a fresh
      // space without discarding the other Org Lens surfaces under the shared namespace.
      `meetings-kpi:v2:${range}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        // Only logged on a miss, so the absence of this line in a trace means the cache served it —
        // the first thing worth knowing when this page is slow.
        logger.debug(req, 'get_org_lens_meetings_kpi', 'Cache miss; querying Snowflake', { account_id: accountId, range });
        const sql = `
        SELECT
          EMPLOYEES_ACTIVE,
          MEETINGS_ATTENDED,
          PROJECTS_SUPPORTED,
          FOUNDATIONS_SUPPORTED,
          PRIOR_EMPLOYEES_ACTIVE,
          PRIOR_MEETINGS_ATTENDED,
          PRIOR_PROJECTS_SUPPORTED,
          PRIOR_FOUNDATIONS_SUPPORTED
        FROM ${this.kpiTable()}
        WHERE ACCOUNT_ID = ? AND TIME_RANGE_TYPE = ?
      `;
        const result = await this.snowflakeService.execute<OrgMeetingsKpiWarehouseRow>(sql, [accountId, range]);
        if (result.rows.length > 1) {
          // Grain is (account_id, time_range_type); more than one row means the model regressed.
          logger.warning(req, 'get_org_lens_meetings_kpi', 'Expected at most one KPI row for the grain', {
            account_id: accountId,
            range,
            rows: result.rows.length,
          });
        }
        return this.mapKpiSummary(result.rows.at(0) ?? null);
      },
      OrgLensMeetingsService.isKpiSummary
    );
  }

  /** Four ranked breakdowns. An absent `BREAKDOWN_KIND` yields `[]` — that absence is how the warehouse encodes DR-003 suppression. */
  public async getSpendBreakdown(req: Request, accountId: string, range: OrgMeetingsSupportedTimeRange): Promise<OrgMeetingsSpendBreakdown> {
    return withOrgCache(
      accountId,
      `meetings-spend:${range}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_meetings_spend', 'Cache miss; querying Snowflake', { account_id: accountId, range });
        const sql = `
        SELECT
          BREAKDOWN_KIND,
          LABEL,
          ATTENDANCE_COUNT,
          PCT,
          RANK,
          IS_OTHER,
          OTHER_ITEMS,
          OTHER_OVERFLOW_COUNT
        FROM ${this.spendTable()}
        WHERE ACCOUNT_ID = ? AND TIME_RANGE_TYPE = ?
        ORDER BY BREAKDOWN_KIND, RANK
      `;
        const result = await this.snowflakeService.execute<OrgMeetingsSpendWarehouseRow>(sql, [accountId, range]);
        return this.mapSpendBreakdown(result.rows);
      },
      OrgLensMeetingsService.isSpendBreakdown
    );
  }

  /** One row per project the org engages with, in the requested window, that also has influence data for it. */
  public async getInfluenceRows(req: Request, accountId: string, range: OrgMeetingsSupportedTimeRange): Promise<OrgInfluenceRow[]> {
    return withOrgCache(
      accountId,
      // The range suffix partitions entries per window, and is on its own enough to keep the
      // pre-range `v3` keys from being read — `withOrgCache` does an exact GET, so a suffixed key
      // can never hit an unsuffixed entry. `v4` is deliberate signalling that the row shape gained
      // `displayedInfluence` and `rankTotalAll`, which still matters because `isInfluenceRows`
      // checks only three fields and would not reject the old shape.
      `meetings-influence:v4:${range}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_meetings_influence', 'Cache miss; querying Snowflake', { account_id: accountId, range });
        const sql = `
        SELECT
          PROJECT_SLUG,
          PROJECT_NAME,
          ECOSYSTEM_INFLUENCE,
          DISPLAYED_INFLUENCE,
          BAND,
          RANK,
          RANK_TOTAL,
          RANK_TOTAL_ALL,
          FROM_ATTENDANCE_PCT,
          DELTA_PCT,
          PRIOR_WINDOW_SCORE,
          TREND_DIRECTION,
          BREAKDOWN
        FROM ${this.influenceTable()}
        WHERE ACCOUNT_ID = ? AND TIME_RANGE_TYPE = ?
        ORDER BY ECOSYSTEM_INFLUENCE DESC, PROJECT_NAME
      `;
        const result = await this.snowflakeService.execute<OrgMeetingsInfluenceWarehouseRow>(sql, [accountId, range]);
        // A row with no slug cannot link anywhere and would collide with any other slugless row on the
        // template's track key, so it is dropped rather than rendered.
        return result.rows.filter((row) => this.toLabel(row.PROJECT_SLUG).length > 0).map((row) => this.mapInfluenceRow(row));
      },
      OrgLensMeetingsService.isInfluenceRows
    );
  }

  // ── mappers ──────────────────────────────────────────────────────────────────

  private mapKpiSummary(row: OrgMeetingsKpiWarehouseRow | null): OrgMeetingsKpiSummary {
    const employees = this.kpiDelta(row?.EMPLOYEES_ACTIVE, row?.PRIOR_EMPLOYEES_ACTIVE);
    const meetings = this.kpiDelta(row?.MEETINGS_ATTENDED, row?.PRIOR_MEETINGS_ATTENDED);
    const projects = this.kpiDelta(row?.PROJECTS_SUPPORTED, row?.PRIOR_PROJECTS_SUPPORTED);
    const foundations = this.kpiDelta(row?.FOUNDATIONS_SUPPORTED, row?.PRIOR_FOUNDATIONS_SUPPORTED);

    return {
      employeesActive: employees.value,
      employeesActiveDeltaLabel: employees.label,
      employeesActiveDeltaDirection: employees.direction,
      meetingsAttended: meetings.value,
      meetingsAttendedDeltaLabel: meetings.label,
      meetingsAttendedDeltaDirection: meetings.direction,
      projectsSupported: projects.value,
      projectsSupportedDeltaLabel: projects.label,
      projectsSupportedDeltaDirection: projects.direction,
      foundationsSupported: foundations.value,
      foundationsSupportedDeltaLabel: foundations.label,
      foundationsSupportedDeltaDirection: foundations.direction,
    };
  }

  /**
   * A zero prior period has no percentage to express, so it renders "New" rather than an infinite
   * one. Every other delta renders its percentage, however large: a thin prior period produces a
   * five-figure ratio, but that reflects ~3.5 years of attendance history rather than an error, and
   * showing it keeps the coverage gap visible. Whole percents match the counts' own granularity, and
   * a change that rounds to zero is reported as no change rather than as "+0%".
   */
  private kpiDelta(current: unknown, prior: unknown): { value: number; label: string; direction: OrgMeetingsDeltaDirection } {
    const value = this.toCount(current);
    const priorValue = this.toCount(prior);

    if (priorValue === 0) {
      return value > 0 ? { value, label: NEW_LABEL, direction: 'up' } : { value, label: KPI_NO_CHANGE_LABEL, direction: 'flat' };
    }

    const pct = Math.round(((value - priorValue) / priorValue) * 100);
    const { label, direction } = this.formatDelta(pct, '% vs. prior period', KPI_NO_CHANGE_LABEL);
    return { value, label, direction };
  }

  /** Shared tail of both delta rules: no change, or a signed percentage. */
  private formatDelta(pct: number, suffix: string, noChangeLabel: string): FormattedDelta {
    if (pct === 0) {
      return { kind: 'no-change', label: noChangeLabel, direction: 'flat' };
    }
    return { kind: 'pct', label: `${this.signed(pct)}${suffix}`, direction: pct > 0 ? 'up' : 'down' };
  }

  private mapSpendBreakdown(rows: OrgMeetingsSpendWarehouseRow[]): OrgMeetingsSpendBreakdown {
    return {
      byFoundation: this.segmentsOfKind(rows, 'foundation'),
      byProject: this.segmentsOfKind(rows, 'project'),
      byMeetingType: this.segmentsOfKind(rows, 'meeting_type'),
      byRole: this.segmentsOfKind(rows, 'role'),
    };
  }

  private segmentsOfKind(rows: OrgMeetingsSpendWarehouseRow[], kind: SpendBreakdownKind): OrgMeetingsSpendSegment[] {
    return rows.filter((row) => row.BREAKDOWN_KIND === kind).map((row) => this.mapSpendSegment(row));
  }

  private mapSpendSegment(row: OrgMeetingsSpendWarehouseRow): OrgMeetingsSpendSegment {
    const segment: OrgMeetingsSpendSegment = {
      label: this.toLabel(row.LABEL),
      pct: this.round1(row.PCT),
      count: this.toCount(row.ATTENDANCE_COUNT),
    };

    if (!row.IS_OTHER) {
      return segment;
    }

    const others = this.parseOtherItems(row.OTHER_ITEMS);
    const overflow = this.toCount(row.OTHER_OVERFLOW_COUNT);
    if (overflow > 0) {
      // The overflow entities are deliberately unnamed (past the itemization cap), so the row states
      // how many there are and carries no share of its own — `pct` is omitted rather than zeroed so
      // the popover doesn't render a misleading "0%".
      others.push({ label: `+${overflow} more` });
    }
    return { ...segment, others };
  }

  private mapInfluenceRow(row: OrgMeetingsInfluenceWarehouseRow): OrgInfluenceRow {
    const delta = this.influenceDelta(row);
    return {
      project: this.toLabel(row.PROJECT_NAME),
      projectSlug: this.toLabel(row.PROJECT_SLUG),
      ecosystemInfluence: this.round1(row.ECOSYSTEM_INFLUENCE),
      displayedInfluence: this.round1(row.DISPLAYED_INFLUENCE),
      band: this.toBand(row.BAND),
      rankLabel: this.rankLabel(row.RANK, row.RANK_TOTAL),
      rankTotalAll: this.toNullableCount(row.RANK_TOTAL_ALL),
      fromAttendancePct: this.round1(row.FROM_ATTENDANCE_PCT),
      deltaLabel: delta.label,
      deltaDirection: delta.direction,
      breakdown: this.parseBreakdown(row.BREAKDOWN),
    };
  }

  /**
   * Mirrors the KPI rule for the same degeneracy. The zero baseline has to be read from
   * `PRIOR_WINDOW_SCORE`: `TREND_DIRECTION` cannot identify it, because its `flat` value is a ±1%
   * deadband rather than equality and zero-baseline rows therefore split across `flat` and `up`.
   * The raw from-zero percentage reaches five figures in prod and is never rendered.
   */
  private influenceDelta(row: OrgMeetingsInfluenceWarehouseRow): { label: string; direction: OrgMeetingsDeltaDirection } {
    const value = this.toFiniteNumber(row.ECOSYSTEM_INFLUENCE);

    // A missing prior score is unknown, not zero. `Number(null)` is 0 and passes `isFinite`, so the
    // absent cases have to be excluded before the numeric check — otherwise a column that went away
    // would relabel every row "New", which reads as a real finding rather than a defect. The
    // direction is flat because there is no baseline to have moved from.
    const priorScoreRaw = row.PRIOR_WINDOW_SCORE === null || row.PRIOR_WINDOW_SCORE === undefined ? NaN : Number(row.PRIOR_WINDOW_SCORE);
    if (!Number.isFinite(priorScoreRaw)) {
      return { label: UNKNOWN_BASELINE_LABEL, direction: 'flat' };
    }

    if (priorScoreRaw < INFLUENCE_ZERO_SCORE_EPSILON) {
      return value > 0 ? { label: NEW_LABEL, direction: 'up' } : { label: INFLUENCE_NO_CHANGE_LABEL, direction: 'flat' };
    }

    const pct = this.round1(row.DELTA_PCT);
    const delta = this.formatDelta(pct, '%', INFLUENCE_NO_CHANGE_LABEL);
    // The direction is the warehouse's own `trend_direction` rather than the sign of `pct` (DR-011),
    // but only where an actual percentage was rendered.
    return delta.kind === 'pct'
      ? { label: delta.label, direction: this.toTrendDirection(row.TREND_DIRECTION) }
      : { label: delta.label, direction: delta.direction };
  }

  // ── cached-entry shape guards ────────────────────────────────────────────────

  // The `org-lens-sf:v1` namespace is shared by every Org Lens sub-resource, so bumping it to
  // invalidate one response shape would discard all the others — meaning in practice it never gets
  // bumped, and a DTO change leaves up to a TTL's worth of clients receiving the old shape. These
  // guards degrade a stale or corrupt entry to a cache miss instead of serving it.

  private static isKpiSummary(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const summary = value as Record<string, unknown>;
    return (['employeesActive', 'meetingsAttended', 'projectsSupported', 'foundationsSupported'] as const).every(
      (key) => typeof summary[key] === 'number' && typeof summary[`${key}DeltaLabel`] === 'string' && typeof summary[`${key}DeltaDirection`] === 'string'
    );
  }

  private static isSpendBreakdown(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const breakdown = value as Record<string, unknown>;
    return (['byFoundation', 'byProject', 'byMeetingType', 'byRole'] as const).every((key) => Array.isArray(breakdown[key]));
  }

  private static isInfluenceRows(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every((row) => {
        if (row === null || typeof row !== 'object') return false;
        const entry = row as Record<string, unknown>;
        return typeof entry['projectSlug'] === 'string' && typeof entry['ecosystemInfluence'] === 'number' && Array.isArray(entry['breakdown']);
      })
    );
  }

  // ── parsing / coercion ───────────────────────────────────────────────────────

  /** Snowflake ARRAY columns arrive either pre-parsed or as JSON text depending on driver settings; accept both. */
  private parseVariantArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Keeps only `{label, pct}` entries and drops malformed ones. This is a shape filter, not a
   * privacy boundary: it cannot tell an aggregate label from a person's name, so a warehouse that
   * started emitting person-derived labels would pass straight through. The actual guarantee is
   * upstream — the models never project `person_key`, enforced by a dbt privacy test.
   */
  private parseLabelPctArray(value: unknown): { label: string; pct: number }[] {
    return this.parseVariantArray(value).flatMap((item) => {
      if (item === null || typeof item !== 'object') return [];
      const entry = item as { label?: unknown; pct?: unknown };
      if (typeof entry.label !== 'string') return [];
      return [{ label: entry.label, pct: this.round1(entry.pct) }];
    });
  }

  private parseOtherItems(value: unknown): OrgMeetingsSpendOtherItem[] {
    return this.parseLabelPctArray(value);
  }

  private parseBreakdown(value: unknown): OrgInfluenceBreakdownSegment[] {
    return this.parseLabelPctArray(value);
  }

  /** Empty rather than "#0 of 0" when either side is missing — a blank cell beats a wrong rank. */
  private rankLabel(rank: unknown, rankTotal: unknown): string {
    const position = this.toCount(rank);
    const total = this.toCount(rankTotal);
    return position > 0 && total > 0 ? `#${position} of ${total}` : '';
  }

  /** Warehouse text columns are non-null by contract; coerced anyway so a null can't reach a slug or a track key. */
  private toLabel(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private toBand(value: unknown): OrgLensProjectBand {
    const band = typeof value === 'string' ? (value.toLowerCase() as OrgLensProjectBand) : null;
    return band && INFLUENCE_BANDS.includes(band) ? band : 'silent';
  }

  private toTrendDirection(value: unknown): OrgMeetingsDeltaDirection {
    const direction = typeof value === 'string' ? (value.toLowerCase() as OrgMeetingsDeltaDirection) : null;
    return direction && TREND_DIRECTIONS.includes(direction) ? direction : 'flat';
  }

  /**
   * Grouped because a thin prior period pushes the ratio into six figures, where "+115000" is hard to
   * size at a glance. The locale is pinned so the server renders the same string everywhere.
   */
  private signed(value: number): string {
    const formatted = Math.abs(value).toLocaleString('en-US');
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  }

  private toFiniteNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toCount(value: unknown): number {
    return Math.max(0, Math.round(this.toFiniteNumber(value)));
  }

  /**
   * Absence has to survive the boundary. `toCount` would turn a warehouse NULL into `0`, and a
   * reference population of zero rendered beside a live rank asserts that no company has influence
   * on the project — a contradiction on its face. The 1,983 projects with no reference row must
   * reach the template as `null` so it can omit the clause instead.
   */
  private toNullableCount(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }

  private round1(value: unknown): number {
    return Math.round(this.toFiniteNumber(value) * 10) / 10;
  }

  // ── warehouse locations ──────────────────────────────────────────────────────

  private snowflakeQualifier(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed && /^[A-Z0-9_]+(\.[A-Z0-9_]+){1,2}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  private lfxOnePlatinumSchema(): string {
    return this.snowflakeQualifier(process.env['LFX_ONE_PLATINUM_SCHEMA']) ?? DEFAULT_LFX_ONE_PLATINUM_SCHEMA;
  }

  private kpiTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_MEETINGS_KPI`;
  }

  private spendTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_MEETINGS_SPEND`;
  }

  private influenceTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_MEETINGS_INFLUENCE`;
  }
}
