// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE, PAST_MEETING_SORT } from '@lfx-one/shared/constants';
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

import { encodeActivityPageToken } from '../helpers/committee-activity-query.helper';
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
 * own natural uid, prefixed by source so ids from different sources can never collide.
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
      return `document:${event.payload.document_uid}`;
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
 */
function compareEventsDesc(a: { occurred_at: string; key: string }, b: { occurred_at: string; key: string }): number {
  const byTime = timestampValue(b.occurred_at) - timestampValue(a.occurred_at);
  if (byTime !== 0) return byTime;
  return b.key.localeCompare(a.key);
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
    const { since, cursor, limit } = options;
    // Fetching `limit + 1` from EACH source (not just `limit`) guarantees the true global
    // top-(limit+1) merged-by-occurred_at result is present in the fetched pool, even in the
    // worst case where a single source contributes every one of the top items — a smaller
    // per-source fetch could silently under-represent a dominant source. ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE
    // keeps small `limit` values (e.g. 1) from starving that guarantee.
    const fetchSize = Math.max(limit + 1, ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE);
    const before = cursor?.before;

    const [committee, pastMeetingEvents, voteEvents, surveyEvents, documentEvents] = await Promise.all([
      this.fetchCommittee(req, committeeUid),
      this.fetchPastMeetingEvents(req, committeeUid, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch past-meeting activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
      this.fetchVoteEvents(req, committeeUid, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch vote activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
      this.fetchSurveyEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch survey activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
      this.fetchDocumentEvents(req, committeeUid, since, before, fetchSize).catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch document activity, continuing without it', { committee_uid: committeeUid, err });
        return [];
      }),
    ]);

    // Committee lookup failure defaults to voting excluded (conservative) rather than included —
    // we can't confirm enable_voting, and showing vote activity for a committee we couldn't
    // verify is worse than briefly under-showing it.
    const votingEnabled = committee?.enable_voting ?? false;
    const sources: ActivityEvent[][] = [pastMeetingEvents, votingEnabled ? voteEvents : [], surveyEvents, documentEvents];

    // Single pass: attach each event's sort key once, apply since/cursor, sort desc by
    // (occurred_at, key). No per-source pre-cap — a global sort+slice already picks the true top
    // `limit` by time regardless of which source they came from; an artificial per-source quota
    // would only make this LESS "time-ordered", not more correct.
    const keyed = sources.flat().map((event) => ({ event, key: eventKey(event) }));
    const windowed = keyed.filter(
      ({ event, key }) => isAtOrAfterSince(event.occurred_at, since) && isAfterCursor({ occurred_at: event.occurred_at, key }, cursor)
    );
    windowed.sort((a, b) => compareEventsDesc({ occurred_at: a.event.occurred_at, key: a.key }, { occurred_at: b.event.occurred_at, key: b.key }));

    const hasMore = windowed.length > limit;
    const page = windowed.slice(0, limit);
    const data = page.map(({ event }) => event);
    // Cursor from the last item with a real (parseable) timestamp, not necessarily page's last
    // entry — an event with no usable timestamp sorts last but would produce a page_token this
    // server can't decode on the very next request (isParseableTimestamp would reject it).
    const cursorSource = [...page].reverse().find(({ event }) => timestampValue(event.occurred_at) !== -Infinity);
    const pageToken = hasMore && cursorSource ? encodeActivityPageToken({ before: cursorSource.event.occurred_at, key: cursorSource.key }) : undefined;

    logger.debug(req, 'get_committee_activity', 'Completed committee activity aggregation', {
      committee_uid: committeeUid,
      meeting_count: pastMeetingEvents.length,
      vote_count: voteEvents.length,
      survey_count: surveyEvents.length,
      document_count: documentEvents.length,
      voting_enabled: votingEnabled,
      returned: data.length,
      has_more: hasMore,
    });

    return { data, page_token: pageToken };
  }

  // ─── Committee (for enable_voting) ─────────────────────────────────────────

  private async fetchCommittee(req: Request, committeeUid: string): Promise<Committee | null> {
    return this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeUid}`, 'GET').catch((err) => {
      logger.warning(req, 'get_committee_activity', 'Failed to fetch committee; defaulting votes to excluded', { committee_uid: committeeUid, err });
      return null;
    });
  }

  // ─── Past Meetings → meeting_held ──────────────────────────────────────────

  private async fetchPastMeetingEvents(req: Request, committeeUid: string, fetchSize: number): Promise<ActivityEvent[]> {
    // No date_field/date_from/date_to on this leg — occurred_at is derived via
    // getPastMeetingStartTimeMs, which prefers scheduled_start_time and falls back to start_time,
    // so a single upstream date_field can't represent that fallback and would silently exclude a
    // row whose in-window value lives on the field NOT selected (this leg has no in-memory
    // recovery path once upstream never returns the row at all). NAME_DESC already sorts by
    // start_time (see the sort comment below), and fetchSize + the since/cursor filter in
    // getCommitteeActivity bound and narrow the result correctly without it.
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      // NAME_DESC, not UPDATED_DESC — the meeting-service indexer populates sort_name from
      // start_time (packages/shared/src/constants/meeting.constants.ts), so NAME_DESC is the
      // start_time-ordered sort this leg actually needs; UPDATED_DESC sorts by index update time,
      // unrelated to occurred_at.
      sort: PAST_MEETING_SORT.NAME_DESC,
    };

    // access=false — the activity row only needs title/start_time, not per-meeting writer flags,
    // so skip the access-check call getMeetings otherwise makes for every returned meeting.
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

  private async fetchVoteEvents(req: Request, committeeUid: string, fetchSize: number): Promise<(VoteOpenedActivityEvent | VoteClosedActivityEvent)[]> {
    // No date_field/date_from/date_to on this leg, same rationale as fetchPastMeetingEvents — a
    // vote's occurred_at is end_time/early_end_time/last_modified_time/creation_time depending on
    // status, not a single field a `date_field` param can represent. sort: 'updated_desc' + the
    // since/cursor filter in getCommitteeActivity bound and narrow the result correctly instead.
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      sort: 'updated_desc',
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
      // Unlike meetings/votes, last_modified_at genuinely is occurred_at's primary field here
      // (firstValidTimestamp(survey.last_modified_at, survey.created_at)) — no fallback-field
      // mismatch, so upstream narrowing on it is safe, not just best-effort.
      ...(hasWindow && { date_field: 'last_modified_at' }),
      ...(since && { date_from: since }),
      ...(before && { date_to: before }),
    };

    // Deliberately not SurveyService.getSurveys — that always fully drains every page via
    // fetchAllQueryResources and does an extra per-user "responded" join, neither of which this
    // bounded, presentation-only fetch needs.
    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', query);

    return resources.map((resource) => this.mapSurveyToEvent(resource.data, committeeUid));
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
    fetchSize: number
  ): Promise<DocumentUploadedActivityEvent[]> {
    const hasWindow = !!since || !!before;

    const [folders, links, files] = await Promise.all([
      this.microserviceProxy.proxyRequest<CommitteeActivityFolder[]>(req, 'LFX_V2_SERVICE', `/committees/${committeeUid}/folders`, 'GET').catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch committee folders, continuing without them', { committee_uid: committeeUid, err });
        return [] as CommitteeActivityFolder[];
      }),
      this.microserviceProxy.proxyRequest<CommitteeActivityLink[]>(req, 'LFX_V2_SERVICE', `/committees/${committeeUid}/links`, 'GET').catch((err) => {
        logger.warning(req, 'get_committee_activity', 'Failed to fetch committee links, continuing without them', { committee_uid: committeeUid, err });
        return [] as CommitteeActivityLink[];
      }),
      // Single bounded page, not CommitteeService.getCommitteeDocuments's fetchAllQueryResources
      // drain — this endpoint must stay bounded (no per-event follow-ups), so a page_size-limited
      // page is enough for a "recent activity" feed even though it isn't the complete file list.
      this.microserviceProxy
        .proxyRequest<QueryServiceResponse<CommitteeActivityDocumentFile>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'committee_document',
          tags: `committee_uid:${committeeUid}`,
          page_size: fetchSize,
          sort: 'updated_desc',
          ...(hasWindow && { date_field: 'updated_at' }),
          ...(since && { date_from: since }),
          ...(before && { date_to: before }),
        })
        .then((response) => response.resources.map((resource) => resource.data))
        .catch((err) => {
          logger.warning(req, 'get_committee_activity', 'Failed to fetch committee files, continuing without them', { committee_uid: committeeUid, err });
          return [] as CommitteeActivityDocumentFile[];
        }),
    ]);

    // GET /committees/:id/folders and /links accept no page_size/date param at all and return
    // every folder/link on the committee unconditionally — bound each to fetchSize here (sorted
    // by its own occurred_at desc) so this leg can't return an unbounded candidate pool. The
    // since/cursor window itself is applied once, centrally, in getCommitteeActivity.
    const folderEvents = boundedSortDesc(
      folders.map((folder) =>
        this.buildDocumentEvent(committeeUid, folder.uid, folder.name, 'folder', firstValidTimestamp(folder.updated_at, folder.created_at))
      ),
      fetchSize
    );
    const linkEvents = boundedSortDesc(
      links.map((link) => this.buildDocumentEvent(committeeUid, link.uid, link.name, 'link', firstValidTimestamp(link.updated_at, link.created_at), link.url)),
      fetchSize
    );
    const fileEvents = files.map((file) =>
      this.buildDocumentEvent(committeeUid, file.uid, file.name, 'file', firstValidTimestamp(file.updated_at, file.created_at))
    );

    return [...folderEvents, ...linkEvents, ...fileEvents];
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

function boundedSortDesc<T extends { occurred_at: string }>(events: T[], limit: number): T[] {
  return [...events].sort((a, b) => timestampValue(b.occurred_at) - timestampValue(a.occurred_at)).slice(0, limit);
}
