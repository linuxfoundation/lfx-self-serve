// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE, PAST_MEETING_SORT } from '@lfx-one/shared/constants';
import { PollStatus, SurveyStatus } from '@lfx-one/shared/enums';
// import type — erased entirely at compile time, so unlike the enums/utils imports below, this
// one needs no vi.mock in the spec (same reasoning as activity-feed.utils.ts's own interfaces import).
import type {
  ActivityEvent,
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

function sortDescByOccurredAt<T extends { occurred_at: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => timestampValue(b.occurred_at) - timestampValue(a.occurred_at));
}

/**
 * True when `occurredAt` falls within `[since, before)` — the single source of truth for window
 * membership, applied to the full merged pool in `getCommitteeActivity` (not per-source). Per-leg
 * upstream `date_from`/`date_to` are best-effort narrowing only: query-service's `date_to` is
 * documented *inclusive*, while this endpoint's cursor contract is exclusive, and two legs
 * (committee folders/links) accept no date param at all — relying on any single leg's upstream
 * filtering for correctness would both re-return a page's boundary item forever (the inclusive/
 * exclusive mismatch) and miss folders/links entirely. Applying this filter once, centrally, after
 * every source has computed its real `occurred_at`, is correct regardless of what each leg's
 * upstream filtering did or didn't narrow. An unparseable/missing timestamp is excluded whenever a
 * window is active — it can't be verified to belong in the window — but kept when there's no
 * window (matches the old client-side feed, which sorted an invalid timestamp to the bottom rather
 * than dropping it).
 */
function isWithinWindow(occurredAt: string, since: string | undefined, before: string | undefined): boolean {
  if (!since && !before) return true;
  const ms = Date.parse(occurredAt);
  if (Number.isNaN(ms)) return false;
  if (since && ms < Date.parse(since)) return false;
  if (before && ms >= Date.parse(before)) return false;
  return true;
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
    const { since, before, limit } = options;
    // Fetching `limit + 1` from EACH source (not just `limit`) guarantees the true global
    // top-(limit+1) merged-by-occurred_at result is present in the fetched pool, even in the
    // worst case where a single source contributes every one of the top items — a smaller
    // per-source fetch could silently under-represent a dominant source. ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE
    // keeps small `limit` values (e.g. 1) from starving that guarantee.
    const fetchSize = Math.max(limit + 1, ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE);

    const [committee, pastMeetingEvents, voteEvents, surveyEvents, documentEvents] = await Promise.all([
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

    // Pure chronological merge — no per-source pre-cap. Each source already carries at most
    // fetchSize items (bounded above), and a global sort+slice already picks the true top `limit`
    // by time regardless of which source they came from; an artificial per-source quota would only
    // make this LESS "time-ordered", not more correct. The window filter runs here, once, against
    // every source's computed occurred_at — see isWithinWindow's doc comment for why per-leg
    // upstream filtering alone isn't sufficient.
    const windowed = sources.flat().filter((event) => isWithinWindow(event.occurred_at, since, before));
    const merged = sortDescByOccurredAt(windowed);

    const hasMore = merged.length > limit;
    const data = merged.slice(0, limit);
    // Cursor from the last item with a real timestamp, not necessarily data[data.length - 1] —
    // an event with no usable timestamp sorts last (timestampValue('') === -Infinity) but would
    // produce a page_token that fails isParseableTimestamp on the very next request. Omitting the
    // token entirely in that case is safer than a token the server itself can't decode.
    const cursorTimestamp = [...data].reverse().find((event) => event.occurred_at)?.occurred_at;
    const pageToken = hasMore && cursorTimestamp ? encodeActivityPageToken(cursorTimestamp) : undefined;

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

  private async fetchPastMeetingEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number
  ): Promise<ActivityEvent[]> {
    const hasWindow = !!since || !!before;
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      // NAME_DESC, not UPDATED_DESC — the meeting-service indexer populates sort_name from
      // start_time (packages/shared/src/constants/meeting.constants.ts), so NAME_DESC is the
      // start_time-ordered sort this leg actually needs; UPDATED_DESC sorts by index update time,
      // unrelated to occurred_at.
      sort: PAST_MEETING_SORT.NAME_DESC,
      // Best-effort narrowing only — occurred_at is actually derived via getPastMeetingStartTimeMs
      // (prefers scheduled_start_time, falls back to start_time), so filtering upstream on
      // start_time alone can miss a row whose scheduled_start_time is the real, in-window value.
      // The isWithinWindow pass in getCommitteeActivity is the correctness backstop.
      ...(hasWindow && { date_field: 'start_time' }),
      ...(since && { date_from: since }),
      ...(before && { date_to: before }),
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

  private async fetchVoteEvents(
    req: Request,
    committeeUid: string,
    since: string | undefined,
    before: string | undefined,
    fetchSize: number
  ): Promise<(VoteOpenedActivityEvent | VoteClosedActivityEvent)[]> {
    const hasWindow = !!since || !!before;
    const query: Record<string, unknown> = {
      tags: `committee_uid:${committeeUid}`,
      page_size: fetchSize,
      sort: 'updated_desc',
      // Best-effort narrowing only (see fetchPastMeetingEvents) — a vote's occurred_at is derived
      // from end_time/early_end_time when closed, creation_time when open, not always
      // last_modified_time. The isWithinWindow pass in getCommitteeActivity is the backstop.
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

    // Folders/links have no upstream date param at all (confirmed gap — neither REST endpoint
    // accepts one), so their window filtering happens entirely in getCommitteeActivity's
    // isWithinWindow pass, same as every other source.
    const folderEvents = folders.map((folder) =>
      this.buildDocumentEvent(committeeUid, folder.uid, folder.name, 'folder', firstValidTimestamp(folder.updated_at, folder.created_at))
    );
    const linkEvents = links.map((link) =>
      this.buildDocumentEvent(committeeUid, link.uid, link.name, 'link', firstValidTimestamp(link.updated_at, link.created_at), link.url)
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
