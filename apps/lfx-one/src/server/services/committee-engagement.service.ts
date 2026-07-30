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

/** The only characters `redactedShape` (below) passes through verbatim — everything else is substituted. */
const TIMESTAMP_PUNCTUATION = new Set(['-', ':', '.', '+', '/', ' ', 'T', 'Z']);

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

    // Two distinct failure modes, counted separately so a reader isn't left guessing which one
    // happened: a blank email is a data-quality problem in the row itself, while a duplicate email
    // means the declared grain (COMMITTEE_UID, MEMBER_EMAIL, TIME_RANGE_TYPE) — a guess pending the
    // real dbt model — is finer than assumed. Last-write-wins on a duplicate (ORDER BY MEMBER_EMAIL
    // has no tiebreaker on TIME_RANGE_TYPE or COMPUTED_AT, so "last" is whichever the warehouse
    // happened to emit second, not a deliberate choice) — flagged here since it's otherwise silent.
    const rowsByEmail = new Map<string, CommitteeEngagementWarehouseRow>();
    let blankEmailRowCount = 0;
    for (const row of rows) {
      const email = this.normalizeEmail(row.MEMBER_EMAIL);
      if (email) rowsByEmail.set(email, row);
      else blankEmailRowCount++;
    }
    const duplicateEmailRowCount = rows.length - rowsByEmail.size - blankEmailRowCount;

    if (duplicateEmailRowCount > 0 || blankEmailRowCount > 0) {
      logger.warning(req, 'get_committee_engagement', 'Some warehouse rows were dropped or overwritten before joining to the roster', {
        committee_uid: committeeUid,
        duplicate_email_row_count: duplicateEmailRowCount,
        blank_email_row_count: blankEmailRowCount,
        row_count: rows.length,
      });
    }

    // Named "over-attended", not "clamped": rows with no roster match are dropped entirely in the
    // map below and never actually clamped, so this counts detection, not mutation. Counted over
    // rows, not roster members, so a grain mismatch affecting only former-member rows (the normal
    // case, not an edge case — see the join-mismatch warning below) isn't invisible.
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
        // that — not its content. See redactedShape's doc comment for the redaction policy; bounded
        // to 3 rows, 24 code points each.
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
   * Redacts a rejected `COMPUTED_AT` value to its structural shape for logging: only a fixed
   * allowlist of timestamp-punctuation characters (`- : . + / T Z` and space) passes through
   * verbatim; every Unicode digit becomes `9`, every Unicode letter/mark becomes `a`, and anything
   * else becomes `?`. A warning reader can tell "looks like a real timestamp that failed to parse"
   * from "not a timestamp at all" — the allowlisted characters are the only ones that carry that
   * shape signal, and they're a closed, non-sensitive set, not free-form content.
   *
   * Default-*deny*, not default-allow: redacting only known digit/letter classes and letting
   * anything else (symbols, emoji, combining marks) through unchanged wouldn't actually shrink what
   * a caller could put in this column. Walks by Unicode code point via `for...of` (not `Array.from`
   * + `.slice`, which would materialize the entire string before truncating — a real cost against a
   * column whose real width is unknown) and stops the moment the bound is reached, so a surrogate
   * pair is never split into two invalid lone surrogates either.
   */
  private redactedShape(raw: unknown): string {
    const MAX_CODE_POINTS = 24;
    const shape: string[] = [];
    for (const char of String(raw)) {
      if (shape.length === MAX_CODE_POINTS) break;
      if (TIMESTAMP_PUNCTUATION.has(char)) shape.push(char);
      else if (/\p{Nd}/u.test(char)) shape.push('9');
      else if (/[\p{L}\p{M}]/u.test(char)) shape.push('a');
      else shape.push('?');
    }
    return shape.join('');
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

  /**
   * TODO(LFXV2-1705 follow-up): placeholder table name. Every column this service reads
   * (`MEMBER_EMAIL`, `ATTENDED_COUNT`, `INVITED_COUNT`, `COMPUTED_AT`, `COMMITTEE_UID`,
   * `TIME_RANGE_TYPE`) and the assumed grain are guesses pending the real dbt model, owned
   * separately (see the ticket). Until reconciled: a wrong *table* name degrades identically to
   * "not deployed yet" via `expectMissingObject`/`isMissingObjectError`'s "does not exist or not
   * authorized" match — the two stay indistinguishable, which is the known limitation this TODO is
   * about. A wrong *column* name does not degrade the same way — Snowflake's "invalid identifier"
   * compilation error doesn't match that regex, so it rethrows as a 500 instead, which is the
   * correct failure mode for a genuinely broken query rather than a silent zeroed response.
   */
  private engagementTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEMBER_MEETING_ATTENDANCE`;
  }
}
