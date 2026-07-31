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

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
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

  it('drops a vote with an unparseable timestamp instead of throwing or including it unordered', async () => {
    getVotes.mockResolvedValue({ data: [vote({ creation_time: 'not-a-timestamp', last_modified_time: undefined })] });
    proxyRequest.mockImplementation((r, s, path, m, query) => {
      if (path === '/query/resources' && query?.['type'] === 'survey') {
        return Promise.resolve({ resources: [{ type: 'survey', id: 'survey-1', data: survey({ last_modified_at: '2026-01-01T00:00:00Z' }) }] });
      }
      return defaultProxyRequest(r, s, path, m, query);
    });

    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data.map((e) => e.type)).toEqual(['survey_published']);
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

    it('rejects an unparseable cursor.before instead of silently degrading to an empty feed', async () => {
      // getCommitteeActivity is a public method — the controller always validates cursor.before via
      // decodePageToken first, but a future non-HTTP caller could invoke this directly with a bad
      // value. Matches decodePageToken's own policy for the identical input (a bad explicit cursor
      // is a 400, not a silently-ignored value) rather than doing the full upstream fan-out for a
      // result that isAfterCursor would filter to [] anyway (every event compares as before an
      // unparseable, -Infinity-valued cursor position).
      await expect(
        service.getCommitteeActivity(req, COMMITTEE_UID, {
          cursor: { before: 'not-a-timestamp', key: 'vote:unrelated' },
          limit: 8,
        })
      ).rejects.toThrow(ServiceValidationError);

      expect(getVotes).not.toHaveBeenCalled();
    });

    it('rejects an unparseable since instead of silently degrading to an empty feed', async () => {
      // Same policy, same reason, as the cursor.before test above — parseCommitteeActivityQuery
      // validates `since` on the HTTP path, but this method is public and reachable directly.
      // Without this check, isAtOrAfterSince's `ms >= Date.parse(since)` is `ms >= NaN` for every
      // event, so an unparseable since would silently degrade to an empty feed instead of rejecting.
      await expect(service.getCommitteeActivity(req, COMMITTEE_UID, { since: 'not-a-timestamp', limit: 8 })).rejects.toThrow(ServiceValidationError);

      expect(getVotes).not.toHaveBeenCalled();
    });

    it('sets hasMore when a page_size-bounded leg is saturated, even though the merged pool itself is not over limit', async () => {
      // Regression for a false negative traced in the full-branch review: `windowed.length > limit`
      // alone can't see "more data exists" when a single dominant, page_size-bounded source (votes,
      // here) returns exactly fetchSize rows and the in-memory since filter then drops all but one
      // of them — the merged pool ends up at or under `limit`, but there could easily be more
      // matching rows upstream that this page's fetch never reached. fetchSize = max(1+1, 25) = 25,
      // so 25 votes here means the leg genuinely hit its upstream page bound.
      const fetchSize = 25;
      const votes = Array.from({ length: fetchSize }, (_, i) =>
        vote({ uid: `v-${i}`, creation_time: i === 0 ? '2026-02-01T00:00:00Z' : '2020-01-01T00:00:00Z' })
      );
      getVotes.mockResolvedValue({ data: votes });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.page_token).toBeDefined();
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

    it('surfaces folders older than fetchSize once pagination reaches them — the window must be applied before bounding, not after', async () => {
      // Regression guard: folders/links have no upstream page_size, so this leg always refetches
      // every folder on every call and must bound locally. Bounding to fetchSize BEFORE applying
      // the since/before window would recompute the same newest-25 slice on every page regardless
      // of cursor, permanently hiding the 5 oldest of these 30 folders no matter how far pagination
      // walked. Filtering first, then bounding, means each page's window narrows the candidate pool
      // before the cap is applied, so the older folders become reachable once the cursor passes them.
      const manyFolders = Array.from({ length: 30 }, (_, i) => ({
        uid: `f-${i}`,
        name: `Folder ${i}`,
        updated_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.resolve(manyFolders);
        return defaultProxyRequest(r, s, path, m, query);
      });

      let cursor: ActivityPageCursor | undefined;
      const uids: string[] = [];
      for (let i = 0; i < manyFolders.length; i++) {
        const page = await service.getCommitteeActivity(req, COMMITTEE_UID, { cursor, limit: 1 });
        if (page.data.length === 0) break;
        const event = page.data[0];
        uids.push(event.type === 'document_uploaded' ? event.payload.document_uid : 'unexpected');
        if (!page.page_token) break;
        cursor = encodeActivityPageToken.mock.calls.at(-1)?.[0] as ActivityPageCursor;
      }

      expect(uids).toEqual(Array.from({ length: manyFolders.length }, (_, i) => `f-${manyFolders.length - 1 - i}`));
    });

    it('reaches every folder even when all of them share one exact timestamp — the per-leg pre-filter needs the cursor key tiebreak too', async () => {
      // Same failure class as the previous test, one dimension over: there occurred_at alone gave
      // too wide a window; here occurred_at alone can't distinguish these items at all. If more
      // than fetchSize folders share one exact occurred_at second, an occurred_at-only pre-filter
      // (isWithinFetchWindow) and an occurred_at-only bound (boundedSortDesc) would never actually
      // shrink the pool across pages — the 25 that survive each call would depend on upstream
      // response order, not the (occurred_at, key) order the cursor itself uses, permanently
      // hiding whichever folders don't happen to sort first upstream.
      const tiedFolders = Array.from({ length: 30 }, (_, i) => ({ uid: `f-${i}`, name: `Folder ${i}`, updated_at: '2026-01-01T00:00:00Z' }));
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.resolve(tiedFolders);
        return defaultProxyRequest(r, s, path, m, query);
      });

      let cursor: ActivityPageCursor | undefined;
      const uids = new Set<string>();
      for (let i = 0; i < tiedFolders.length; i++) {
        const page = await service.getCommitteeActivity(req, COMMITTEE_UID, { cursor, limit: 1 });
        if (page.data.length === 0) break;
        const event = page.data[0];
        uids.add(event.type === 'document_uploaded' ? event.payload.document_uid : 'unexpected');
        if (!page.page_token) break;
        cursor = encodeActivityPageToken.mock.calls.at(-1)?.[0] as ActivityPageCursor;
      }

      expect(uids.size).toBe(tiedFolders.length);
    });

    it('treats a null folders response as empty without discarding sibling links in the same leg', async () => {
      // MicroserviceProxyService.proxyRequest returns the upstream body verbatim — a 204/empty
      // response comes through as null, not []. Without a null guard, `folders.map(...)` throws
      // before `links.map(...)` ever runs, so the outer per-leg `.catch()` in getCommitteeActivity
      // discards the ENTIRE document leg (links and files included), not just the null folders source.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.resolve(null);
        if (path.endsWith('/links')) return Promise.resolve([{ uid: 'link-1', name: 'Spec doc', updated_at: '2026-01-05T00:00:00Z' }]);
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ type: 'document_uploaded', payload: { document_uid: 'link-1', document_type: 'link' } });
    });

    it('treats a null /query/resources body as a graceful empty survey leg, not an error-path degrade', async () => {
      // The survey leg already sits inside its own per-leg `.catch()` in getCommitteeActivity, so
      // `result.data` alone can't tell a guarded null response apart from an unguarded one — either
      // way the leg contributes []. The `warning` log is what actually discriminates: without the
      // `response?.resources ?? []` guard, the TypeError thrown reading `.resources` off a null
      // response propagates out of fetchSurveyEvents and is caught by that outer per-leg `.catch()`,
      // which DOES log a warning; the guard means fetchSurveyEvents never throws at all, so no
      // warning fires. Asserting only `result.data` here would pass identically whether the guard
      // exists or not — proven by mutation testing the guard away and re-running this test. Scoped
      // to the survey leg's own message (not `not.toHaveBeenCalled()` at all) so an unrelated
      // warning from another leg can't make this assertion pass for the wrong reason.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'survey') return Promise.resolve(null);
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toEqual([]);
      expect(warning).not.toHaveBeenCalledWith(expect.anything(), 'get_committee_activity', expect.stringContaining('survey activity'), expect.anything());
    });

    it('treats a null /query/resources body as a graceful empty files leg, not an error-path degrade', async () => {
      // Same mechanism as the survey test above, one layer earlier: the files leg's TypeError is
      // caught by the `.catch()` chained directly onto its own proxyRequest call inside
      // fetchDocumentEvents (not the outer per-leg catch in getCommitteeActivity), but the
      // observable signal is identical — a warning fires only on the unguarded path.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'committee_document') return Promise.resolve(null);
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toEqual([]);
      expect(warning).not.toHaveBeenCalledWith(expect.anything(), 'get_committee_activity', expect.stringContaining('committee files'), expect.anything());
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

    it('drops both events when neither has a valid timestamp, regardless of source-fetch order', async () => {
      // Events with no valid timestamp are dropped entirely (see the windowed filter's comment) —
      // this also means the NaN-tiebreak hazard compareEventsDesc guards against (timestampValue(a)
      // - timestampValue(b) on two -Infinity values is NaN) is now structurally unreachable through
      // the merge for genuinely-invalid timestamps: they never reach the sort. The tiebreak itself
      // is still exercised by real, valid, tied timestamps — see the two-page round trip test above.
      const voteX = vote({ uid: 'v-x', creation_time: undefined, last_modified_time: undefined });
      const voteY = vote({ uid: 'v-y', creation_time: undefined, last_modified_time: undefined });
      const uidsOf = (r: Awaited<ReturnType<typeof service.getCommitteeActivity>>) => r.data.map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null));

      getVotes.mockResolvedValue({ data: [voteX, voteY] });
      expect(uidsOf(await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 }))).toEqual([]);

      getVotes.mockResolvedValue({ data: [voteY, voteX] });
      expect(uidsOf(await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 }))).toEqual([]);
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

    it('excludes invalid-timestamp votes from both the page and the hasMore/page_token calculation', async () => {
      // 2 votes have a real timestamp; 2 more have none and are dropped entirely (see the windowed
      // filter). With limit=3, the 2 remaining valid candidates fit on one page — no page_token,
      // even though 4 rows were fetched from the source.
      getVotes.mockResolvedValue({
        data: [
          vote({ uid: 'v1', creation_time: '2026-01-05T00:00:00Z' }),
          vote({ uid: 'v2', creation_time: '2026-01-04T00:00:00Z' }),
          vote({ uid: 'v3', creation_time: undefined, last_modified_time: undefined }),
          vote({ uid: 'v4', creation_time: undefined, last_modified_time: undefined }),
        ],
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 3 });
      expect(result.data.map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null))).toEqual(['v1', 'v2']);
      expect(result.page_token).toBeUndefined();
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
      // Positive control for the null-body survey test's negative `not.toHaveBeenCalledWith(...)`
      // assertion above — pins that the 'survey activity' substring is the real, current message a
      // survey-leg failure logs, so a future rename of that message would fail loudly here instead
      // of just letting the negative assertion pass for the wrong reason.
      expect(warning).toHaveBeenCalledWith(expect.anything(), 'get_committee_activity', expect.stringContaining('survey activity'), expect.anything());
    });

    it('renders the other three sources when documents (folders) fail', async () => {
      getMeetings.mockResolvedValue({ data: [pastMeeting()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) return Promise.reject(new Error('upstream down'));
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['meeting_held']);
    });

    it('renders the other three sources when documents (files) fail', async () => {
      getMeetings.mockResolvedValue({ data: [pastMeeting()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'committee_document') return Promise.reject(new Error('upstream down'));
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['meeting_held']);
      // Positive control for the null-body files test's negative assertion — pins 'committee files'
      // as the real, current message; the pre-existing folders-failure test above never exercised
      // this leg's own message, so this substring was previously pinned nowhere in the suite.
      expect(warning).toHaveBeenCalledWith(expect.anything(), 'get_committee_activity', expect.stringContaining('committee files'), expect.anything());
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

    it('rejects the whole request when the committee lookup fails, rather than degrading to votes-excluded', async () => {
      // GET /committees/:uid is committee-service's real per-request FGA gate (unlike the
      // /query/resources legs, which filter per-resource and never reject the whole request) — a
      // failure here (a real 403, or a transient 5xx) must propagate, not silently downgrade into
      // "votes excluded, everything else renders" for what could be an unauthorized caller.
      const upstreamError = new Error('upstream down');
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (/^\/committees\/[^/]+$/.test(path)) return Promise.reject(upstreamError);
        return defaultProxyRequest(r, s, path, m, query);
      });

      await expect(service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 })).rejects.toThrow(upstreamError);
    });

    it('rejects with a typed ResourceNotFoundError when the committee body is null, rather than an untyped TypeError', async () => {
      // Same fail-closed contract as the test above, for the other real shape a committee lookup
      // can return: an empty-bodied 200 (proxyRequest parses that to null), not just a rejected
      // promise. Asserting the specific error class (and its operation/service/path context, which
      // BaseApiError.toResponse() surfaces in the actual HTTP response) matters here — an unguarded
      // `.enable_voting` read off a null committee also rejects the whole request via an untyped
      // TypeError, so a bare `rejects.toThrow()` would pass identically whether the guard exists or
      // not, and asserting only the class would leave the context fields this same commit added
      // just as untested as the guard itself was before this round.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (/^\/committees\/[^/]+$/.test(path)) return Promise.resolve(null);
        return defaultProxyRequest(r, s, path, m, query);
      });

      await expect(service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 })).rejects.toBeInstanceOf(ResourceNotFoundError);
      await expect(service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 })).rejects.toMatchObject({
        statusCode: 404,
        operation: 'get_committee_activity',
        service: 'committee_service',
        path: `/committees/${COMMITTEE_UID}`,
      });
    });

    it('encodes the committee uid in the 404 path so it matches the path actually requested', async () => {
      // COMMITTEE_UID ('committee-1') contains nothing encodeURIComponent transforms, so the
      // toMatchObject assertion above can't tell an encoded path from an unencoded one — it stayed
      // green when the encoding fix was mutated away. This uid needs real encoding to exercise it.
      // The expected path is a hard-coded literal, not re-derived with encodeURIComponent — deriving
      // it the same way the production code does would let a bug in which encoder is used cancel
      // out on both sides of the assertion.
      const uidNeedingEncoding = 'committee 1';
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (/^\/committees\/[^/]+$/.test(path)) return Promise.resolve(null);
        return defaultProxyRequest(r, s, path, m, query);
      });

      await expect(service.getCommitteeActivity(req, uidNeedingEncoding, { limit: 8 })).rejects.toMatchObject({
        path: '/committees/committee%201',
      });
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
