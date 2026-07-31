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
  encodeActivityPageToken: vi.fn((before: string) => `token(${before})`),
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
import type { PastMeeting, Survey, Vote } from '@lfx-one/shared/interfaces';

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
    encodeActivityPageToken.mockImplementation((before: string) => `token(${before})`);
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

  describe('since/before/limit handling', () => {
    it('passes since as date_from and before as date_to to the past-meetings, votes, and survey legs', async () => {
      await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', before: '2026-02-01T00:00:00Z', limit: 8 });

      expect(getMeetings).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ date_field: 'start_time', date_from: '2026-01-01T00:00:00Z', date_to: '2026-02-01T00:00:00Z' }),
        'v1_past_meeting',
        false
      );
      expect(getVotes).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ date_field: 'last_modified_time', date_from: '2026-01-01T00:00:00Z', date_to: '2026-02-01T00:00:00Z' })
      );
      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ type: 'survey', date_field: 'last_modified_at', date_from: '2026-01-01T00:00:00Z', date_to: '2026-02-01T00:00:00Z' })
      );
    });

    it('requests page_size = max(limit + 1, 25) from every source', async () => {
      await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 2 });
      expect(getMeetings).toHaveBeenCalledWith(req, expect.objectContaining({ page_size: 25 }), 'v1_past_meeting', false);
      expect(getVotes).toHaveBeenCalledWith(req, expect.objectContaining({ page_size: 25 }));

      await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 30 });
      expect(getMeetings).toHaveBeenCalledWith(req, expect.objectContaining({ page_size: 31 }), 'v1_past_meeting', false);
    });

    it('caps the returned feed at limit and sets a page_token when more candidates exist', async () => {
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
      expect(encodeActivityPageToken).toHaveBeenCalledWith('2026-01-04T00:00:00Z');
      expect(result.page_token).toBe('token(2026-01-04T00:00:00Z)');
    });

    it('omits page_token when every source is exhausted', async () => {
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v1' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.page_token).toBeUndefined();
    });

    it('applies the since/before window in-memory for folders and links, which have no upstream date param', async () => {
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path.endsWith('/folders')) {
          return Promise.resolve([
            { uid: 'f-in', name: 'In window', updated_at: '2026-01-15T00:00:00Z' },
            { uid: 'f-out', name: 'Out of window', updated_at: '2025-01-01T00:00:00Z' },
          ]);
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', before: '2026-02-01T00:00:00Z', limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ type: 'document_uploaded', payload: { document_uid: 'f-in' } });
    });

    it('applies the same in-memory window backstop to a query-service-backed leg, in case upstream date filtering under- or over-narrows it', async () => {
      // Simulates the upstream date_field mismatch (e.g. a vote's real occurred_at falls outside
      // the window even though the upstream date_field pre-filter returned it) — the merge itself
      // must still exclude it, not just trust whatever each leg's upstream call narrowed to.
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v-out', creation_time: '2025-01-01T00:00:00Z', end_time: '2025-01-02T00:00:00Z' })] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', before: '2026-02-01T00:00:00Z', limit: 8 });
      expect(result.data).toEqual([]);
    });

    it('excludes the previous page boundary item instead of re-returning it — the before cursor is strictly exclusive', async () => {
      // Regression guard for the inclusive/exclusive mismatch against upstream's date_to
      // semantics: the merge's own isWithinWindow pass must exclude occurred_at === before
      // regardless of what date_to did upstream.
      getVotes.mockResolvedValue({ data: [vote({ uid: 'v-boundary', creation_time: '2026-01-04T00:00:00Z' })] });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { before: '2026-01-04T00:00:00Z', limit: 8 });
      expect(result.data).toEqual([]);
    });

    it('falls back to the last item with a real timestamp for the cursor, when the returned page is short on valid timestamps', async () => {
      // Only 2 votes have a real timestamp; 2 more have none. Sorted desc, invalid-timestamp
      // items sort last (timestampValue('') === -Infinity), so with limit=3 the returned page is
      // [v1, v2, v3] — v3 (the tail) has no valid timestamp, while a 4th candidate (v4) still
      // exists beyond the page, so hasMore is true and a page_token must still be issued.
      getVotes.mockResolvedValue({
        data: [
          vote({ uid: 'v1', creation_time: '2026-01-05T00:00:00Z' }),
          vote({ uid: 'v2', creation_time: '2026-01-04T00:00:00Z' }),
          vote({ uid: 'v3', creation_time: undefined, last_modified_time: undefined }),
          vote({ uid: 'v4', creation_time: undefined, last_modified_time: undefined }),
        ],
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 3 });
      expect(result.data.map((e) => (e.type === 'vote_opened' ? e.payload.vote_uid : null))).toEqual(['v1', 'v2', 'v3']);
      // v3 (the tail of the returned page) has no valid timestamp — the cursor must fall back to v2's.
      expect(result.page_token).toBe('token(2026-01-04T00:00:00Z)');
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
