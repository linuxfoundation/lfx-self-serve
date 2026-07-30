// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CommitteeEngagementQueryResult,
  CommitteeEngagementResponse,
  CommitteeEngagementWarehouseRow,
  CommitteeEngagementWindow,
  CommitteeMember,
} from '@lfx-one/shared/interfaces';
import { classifyCommitteeEngagement, computeCommitteeEngagementRate, isCommitteeMemberAtRisk } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Matches `YYYY-MM-DD[T ]HH:MM:SS[.sss][Z | ±HH[:]MM]` — the shapes Snowflake actually renders for
 * TIMESTAMP_NTZ (no zone) and TIMESTAMP_TZ/LTZ (space before the offset), and nothing looser. Groups:
 * date, time, a literal `Z`, offset hours, offset minutes.
 */
const TIMESTAMP_SHAPE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*(?:(Z)|([+-]\d{2}):?(\d{2}))?$/i;

/**
 * Reads the per-committee-member meeting-attendance rollup (LFXV2-1705) from the (not-yet-deployed)
 * committee-engagement warehouse model and joins it against the committee roster. Table/column
 * names are a placeholder pending the real dbt model.
 */
export class CommitteeEngagementService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly committeeService = new CommitteeService();

  /**
   * Two independent reads run in parallel — one query-service call for the roster, one Snowflake
   * call for engagement rows — and are joined in memory. No per-member Snowflake call, so this
   * stays N+1-free regardless of committee size.
   */
  public async getCommitteeEngagement(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<CommitteeEngagementResponse> {
    const [members, queryResult] = await Promise.all([
      this.committeeService.getCommitteeMembers(req, committeeUid),
      this.queryEngagementRows(req, committeeUid, window),
    ]);

    return this.buildResponse(req, committeeUid, members, queryResult);
  }

  private async queryEngagementRows(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<CommitteeEngagementQueryResult> {
    const sql = `
      SELECT MEMBER_EMAIL, ATTENDED_COUNT, INVITED_COUNT, COMPUTED_AT
      FROM ${this.engagementTable()}
      WHERE COMMITTEE_UID = ? AND TIME_RANGE_TYPE = ?
      ORDER BY MEMBER_EMAIL
    `;
    logger.debug(req, 'get_committee_engagement', 'Querying engagement rows', { committee_uid: committeeUid, window });
    try {
      const result = await this.snowflakeService.execute<CommitteeEngagementWarehouseRow>(sql, [committeeUid, window], { expectMissingObject: true });
      logger.debug(req, 'get_committee_engagement', 'Fetched engagement rows', { committee_uid: committeeUid, window, row_count: result.rows.length });
      return { rows: result.rows, dataAvailable: true };
    } catch (error) {
      // Pre-dbt-deploy the engagement table is absent; degrade to the empty response the
      // members table expects instead of 5xx per committee page load. `dataAvailable: false`
      // lets the response tell the UI this is "no data yet", not "zero engagement".
      //
      // isMissingObjectError's regex ("does not exist or not authorized") also matches a missing
      // GRANT, not just a missing table — once the model is deployed, a role/permissions
      // misconfiguration will degrade identically to the pre-deploy state. The message and
      // attached `err` below are worded to not assert which case this is; check `err` first.
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      logger.warning(req, 'get_committee_engagement', 'Engagement query hit a missing-object/not-authorized error; returning empty response', {
        committee_uid: committeeUid,
        window,
        err: error,
      });
      return { rows: [], dataAvailable: false };
    }
  }

  /**
   * Joins on email (`CommitteeMember.email` is required per `member.interface.ts`) since no shared
   * identifier between query-service and the warehouse is confirmed yet — an assumption to revisit
   * once the real dbt model's schema is known. Every roster member appears in the response even
   * without a matching warehouse row, so `total_count` always reflects the full committee.
   */
  private buildResponse(
    req: Request,
    committeeUid: string,
    members: CommitteeMember[],
    queryResult: CommitteeEngagementQueryResult
  ): CommitteeEngagementResponse {
    const { rows, dataAvailable } = queryResult;

    const rowsByEmail = new Map<string, CommitteeEngagementWarehouseRow>();
    for (const row of rows) {
      const email = this.normalizeEmail(row.MEMBER_EMAIL);
      if (email) rowsByEmail.set(email, row);
    }

    // Named "over-attended", not "clamped": this counts every deduped row where ATTENDED_COUNT
    // exceeds INVITED_COUNT, including rows with no roster match — those are dropped entirely in
    // the map below, never actually clamped. Counted over rows, not roster members, so a grain
    // mismatch affecting only former-member rows (the normal case, not an edge case — see the
    // join-mismatch warning below) isn't invisible.
    const overAttendedRowCount = [...rowsByEmail.values()].filter((row) => this.toCount(row.ATTENDED_COUNT) > this.toCount(row.INVITED_COUNT)).length;

    // Computed independently of the roster join below (a warehouse row with no roster match, or
    // an empty roster, must still surface the model's freshness timestamp) and as the latest of
    // all parseable values, not the first in `ORDER BY MEMBER_EMAIL` order — a partial refresh
    // could otherwise report an arbitrarily stale alphabetically-first row as "as of".
    const parsedTimestamps = rows.map((row) => ({ raw: row.COMPUTED_AT, iso: this.toIsoTimestamp(row.COMPUTED_AT) }));
    const computedAt = parsedTimestamps
      .map(({ iso }) => iso)
      .filter((iso): iso is string => iso !== null)
      .reduce((latest: string | null, iso) => (!latest || iso > latest ? iso : latest), null);
    // Distinct from "no COMPUTED_AT provided" (normal — the model hasn't computed anything for that
    // row yet, not a data-quality issue): this collects rows that *did* report a value but one
    // toIsoTimestamp rejected as calendar-invalid or shape-mismatched, which is worth surfacing.
    const rejectedTimestamps = parsedTimestamps.filter(({ raw, iso }) => raw !== null && raw !== undefined && iso === null);

    let totalAttended = 0;
    let totalInvited = 0;
    let activeCount = 0;
    let atRiskCount = 0;
    let matchedCount = 0;

    const memberEngagements = members.map((member) => {
      const row = rowsByEmail.get(this.normalizeEmail(member.email));
      if (row) matchedCount++;
      const invited = this.toCount(row?.INVITED_COUNT);
      // Clamped to `invited`: nothing upstream guarantees ATTENDED_COUNT <= INVITED_COUNT, and an
      // unclamped value here would produce a >100% rate and a response where `attended` exceeds
      // `invited` for the same member. Detection is logged once per request via
      // `overAttendedRowCount` above, not per member.
      const attended = Math.min(this.toCount(row?.ATTENDED_COUNT), invited);
      totalAttended += attended;
      totalInvited += invited;

      const classification = classifyCommitteeEngagement(attended, invited);
      if (classification === 'High' || classification === 'Medium') activeCount++;
      if (isCommitteeMemberAtRisk(attended, invited)) atRiskCount++;

      return { uid: member.uid, attended, invited, rate: computeCommitteeEngagementRate(attended, invited), classification };
    });

    if (rows.length > 0 && members.length > 0 && matchedCount === 0) {
      logger.warning(req, 'get_committee_engagement', 'Engagement rows returned but none matched the committee roster by email — join key mismatch?', {
        committee_uid: committeeUid,
        row_count: rows.length,
        roster_size: members.length,
      });
    }

    if (overAttendedRowCount > 0) {
      logger.warning(
        req,
        'get_committee_engagement',
        'Warehouse rows had ATTENDED_COUNT greater than INVITED_COUNT; clamped to invited where joined to the roster',
        {
          committee_uid: committeeUid,
          over_attended_row_count: overAttendedRowCount,
          // Deduped by email, like over_attended_row_count, so the two counts describe the same
          // population — the join-mismatch warning above intentionally uses the raw `rows.length`
          // instead, since it's asking a different question ("did anything match at all").
          deduped_row_count: rowsByEmail.size,
        }
      );
    }

    if (rejectedTimestamps.length > 0) {
      logger.warning(req, 'get_committee_engagement', 'Some warehouse rows had an unparseable COMPUTED_AT; excluded from the freshness timestamp', {
        committee_uid: committeeUid,
        rejected_count: rejectedTimestamps.length,
        row_count: rows.length,
        // A rejection is almost certainly a format problem (the dbt model is still unwritten, and
        // COMPUTED_AT's real column type/width are unknown), and its shape is what would identify
        // that — not its content. Logging the raw value would raise the same "don't log PII" concern
        // every free-text warehouse column does; digits/letters are redacted to '9'/'a' so the
        // structure survives (does it look like a real timestamp that failed to parse, or garbage
        // entirely?) without logging anything from the value itself. Bounded to 3 rows, 24 chars each.
        rejected_sample: rejectedTimestamps.slice(0, 3).map(({ raw }) => this.redactedShape(raw)),
      });
    }

    logger.debug(req, 'get_committee_engagement', 'Joined engagement rows to the roster', {
      committee_uid: committeeUid,
      roster_size: members.length,
      matched_count: matchedCount,
      data_available: dataAvailable,
    });

    return {
      members: memberEngagements,
      summary: {
        attendance_rate: computeCommitteeEngagementRate(totalAttended, totalInvited),
        active_count: activeCount,
        total_count: members.length,
        at_risk_count: atRiskCount,
      },
      computed_at: computedAt,
      data_available: dataAvailable,
    };
  }

  private normalizeEmail(email: string | null | undefined): string {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  /**
   * Redacts a rejected `COMPUTED_AT` value to its structural shape for logging — Unicode digits
   * become `9`, Unicode letters/marks become `a`, a fixed set of timestamp-punctuation characters
   * (`- : . + / T Z` and space) pass through, and everything else becomes `?` — so a warning reader
   * can tell "looks like a real timestamp that failed to parse" from "not a timestamp at all"
   * without any of the value's actual content ever reaching the log.
   *
   * Default-*deny*, not default-allow: an earlier version redacted only known digit/letter classes
   * and let anything else (symbols, emoji, combining marks) through unchanged, which doesn't
   * actually guarantee "no content reaches the log" — only an explicit allowlist for the characters
   * that carry real timestamp-shape signal does. Iterates by Unicode code point (`Array.from`, not
   * `.slice`/index access) so a surrogate pair isn't split into two lone, invalid surrogates.
   */
  private redactedShape(raw: unknown): string {
    const TIMESTAMP_PUNCTUATION = new Set(['-', ':', '.', '+', '/', ' ', 'T', 'Z']);
    return Array.from(String(raw))
      .slice(0, 24)
      .map((char) => {
        if (/\p{Nd}/u.test(char)) return '9';
        if (/[\p{L}\p{M}]/u.test(char)) return TIMESTAMP_PUNCTUATION.has(char) ? char : 'a';
        return TIMESTAMP_PUNCTUATION.has(char) ? char : '?';
      })
      .join('');
  }

  private toCount(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  /**
   * `Date` instances convert via `toISOString()`. Strings are matched against a strict
   * `YYYY-MM-DD[T ]HH:MM:SS[.sss][Z | ±HH:MM]` shape rather than gated on bare `Date`-parseability
   * — `new Date(value)` parses far more than real timestamps (`new Date('2026-07-28')` and even
   * `new Date('July 28, 2026')` both succeed), so a validity-only gate would let non-timestamp
   * strings through and get a fabricated `Z` glued onto them.
   *
   * Once the shape matches, an explicit zone is attached *before* the one `new Date(...)` call that
   * produces the returned value — `Z` when one was already present or absent entirely (warehouse
   * timestamps are assumed UTC by construction; no per-committee timezone concept exists), or the
   * extracted offset otherwise. Parsing only ever happens with an explicit, unambiguous zone
   * attached, so this can't hit the trap `OrgLensProjectsService.latestTimestamp` avoids: a
   * zone-less string re-parsed via bare `new Date(value)` is interpreted as *local* time in V8,
   * silently shifting by the server's UTC offset. Every non-null return here is a canonical
   * `toISOString()` output, so the lexicographic `iso > latest` comparison this feeds into stays
   * correct even if a warehouse column ever mixed timestamp formats across rows.
   */
  private toIsoTimestamp(value: string | Date | null | undefined): string | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value !== 'string') return null;
    const match = TIMESTAMP_SHAPE.exec(value.trim());
    if (!match) return null;
    const [, date, time, utc, offsetHours, offsetMinutes] = match;
    // The shape regex only constrains digit counts, so an out-of-range day like '2026-02-30' still
    // matches it — and V8 rolls it forward into a real date (here, March 2) instead of failing, so
    // the NaN guard below wouldn't catch it (an out-of-range *month* like '2026-13-01' does fail
    // that guard on its own; only day-overflow silently rolls over). Round-trip the date part alone
    // (offset-independent; an offset can legitimately shift the *time*'s UTC date, but not whether
    // the calendar date the warehouse actually reported was real) to catch what the final parse
    // would otherwise silently fix up.
    const calendarDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date) return null;
    const zone = utc || !offsetHours ? 'Z' : `${offsetHours}:${offsetMinutes}`;
    const parsed = new Date(`${date}T${time}${zone}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  /** Placeholder table/column names — real names TBD once the dbt model (owned separately) lands. */
  private engagementTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEMBER_MEETING_ATTENDANCE`;
  }
}
