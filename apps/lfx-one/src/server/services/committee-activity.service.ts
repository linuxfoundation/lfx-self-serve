// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_MAX_PAGE_SIZE, ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE, PAST_MEETING_SORT } from '@lfx-one/shared/constants';
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
  CommitteeActivityQuery,
  DocumentUploadedActivityEvent,
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
import { firstValidTimestamp, getPastMeetingResourceId, getPastMeetingStartTimeMs, getSurveyDisplayStatus } from '@lfx-one/shared/utils';
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
 * documents) into one time-ordered, cursor-paginated feed — LFXV2-1707 v1. No new upstream
 * service: each source is an existing committee-scoped read, fetched in parallel and merged
 * server-side. See `packages/shared/src/interfaces/activity-event.interface.ts` for which event
 * types this emits vs. defers pending a real event log.
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
    // ITX/Zoom past-meeting-completion events (`docs/event-processing.md`'s `itx-zoom-past-meetings.`
    // stream — a "past meeting" is a derived record generated when an occurrence completes, not
    // something created directly); its source struct `PastMeetingEventData` has no
    // `scheduled_start_time` JSON field at all (`internal/domain/models/event_models.go`), and the
    // one handler that builds it populates `StartTime` FROM the raw record's own `ScheduledStartTime`
    // (`past_meeting_event_handler.go`). So `scheduled_start_time` is never present on a row this leg
    // can read, the fallback always fires, and `sort_name`/occurred_at are always built from the
    // identical value — meetings is exact, not merely the best-behaved approximation, unlike the
    // other three legs below.
    //
    // Votes, surveys, and files are all in a different, genuinely-approximate bucket: query-service's
    // `sort=updated_desc` resolves to the INDEX's own root-level `updated_at` (`cmd/service/
    // converters.go`: `SortBy = "updated_at"`, no `data.` prefix), which the indexer contract
    // documents as index-write/audit metadata, not a copy of any `data.*` domain field — distinct
    // from the `date_field` values these three legs filter on: votes' `data.last_modified_time`,
    // surveys' `data.last_modified_at`, files' `data.updated_at` (each auto-prefixed with `data.` by
    // query-service, unlike `sort`). Files happens to share a field NAME with the sort target
    // (`updated_at` == `updated_at`) despite resolving to a different actual field once `data.`
    // prefixing is applied; surveys' and votes' date_field names don't even coincide with `updated_at`.
    // Same class of approximation as the per-leg date_field caveats below, just in the sort dimension
    // instead of the filter dimension.
    //
    // Known v1 limitation (accepted, not solved — see LFXV2-1707): meetings/votes/surveys/files
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
      // same bad input and (b) still do the full 7-call upstream fan-out below for a result that's
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
    // single-source enrichment services that stay at DEBUG throughout. A merge across 4
    // independently-paginated upstream sources with cursor/saturation logic is exactly the
    // "complex multi-step orchestration" case logging-patterns.md reserves INFO for.
    logger.info(req, 'get_committee_activity', 'Starting committee activity aggregation', { committee_uid: committeeUid, fetch_size: fetchSize });

    const [committee, pastMeetingEvents, voteEvents, surveyEvents, documentResult] = await Promise.all([
      this.fetchCommittee(req, committeeUid),
      this.fetchPastMeetingEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch past-meeting activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
      this.fetchVoteEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch vote activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
      this.fetchSurveyEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch survey activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
      this.fetchDocumentEvents(req, committeeUid, since, before, fetchSize, cursor).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch document activity, continuing without it', { committee_uid: committeeUid, err });
        return { events: [], saturated: false };
      }),
    ]);

    // A committee-lookup failure already rejected the whole Promise.all above (see fetchCommittee's
    // doc comment) — by this line `committee` is always a resolved Committee.
    const votingEnabled = committee.enable_voting;
    const sources: ActivityEvent[][] = [pastMeetingEvents, votingEnabled ? voteEvents : [], surveyEvents, documentResult.events];

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
    // meetings/votes/surveys/files is bounded to a single upstream page of `fetchSize` rows (see
    // the caveat above), so once a page's fetch actually hits that bound, there could be more rows
    // upstream than made it into `windowed` even though the merged pool itself isn't over `limit` —
    // e.g. a single dominant source returning exactly `fetchSize` rows, several of which get
    // dropped by the in-memory since/cursor/invalid-timestamp filters, can leave `windowed.length`
    // at or under `limit` while real, unfetched rows remain beyond this page's upstream cutoff.
    // Folders/links are excluded from this saturation check — they have no upstream page bound at
    // all (fetched in full every call) and are already filtered+bounded correctly against the exact
    // cursor inside fetchDocumentEvents, so a fetched length at `fetchSize` there reflects this
    // leg's own internal cap, not an upstream truncation signal.
    const anyLegSaturated =
      pastMeetingEvents.length >= fetchSize ||
      (votingEnabled && voteEvents.length >= fetchSize) ||
      surveyEvents.length >= fetchSize ||
      documentResult.saturated;

    const page = windowed.slice(0, limit);
    const data = page.map(({ event }) => event);
    // Every item in `page` now has a real timestamp (windowed already dropped the ones that
    // don't), so the last page item is always a valid cursor position — no need to search backward
    // for one. `hasMore` still requires a real `lastPageItem` to anchor a cursor on — if saturation
    // is detected but this page came back empty (every fetched row got filtered out), there is no
    // position left to resume from, so this degrades to the same "nothing more to report" outcome
    // as before; an over-fetch this narrow (an entire upstream page filtered to zero matches) is
    // accepted as a known residual rather than solved by a second round-trip within this call.
    const lastPageItem = page.at(-1);
    const hasMore = (windowed.length > limit || anyLegSaturated) && !!lastPageItem;
    const pageToken = hasMore && lastPageItem ? encodeActivityPageToken({ before: lastPageItem.event.occurred_at, key: lastPageItem.key }) : undefined;

    logger.info(req, 'get_committee_activity', 'Completed committee activity aggregation', {
      committee_uid: committeeUid,
      meeting_count: pastMeetingEvents.length,
      vote_count: voteEvents.length,
      survey_count: surveyEvents.length,
      document_count: documentResult.events.length,
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
   * `GET /committees/:uid` is the one leg in this fan-out backed by committee-service's real
   * per-request FGA enforcement (the four `/query/resources` legs instead filter per-resource,
   * never 403 the whole request — see the controller's docblock); catching a 403/404 here the same
   * way as the other legs would silently downgrade "caller isn't authorized for this committee at
   * all" into "votes excluded, everything else renders", which is a materially different, and
   * wrong, outcome for that case. A transient failure (5xx/network) fails the whole request too —
   * matching `committee-engagement`'s `assertCommitteeRead`, which fails closed on both a resolved
   * `false` and a thrown upstream error, rather than treating "couldn't verify" as "verified false".
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
  ): Promise<ActivityEvent[]> {
    // date_field: 'start_time' — unlike every other leg's date_field narrowing (all best-effort, see
    // their own comments), this one IS a correctness guarantee, not just an approximation: occurred_at
    // (getPastMeetingStartTimeMs) prefers scheduled_start_time, falling back to start_time — but the
    // indexed v1_past_meeting projection this leg reads never carries scheduled_start_time at all
    // (see the "Meetings" paragraph in getCommitteeActivity's fetchSize comment for the verified
    // source), so that fallback always fires and occurred_at is always built from the same start_time
    // field this date_field narrows on. The in-memory since/cursor pass in getCommitteeActivity is
    // still the one place that enforces the exact boundary (this narrowing only bounds what's
    // fetched), but for this leg specifically it can't under-fetch relative to occurred_at the way
    // the other legs' single-field-vs-fallback-derivation approximations can.
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
    const { data: meetings } = (await this.meetingService.getMeetings(req, query, 'v1_past_meeting', false)) as { data: PastMeeting[] };

    return meetings.map((meeting) => {
      const startMs = getPastMeetingStartTimeMs(meeting);
      const occurredAt = startMs !== null ? new Date(startMs).toISOString() : '';
      return {
        type: 'meeting_held',
        occurred_at: occurredAt,
        committee_uid: committeeUid,
        payload: { meeting_id: meeting.id, meeting_occurrence_id: getPastMeetingResourceId(meeting), title: meeting.title },
      };
    });
  }

  // ─── Votes → vote_opened | vote_closed ─────────────────────────────────────

  private async fetchVoteEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number
  ): Promise<(VoteOpenedActivityEvent | VoteClosedActivityEvent)[]> {
    // date_field: 'last_modified_time' is best-effort narrowing, same caveat as
    // fetchPastMeetingEvents — a vote's occurred_at is actually
    // end_time/early_end_time/last_modified_time/creation_time depending on status, not always
    // last_modified_time. See fetchPastMeetingEvents's comment for why narrowing (imperfectly) beats
    // not narrowing at all.
    const hasWindow = !!since || !!before;
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      sort: 'updated_desc',
      ...(hasWindow && { date_field: 'last_modified_time' }),
      ...(since && { date_from: since }),
      ...(before && { date_to: before }),
    };

    const { data: votes } = await this.voteService.getVotes(req, query);
    return votes.map((vote) => this.mapVoteToEvent(vote, committeeUid));
  }

  /**
   * One event per vote row (not two) — deliberate: this is an aggregation over current state, not
   * a real event log, so only the vote's most recent lifecycle point is known. Keeps the feed's
   * row count/rendering identical to the old client-side widget (one row per vote). A real event
   * log would naturally emit both `vote_opened` and `vote_closed` as they occur.
   */
  private mapVoteToEvent(vote: Vote, committeeUid: string): VoteOpenedActivityEvent | VoteClosedActivityEvent {
    const isClosed = vote.status === PollStatus.ENDED || !!vote.early_end_time;
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
  ): Promise<(SurveyPublishedActivityEvent | SurveyClosedActivityEvent)[]> {
    const hasWindow = !!since || !!before;
    const query: Record<string, unknown> = {
      type: 'survey',
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      sort: 'updated_desc',
      // Best-effort narrowing, same caveat as fetchPastMeetingEvents — occurred_at is
      // firstValidTimestamp(survey.last_modified_at, survey.created_at), so a never-modified
      // survey (last_modified_at is the Go zero-date, created_at is the real value) could be
      // excluded upstream on this field before the in-memory backstop ever sees it.
      ...(hasWindow && { date_field: 'last_modified_at' }),
      ...(since && { date_from: since }),
      ...(before && { date_to: before }),
    };

    // Deliberately not SurveyService.getSurveys — that always fully drains every page via
    // fetchAllQueryResources and does an extra per-user "responded" join, neither of which this
    // bounded, presentation-only fetch needs.
    //
    // `| null` — see fetchCommittee's note above on why this file annotates it per call site.
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey> | null>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', query);

    return (response?.resources ?? []).map((resource) => this.mapSurveyToEvent(resource.data, committeeUid));
  }

  private mapSurveyToEvent(survey: Survey, committeeUid: string): SurveyPublishedActivityEvent | SurveyClosedActivityEvent {
    const displayStatus = getSurveyDisplayStatus(survey);
    return {
      type: displayStatus === SurveyStatus.CLOSED ? 'survey_closed' : 'survey_published',
      occurred_at: firstValidTimestamp(survey.last_modified_at, survey.created_at),
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

    const [folders, links, files] = await Promise.all([
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
        .then((response) => (response?.resources ?? []).map((resource) => resource.data))
        .catch((err) => {
          logger.warning(req, 'get_committee_activity', 'Failed to fetch committee files, continuing without them', { committee_uid: committeeUid, err });
          return [] as CommitteeActivityDocumentFile[];
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
    // upstream ever caps what this leg can re-fetch. The sibling meetings/votes/surveys/files legs
    // are each capped to one upstream page of fetchSize and can still hit the same failure if more
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
    const fileEvents = files.map((file) =>
      this.buildDocumentEvent(committeeUid, file.uid, file.name, 'file', firstValidTimestamp(file.updated_at, file.created_at))
    );

    // Only the files leg feeds `saturated` — it's the one document sub-leg bounded by an upstream
    // page_size (like meetings/votes/surveys), so a fetched length at fetchSize is a real signal
    // there could be more upstream. Folders/links are deliberately excluded: they have no upstream
    // bound at all (fetched in full, every call) and are already filtered+bounded against the exact
    // cursor above, so hitting fetchSize there reflects this leg's own correct internal cap, not an
    // under-fetch.
    return { events: [...folderEvents, ...linkEvents, ...fileEvents], saturated: files.length >= fetchSize };
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
