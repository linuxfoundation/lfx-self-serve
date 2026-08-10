// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_MAX_PAGE_SIZE, ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE, NOTES_ATTACHMENT_CATEGORY, PAST_MEETING_SORT } from '@lfx-one/shared/constants';
import { PollStatus, SurveyStatus } from '@lfx-one/shared/enums';
// import type — erased entirely at compile time, so unlike the enums/utils imports below, this
// one needs no vi.mock in the spec (same reasoning as activity-feed.utils.ts's own interfaces import).
import type {
  ActivityEvent,
  ActivityPageCursor,
  Committee,
  CommitteeActivityDocumentFile,
  CommitteeActivityFolder,
  CommitteeActivityLink,
  CommitteeActivityNoteAttachment,
  CommitteeActivityQuery,
  DocumentUploadedActivityEvent,
  NotesAddedActivityEvent,
  PaginatedResponse,
  PastMeeting,
  QueryServiceResponse,
  Survey,
  SurveyClosedActivityEvent,
  SurveyPublishedActivityEvent,
  Vote,
  VoteClosedActivityEvent,
  VoteOpenedActivityEvent,
} from '@lfx-one/shared/interfaces';
import { firstValidTimestamp, getPastMeetingResourceId, getPastMeetingStartTimeMs, getSurveyDisplayStatus, normalizePollStatus } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { encodeActivityPageToken, normalizeTimestamp } from '../helpers/committee-activity-query.helper';
import { logger } from './logger.service';
import { MeetingService } from './meeting.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { VoteService } from './vote.service';

function timestampValue(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/**
 * Stable per-event identifier for sort tiebreaking and cursor keying — NOT part of the
 * `ActivityEvent` wire contract, purely a server-internal sort/pagination detail. Each source's
 * own natural uid, prefixed by source so ids from different sources can never collide. Documents
 * additionally discriminate by document_type — folders, links, and files are three distinct
 * upstream uid namespaces, so `document_uid` alone could collide across them (e.g. a folder and a
 * file coincidentally sharing a uid). A collision doesn't drop anything from a single unpaginated
 * merge (nothing here dedups by key) — the real risk is at the cursor boundary:
 * `compareEventsDesc` would treat two same-timestamp, same-key events as equal, so once one of
 * them is returned, `isAfterCursor` excludes both on the next page, permanently dropping the
 * other. See the paginated collision test in the spec.
 */
function eventKey(event: ActivityEvent): string {
  switch (event.type) {
    case 'meeting_held':
      return `meeting:${event.payload.meeting_occurrence_id}`;
    case 'vote_opened':
    case 'vote_closed':
      return `vote:${event.payload.vote_uid}`;
    case 'survey_published':
    case 'survey_closed':
      return `survey:${event.payload.survey_uid}`;
    case 'document_uploaded':
      return `document:${event.payload.document_type}:${event.payload.document_uid}`;
    case 'notes_added':
      return `note:${event.payload.meeting_scope}:${event.payload.document_uid}`;
    default:
      // Deferred types are never constructed in v1 (see activity-event.interface.ts) — occurred_at
      // is the least-bad fallback key if one ever were.
      return `deferred:${event.occurred_at}`;
  }
}

/**
 * Sorts descending by `(occurred_at, key)` — occurred_at first, key as a deterministic tiebreak
 * when two events share the exact same timestamp (e.g. a batch of documents uploaded in one
 * request, all sharing `created_at` to the second). Without a tiebreak, which of several
 * same-timestamp events is "first" would depend on source-fetch order, making the cursor
 * (`isAfterCursor` below) unable to draw a stable line between "already returned" and "not yet
 * returned" among them.
 *
 * Compares the two numeric timestamps explicitly rather than subtracting them — `a - b` on two
 * `-Infinity` values (both events have an unparseable/absent occurred_at) is `NaN`, which is
 * `!== 0` and would skip the key tiebreak entirely, leaving that pair's order non-deterministic
 * exactly when the tiebreak matters most.
 */
function compareEventsDesc(a: { occurred_at: string; key: string }, b: { occurred_at: string; key: string }): number {
  const aTime = timestampValue(a.occurred_at);
  const bTime = timestampValue(b.occurred_at);
  if (aTime !== bTime) return bTime > aTime ? 1 : -1;
  // Codepoint comparison, not localeCompare — locale-aware collation is ICU-build-dependent, so
  // two server instances on different Node builds could tiebreak two same-timestamp events in a
  // different order, which would let a cursor issued by one instance skip or repeat an item when
  // the next page is served by the other.
  if (b.key === a.key) return 0;
  return b.key > a.key ? 1 : -1;
}

/**
 * Ceils an ISO timestamp to the next whole second. query-service's `date_to` parameter round-trips
 * through Go's `time.RFC3339` layout server-side (`cmd/service/converters.go`), which has no
 * fractional-seconds component — sub-second precision is silently truncated before the range
 * filter is applied. `cursor.before` can carry millisecond precision (`Date.toISOString()` always
 * emits it, and some upstream sources' own timestamps do too), so sending it verbatim as `date_to`
 * would shrink the upstream boundary below the true cursor position — under-fetching, not
 * over-fetching, and permanently excluding same-second siblings before the in-memory `isAfterCursor`
 * pass ever sees them (the exact failure the compound cursor exists to prevent, reintroduced one
 * layer upstream). Ceiling instead of truncating guarantees the upstream boundary is never tighter
 * than the true one; the in-memory pass still applies the exact `(occurred_at, key)` comparison, so
 * the resulting over-fetch (at most ~1 second of extra rows) is trimmed correctly, not a correctness gap.
 *
 * Returns `undefined` for an unparseable `iso` rather than throwing — matches every other
 * timestamp helper in this file (`timestampValue`, `isAtOrAfterSince`, `isAfterCursor`) treating an
 * invalid timestamp as "can't reason about this" rather than a fatal error itself. The caller
 * (`getCommitteeActivity`) is the one that decides what an unparseable `cursor.before` means for
 * the request as a whole — see the comment there.
 */
function ceilToWholeSecond(iso: string): string | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  return new Date(Math.ceil(ms / 1000) * 1000).toISOString();
}

/**
 * True when `survey`'s CLOSED display status is driven purely by its cutoff date passing
 * (`SurveyStatus.SENT` with `survey_cutoff_date` in the past — mirrors `getEffectiveSurveyStatus`'s
 * own SENT/cutoff branch in `survey.utils.ts`), as opposed to an explicit "closed" `survey_status`
 * or `response_status` write. Duplicated here rather than imported because
 * `getSurveyDisplayStatus`/`getEffectiveSurveyStatus` only return the resulting status, not which
 * branch produced it — this file needs that distinction to pick `occurred_at`.
 */
function isCutoffDrivenClosure(survey: Survey): boolean {
  if (survey.survey_status?.toLowerCase() !== SurveyStatus.SENT) return false;
  // Mirrors survey.utils.ts's private RESPONSE_STATUS_CLOSED_SENTINEL ('closed') — an explicit
  // response_status closure isn't cutoff-driven even if the cutoff has also passed.
  if (survey.response_status?.toLowerCase() === 'closed') return false;
  const cutoffDate = survey.survey_cutoff_date ? new Date(survey.survey_cutoff_date) : null;
  return cutoffDate !== null && !Number.isNaN(cutoffDate.getTime()) && new Date() >= cutoffDate;
}

/**
 * True when `deadlineIso` is absent-but-invalid or already passed — mirrors meeting.utils.ts's
 * `isCalendarDeadlinePast` (reimplemented, not imported; see mapVoteToEvent's doc comment for why).
 * Unlike that helper, `undefined`/empty is treated as "not past" (`false`) rather than checked —
 * `mapVoteToEvent` only calls this with `vote.end_time`, which the ENDED/early_end_time checks
 * ahead of it already partially cover; an absent end_time here just means "no deadline to compare."
 */
function isVoteDeadlinePast(deadlineIso: string | null | undefined): boolean {
  if (!deadlineIso) return false;
  const ms = Date.parse(deadlineIso);
  return Number.isNaN(ms) ? true : Date.now() >= ms;
}

function isAtOrAfterSince(occurredAt: string, since: string | undefined): boolean {
  if (!since) return true;
  const ms = Date.parse(occurredAt);
  if (Number.isNaN(ms)) return false;
  return ms >= Date.parse(since);
}

/** True when `event` sorts strictly after `cursor` in `compareEventsDesc` order — i.e. belongs on the next page. */
function isAfterCursor(event: { occurred_at: string; key: string }, cursor: ActivityPageCursor | undefined): boolean {
  if (!cursor) return true;
  const ms = Date.parse(event.occurred_at);
  if (Number.isNaN(ms)) return false;
  return compareEventsDesc(event, { occurred_at: cursor.before, key: cursor.key }) > 0;
}

/**
 * Aggregates a committee's activity across existing sources (past meetings, votes, surveys,
 * documents, notes-category meeting attachments) into one time-ordered, cursor-paginated feed —
 * LFXV2-1707 v1 / LFXV2-3077. No new upstream service: each source is an existing
 * committee-scoped read, fetched in parallel and merged server-side. See
 * `packages/shared/src/interfaces/activity-event.interface.ts` for which event types this emits
 * vs. defers pending a real event log.
 */
export class CommitteeActivityService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly meetingService: MeetingService;
  private readonly voteService: VoteService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.meetingService = new MeetingService();
    this.voteService = new VoteService();
  }

  public async getCommitteeActivity(req: Request, committeeUid: string, options: CommitteeActivityQuery): Promise<PaginatedResponse<ActivityEvent>> {
    const { since: rawSince, cursor, limit } = options;
    // Same reject-not-degrade policy as the cursor/since checks below, for the same reason:
    // parseCommitteeActivityQuery already bounds page_size on the HTTP path, but this method is
    // public and reachable directly. An out-of-range `limit` here degrades silently instead of
    // rejecting — `limit: 0` yields `windowed.slice(0, 0)`, an empty feed with no error; a negative
    // `limit` (`slice(0, -1)`) silently drops the OLDEST item (windowed is sorted descending by
    // (occurred_at, key), so index 0 is newest and -1 is oldest) while still emitting a page_token.
    if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_FEED_MAX_PAGE_SIZE) {
      throw ServiceValidationError.forField('limit', `limit must be an integer between 1 and ${ACTIVITY_FEED_MAX_PAGE_SIZE}`, {
        operation: 'get_committee_activity',
      });
    }
    // Fetching `limit + 1` from EACH source (not just `limit`) is what makes the true global
    // top-(limit+1) merged-by-occurred_at result likely to be present in the fetched pool, even in
    // the worst case where a single source contributes every one of the top items — a smaller
    // per-source fetch could silently under-represent a dominant source. ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE
    // keeps small `limit` values (e.g. 1) from starving that. This is NOT an airtight guarantee for
    // every leg, though: it only holds if each source's upstream page already contains its own true
    // top-(limit+1) by occurred_at.
    //
    // Meetings: `sort: NAME_DESC` resolves to query-service's `sort_name`, which the meeting-service
    // indexer populates from `start_time` (`meeting.constants.ts`'s `PAST_MEETING_SORT` doc comment;
    // upstream `PastMeetingEventData.SortName()` confirms — its own doc comment calls `StartTime`
    // "the scheduled start time"). occurred_at (getPastMeetingStartTimeMs, via
    // firstValidTimestampMs/isRealTimestamp) prefers `scheduled_start_time`, falling back to
    // `start_time`. The indexed `v1_past_meeting` type this leg reads is sourced exclusively from
    // ITX/Zoom past-meeting-completion events, not created directly — verified in the
    // `lfx-v2-meeting-service` repo: `docs/event-processing.md`'s `itx-zoom-past-meetings.` stream is
    // the sole source; the source struct `PastMeetingEventData`
    // (`internal/domain/models/event_models.go`) has no `scheduled_start_time` JSON field at all; and
    // the one handler that builds it (`cmd/meeting-api/eventing/past_meeting_event_handler.go`)
    // populates `StartTime` FROM the raw record's own `ScheduledStartTime`. So `scheduled_start_time`
    // is never present on a row this leg can read, the fallback always fires, and
    // `sort_name`/occurred_at are always built from the identical value — meetings is exact, not
    // merely the best-behaved approximation, unlike the other three legs below. This holds against
    // the contract as verified today, not as a law of nature: if `lfx-v2-meeting-service` ever adds
    // `scheduled_start_time` to that struct, `getPastMeetingStartTimeMs` would start preferring it
    // while `date_field: 'start_time'` (in fetchPastMeetingEvents below) keeps narrowing on the old
    // field — an upstream-side regression that would otherwise be silent. fetchPastMeetingEvents has
    // a runtime tripwire for exactly this: a warning log if a real, differing scheduled_start_time
    // ever shows up on a returned row, rather than relying on this comment alone to catch it.
    //
    // Votes, surveys, files, and notes are all in a different, genuinely-approximate bucket:
    // query-service's `sort=updated_desc` resolves to the INDEX's own root-level `updated_at`
    // (`cmd/service/converters.go`: `SortBy = "updated_at"`, no `data.` prefix), which the indexer
    // contract documents as index-write/audit metadata, not a copy of any `data.*` domain field —
    // distinct from the `date_field` values votes and files filter on: votes' `data.last_modified_time`,
    // files' `data.updated_at` (each auto-prefixed with `data.` by query-service, unlike `sort`).
    // Files happens to share a field NAME with the sort target (`updated_at` == `updated_at`)
    // despite resolving to a different actual field once `data.` prefixing is applied; votes'
    // date_field name doesn't even coincide with `updated_at`. Surveys and notes are the exception
    // here: neither has an upstream date_field at all (see fetchSurveyEvents's and
    // fetchNotesAddedEvents's own comments for why, two different reasons) — `sort: updated_desc`
    // is the only upstream ordering either leg gets. Same class of approximation as the per-leg
    // date_field (filter-dimension) caveats discussed next, just in the sort dimension instead.
    //
    // Filter dimension: votes/files each filter on a single upstream `date_field` that only
    // approximates their own multi-field occurred_at derivation (see each leg's own comment for
    // which field and why) — sending that imperfect narrowing upstream still beats sending none at
    // all, which was tried and reverted earlier in this file's history: it traded the rare
    // filter-mismatch miss for hard truncation at `fetchSize` on every page instead, a strictly worse
    // failure mode. The in-memory since/cursor pass in getCommitteeActivity is the correctness
    // backstop against over-inclusion for both legs, not under-inclusion — an imperfectly-narrowed
    // leg can still exclude a real in-window row upstream before that pass ever sees it. Surveys and
    // notes are the exception where "sending none at all" IS the right call, not the failure mode
    // this paragraph describes — for two different reasons. Surveys: unlike votes/files, a survey's
    // cutoff-driven occurred_at isn't bounded below by any field the row gets written to, so
    // date_field narrowing there would systematically (not rarely) exclude exactly the rows `since`
    // is meant to include — see fetchSurveyEvents. Notes: an attachment whose v1 source record had
    // no parseable `updated_at` gets indexed with `modified_at` set to the Go zero-date sentinel
    // (`0001-01-01T00:00:00Z`, lfx-v2-meeting-service's `parseTime` swallows that error rather than
    // omitting the field — `modified_at` is never actually absent), which an upstream date_field
    // filter would exclude even though `firstValidTimestamp` correctly treats the sentinel as
    // invalid and falls back to `created_at` for `occurred_at` — see fetchNotesAddedEvents.
    //
    // Known v1 limitation (accepted, not solved — see LFXV2-1707): meetings/votes/surveys/files/notes
    // are each bounded to a single upstream page of `fetchSize` rows.
    // If more than `fetchSize` rows on one of those legs share the exact same occurred_at second,
    // rows beyond the upstream page are simply never fetched, on any page — unlike folders/links
    // (which have no upstream bound at all and are paginated correctly via the in-memory cursor
    // pre-filter below), fixing this for a page_size-bounded leg would mean looping that leg's own
    // upstream query-service/meeting-service/vote-service call across multiple pages until the tie
    // is exhausted, i.e. per-leg N+1 upstream calls — which the ticket's "bounded calls, no
    // per-event follow-ups" requirement rules out for v1. Negligible in practice at committee scale
    // (tens of items, not thousands sharing one second); resolved for real once the upstream event
    // log (this endpoint's eventual replacement) makes every event independently, chronologically
    // paginable at the source.

    const fetchSize = Math.max(limit + 1, ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE);
    // Sent to every leg as an inclusive upstream `date_to` (query-service's date_to is documented
    // inclusive), ceiled to the next whole second — see ceilToWholeSecond's doc comment for why:
    // upstream truncates sub-second precision, so the raw cursor.before could otherwise shrink the
    // boundary below the true cursor position. The in-memory isAfterCursor pass (which uses the
    // exact, un-ceiled cursor.before) is what actually enforces the boundary; the ceiled value here
    // only bounds what gets fetched, so a wider upstream window is always safe, a narrower one isn't.
    const before = cursor ? ceilToWholeSecond(cursor.before) : undefined;
    if (cursor && !before) {
      // Reject rather than degrade — matches decodePageToken's own policy for the identical input
      // (committee-activity-query.helper.ts: a bad explicit cursor is a 400, not a silently-ignored
      // value). This method is public and reachable directly by a future non-HTTP caller that
      // skips that validation; degrading here would (a) diverge from the HTTP path's policy for the
      // same bad input and (b) still do the full 9-call upstream fan-out below for a result that's
      // provably empty anyway (isAfterCursor can't place any real event "after" an unparseable
      // cursor position), which is pure waste. Failing fast avoids both.
      throw ServiceValidationError.forField('cursor.before', 'cursor.before must be a valid ISO 8601 timestamp', {
        operation: 'get_committee_activity',
      });
    }
    // Same reject-not-degrade policy, same reason, for `since` — this method is public and
    // reachable by a caller that skips parseCommitteeActivityQuery's own since validation. Without
    // this check, an unparseable `since` does the full upstream fan-out, 400s every query-service
    // leg's date_from (each swallowed into an empty leg by its own .catch), and isAtOrAfterSince
    // then rejects every surviving event too (`ms >= Date.parse(since)` is `ms >= NaN`, always
    // false) — a silent empty feed, not the clean rejection this method's cursor handling already
    // guarantees for the equivalent bad-input case.
    //
    // `typeof rawSince !== 'string'`, not just parseability — `CommitteeActivityQuery.since` is
    // typed `string | undefined`, but this method is reachable by an untyped/direct caller that
    // bypasses that guarantee, and Date.parse(x) coerces its argument via ToString before parsing
    // while normalizeTimestamp's `new Date(x)` does not (a Number is instead read as epoch-ms) —
    // so a non-string `since` could pass Date.parse's parseability check here and then normalize to
    // a completely different instant below, silently corrupting the window instead of rejecting.
    if (rawSince !== undefined && (typeof rawSince !== 'string' || Number.isNaN(Date.parse(rawSince)))) {
      throw ServiceValidationError.forField('since', 'since must be a valid ISO 8601 timestamp', { operation: 'get_committee_activity' });
    }
    // normalizeTimestamp — same reason as parseCommitteeActivityQuery's own use of it (see that
    // function's doc comment): `Date.parse` accepts formats (e.g. a zone-less
    // `2026-01-05T00:00:00`) that query-service's stricter RFC3339 parser 400s, and that 400 would
    // otherwise be swallowed into an empty leg by each leg's own .catch — a passably-formatted but
    // non-normalized `since` would silently thin the feed rather than error, on this direct-caller
    // path specifically (the HTTP path already normalizes before this method ever sees `since`).
    // `!== undefined`, matching the guard above (not truthiness) — the guard above already rejects
    // `since: ''` (an empty string fails `Number.isNaN(Date.parse(''))`), so by this line the only
    // way to reach here with a falsy-but-defined `since` is already closed off; matching predicates
    // means that stays true even if the guard above is ever relaxed, instead of the two silently
    // diverging on which falsy values count as "no since" vs. "invalid since".
    const since = rawSince !== undefined ? normalizeTimestamp(rawSince) : undefined;

    // INFO, not DEBUG — matches DocumentService.getMyDocuments's "N-stage aggregation" logging
    // (the closest precedent in this repo: a comparable multi-source read aggregation), not the
    // single-source enrichment services that stay at DEBUG throughout. A merge across 5
    // independently-paginated upstream sources with cursor/saturation logic is exactly the
    // "complex multi-step orchestration" case logging-patterns.md reserves INFO for.
    logger.info(req, 'get_committee_activity', 'Starting committee activity aggregation', { committee_uid: committeeUid, fetch_size: fetchSize });

    const [committee, pastMeetingResult, voteResult, surveyResult, documentResult, notesResult] = await Promise.all([
      this.fetchCommittee(req, committeeUid),
      this.fetchPastMeetingEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch past-meeting activity, continuing without it', { committee_uid: committeeUid, err });
        return { events: [], saturated: false };
      }),
      this.fetchVoteEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch vote activity, continuing without it', { committee_uid: committeeUid, err });
        return { events: [], saturated: false };
      }),
      this.fetchSurveyEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch survey activity, continuing without it', { committee_uid: committeeUid, err });
        return { events: [], saturated: false };
      }),
      this.fetchDocumentEvents(req, committeeUid, since, before, fetchSize, cursor).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch document activity, continuing without it', { committee_uid: committeeUid, err });
        return { events: [], saturated: false };
      }),
      this.fetchNotesAddedEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch notes activity, continuing without it', { committee_uid: committeeUid, err });
        return { events: [], saturated: false };
      }),
    ]);

    // A committee-lookup failure already rejected the whole Promise.all above (see fetchCommittee's
    // doc comment) — by this line `committee` is always a resolved Committee.
    const votingEnabled = committee.enable_voting;
    const sources: ActivityEvent[][] = [
      pastMeetingResult.events,
      votingEnabled ? voteResult.events : [],
      surveyResult.events,
      documentResult.events,
      notesResult.events,
    ];

    // Single pass: attach each event's sort key once, apply since/cursor, sort desc by
    // (occurred_at, key). No per-source pre-cap — a global sort+slice already picks the true top
    // `limit` by time regardless of which source they came from; an artificial per-source quota
    // would only make this LESS "time-ordered", not more correct.
    const keyed = sources.flat().map((event) => ({ event, key: eventKey(event) }));
    const windowed = keyed.filter(
      ({ event, key }) =>
        // Drop events with no usable timestamp entirely, rather than keeping them sorted last — an
        // event that can't be placed in time carries no signal for a feed literally named "Recent
        // Activity", and worse, isAfterCursor rejects an unparseable occurred_at unconditionally
        // (correctly — it can't be placed relative to any cursor), so once pagination is in play
        // such an event would be visible on an unfilled page 1 and then permanently unreachable on
        // every later page. Dropping it up front means "included" is a stable property, not one
        // that depends on how many pages the caller has already fetched.
        timestampValue(event.occurred_at) !== -Infinity &&
        isAtOrAfterSince(event.occurred_at, since) &&
        isAfterCursor({ occurred_at: event.occurred_at, key }, cursor)
    );
    windowed.sort((a, b) => compareEventsDesc({ occurred_at: a.event.occurred_at, key: a.key }, { occurred_at: b.event.occurred_at, key: b.key }));

    // `windowed.length > limit` alone under-detects "more data exists": each of
    // meetings/votes/surveys/files/notes is bounded to a single upstream page of `fetchSize` rows (see
    // the caveat above), so once a page's fetch actually hits that bound, there could be more rows
    // upstream than made it into `windowed` even though the merged pool itself isn't over `limit` —
    // e.g. a single dominant source returning exactly `fetchSize` rows, several of which get
    // dropped by the in-memory since/cursor/invalid-timestamp filters, can leave `windowed.length`
    // at or under `limit` while real, unfetched rows remain beyond this page's upstream cutoff.
    // Each bounded leg's own `saturated` flag is derived from the upstream `page_token` it actually
    // got back (see each fetch* method) — NOT from comparing its returned row count to `fetchSize`.
    // A leg can return exactly `fetchSize` rows as a genuine final page with no further
    // `page_token`; a row-count comparison alone would falsely flag that as saturated and hand back
    // a cursor that only leads to an empty next page (independently flagged by Copilot and
    // dealako). Folders/links are excluded from this saturation check — they have no upstream page
    // bound at all (fetched in full every call) and are already filtered+bounded correctly against
    // the exact cursor inside fetchDocumentEvents, so a fetched length at `fetchSize` there reflects
    // this leg's own internal cap, not an upstream truncation signal.
    const anyLegSaturated =
      pastMeetingResult.saturated || (votingEnabled && voteResult.saturated) || surveyResult.saturated || documentResult.saturated || notesResult.saturated;

    const page = windowed.slice(0, limit);
    const data = page.map(({ event }) => event);
    // Every item in `page` now has a real timestamp (windowed already dropped the ones that
    // don't), so the last page item is always a valid cursor position — no need to search backward
    // for one. `hasMore` still requires a real `lastPageItem` to anchor a cursor on — if saturation
    // is detected but this page came back empty, there is no position left to resume from, so this
    // degrades to the same "nothing more to report" outcome as before.
    //
    // This isn't just an in-memory-filter edge case: confirmed against `lfx-v2-query-service`'s own
    // source (`internal/service/resource_search.go`) and documented contract
    // (`docs/query-service-contract.md`), FGA access-checking runs AFTER OpenSearch paginates —
    // `page_token` reflects the raw (pre-filter) OpenSearch page, so a leg's single fetched page can
    // come back with fewer visible resources than `page_size`, including zero, while `page_token`
    // is still present. `anyLegSaturated` (above) already correctly reflects this via each leg's
    // real `page_token` (not row count) — but if EVERY leg's single page happens to filter down to
    // zero visible rows, `windowed`/`page` end up empty too, `lastPageItem` is undefined, and
    // `hasMore` forces `false` regardless of `anyLegSaturated`: this response looks terminal even
    // though a later upstream page (of any saturated leg) could contain rows this caller is
    // authorized to see. Closing this for real means looping a leg's own upstream call until a
    // visible candidate or exhaustion — ruled out for v1 by the ticket's "bounded calls, no
    // per-event follow-ups" requirement (same constraint documented at the top of this method).
    // Accepted as a known residual (per-request, not per-response — a follow-up request with the
    // same `since`/no cursor would simply re-run this same fetch and could still surface nothing
    // new if the access-filtering pattern hasn't changed), not solved by a second round-trip within
    // this call.
    const lastPageItem = page.at(-1);
    const hasMore = (windowed.length > limit || anyLegSaturated) && !!lastPageItem;
    const pageToken = hasMore && lastPageItem ? encodeActivityPageToken({ before: lastPageItem.event.occurred_at, key: lastPageItem.key }) : undefined;

    logger.info(req, 'get_committee_activity', 'Completed committee activity aggregation', {
      committee_uid: committeeUid,
      meeting_count: pastMeetingResult.events.length,
      vote_count: voteResult.events.length,
      survey_count: surveyResult.events.length,
      document_count: documentResult.events.length,
      notes_count: notesResult.events.length,
      voting_enabled: votingEnabled,
      returned: data.length,
      has_more: hasMore,
      // Without these two, a line reading `returned: 1, has_more: true` is unexplainable from the
      // log alone — has_more can now be true without windowed.length exceeding limit, and a leg
      // count only signals saturation when compared against fetch_size (also not logged elsewhere).
      any_leg_saturated: anyLegSaturated,
      fetch_size: fetchSize,
    });

    return { data, page_token: pageToken };
  }

  // ─── Committee (for enable_voting) ─────────────────────────────────────────

  /**
   * Unlike every other leg, a failure here is NOT caught-and-degraded by the caller — it's allowed
   * to reject `getCommitteeActivity`'s `Promise.all` and propagate to the controller's `next(error)`.
   * `GET /committees/:uid` is the one leg in this 9-call fan-out (committee + 6 `/query/resources`
   * legs — meetings, votes, surveys, files, notes×2 — + committee-service's folders/links legs) whose
   * committee-service FGA rejection is allowed to fail the whole request. The 6 `/query/resources`
   * legs filter per-resource and never 403 the whole request (see the controller's docblock); the
   * folders/links legs are also committee-service-FGA-backed but are deliberately caught-and-degraded
   * in fetchDocumentEvents rather than propagated, since a single missing/inaccessible committee's
   * folders or links shouldn't sink the whole feed the way a genuine "not authorized for this
   * committee at all" should. Catching a 403/404 here the same way as the other legs would silently
   * downgrade that case into "votes excluded, everything else renders", which is materially
   * different, and wrong. A transient failure (5xx/network) fails the whole request too — matching
   * `committee-engagement`'s `assertCommitteeRead`, which fails closed on both a resolved `false`
   * and a thrown upstream error, rather than treating "couldn't verify" as "verified false".
   */
  private async fetchCommittee(req: Request, committeeUid: string): Promise<Committee> {
    // `| null`, not an optimistic non-null type — MicroserviceProxyService.proxyRequest returns the
    // upstream body verbatim (api-client.service.ts parses an empty body to `null`), so a null
    // response is a real return value this file guards at four other call sites too (see
    // fetchSurveyEvents/fetchDocumentEvents). `proxyRequest`'s own declared type doesn't reflect
    // this repo-wide — every other caller still *declares* it non-null, though several (e.g.
    // project.service.ts, survey.service.ts) already runtime-guard the same way this does, which is
    // the established repo pattern this follows. A null committee here would otherwise throw an
    // untyped TypeError reading `.enable_voting` off it in getCommitteeActivity; throwing explicitly
    // here keeps this leg's fail-closed behavior (see the docblock above) meaningful and typed
    // rather than an accidental side effect of a property read.
    const committee = await this.microserviceProxy.proxyRequest<Committee | null>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${encodeURIComponent(committeeUid)}`,
      'GET'
    );
    if (!committee) {
      throw new ResourceNotFoundError('Committee', committeeUid, {
        operation: 'get_committee_activity',
        service: 'committee_service',
        // encodeURIComponent — matches the request path above. BaseApiError.toResponse() spreads
        // `path` into the 404 body, so an unencoded value here would diverge from what was actually
        // requested in a field the client can see, not just in a log.
        path: `/committees/${encodeURIComponent(committeeUid)}`,
      });
    }
    return committee;
  }

  // ─── Past Meetings → meeting_held ──────────────────────────────────────────

  private async fetchPastMeetingEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number
  ): Promise<{ events: ActivityEvent[]; saturated: boolean }> {
    // date_field: 'start_time' — unlike every other leg's date_field narrowing (best-effort; see the
    // shared rationale at the top of getCommitteeActivity), this one is a correctness guarantee for
    // the upstream contract as verified: occurred_at (getPastMeetingStartTimeMs) prefers
    // scheduled_start_time, falling back to start_time — and the indexed v1_past_meeting projection
    // this leg reads never carries scheduled_start_time at all (see the "Meetings" paragraph in
    // getCommitteeActivity's fetchSize comment for the verified source), so that fallback always
    // fires and occurred_at is always built from the same start_time field this date_field narrows
    // on. "As verified" is doing real work in that sentence, not hedge-speak: getPastMeetingStartTimeMs
    // and this leg's own test suite (committee-activity.service.spec.ts's "does not sort a past
    // meeting as ancient when start_time is a Go zero-date" case) still handle a present-and-differing
    // scheduled_start_time defensively, matching meeting.service.ts's identical posture — the code
    // doesn't assume the verified-absent case stays absent forever, even though the correctness
    // conclusion above holds against the contract as it exists today. The in-memory since/cursor
    // pass in getCommitteeActivity is still the one place that enforces the exact boundary (this
    // narrowing only bounds what's fetched).
    const hasWindow = !!since || !!before;
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      // NAME_DESC, not UPDATED_DESC — the meeting-service indexer populates sort_name from
      // start_time (packages/shared/src/constants/meeting.constants.ts), so NAME_DESC is the
      // start_time-ordered sort this leg actually needs; UPDATED_DESC sorts by index update time,
      // unrelated to occurred_at.
      sort: PAST_MEETING_SORT.NAME_DESC,
      ...(hasWindow && { date_field: 'start_time' }),
      ...(since && { date_from: since }),
      ...(before && { date_to: before }),
    };

    // access=false — the activity row only needs title/start_time, not per-meeting writer flags,
    // so skip the access-check call getMeetings otherwise makes for every returned meeting. Unlike
    // the survey/file legs below, this one still goes through the full MeetingService.getMeetings
    // rather than a raw proxyRequest — getMeetings unconditionally enriches with project name and
    // committee name (packages this leg discards), a known, accepted v1 inefficiency: reimplementing
    // this leg as a raw query-service call would need to independently reproduce
    // getPastMeetingStartTimeMs's scheduled_start_time/start_time fallback and the v1_past_meeting
    // id-normalization getMeetings already does, and it wasn't confirmed those fields survive a raw
    // (non-normalized) response — not worth that regression risk for a bounded (not per-event),
    // O(1)-extra-calls efficiency gain.
    // Cast to PastMeeting[] — getMeetings' return type is generic Meeting[], but the actual shape
    // is PastMeeting for meetingType 'v1_past_meeting' (same cast PastMeetingController itself uses).
    // page_token — getMeetings' own PaginatedResponse already carries the real upstream signal for
    // "more data exists on this leg"; see the saturation comment in getCommitteeActivity for why
    // this is preferred over comparing `meetings.length` to `fetchSize`.
    const { data: meetings, page_token: pageToken } = (await this.meetingService.getMeetings(req, query, 'v1_past_meeting', false)) as {
      data: PastMeeting[];
      page_token?: string;
    };

    // Tripwire for the "meetings is exact" claim in getCommitteeActivity's fetchSize comment — a
    // documented-but-silent regression is worse than no documentation, so make it observable: if a
    // real scheduled_start_time (not absent/zero-date/unparseable) ever shows up on a row and
    // differs from start_time, the upstream contract this leg's date_field narrowing relies on has
    // changed. Counted across the page and logged once, not once per row — the scenario this
    // catches is upstream flipping a field on every future row of an entire resource type, so a
    // per-row warning would mean up to `fetchSize` near-identical log lines per request, on every
    // request, indefinitely, the moment it happened — noise that would bury the one signal it exists
    // to surface, not amplify it.
    let contractBreachCount = 0;
    const events = meetings.map((meeting) => {
      const startMs = getPastMeetingStartTimeMs(meeting);
      const occurredAt = startMs !== null ? new Date(startMs).toISOString() : '';
      const scheduledStartTime = firstValidTimestamp(meeting.scheduled_start_time);
      if (scheduledStartTime && Date.parse(scheduledStartTime) !== Date.parse(meeting.start_time)) {
        contractBreachCount++;
      }
      return {
        type: 'meeting_held' as const,
        occurred_at: occurredAt,
        committee_uid: committeeUid,
        payload: {
          meeting_id: meeting.id,
          meeting_occurrence_id: getPastMeetingResourceId(meeting),
          title: meeting.title,
          password: meeting.password,
        },
      };
    });
    if (contractBreachCount > 0) {
      logger.warning(
        req,
        'get_committee_activity',
        'One or more v1_past_meeting rows carry a real scheduled_start_time differing from start_time — date_field narrowing on start_time may no longer be exact for this leg',
        { committee_uid: committeeUid, affected_row_count: contractBreachCount, total_rows: meetings.length }
      );
    }
    return { events, saturated: !!pageToken };
  }

  // ─── Votes → vote_opened | vote_closed ─────────────────────────────────────

  private async fetchVoteEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number
  ): Promise<{ events: (VoteOpenedActivityEvent | VoteClosedActivityEvent)[]; saturated: boolean }> {
    // date_field: 'last_modified_time' is best-effort narrowing (see the filter-dimension paragraph
    // in getCommitteeActivity's fetchSize comment for why narrowing imperfectly still beats not
    // narrowing at all) — a vote's occurred_at is actually
    // end_time/early_end_time/last_modified_time/creation_time depending on status, not always
    // last_modified_time.
    const hasWindow = !!since || !!before;
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      sort: 'updated_desc',
      ...(hasWindow && { date_field: 'last_modified_time' }),
      ...(since && { date_from: since }),
      ...(before && { date_to: before }),
    };

    // page_token — see the saturation comment in getCommitteeActivity for why this is preferred
    // over comparing `votes.length` to `fetchSize`.
    const { data: votes, page_token: pageToken } = await this.voteService.getVotes(req, query);
    return { events: votes.map((vote) => this.mapVoteToEvent(vote, committeeUid)), saturated: !!pageToken };
  }

  /**
   * One event per vote row (not two) — deliberate: this is an aggregation over current state, not
   * a real event log, so only the vote's most recent lifecycle point is known. Keeps the feed's
   * row count/rendering identical to the old client-side widget (one row per vote). A real event
   * log would naturally emit both `vote_opened` and `vote_closed` as they occur.
   */
  private mapVoteToEvent(vote: Vote, committeeUid: string): VoteOpenedActivityEvent | VoteClosedActivityEvent {
    // normalizePollStatus, not a raw comparison — Vote.status arrives with inconsistent casing
    // (poll.utils.ts's normalizePollStatus doc comment; poll.utils.spec.ts exercises 'Ended'/'ACTIVE'
    // mixed-case inputs), which is exactly why isVoteCalendarEventPast (meeting.utils.ts) goes
    // through the same normalization for its own ended check rather than comparing vote.status
    // directly. Skipping it here misclassified a non-canonical-case "ENDED" vote as vote_opened,
    // stamped at creation time instead of close time — caught independently by Copilot and Cursor
    // Bugbot, confirmed against current code.
    //
    // isVoteDeadlinePast(vote.end_time) — mirrors isVoteCalendarEventPast's third check
    // (isCalendarDeadlinePast(early_end_time ?? end_time)) rather than importing it: that helper
    // lives in meeting.utils.ts, which imports @angular/common/http — the same Angular-runtime-leak
    // this file already avoids importing (see activity-feed.utils.ts's identical avoidance).
    // Reimplemented locally instead. An ACTIVE vote whose end_time has already passed (but hasn't
    // been flipped to ENDED by an async backend job yet) is still effectively over — without this,
    // it stayed vote_opened at creation_time indefinitely, sorting far from where it belongs in the
    // feed. Cursor Bugbot caught this as a follow-up to the casing fix above.
    const isClosed = normalizePollStatus(vote.status) === PollStatus.ENDED || !!vote.early_end_time || isVoteDeadlinePast(vote.end_time);
    const occurredAt = isClosed
      ? firstValidTimestamp(vote.early_end_time, vote.end_time, vote.last_modified_time, vote.creation_time)
      : firstValidTimestamp(vote.creation_time, vote.last_modified_time);
    return {
      type: isClosed ? 'vote_closed' : 'vote_opened',
      occurred_at: occurredAt,
      committee_uid: committeeUid,
      payload: { vote_uid: vote.uid, name: vote.name, status: vote.status },
    };
  }

  // ─── Surveys → survey_published | survey_closed ────────────────────────────

  private async fetchSurveyEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number
  ): Promise<{ events: (SurveyPublishedActivityEvent | SurveyClosedActivityEvent)[]; saturated: boolean }> {
    // No date_field/date_from/date_to on this leg — unlike votes/files, surveys have a mode of
    // occurred_at (a cutoff-driven closure, see isCutoffDrivenClosure/mapSurveyToEvent below) that
    // is NOT bounded below by last_modified_at: a SENT survey can sit with an old last_modified_at
    // while its real occurred_at (survey_cutoff_date) is still in the future relative to that
    // write, with no upstream write ever marking the transition. Narrowing on
    // date_field: 'last_modified_at' (the previous approach) would upstream-exclude exactly that
    // row whenever `since` falls between its last_modified_at and its cutoff-driven occurred_at —
    // not a rare-edge best-effort miss like the votes/files legs' narrowing, but a systematic one
    // for every cutoff-driven closure `since` is meant to include (Copilot caught this on this
    // leg's initial cutoff fix). Dropping upstream date narrowing here entirely closes that: this
    // leg falls back to the same "Known v1 limitation" already documented at the top of
    // getCommitteeActivity for every page_size-bounded leg (a survey outside the top-fetchSize
    // slice by `sort: updated_desc` can still be missed), which is an honest, pre-existing
    // trade-off rather than a newly-introduced correctness gap.
    const query: Record<string, unknown> = {
      type: 'survey',
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      sort: 'updated_desc',
    };

    // Deliberately not SurveyService.getSurveys — that always fully drains every page via
    // fetchAllQueryResources and does an extra per-user "responded" join, neither of which this
    // bounded, presentation-only fetch needs.
    //
    // `| null` — see fetchCommittee's note above on why this file annotates it per call site.
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey> | null>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', query);

    // response?.page_token — see the saturation comment in getCommitteeActivity for why this is
    // preferred over comparing the mapped array's length to `fetchSize`.
    return {
      events: (response?.resources ?? []).map((resource) => this.mapSurveyToEvent(resource.data, committeeUid)),
      saturated: !!response?.page_token,
    };
  }

  private mapSurveyToEvent(survey: Survey, committeeUid: string): SurveyPublishedActivityEvent | SurveyClosedActivityEvent {
    const displayStatus = getSurveyDisplayStatus(survey);
    // A cutoff-driven closure (SENT past its survey_cutoff_date — see isCutoffDrivenClosure's own
    // doc comment) has no corresponding last_modified_at write: the survey just sits SENT while
    // time passes. Falling back to last_modified_at/created_at in that case stamps survey_closed at
    // the publish/update time instead of the real closure moment, which can misorder the feed or
    // let `since` filtering drop a closure that genuinely happened inside the requested window.
    // Confirmed by Copilot, matches dealako's review.
    let occurredAt = firstValidTimestamp(survey.last_modified_at, survey.created_at);
    if (displayStatus === SurveyStatus.CLOSED && isCutoffDrivenClosure(survey)) {
      const cutoffTimestamp = firstValidTimestamp(survey.survey_cutoff_date ?? undefined);
      if (cutoffTimestamp) {
        occurredAt = cutoffTimestamp;
      }
    }
    return {
      type: displayStatus === SurveyStatus.CLOSED ? 'survey_closed' : 'survey_published',
      occurred_at: occurredAt,
      committee_uid: committeeUid,
      payload: { survey_uid: survey.uid, title: survey.survey_title, status: displayStatus },
    };
  }

  // ─── Documents → document_uploaded ─────────────────────────────────────────

  private async fetchDocumentEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number,
    cursor: ActivityPageCursor | undefined
  ): Promise<{ events: DocumentUploadedActivityEvent[]; saturated: boolean }> {
    const hasWindow = !!since || !!before;

    const [folders, links, filesResult] = await Promise.all([
      // `| null` on folders/links/files below — see fetchCommittee's note on why this file
      // annotates it per call site.
      this.microserviceProxy
        .proxyRequest<CommitteeActivityFolder[] | null>(req, 'LFX_V2_SERVICE', `/committees/${encodeURIComponent(committeeUid)}/folders`, 'GET')
        .catch((err) => {
          logger.warning(req, 'get_committee_activity', 'Failed to fetch committee folders, continuing without them', { committee_uid: committeeUid, err });
          return [] as CommitteeActivityFolder[];
        }),
      this.microserviceProxy
        .proxyRequest<CommitteeActivityLink[] | null>(req, 'LFX_V2_SERVICE', `/committees/${encodeURIComponent(committeeUid)}/links`, 'GET')
        .catch((err) => {
          logger.warning(req, 'get_committee_activity', 'Failed to fetch committee links, continuing without them', { committee_uid: committeeUid, err });
          return [] as CommitteeActivityLink[];
        }),
      // Single bounded page, not CommitteeService.getCommitteeDocuments's fetchAllQueryResources
      // drain — this endpoint must stay bounded (no per-event follow-ups), so a page_size-limited
      // page is enough for a "recent activity" feed even though it isn't the complete file list.
      this.microserviceProxy
        .proxyRequest<QueryServiceResponse<CommitteeActivityDocumentFile> | null>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'committee_document',
          tags: `committee_uid:${committeeUid}`,
          page_size: fetchSize,
          sort: 'updated_desc',
          // Best-effort narrowing, same caveat as the survey leg above — occurred_at is
          // firstValidTimestamp(file.updated_at, file.created_at).
          ...(hasWindow && { date_field: 'updated_at' }),
          ...(since && { date_from: since }),
          ...(before && { date_to: before }),
        })
        // page_token, not just the mapped array — see the saturation comment below for why this
        // leg's real upstream signal is preferred over comparing the array's length to `fetchSize`.
        .then((response) => ({ files: (response?.resources ?? []).map((resource) => resource.data), pageToken: response?.page_token }))
        .catch((err) => {
          logger.warning(req, 'get_committee_activity', 'Failed to fetch committee files, continuing without them', { committee_uid: committeeUid, err });
          return { files: [] as CommitteeActivityDocumentFile[], pageToken: undefined as string | undefined };
        }),
    ]);

    // GET /committees/:id/folders and /links accept no page_size/date param at all and return
    // every folder/link on the committee unconditionally — unlike every other leg, which is at
    // least bounded to one upstream page of fetchSize. Filter each to the since/before/cursor
    // window FIRST, then bound to fetchSize — bounding before filtering would keep only the newest
    // fetchSize folders/links by recency regardless of the window, silently and permanently
    // excluding older-but-in-window items once a caller pages deep enough that they'd otherwise
    // surface (boundedSortDesc always keeps the same newest slice, no matter which page is asked
    // for). isAfterCursor (not just isWithinFetchWindow) is included here too — since/before alone
    // only narrow by timestamp, so a pool where more than fetchSize items share one exact
    // occurred_at second (e.g. a bulk folder import) would never actually shrink across pages: the
    // upstream response order, not (occurred_at, key), would silently decide which items are
    // reachable at all. isAfterCursor is exactly the predicate the central pass applies, so
    // pre-filtering with it here can only narrow the pool toward what the central pass would keep
    // anyway, never past it. The exact/final since+cursor enforcement still happens once,
    // centrally, in getCommitteeActivity — this pre-filter only needs to be a superset of that.
    // This fully closes the tie-truncation failure for folders/links specifically, because nothing
    // upstream ever caps what this leg can re-fetch. The sibling meetings/votes/surveys/files/notes
    // legs are each capped to one upstream page of fetchSize and can still hit the same failure if more
    // than fetchSize of their own rows share one exact timestamp — see the caveat on `fetchSize`'s
    // own comment above, in getCommitteeActivity.
    const folderEvents = boundedSortDesc(
      (folders ?? [])
        .map((folder) => this.buildDocumentEvent(committeeUid, folder.uid, folder.name, 'folder', firstValidTimestamp(folder.updated_at, folder.created_at)))
        .filter(
          (event) => isWithinFetchWindow(event.occurred_at, since, before) && isAfterCursor({ occurred_at: event.occurred_at, key: eventKey(event) }, cursor)
        ),
      fetchSize
    );
    const linkEvents = boundedSortDesc(
      (links ?? [])
        .map((link) => this.buildDocumentEvent(committeeUid, link.uid, link.name, 'link', firstValidTimestamp(link.updated_at, link.created_at), link.url))
        .filter(
          (event) => isWithinFetchWindow(event.occurred_at, since, before) && isAfterCursor({ occurred_at: event.occurred_at, key: eventKey(event) }, cursor)
        ),
      fetchSize
    );
    const fileEvents = filesResult.files.map((file) =>
      this.buildDocumentEvent(committeeUid, file.uid, file.name, 'file', firstValidTimestamp(file.updated_at, file.created_at))
    );

    // Only the files leg feeds `saturated` — it's the one document sub-leg bounded by an upstream
    // page_size (like meetings/votes/surveys), so its own upstream `page_token` is a real signal
    // there could be more data upstream (not a comparison of the fetched array's length to
    // `fetchSize` — a leg can return exactly `fetchSize` rows as a genuine final page with no
    // further `page_token`; see the saturation comment in getCommitteeActivity). Folders/links are
    // deliberately excluded: they have no upstream bound at all (fetched in full, every call) and
    // are already filtered+bounded against the exact cursor above, so hitting fetchSize there
    // reflects this leg's own correct internal cap, not an under-fetch.
    return { events: [...folderEvents, ...linkEvents, ...fileEvents], saturated: !!filesResult.pageToken };
  }

  private buildDocumentEvent(
    committeeUid: string,
    documentUid: string,
    name: string,
    documentType: 'file' | 'link' | 'folder',
    occurredAt: string,
    url?: string
  ): DocumentUploadedActivityEvent {
    return {
      type: 'document_uploaded',
      occurred_at: occurredAt,
      committee_uid: committeeUid,
      payload: { document_uid: documentUid, name, document_type: documentType, url },
    };
  }

  // ─── Notes → notes_added ────────────────────────────────────────────────────

  /**
   * A new aggregation leg, NOT a filter on fetchDocumentEvents above — folders/links/
   * committee_document files carry no `category` field, so a Notes-category row can only come
   * from v1_meeting_attachment/v1_past_meeting_attachment, two upstream resource types
   * fetchDocumentEvents never touches (LFXV2-3077, corrects LFXV2-2982's original framing).
   *
   * `filters: ['category:' + NOTES_ATTACHMENT_CATEGORY]` IS sent upstream, with the unconditional
   * client-side `category === NOTES_ATTACHMENT_CATEGORY` filter below kept as a backstop, not a
   * substitute — both found in review and confirmed against lfx-v2-meeting-service's/
   * lfx-v2-indexer-service's/lfx-v2-query-service's contract docs:
   *  - `filters` compiles to an OpenSearch `term` clause (exact match) on `data.category`. It's
   *    the only way to narrow the OpenSearch query itself on `category` — the attachment types'
   *    Tags tables (lfx-v2-meeting-service's indexer-contract.md) don't include it, so `tags`
   *    can't filter on it; `cel_filter` can express `data.category == 'Notes'` too, but the
   *    query-service contract documents it as applied in-process AFTER OpenSearch paginates, "not
   *    a substitute for narrowing the OpenSearch query itself" — it would inherit the exact same
   *    dilution problem this filter exists to avoid, just moved one step later. `data` is
   *    documented (lfx-v2-indexer-service's indexer-contract.md) as a schema-free `flat_object`,
   *    and that same doc explicitly declines to guarantee per-field analyzer behavior inside
   *    `data` — a caution, not a green light — so sending `filters` here is a deliberate bet on a
   *    `term` clause being exact for a field the indexer can't promise that for. It's a bet worth
   *    making anyway: this repo
   *    already ships an identical `term` filter on another `data.*` subfield of this same resource
   *    type (`document.service.ts`'s `filters_or: ['meeting_id:<id>']` on `v1_meeting_attachment`),
   *    and the failure mode if the bet is wrong is a *visible*, all-or-nothing one (`notes_count: 0`
   *    in `getCommitteeActivity`'s completion log across every committee, trivially distinguishable
   *    from "this committee genuinely has no notes") — not a silent one. The alternative (dropping
   *    the filter and fetching `fetchSize` attachments of every category before filtering
   *    client-side) trades that visible risk for a guaranteed, silent dilution instead: a committee
   *    whose meetings carry non-Notes attachments too would only ever surface notes from its most
   *    recent handful of meetings, with `saturated` firing far more than the actual Notes volume
   *    warrants. If the bet ever proves wrong, the durable fix is an upstream request to add
   *    `category` to the attachment tag sets, not reverting to the client-side-only approach.
   *  - No `date_field`/`date_from`/`date_to` narrowing, unlike the files leg above. `modified_at`
   *    is never actually absent (`ModifiedAt time.Time` has no `omitempty`), but an attachment
   *    whose v1 source record had no parseable `updated_at` gets indexed with `modified_at` set to
   *    Go's zero-date sentinel (`0001-01-01T00:00:00Z` — `parseTime`'s error is swallowed rather
   *    than the field being omitted). An upstream date range filter on `modified_at` would exclude
   *    those sentinel rows even though `firstValidTimestamp` below correctly treats the sentinel as
   *    invalid and falls back to `created_at` for `occurred_at` — the two would silently diverge on
   *    exactly those rows. Same class of problem `fetchSurveyEvents` documents at length for its
   *    own, different reason; this leg follows that same "drop the narrowing" precedent rather than
   *    repeating the files leg's `date_field`, which is safe there only because `committee_document`
   *    rows reliably carry a real, non-sentinel `updated_at`.
   * `since`/`before` are still accepted (unused in the query itself) to keep this leg's call
   * signature uniform with every other fetch* method — the in-memory since/cursor pass in
   * getCommitteeActivity is what actually enforces the window for this leg, exactly as it already
   * does for votes and surveys.
   */
  private async fetchNotesAddedEvents(
    req: Request,
    committeeUid: string,
    _since: string | undefined,
    _before: string | undefined,
    fetchSize: number
  ): Promise<{ events: NotesAddedActivityEvent[]; saturated: boolean }> {
    const [meetingResult, pastMeetingResult] = await Promise.all([
      this.fetchNoteAttachmentPage(req, committeeUid, 'v1_meeting_attachment', 'upcoming-meeting', fetchSize),
      this.fetchNoteAttachmentPage(req, committeeUid, 'v1_past_meeting_attachment', 'past-meeting', fetchSize),
    ]);

    const events = [
      ...this.buildNotesEventsForScope(req, committeeUid, meetingResult.attachments, 'upcoming'),
      ...this.buildNotesEventsForScope(req, committeeUid, pastMeetingResult.attachments, 'past'),
    ];

    // Both sub-legs are bounded to one upstream page_size-limited page (unlike
    // fetchDocumentEvents, where only the files sub-leg is bounded and folders/links are
    // excluded from saturation) — so either one's own page_token signals more data upstream.
    return { events, saturated: !!meetingResult.pageToken || !!pastMeetingResult.pageToken };
  }

  /** One sub-leg's bounded query-service fetch, shared by both attachment types fetchNotesAddedEvents fans out to. */
  private async fetchNoteAttachmentPage(
    req: Request,
    committeeUid: string,
    type: string,
    scopeLabel: string,
    fetchSize: number
  ): Promise<{ attachments: CommitteeActivityNoteAttachment[]; pageToken: string | undefined }> {
    return this.microserviceProxy
      .proxyRequest<QueryServiceResponse<CommitteeActivityNoteAttachment> | null>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type,
        parent: `committee:${committeeUid}`,
        filters: [`category:${NOTES_ATTACHMENT_CATEGORY}`],
        page_size: fetchSize,
        sort: 'updated_desc',
      })
      .then((response) => ({ attachments: (response?.resources ?? []).map((resource) => resource.data), pageToken: response?.page_token }))
      .catch((err) => {
        logger.warning(req, 'get_committee_activity', `Failed to fetch ${scopeLabel} notes attachments, continuing without them`, {
          committee_uid: committeeUid,
          err,
        });
        return { attachments: [] as CommitteeActivityNoteAttachment[], pageToken: undefined as string | undefined };
      });
  }

  /**
   * Applies the client-side `category` backstop and warns if it ever drops a row — the tripwire
   * for the doc comment's "the upstream `filters` term clause might not narrow" bet above.
   * Without this, a non-narrowing upstream filter is invisible: the backstop silently absorbs
   * every non-Notes row and the leg looks healthy while quietly under-serving every request
   * (fetchSize filled with every category, only the newest handful surviving) — the exact
   * "someone eventually notices" failure mode `notes_count: 0` catches for a *fully* failed
   * filter, but with no equivalent signal for a *partially* failed one. Same pattern as
   * fetchPastMeetingEvents's own scheduled_start_time tripwire.
   */
  private buildNotesEventsForScope(
    req: Request,
    committeeUid: string,
    attachments: CommitteeActivityNoteAttachment[],
    meetingScope: 'upcoming' | 'past'
  ): NotesAddedActivityEvent[] {
    const notes = attachments.filter((attachment) => attachment.category === NOTES_ATTACHMENT_CATEGORY);
    const droppedCount = attachments.length - notes.length;
    if (droppedCount > 0) {
      logger.warning(req, 'get_committee_activity', 'Notes category filter did not fully narrow upstream — filters term clause may not be matching', {
        committee_uid: committeeUid,
        meeting_scope: meetingScope,
        dropped_count: droppedCount,
      });
    }
    return notes.map((attachment) => this.buildNotesEvent(committeeUid, attachment, meetingScope));
  }

  private buildNotesEvent(committeeUid: string, attachment: CommitteeActivityNoteAttachment, meetingScope: 'upcoming' | 'past'): NotesAddedActivityEvent {
    return {
      type: 'notes_added',
      // modified_at, not updated_at — v1_meeting_attachment/v1_past_meeting_attachment's indexed
      // data schema carries modified_at (lfx-v2-meeting-service's indexer-contract docs); the
      // ITX-aligned MeetingAttachment/PastMeetingAttachment shape's updated_at field doesn't apply
      // to this query-service-sourced projection (see CommitteeActivityNoteAttachment's doc comment).
      occurred_at: firstValidTimestamp(attachment.modified_at, attachment.created_at),
      committee_uid: committeeUid,
      payload: {
        document_uid: attachment.uid,
        name: attachment.name,
        document_type: attachment.type,
        url: attachment.type === 'link' ? attachment.link : undefined,
        meeting_scope: meetingScope,
      },
    };
  }
}

/**
 * Pre-merge bound for a leg with no upstream page_size (folders/links) — sorts by the same
 * `(occurred_at, key)` order the cursor itself uses (via `compareEventsDesc`/`eventKey`) and keeps
 * the newest `limit`. A plain occurred_at-only sort would tie-break same-timestamp events by
 * whatever order the upstream array happened to return them in — harmless for a single unpaginated
 * call, but if more than `limit` items share one exact timestamp (e.g. a bulk folder import), an
 * occurred_at-only tie would let the survivors of each call vary independently of the cursor,
 * reintroducing the exact permanent-omission failure this function's `since`/`before`/cursor
 * pre-filtering exists to prevent — see the comment at its call site.
 */
function boundedSortDesc<T extends ActivityEvent>(events: T[], limit: number): T[] {
  return [...events]
    .sort((a, b) => compareEventsDesc({ occurred_at: a.occurred_at, key: eventKey(a) }, { occurred_at: b.occurred_at, key: eventKey(b) }))
    .slice(0, limit);
}

/**
 * Inclusive since/before window check for legs with no upstream date filtering (folders/links) —
 * must run BEFORE `boundedSortDesc` on those legs, not after. `since`/`before` mirror the same
 * inclusive bounds sent upstream to every other leg's `date_from`/`date_to`; an event with no
 * parseable `occurred_at` is let through here, since this check alone isn't the whole gate — the
 * call site also `&&`s in `isAfterCursor`, which does reject an unparseable timestamp outright once
 * a cursor is present. Either way, the central `getCommitteeActivity` pass applies the same
 * unparseable-timestamp drop independently, so the final "included or not" outcome is identical
 * regardless of which layer catches it first.
 */
function isWithinFetchWindow(occurredAt: string, since: string | undefined, before: string | undefined): boolean {
  const ms = Date.parse(occurredAt);
  if (Number.isNaN(ms)) return true;
  if (since && ms < Date.parse(since)) return false;
  if (before && ms > Date.parse(before)) return false;
  return true;
}
