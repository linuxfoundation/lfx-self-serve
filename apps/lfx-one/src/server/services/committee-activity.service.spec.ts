// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for committee-activity.service.ts. All fixtures use synthetic placeholder
// identities — never real user data.

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `@lfx-one/shared/*` isn't wired into this app's vitest config (same issue documented in
// committee-engagement-window.helper.spec.ts) — enums/utils need stubs; the interfaces import in
// the service under test is `import type`, so it's erased and needs no mock at all.
const { proxyRequest, getMeetings, getVotes, encodeActivityPageToken, warning, info } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getMeetings: vi.fn(),
  getVotes: vi.fn(),
  encodeActivityPageToken: vi.fn((cursor: { before: string; key: string }) => `token(${cursor.before}|${cursor.key})`),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', async () => {
  const activityEvent = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/activity-event.constants')>(
    '../../../../../packages/shared/src/constants/activity-event.constants'
  );
  const meeting = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/meeting.constants')>(
    '../../../../../packages/shared/src/constants/meeting.constants'
  );
  // Spread the real module rather than hand-listing exports — since committee-activity-query.helper.ts
  // is now mocked via importOriginal (see below), the whole real helper module (including
  // parseCommitteeActivityQuery, which reads ACTIVITY_FEED_DEFAULT_PAGE_SIZE) is reachable from
  // this spec; hand-listing only the constants this file's own tests happen to need would leave a
  // confusing "no export defined on the mock" trap for the next test that reaches further into it.
  return { ...activityEvent, ...meeting };
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
  const pollUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/poll.utils')>(
    '../../../../../packages/shared/src/utils/poll.utils'
  );
  return {
    firstValidTimestamp: iso.firstValidTimestamp,
    getPastMeetingStartTimeMs: pastMeetingUtils.getPastMeetingStartTimeMs,
    getPastMeetingResourceId: pastMeetingUtils.getPastMeetingResourceId,
    getSurveyDisplayStatus: surveyUtils.getSurveyDisplayStatus,
    normalizePollStatus: pollUtils.normalizePollStatus,
  };
});
// Real normalizeTimestamp (not a hand-copied stub) — its exact Date.parse/new Date().toISOString()
// behavior is precisely what the service's since-normalization tests below need to exercise; a
// stub that merely mimics the same expression would validate the stub, not the shipped helper.
vi.mock('../helpers/committee-activity-query.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/committee-activity-query.helper')>()),
  encodeActivityPageToken,
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning, info, startOperation: vi.fn(), success: vi.fn() } }));
vi.mock('./meeting.service', () => ({
  MeetingService: class {
    public getMeetings = getMeetings;
  },
}));
vi.mock('./vote.service', () => ({
  VoteService: class {
    public getVotes = getVotes;
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));

import { PollStatus, SurveyStatus } from '@lfx-one/shared/enums';
import type { ActivityPageCursor, MeetingAttachment, PastMeeting, PastMeetingAttachment, Survey, Vote } from '@lfx-one/shared/interfaces';

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
    // Far future, deliberately — mapVoteToEvent now treats a passed end_time as an implicit close
    // (isVoteDeadlinePast), so a fixture meant to default to "still open" can't use a fixed date
    // that will eventually lapse into the past as real time passes. Tests exercising a
    // deadline-passed closure override this explicitly with a past end_time.
    end_time: '2099-01-01T00:00:00Z',
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

function meetingAttachment(overrides: Partial<MeetingAttachment> = {}): MeetingAttachment {
  return {
    uid: 'ma-1',
    meeting_id: 'meeting-1',
    type: 'file',
    category: 'Notes',
    name: 'Meeting Notes.pdf',
    created_at: '2026-01-06T00:00:00Z',
    ...overrides,
  } as MeetingAttachment;
}

function pastMeetingAttachment(overrides: Partial<PastMeetingAttachment> = {}): PastMeetingAttachment {
  return {
    uid: 'pma-1',
    meeting_and_occurrence_id: 'pm-1-occ-1',
    meeting_id: 'meeting-1',
    type: 'file',
    category: 'Notes',
    name: 'Past Meeting Notes.pdf',
    created_at: '2026-01-07T00:00:00Z',
    ...overrides,
  } as PastMeetingAttachment;
}

/** Default proxyRequest router: benign empty responses for every leg unless a test overrides it. */
function defaultProxyRequest(_req: Request, _service: string, path: string, _method: string, query?: Record<string, unknown>): unknown {
  if (path.endsWith('/folders')) return Promise.resolve([]);
  if (path.endsWith('/links')) return Promise.resolve([]);
  if (path === '/query/resources' && query?.['type'] === 'survey') return Promise.resolve({ resources: [] });
  if (path === '/query/resources' && query?.['type'] === 'committee_document') return Promise.resolve({ resources: [] });
  if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') return Promise.resolve({ resources: [] });
  if (path === '/query/resources' && query?.['type'] === 'v1_past_meeting_attachment') return Promise.resolve({ resources: [] });
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

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('carries the meeting password in the event payload, not just its own pastMeetings() signal', async () => {
    // The activity feed is a separately-windowed fetch from the client's own pastMeetings()
    // signal — a password-protected meeting recent enough for this feed isn't guaranteed to be
    // in that signal's window, so the event needs its own password, not a client-side lookup.
    // Regression for Copilot/Cursor Bugbot/dealako's PR #1288 review.
    getMeetings.mockResolvedValue({ data: [pastMeeting({ password: 'sesame' })] });
    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data[0]).toMatchObject({ type: 'meeting_held', payload: { password: 'sesame' } });
  });

  it('carries a null password when the meeting has none', async () => {
    getMeetings.mockResolvedValue({ data: [pastMeeting({ password: null })] });
    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
    expect(result.data[0]).toMatchObject({ type: 'meeting_held', payload: { password: null } });
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
    // Also the tripwire case: a real, differing scheduled_start_time on a returned row should fire
    // the contract-change warning documented in getCommitteeActivity's fetchSize comment — this
    // fixture's scheduled_start_time (2026-01-05) genuinely differs from its start_time (zero-date).
    expect(warning).toHaveBeenCalledWith(
      expect.anything(),
      'get_committee_activity',
      expect.stringContaining('scheduled_start_time'),
      expect.objectContaining({ committee_uid: COMMITTEE_UID, affected_row_count: 1, total_rows: 1 })
    );
  });

  it('does not fire the scheduled_start_time tripwire for an ordinary meeting with no scheduled_start_time', async () => {
    getMeetings.mockResolvedValue({ data: [pastMeeting({ start_time: '2026-01-05T00:00:00Z', scheduled_start_time: '' })] });

    const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });

    // Positive control — without this, the assertion below would pass identically if the meetings
    // leg failed and never ran at all (a bare "not called" doesn't prove the tripwire code path was
    // exercised, only that nothing called it, which a leg failure would also produce).
    expect(result.data.map((e) => e.type)).toEqual(['meeting_held']);
    expect(warning).not.toHaveBeenCalledWith(expect.anything(), 'get_committee_activity', expect.stringContaining('scheduled_start_time'), expect.anything());
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
      // Date.toISOString(), which always emits milliseconds, hence the trailing `.000Z`. `since`
      // round-trips through the same normalizeTimestamp/Date.toISOString() call on the way in, so
      // it picks up the identical `.000Z` — these three assertions cover that round-trip shape for
      // an already-well-formed `since`; the dedicated "normalizes a zone-less since" test below
      // covers the actual reformatting case (a value Date.parse accepts but isn't RFC3339 yet).
      expect(getMeetings).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ date_field: 'start_time', date_from: '2026-01-01T00:00:00.000Z', date_to: '2026-02-01T00:00:00.000Z' }),
        'v1_past_meeting',
        false
      );
      expect(getVotes).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ date_field: 'last_modified_time', date_from: '2026-01-01T00:00:00.000Z', date_to: '2026-02-01T00:00:00.000Z' })
      );
    });

    it('sends no date_field/date_from/date_to to the survey leg, even with since and cursor set', async () => {
      // Surveys are the one leg deliberately excluded from upstream date narrowing — see
      // fetchSurveyEvents's own comment for why (a cutoff-driven closure's occurred_at isn't
      // bounded below by any field the survey row gets written to, so narrowing on last_modified_at
      // would systematically exclude exactly the rows `since` is meant to include). Regression for
      // the gap Copilot caught in the cutoff-driven-closure fix.
      await service.getCommitteeActivity(req, COMMITTEE_UID, {
        since: '2026-01-01T00:00:00Z',
        cursor: { before: '2026-02-01T00:00:00Z', key: 'vote:unrelated' },
        limit: 8,
      });

      const surveyCall = proxyRequest.mock.calls.find(([, , path, , query]) => path === '/query/resources' && query?.type === 'survey');
      expect(surveyCall?.[4]).not.toHaveProperty('date_field');
      expect(surveyCall?.[4]).not.toHaveProperty('date_from');
      expect(surveyCall?.[4]).not.toHaveProperty('date_to');
      expect(surveyCall?.[4]).toMatchObject({ page_size: 25, sort: 'updated_desc' });
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

    it('rejects an empty-string since rather than silently treating it as "no since"', async () => {
      // `''` is neither undefined (skip validation) nor a valid timestamp (Number.isNaN(Date.parse(''))
      // is true), so it's rejected the same way any other unparseable value is — not treated as an
      // omitted `since`, which the earlier truthiness-based check (`rawSince ? ... : undefined`)
      // used to do implicitly. Pins the guard's treatment of `''` as invalid, not omitted. The
      // matching `!== undefined` predicate on the normalization line below is defensive only — it's
      // unreachable while this guard stands, so it isn't (and can't be) covered by this test.
      await expect(service.getCommitteeActivity(req, COMMITTEE_UID, { since: '', limit: 8 })).rejects.toThrow(ServiceValidationError);

      expect(getVotes).not.toHaveBeenCalled();
    });

    it('normalizes a zone-less since to RFC3339 before sending it upstream as date_from', async () => {
      // Date.parse accepts a zone-less `2026-01-05T00:00:00` (parsed in the server's local
      // timezone), but query-service's stricter RFC3339 parser 400s it — without normalization this
      // would pass the parseability check above and then silently thin the feed once every leg's
      // upstream call rejects it. Pinned against a literal, not `new Date(x).toISOString()` (which
      // would just restate the implementation), with TZ stubbed explicitly since a zone-less string
      // is parsed in the server's local timezone — the exact behavior this test needs to pin down.
      vi.stubEnv('TZ', 'UTC');
      await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-05T00:00:00', limit: 8 });

      expect(getVotes).toHaveBeenCalledWith(req, expect.objectContaining({ date_from: '2026-01-05T00:00:00.000Z' }));
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['non-integer', 1.5],
      ['above the max', 51],
    ])('rejects a limit that is %s instead of silently degrading to a wrong result', async (_label, limit) => {
      // parseCommitteeActivityQuery already bounds page_size on the HTTP path, but this method is
      // public and reachable directly. Without this check: limit=0 -> windowed.slice(0, 0) -> an
      // empty feed with no error; a negative limit -> slice(0, -1) silently drops the OLDEST item
      // (windowed is sorted newest-first) while still emitting a page_token; either way, a wrong
      // result with no signal anything's off.
      await expect(service.getCommitteeActivity(req, COMMITTEE_UID, { limit })).rejects.toThrow(ServiceValidationError);

      expect(getVotes).not.toHaveBeenCalled();
    });

    it("sets hasMore when a page_size-bounded leg's upstream page_token signals more data, even though the merged pool itself is not over limit", async () => {
      // Regression for a false negative traced in the full-branch review: `windowed.length > limit`
      // alone can't see "more data exists" when a single dominant, page_size-bounded source (votes,
      // here) has more rows upstream than fit in one page and the in-memory since filter then drops
      // all but one of them — the merged pool ends up at or under `limit`, but there could easily be
      // more matching rows upstream that this page's fetch never reached. Saturation is driven by
      // the leg's own real upstream `page_token` (see the paired "does NOT set hasMore" test below
      // for the false-positive this replaced — Copilot/dealako flagged the original bare
      // `votes.length >= fetchSize` heuristic).
      const fetchSize = 25;
      const votes = Array.from({ length: fetchSize }, (_, i) =>
        vote({ uid: `v-${i}`, creation_time: i === 0 ? '2026-02-01T00:00:00Z' : '2020-01-01T00:00:00Z' })
      );
      getVotes.mockResolvedValue({ data: votes, page_token: 'more-votes-upstream' });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.page_token).toBeDefined();
    });

    it('does not set hasMore from row count alone when a leg returns a genuine final page with no upstream page_token', async () => {
      // The exact false positive Copilot/dealako flagged: a leg can return exactly `fetchSize` rows
      // as a real, final page — no further page_token means query-service has nothing more to give,
      // so a row-count-only heuristic would wrongly hand back a cursor to an empty next page.
      const fetchSize = 25;
      const votes = Array.from({ length: fetchSize }, (_, i) =>
        vote({ uid: `v-${i}`, creation_time: i === 0 ? '2026-02-01T00:00:00Z' : '2020-01-01T00:00:00Z' })
      );
      getVotes.mockResolvedValue({ data: votes });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.page_token).toBeUndefined();
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
      // .at(-1) is the "Completed" log — "Starting" fires first each call, so this is still the
      // last of the two `info` calls this invocation makes.
      const completionMetadata = info.mock.calls.at(-1)?.[3] as { document_count: number };
      expect(completionMetadata.document_count).toBe(25);
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
      for (let remaining = manyFolders.length; remaining > 0; remaining--) {
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
      for (let remaining = tiedFolders.length; remaining > 0; remaining--) {
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

  describe('notes_added leg', () => {
    it('emits a notes_added event for a Notes-category v1_meeting_attachment row, scoped upcoming', async () => {
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') {
          return Promise.resolve({ resources: [{ type: 'v1_meeting_attachment', id: 'ma-1', data: meetingAttachment() }] });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        type: 'notes_added',
        payload: { document_uid: 'ma-1', name: 'Meeting Notes.pdf', document_type: 'file', meeting_id: 'meeting-1', meeting_scope: 'upcoming' },
      });
    });

    it('emits a notes_added event for a Notes-category v1_past_meeting_attachment row, scoped past', async () => {
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'v1_past_meeting_attachment') {
          return Promise.resolve({ resources: [{ type: 'v1_past_meeting_attachment', id: 'pma-1', data: pastMeetingAttachment() }] });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        type: 'notes_added',
        payload: { document_uid: 'pma-1', name: 'Past Meeting Notes.pdf', document_type: 'file', meeting_id: 'meeting-1', meeting_scope: 'past' },
      });
    });

    it('drops a non-Notes-category attachment row even if the server-side filters param fails to narrow it', async () => {
      // Validates the client-side re-filter decision: the upstream `filters: ['category:Notes']`
      // param is a best-effort payload-size optimization, not something this leg's correctness
      // depends on — this mock simulates the server-side filter not narrowing at all.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') {
          return Promise.resolve({
            resources: [
              { type: 'v1_meeting_attachment', id: 'ma-1', data: meetingAttachment({ category: 'Notes' }) },
              { type: 'v1_meeting_attachment', id: 'ma-2', data: meetingAttachment({ uid: 'ma-2', category: 'Other' }) },
            ],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.filter((e) => e.type === 'notes_added')).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ payload: { document_uid: 'ma-1' } });
    });

    it('queries both attachment types scoped by committee parent ref and the category filter', async () => {
      await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ type: 'v1_meeting_attachment', parent: `committee:${COMMITTEE_UID}`, filters: ['category:Notes'] })
      );
      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ type: 'v1_past_meeting_attachment', parent: `committee:${COMMITTEE_UID}`, filters: ['category:Notes'] })
      );
    });

    it('keeps upcoming-meeting and past-meeting notes as distinct events even when they share the same attachment uid', async () => {
      // Regression for the meeting_scope-namespaced eventKey — v1_meeting_attachment and
      // v1_past_meeting_attachment are two distinct upstream uid namespaces (same reasoning as
      // document_uploaded's document_type discrimination). Paginating (not just an unpaginated
      // merge) is what actually exercises the cursor-boundary collision risk.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') {
          return Promise.resolve({
            resources: [
              { type: 'v1_meeting_attachment', id: 'shared-uid', data: meetingAttachment({ uid: 'shared-uid', created_at: '2026-01-05T00:00:00Z' }) },
            ],
          });
        }
        if (path === '/query/resources' && query?.['type'] === 'v1_past_meeting_attachment') {
          return Promise.resolve({
            resources: [
              { type: 'v1_past_meeting_attachment', id: 'shared-uid', data: pastMeetingAttachment({ uid: 'shared-uid', created_at: '2026-01-05T00:00:00Z' }) },
            ],
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
      const scopes = [page1.data[0], page2.data[0]].map((e) => (e.type === 'notes_added' ? e.payload.meeting_scope : null)).sort();
      expect(scopes).toEqual(['past', 'upcoming']);
    });

    it("sets hasMore when either notes sub-leg's upstream page_token signals more data", async () => {
      const fetchSize = 25;
      const attachments = Array.from({ length: fetchSize }, (_, i) =>
        meetingAttachment({ uid: `ma-${i}`, created_at: i === 0 ? '2026-02-01T00:00:00Z' : '2020-01-01T00:00:00Z' })
      );
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') {
          return Promise.resolve({
            resources: attachments.map((a) => ({ type: 'v1_meeting_attachment', id: a.uid, data: a })),
            page_token: 'more-notes-upstream',
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-01T00:00:00Z', limit: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.page_token).toBeDefined();
    });

    it('degrades a failed notes sub-leg to empty without failing the whole feed', async () => {
      getMeetings.mockResolvedValue({ data: [pastMeeting()] });
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') return Promise.reject(new Error('upstream down'));
        if (path === '/query/resources' && query?.['type'] === 'v1_past_meeting_attachment') {
          return Promise.resolve({ resources: [{ type: 'v1_past_meeting_attachment', id: 'pma-1', data: pastMeetingAttachment() }] });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      const types = result.data.map((e) => e.type);
      expect(types).toContain('meeting_held');
      const notesEvent = result.data.find((e) => e.type === 'notes_added');
      expect(notesEvent).toMatchObject({ payload: { meeting_scope: 'past' } });
    });

    it('merges all five sources including notes_added and sorts by occurred_at descending', async () => {
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
        if (path === '/query/resources' && query?.['type'] === 'v1_meeting_attachment') {
          return Promise.resolve({
            resources: [{ type: 'v1_meeting_attachment', id: 'ma-1', data: meetingAttachment({ created_at: '2026-01-05T00:00:00Z' }) }],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data.map((e) => e.type)).toEqual(['notes_added', 'document_uploaded', 'vote_closed', 'survey_published', 'meeting_held']);
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

    it('maps an ACTIVE vote whose end_time has already passed to vote_closed (deadline-passed regression)', async () => {
      // An async backend job may not have flipped status to ENDED yet, but a vote whose end_time
      // is in the past is effectively over — matching isVoteCalendarEventPast's established
      // "deadline passed" semantics elsewhere in the app. Without this, it stayed vote_opened at
      // creation_time indefinitely. Cursor Bugbot caught this as a follow-up to the casing fix.
      getVotes.mockResolvedValue({ data: [vote({ status: PollStatus.ACTIVE, end_time: '2020-01-01T00:00:00Z' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ type: 'vote_closed', occurred_at: '2020-01-01T00:00:00Z' });
    });

    it('does not close an ACTIVE vote whose end_time is still in the future', async () => {
      // Negative control for the deadline-passed test above.
      getVotes.mockResolvedValue({ data: [vote({ status: PollStatus.ACTIVE, end_time: '2099-06-01T00:00:00Z' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data[0].type).toBe('vote_opened');
    });

    it('maps a mixed-case ended vote status to vote_closed, not vote_opened (casing bug regression)', async () => {
      // Vote.status arrives with inconsistent casing (poll.utils.ts's normalizePollStatus doc
      // comment) — a raw `status === PollStatus.ENDED` comparison misclassifies this as
      // vote_opened, stamped at creation time instead of close time. Independently flagged by
      // Copilot and Cursor Bugbot, confirmed by dealako.
      getVotes.mockResolvedValue({ data: [vote({ status: 'Ended' as PollStatus, end_time: '2026-01-10T00:00:00Z' })] });
      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('vote_closed');
      expect(result.data[0].occurred_at).toBe('2026-01-10T00:00:00Z');
    });

    it('stamps a cutoff-driven survey closure at survey_cutoff_date, not the stale last_modified_at', async () => {
      // getSurveyDisplayStatus reports CLOSED for a SENT survey whose cutoff has passed even
      // though last_modified_at never changed (getEffectiveSurveyStatus's SENT/cutoff branch,
      // survey.utils.ts) — falling back to last_modified_at/created_at in that case stamps
      // survey_closed at the publish time instead of the real closure moment. Flagged by
      // Copilot, confirmed by dealako.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'survey') {
          return Promise.resolve({
            resources: [
              {
                type: 'survey',
                id: 'survey-cutoff',
                data: survey({
                  uid: 'survey-cutoff',
                  survey_status: SurveyStatus.SENT,
                  survey_cutoff_date: '2026-01-05T00:00:00Z',
                  last_modified_at: '2026-01-01T00:00:00Z',
                  created_at: '2026-01-01T00:00:00Z',
                }),
              },
            ],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('survey_closed');
      expect(result.data[0].occurred_at).toBe('2026-01-05T00:00:00Z');
    });

    it('includes a cutoff-driven survey closure when since falls between its last_modified_at and its real occurred_at', async () => {
      // The exact gap Copilot caught: with upstream date_field narrowing on last_modified_at (the
      // previous implementation), a survey last modified Jan 1 but closed by its Jan 5 cutoff would
      // be excluded by an upstream `?since=Jan 4` filter, even though its emitted occurred_at (Jan
      // 5) is inside that window. Now that the survey leg sends no upstream date narrowing at all
      // (see fetchSurveyEvents), this must come through — the in-memory since pass is the only
      // filter, applied against the corrected occurred_at, not last_modified_at.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'survey') {
          return Promise.resolve({
            resources: [
              {
                type: 'survey',
                id: 'survey-cutoff',
                data: survey({
                  uid: 'survey-cutoff',
                  survey_status: SurveyStatus.SENT,
                  survey_cutoff_date: '2026-01-05T00:00:00Z',
                  last_modified_at: '2026-01-01T00:00:00Z',
                  created_at: '2026-01-01T00:00:00Z',
                }),
              },
            ],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { since: '2026-01-04T00:00:00Z', limit: 8 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ type: 'survey_closed', occurred_at: '2026-01-05T00:00:00Z' });
    });

    it('uses last_modified_at, not survey_cutoff_date, for an explicitly-closed survey status (not cutoff-driven)', async () => {
      // Negative control for the cutoff-driven test above: guards against a broader mutation of
      // isCutoffDrivenClosure that would apply the cutoff timestamp to every CLOSED survey
      // regardless of why it's closed.
      proxyRequest.mockImplementation((r, s, path, m, query) => {
        if (path === '/query/resources' && query?.['type'] === 'survey') {
          return Promise.resolve({
            resources: [
              {
                type: 'survey',
                id: 'survey-explicit-closed',
                data: survey({
                  uid: 'survey-explicit-closed',
                  survey_status: SurveyStatus.CLOSED,
                  survey_cutoff_date: '2020-01-01T00:00:00Z',
                  last_modified_at: '2026-01-02T00:00:00Z',
                }),
              },
            ],
          });
        }
        return defaultProxyRequest(r, s, path, m, query);
      });

      const result = await service.getCommitteeActivity(req, COMMITTEE_UID, { limit: 8 });
      expect(result.data[0].type).toBe('survey_closed');
      expect(result.data[0].occurred_at).toBe('2026-01-02T00:00:00Z');
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
