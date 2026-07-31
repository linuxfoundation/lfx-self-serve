// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for committee-activity.service.ts. All fixtures use synthetic placeholder
// identities — never real user data.

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@lfx-one/shared/*` isn't wired into this app's vitest config (same issue documented in
// committee-engagement-window.helper.spec.ts) — enums/utils need stubs; the interfaces import in
// the service under test is `import type`, so it's erased and needs no mock at all.
const { proxyRequest, getMeetings, getVotes, encodeActivityPageToken, warning, debug } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getMeetings: vi.fn(),
  getVotes: vi.fn(),
  encodeActivityPageToken: vi.fn((cursor: { before: string; key: string }) => `token(${cursor.before}|${cursor.key})`),
  warning: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', async () => {
  const activityEvent = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/activity-event.constants')>(
    '../../../../../packages/shared/src/constants/activity-event.constants'
  );
  const meeting = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/meeting.constants')>(
    '../../../../../packages/shared/src/constants/meeting.constants'
  );
  return {
    ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE: activityEvent.ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE,
    PAST_MEETING_SORT: meeting.PAST_MEETING_SORT,
  };
});
vi.mock('@lfx-one/shared/enums', () => ({
  PollStatus: { ACTIVE: 'active', DISABLED: 'disabled', ENDED: 'ended' },
  SurveyStatus: { OPEN: 'open', CLOSED: 'closed', SCHEDULED: 'scheduled', DRAFT: 'draft', SENT: 'sent' },
}));
vi.mock('@lfx-one/shared/utils', async () => {
  const iso = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/iso-timestamp.utils')>(
    '../../../../../packages/shared/src/utils/iso-timestamp.utils'
  );
  const pastMeetingUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/past-meeting.utils')>(
    '../../../../../packages/shared/src/utils/past-meeting.utils'
  );
  const surveyUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/survey.utils')>(
    '../../../../../packages/shared/src/utils/survey.utils'
  );
  return {
    firstValidTimestamp: iso.firstValidTimestamp,
    getPastMeetingStartTimeMs: pastMeetingUtils.getPastMeetingStartTimeMs,
    getPastMeetingResourceId: pastMeetingUtils.getPastMeetingResourceId,
    getSurveyDisplayStatus: surveyUtils.getSurveyDisplayStatus,
  };
});
vi.mock('../helpers/committee-activity-query.helper', () => ({ encodeActivityPageToken }));
vi.mock('./logger.service', () => ({ logger: { debug, warning, info: vi.fn(), startOperation: vi.fn(), success: vi.fn() } }));
vi.mock('./meeting.service', () => ({
  MeetingService: class {
    getMeetings = getMeetings;
  },
}));
vi.mock('./vote.service', () => ({
  VoteService: class {
    getVotes = getVotes;
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    proxyRequest = proxyRequest;
  },
}));

import { PollStatus, SurveyStatus } from '@lfx-one/shared/enums';
import type { ActivityPageCursor, PastMeeting, Survey, Vote } from '@lfx-one/shared/interfaces';

import { CommitteeActivityService } from './committee-activity.service';

const req = {} as unknown as Request;
const COMMITTEE_UID = 'committee-1';

function pastMeeting(overrides: Partial<PastMeeting> = {}): PastMeeting {
  return {
    id: 'pm-1',
    meeting_and_occurrence_id: 'pm-1-occ-1',
    title: 'Weekly Sync',
    start_time: '2026-01-01T10:00:00Z',
    scheduled_start_time: '',
    ...overrides,
  } as PastMeeting;
}

function vote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Q1 Budget',
    status: PollStatus.ACTIVE,
    creation_time: '2026-01-02T10:00:00Z',
    end_time: '2026-01-10T00:00:00Z',
    ...overrides,
  } as Vote;
}

function survey(overrides: Partial<Survey> = {}): Survey {
  return {
    uid: 'survey-1',
    survey_title: 'Community Feedback',
    survey_status: SurveyStatus.OPEN,
    survey_cutoff_date: null,
    created_at: '2026-01-03T10:00:00Z',
    last_modified_at: '2026-01-03T10:00:00Z',
    ...overrides,
  } as Survey;
}

/** Default proxyRequest router: benign empty responses for every leg unless a test overrides it. */
function defaultProxyRequest(_req: Request, _service: string, path: string, _method: string, query?: Record<string, unknown>): unknown {
  if (path.endsWith('/folders')) return Promise.resolve([]);
  if (path.endsWith('/links')) return Promise.resolve([]);
  if (path === '/query/resources' && query?.['type'] === 'survey') return Promise.resolve({ resources: [] });
  if (path === '/query/resources' && query?.['type'] === 'committee_document') return Promise.resolve({ resources: [] });
  if (/^\/committees\/[^/]+$/.test(path)) return Promise.resolve({ uid: COMMITTEE_UID, enable_voting: true });
  throw new Error(`Unhandled proxyRequest call in test: ${path}`);
}

describe('CommitteeActivityService', () => {
  let service: CommitteeActivityService;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRequest.mockImplementation(defaultProxyRequest);
    getMeetings.mockResolvedValue({ data: [] });
    getVotes.mockResolvedValue({ data: [] });
    encodeActivityPageToken.mockImplementation((cursor: { before: string; key: string }) => `token(${cursor.before}|${cursor.key})`);
    service = new CommitteeActivityService();
  });

  it('returns an empty feed when every source is empty', async () => {
    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result).toEqual({ data: [], page_token: undefined });
  });

  it('merges all four sources and sorts the result by occurred_at descending', async () => {
    getMeetings.mockResolvedValue({ data: [pastMeeting({ start_time: '2026-01-01T00:00:00Z' })] });
    getVotes.mockResolvedValue({ data: [vote({ status: PollStatus.ENDED, end_time: '2026-01-03T00:00:00Z' })] });
    proxyRequest.mockImplementation((r, s, path, m, query) => {
      if (path === '/query/resources' && query?.['type'] === 'survey') {
        return Promise.resolve({ resources: [{ type: 'survey', id: 'survey-1', data: survey({ last_modified_at: '2026-01-02T00:00:00Z' }) }] });
      }
      if (path === '/query/resources' && query?.['type'] === 'committee_document') {
        return Promise.resolve({
          resources: [{ type: 'committee_document', id: 'doc-1', data: { uid: 'doc-1', name: 'Charter.pdf', updated_at: '2026-01-04T00:00:00Z' } }],
        });
      }
      return defaultProxyRequest(r, s, path, m, query);
    });

    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data.map((e) => e.type)).toEqual(['document_uploaded', 'vote_closed', 'survey_published', 'meeting_held']);
  });

  it('sorts an unparseable vote timestamp as the oldest item instead of throwing', async () => {
    getVotes.mockResolvedValue({ data: [vote({ creation_time: 'not-a-timestamp', last_modified_time: undefined })] });
    proxyRequest.mockImplementation((r, s, path, m, query) => {
      if (path === '/query/resources' && query?.['type'] === 'survey') {
        return Promise.resolve({ resources: [{ type: 'survey', id: 'survey-1', data: survey({ last_modified_at: '2026-01-01T00:00:00Z' }) }] });
      }
      return defaultProxyRequest(r, s, path, m, query);
    });

    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data.map((e) => e.type)).toEqual(['survey_published', 'vote_opened']);
  });

  it('sorts past meetings by name_desc (start_time-ordered), not updated_desc (index-update-time-ordered)', async () => {
    await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(getMeetings).toHaveBeenCalledWith(req, expect.objectContaining({ sort: 'name_desc' }), 'v1_past_meeting', false);
  });

  it('keys a meeting_held event on meeting_and_occurrence_id, not just meeting_id', async () => {
    getMeetings.mockResolvedValue({ data: [pastMeeting({ id: 'pm-42', meeting_and_occurrence_id: 'pm-42-occ-9' })] });
    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data[0]).toMatchObject({ type: 'meeting_held', payload: { meeting_id: 'pm-42', meeting_occurrence_id: 'pm-42-occ-9' } });
  });

  it('does not sort a past meeting as ancient when start_time is a Go zero-date', async () => {
    getMeetings.mockResolvedValue({ data: [pastMeeting({ start_time: '0001-01-01T00:00:00Z', scheduled_start_time: '2026-01-05T00:00:00Z' })] });
    proxyRequest.mockImplementation((r, s, path, m, query) => {
      if (path === '/query/resources' && query?.['type'] === 'survey') {
        return Promise.resolve({ resources: [{ type: 'survey', id: 'survey-1', data: survey({ last_modified_at: '2026-01-01T00:00:00Z' }) }] });
      }
      return defaultProxyRequest(r, s, path, m, query);
    });

    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data.map((e) => e.type)).toEqual(['meeting_held', 'survey_published']);
  });

  describe('since/cursor/limit handling', () => {
    it('sends since as date_from and cursor.before as date_to to every source, as best-effort narrowing', async () => {
      // Every leg's occurred_at is derived from a field-fallback a single upstream date_field can't
      // fully represent (see the comments in fetchPastMeetingEvents/fetchVoteEvents/etc.) — the
      // upstream date params are best-effort narrowing to keep the fetched volume small, not a
      // correctness guarantee. The in-memory since/cursor filter in getCommitteeActivity is what
      // actually enforces the window; dropping the upstream narrowing entirely (an earlier version
      // of this fix) traded that rare miss for hard truncation at fetchSize on every page instead.
      await service.getCommitteeActivity(req, COMMITTEE_UID, {
        since: '2026-01-01T00:00:00Z',
        cursor: { before: '2026-02-01T00:00:00Z', key: 'vote:unrelated' },
        limit: 8,
      });

      // date_to is ceiled to the next whole second before being sent upstream (see the dedicated
      // ceiling test below) — an already-whole-second cursor still round-trips through
      // Date.toISOString(), which always emits milliseconds, hence the trailing `.000Z`.
      expect(getMeetings).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ date_field: 'start_time', date_from: '2026-01-01T00:00:00Z', date_to: '2026-02-01T00:00:00.000Z' }),
        'v1_past_meeting',
        false
      );
      expect(getVotes).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ date_field: 'last_modified_time', date_from: '2026-01-01T00:00:00Z', date_to: '2026-02-01T00:00:00.000Z' })
      );
      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ type: 'survey', date_field: 'last_modified_at', date_from: '2026-01-01T00:00:00Z', date_to: '2026-02-01T00:00:00.000Z' })
      );
    });

    it('ceils a sub-second cursor to the next whole second before sending it upstream as date_to', async () => {
      // query-service reformats date_to through Go's time.RFC3339 (no fractional-seconds layout),
      // silently truncating sub-second precision — a raw cursor.before with milliseconds would
      // shrink the upstream boundary below the true cursor position and permanently exclude
      // same-second siblings before the in-memory isAfterCursor pass ever sees them. Ceiling
      // guarantees the upstream boundary is never tighter than the true one.
      await service.getCommitteeActivity(req, COMMITTEE_UID, {
        cursor: { before: '2026-02-01T00:00:00.123Z', key: 'vote:unrelated' },
        limit: 8,
      });

      expect(getVotes).toHaveBeenCalledWith(req, expect.objectContaining({ date_to: '2026-02-01T00:00:01.000Z' }));
    });

    it('resolves an empty, logged feed (rather than throwing) when cursor.before is unparseable', async () => {
      // getCommitteeActivity is a public method — the controller always validates cursor.before via
      // decodePageToken first, but a future non-HTTP caller could invoke this directly with a bad
      // value. The net result isn't "widened fetch, trimmed correctly" — isAfterCursor still
      // compares every event against the original unparseable cursor.before, which resolves to
      // -Infinity, so every real event is filtered out regardless of what the (wider) upstream
      // fetch returned. That's still the right call over throwing (empty + logged beats a 500), but
      // the test should pin the actual behavior, not just the outbound query shape.
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v1' })] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, {
        cursor: { before: 'not-a-timestamp', key: 'vote:unrelated' },
        limit: 8,
      });

      const votesQuery = getVotes.mock.calls[0][1];
      expect(votesQuery).not.toHaveProperty('date_to');
      expect(result.data).toEqual([]);
      expect(warning).toHaveBeenCalledWith(
        req,
        'get_committee_activity',
        expect.stringContaining('Unparseable cursor.before'),
        expect.objectContaining({ committee_uid: COMMITTEE_UID })
      );
    });

    it('requests page_size = max(limit + 1, 25) from every source', async () => {
      await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 2 });
      expect(getMeetings).toHaveBeenCalledWith(req, expect.objectContaining({ page_size: 25 }), 'v1_past_meeting', false);
      expect(getVotes).toHaveBeenCalledWith(req, expect.objectContaining({ page_size: 25 }));

      await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 30 });
      expect(getMeetings).toHaveBeenCalledWith(req, expect.objectContaining({ page_size: 31 }), 'v1_past_meeting', false);
    });

    it('caps the returned feed at limit and sets a (before, key) page_token when more candidates exist', async () => {
      getVotes.mockResolvedValue({
        data: [
          vote({ uid: 'v1', creation_time: '2026-01-05T00:00:00Z' }),
          vote({ uid: 'v2', creation_time: '2026-01-04T00:00:00Z' }),
          vote({ uid: 'v3', creation_time: '2026-01-03T00:00:00Z' }),
        ],
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 2 });
      expect(result.data).toHaveLength(2);
      expect(result.data.map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null))).toEqual(['v1', 'v2']);
      expect(encodeActivityPageToken).toHaveBeenCalledWith({ before: '2026-01-04T00:00:00Z', key: 'vote:v2' });
      expect(result.page_token).toBe('token(2026-01-04T00:00:00Z|vote:v2)');
    });

    it('omits page_token when every source is exhausted', async () => {
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v1' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.page_token).toBeUndefined();
    });

    it('applies the since/before window in-memory for folders and links, which have no upstream date param at all', async () => {
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) {
          return Promise.resolve([
            { uid: 'f-in', name: 'In window', updated_at: '2026-01-15T00:00:00Z' },
            { uid: 'f-out', name: 'Out of window', updated_at: '2025-01-01T00:00:00Z' },
          ]);
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, {
        since: '2026-01-01T00:00:00Z',
        cursor: { before: '2026-02-01T00:00:00Z', key: 'document:none' },
        limit: 8,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ type: 'document_uploaded', payload: { document_uid: 'f-in' } });
    });

    it('bounds an unbounded folders/links response to fetchSize before merging', async () => {
      // GET /committees/:id/folders and /links accept no page_size param at all and return every
      // folder/link unconditionally — this leg must bound the result itself rather than trust
      // upstream to have already done so.
      const manyFolders = Array.from({ length: 30 }, (_, i) => ({
        uid: `f-${i}`,
        name: `Folder ${i}`,
        updated_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.resolve(manyFolders);
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(8);
      expect(result.data[0]).toMatchObject({ payload: { document_uid: 'f-29' } });
      // fetchSize = max(8+1, 25) = 25 — assert the leg itself was bounded before merging (not just
      // that the final top-8 slice happens to look right regardless of whether bounding occurred).
      const debugMetadata = debug.mock.calls.at(-1)?.[3] as { document_count: number };
      expect(debugMetadata.document_count).toBe(25);
    });

    it('excludes an out-of-window vote purely via the in-memory since/cursor filter — votes get no upstream date narrowing to rely on', async () => {
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v-out', creation_time: '2025-01-01T00:00:00Z', end_time: '2025-01-02T00:00:00Z' })] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, {
        since: '2026-01-01T00:00:00Z',
        cursor: { before: '2026-02-01T00:00:00Z', key: 'document:none' },
        limit: 8,
      });
      expect(result.data).toEqual([]);
    });

    it('excludes the previous page boundary item instead of re-returning it — the exact (occurred_at, key) pair from the cursor is excluded', async () => {
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v-boundary', creation_time: '2026-01-04T00:00:00Z' })] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, {
        cursor: { before: '2026-01-04T00:00:00Z', key: 'vote:v-boundary' },
        limit: 8,
      });
      expect(result.data).toEqual([]);
    });

    it('returns the other tied-timestamp item on the next page — a real two-page round trip through a shared occurred_at', async () => {
      // Regression guard for the timestamp-only cursor bug: two events sharing the exact same
      // occurred_at (e.g. a batch of documents uploaded in one request) must both be reachable
      // across pages, not have one silently dropped.
      getVotes.mockResolvedValue({
        data: [vote({ uid: 'v-a', creation_time: '2026-01-04T00:00:00Z' }), vote({ uid: 'v-b', creation_time: '2026-01-04T00:00:00Z' })],
      });

      const page1 = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 1 });
      expect(page1.data).toHaveLength(1);
      expect(page1.page_token).toBeDefined();

      const lastCursorArg = encodeActivityPageToken.mock.calls.at(-1)?.[0] as ActivityPageCursor;
      const page2 = await service.getCommitteeActivity(req, COMMITTEE_UID, { cursor: lastCursorArg, limit: 1 });

      expect(page2.data).toHaveLength(1);
      expect(page2.page_token).toBeUndefined();
      const combinedUids = [page1.data[0], page2.data[0]].map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null)).sort();
      expect(combinedUids).toEqual(['v-a', 'v-b']);
    });

    it('sorts two events that both have no valid timestamp by key, independent of source-fetch order', async () => {
      // Regression guard: timestampValue(a) - timestampValue(b) on two -Infinity values is NaN,
      // which is `!== 0` and would skip the key tiebreak — falling through to whatever order the
      // comparator's NaN result happens to preserve, i.e. fetch/insertion order, not the intended
      // key order. Asserting a single fixed input isn't a real guard (stable sort reproduces the
      // same output for the same input either way) — feeding the pair in BOTH orders and requiring
      // the same key-derived output regardless is what actually distinguishes "sorted by key" from
      // "preserved fetch order".
      const voteX = vote({ uid: 'v-x', creation_time: undefined, last_modified_time: undefined });
      const voteY = vote({ uid: 'v-y', creation_time: undefined, last_modified_time: undefined });
      const uidsOf = (r: Awaited<ReturnType<typeof service.getCommitteeActivity>>) => r.data.map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null));

      getVotes.mockResolvedValue({ data: [voteX, voteY] });
      const forwardOrder = uidsOf(await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 }));

      getVotes.mockResolvedValue({ data: [voteY, voteX] });
      const reversedOrder = uidsOf(await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 }));

      // 'vote:v-y' sorts before 'vote:v-x' under compareEventsDesc's descending key tiebreak
      // (b.key.localeCompare(a.key)) — asserting the concrete order, not just forward/reversed
      // agreement, pins down THAT the tiebreak is key-descending, not merely that it's stable.
      expect(forwardOrder).toEqual(['v-y', 'v-x']);
      expect(reversedOrder).toEqual(['v-y', 'v-x']);
    });

    it('keeps a folder and a file that share a uid across a page boundary — document_type discrimination prevents the cursor from dropping one', async () => {
      // eventKey collisions matter specifically at the cursor boundary: compareEventsDesc treats
      // two same-timestamp, same-key events as equal, so isAfterCursor excludes both once one has
      // been returned. Paginating (not just checking both survive an unpaginated merge) is what
      // actually exercises that path.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.resolve([{ uid: 'shared-uid', name: 'Folder', updated_at: '2026-01-05T00:00:00Z' }]);
        if (path === '/query/resources' && query?.['type'] === 'committee_document') {
          return Promise.resolve({
            resources: [{ type: 'committee_document', id: 'shared-uid', data: { uid: 'shared-uid', name: 'File', updated_at: '2026-01-05T00:00:00Z' } }],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const page1 = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 1 });
      expect(page1.data).toHaveLength(1);
      expect(page1.page_token).toBeDefined();

      const cursor = encodeActivityPageToken.mock.calls.at(-1)?.[0] as ActivityPageCursor;
      const page2 = await service.getCommitteeActivity(req, COMMITTEE_UID, { cursor, limit: 1 });

      expect(page2.data).toHaveLength(1);
      const combinedTypes = [page1.data[0], page2.data[0]].map((e) => (e.type === 'document_uploaded' ? e.payload.document_type : null)).sort();
      expect(combinedTypes).toEqual(['file', 'folder']);
    });

    it('falls back to the last item with a real timestamp for the cursor, when the returned page is short on valid timestamps', async () => {
      // Only 2 votes have a real timestamp; 2 more have none. Sorted desc, invalid-timestamp items
      // sort last (timestampValue('') === -Infinity) and tiebreak deterministically on key
      // ('vote:v4' sorts before 'vote:v3' in the descending key order), so with limit=3 the
      // returned page is [v1, v2, v4] — v4 (the tail) has no valid timestamp, while a 4th
      // candidate (v3) still exists beyond the page, so hasMore is true and a page_token must
      // still be issued, falling back past v4 to v2's timestamp.
      getVotes.mockResolvedValue({
        data: [
          vote({ uid: 'v1', creation_time: '2026-01-05T00:00:00Z' }),
          vote({ uid: 'v2', creation_time: '2026-01-04T00:00:00Z' }),
          vote({ uid: 'v3', creation_time: undefined, last_modified_time: undefined }),
          vote({ uid: 'v4', creation_time: undefined, last_modified_time: undefined }),
        ],
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 3 });
      expect(result.data.map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null))).toEqual(['v1', 'v2', 'v4']);
      // v4 (the tail of the returned page) has no valid timestamp — the cursor must fall back to v2's.
      expect(encodeActivityPageToken).toHaveBeenCalledWith({ before: '2026-01-04T00:00:00Z', key: 'vote:v2' });
      expect(result.page_token).toBe('token(2026-01-04T00:00:00Z|vote:v2)');
    });
  });

  describe('one-source-fails-others-still-render', () => {
    it('renders the other three sources when past meetings fail', async () => {
      getMeetings.mockRejectedValue(new Error('upstream down'));
      getVotes.mockResolvedValue({ data: [vote()] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['vote_opened']);
      expect(warning).toHaveBeenCalled();
    });

    it('renders the other three sources when votes fail', async () => {
      getVotes.mockRejectedValue(new Error('upstream down'));
      getMeetings.mockResolvedValue({ data: [pastMeeting()] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['meeting_held']);
    });

    it('renders the other three sources when surveys fail', async () => {
      getMeetings.mockResolvedValue({ data: [pastMeeting()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'survey') return Promise.reject(new Error('upstream down'));
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['meeting_held']);
    });

    it('renders the other three sources when documents fail', async () => {
      getMeetings.mockResolvedValue({ data: [pastMeeting()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.reject(new Error('upstream down'));
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['meeting_held']);
    });
  });

  describe('voting_enabled gating', () => {
    it('excludes vote events from the result when the committee has voting disabled, but still fetches them', async () => {
      getVotes.mockResolvedValue({ data: [vote()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (/^\/committees\/[^/]+$/.test(path)) return Promise.resolve({ uid: COMMITTEE_UID, enable_voting: false });
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toEqual([]);
      expect(getVotes).toHaveBeenCalled();
    });

    it('defaults votes to excluded when the committee lookup itself fails', async () => {
      getVotes.mockResolvedValue({ data: [vote()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (/^\/committees\/[^/]+$/.test(path)) return Promise.reject(new Error('upstream down'));
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toEqual([]);
    });
  });

  describe('one-event-per-row mapping', () => {
    it('maps an ended vote to vote_closed only', async () => {
      getVotes.mockResolvedValue({ data: [vote({ status: PollStatus.ENDED, end_time: '2026-01-10T00:00:00Z' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('vote_closed');
    });

    it('maps an active vote to vote_opened only', async () => {
      getVotes.mockResolvedValue({ data: [vote({ status: PollStatus.ACTIVE })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('vote_opened');
    });

    it('maps a vote with an early_end_time to vote_closed even if status lags behind', async () => {
      getVotes.mockResolvedValue({ data: [vote({ status: PollStatus.ACTIVE, early_end_time: '2026-01-09T00:00:00Z' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data[0].type).toBe('vote_closed');
    });

    it('maps a closed survey to survey_closed and an open survey to survey_published', async () => {
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'survey') {
          return Promise.resolve({
            resources: [
              { type: 'survey', id: 'survey-closed', data: survey({ uid: 'survey-closed', survey_status: SurveyStatus.CLOSED }) },
              {
                type: 'survey',
                id: 'survey-open',
                data: survey({ uid: 'survey-open', survey_status: SurveyStatus.OPEN, last_modified_at: '2026-01-02T00:00:00Z' }),
              },
            ],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      const byType = Object.fromEntries(result.data.map((e) => [e.type, e]));
      expect(byType['survey_closed']).toMatchObject({ payload: { survey_uid: 'survey-closed' } });
      expect(byType['survey_published']).toMatchObject({ payload: { survey_uid: 'survey-open' } });
    });
  });
});
