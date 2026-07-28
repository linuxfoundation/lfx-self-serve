// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for activity-feed.utils.ts. All fixtures use synthetic placeholder identities —
// never real user data.

import { describe, expect, it } from 'vitest';

import { PollStatus, SurveyStatus } from '../enums';
import { BuildActivityFeedInput, CommitteeDocument, PastMeeting, Survey, Vote } from '../interfaces';
import { buildActivityFeed, firstValidTimestamp } from './activity-feed.utils';

/** Minimal past-meeting builder — only the fields buildActivityFeed reads. */
function pastMeeting(overrides: Partial<PastMeeting> = {}): PastMeeting {
  return {
    id: 'pm-1',
    meeting_and_occurrence_id: 'pm-1-occ-1',
    title: 'Weekly Sync',
    start_time: '2026-01-01T10:00:00Z',
    ...overrides,
  } as PastMeeting;
}

/** Minimal vote builder — only the fields buildActivityFeed reads. */
function vote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Q1 Budget',
    status: PollStatus.ACTIVE,
    last_modified_time: '2026-01-02T10:00:00Z',
    ...overrides,
  } as Vote;
}

/** Minimal survey builder — only the fields buildActivityFeed (via getSurveyDisplayStatus) reads. */
function survey(overrides: Partial<Survey> = {}): Survey {
  return {
    uid: 'survey-1',
    survey_title: 'Community Feedback',
    survey_status: SurveyStatus.OPEN,
    survey_cutoff_date: null,
    last_modified_at: '2026-01-03T10:00:00Z',
    ...overrides,
  } as Survey;
}

/** Minimal document builder — only the fields buildActivityFeed reads. */
function document(overrides: Partial<CommitteeDocument> = {}): CommitteeDocument {
  return {
    uid: 'doc-1',
    type: 'file',
    name: 'Charter.pdf',
    updated_at: '2026-01-04T10:00:00Z',
    ...overrides,
  } as CommitteeDocument;
}

function emptyInput(overrides: Partial<BuildActivityFeedInput> = {}): BuildActivityFeedInput {
  return { pastMeetings: [], votes: [], surveys: [], documents: [], votingEnabled: true, ...overrides };
}

describe('firstValidTimestamp', () => {
  it('returns the first candidate that is present and parseable', () => {
    expect(firstValidTimestamp('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('2026-01-01T00:00:00Z');
  });

  it('falls back past an absent candidate', () => {
    expect(firstValidTimestamp(undefined, '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('falls back past a Go zero-date sentinel', () => {
    expect(firstValidTimestamp('0001-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('falls back past an unparseable candidate', () => {
    expect(firstValidTimestamp('not-a-date', '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('returns an empty string when every candidate is invalid or absent', () => {
    expect(firstValidTimestamp(undefined, '0001-01-01T00:00:00Z', 'not-a-date')).toBe('');
  });
});

describe('buildActivityFeed', () => {
  it('returns an empty array when every source is empty', () => {
    expect(buildActivityFeed(emptyInput())).toEqual([]);
  });

  it('merges all four sources and sorts the result by timestamp descending', () => {
    const items = buildActivityFeed(
      emptyInput({
        pastMeetings: [pastMeeting({ start_time: '2026-01-01T00:00:00Z' })],
        votes: [vote({ last_modified_time: '2026-01-03T00:00:00Z' })],
        surveys: [survey({ last_modified_at: '2026-01-02T00:00:00Z' })],
        documents: [document({ updated_at: '2026-01-04T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['document', 'vote', 'survey', 'past_meeting']);
  });

  it('sorts correctly across sources when timestamps use different UTC offset formats', () => {
    // 2026-01-01T09:00:00+05:30 == 2026-01-01T03:30:00Z, so it should sort between the survey and
    // the vote below despite being lexicographically smaller than both (localeCompare would get
    // this wrong — it'd sort by the raw string, putting the offset form last).
    const items = buildActivityFeed(
      emptyInput({
        votes: [vote({ last_modified_time: '2026-01-01T04:00:00Z' })],
        surveys: [survey({ last_modified_at: '2026-01-01T03:00:00Z' })],
        documents: [document({ updated_at: '2026-01-01T09:00:00+05:30' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['vote', 'document', 'survey']);
  });

  it('sorts an unparseable timestamp as the oldest item instead of throwing', () => {
    const items = buildActivityFeed(
      emptyInput({
        votes: [vote({ last_modified_time: 'not-a-timestamp', creation_time: undefined })],
        surveys: [survey({ last_modified_at: '2026-01-01T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['survey', 'vote']);
  });

  it('does not sort a past meeting as ancient when start_time is a Go zero-date', () => {
    // Zoom/ITX past-meeting rows sometimes carry "0001-01-01T00:00:00Z" on start_time — a raw
    // Date.parse would treat that as a real (~year 1) timestamp and sort it as the oldest item,
    // even when scheduled_start_time has a real, recent value.
    const items = buildActivityFeed(
      emptyInput({
        pastMeetings: [pastMeeting({ start_time: '0001-01-01T00:00:00Z', scheduled_start_time: '2026-01-05T00:00:00Z' })],
        surveys: [survey({ last_modified_at: '2026-01-01T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['past_meeting', 'survey']);
  });

  it('sorts a past meeting as oldest when both start_time and scheduled_start_time are zero-dates', () => {
    const items = buildActivityFeed(
      emptyInput({
        pastMeetings: [pastMeeting({ start_time: '0001-01-01T00:00:00Z', scheduled_start_time: '0001-01-01T00:00:00Z' })],
        surveys: [survey({ last_modified_at: '2026-01-01T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['survey', 'past_meeting']);
  });

  it('does not sort a vote as ancient when last_modified_time is a Go zero-date', () => {
    const items = buildActivityFeed(
      emptyInput({
        votes: [vote({ last_modified_time: '0001-01-01T00:00:00Z', creation_time: '2026-01-05T00:00:00Z' })],
        surveys: [survey({ last_modified_at: '2026-01-01T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['vote', 'survey']);
  });

  it('does not sort a survey as ancient when last_modified_at is a Go zero-date', () => {
    const items = buildActivityFeed(
      emptyInput({
        surveys: [survey({ last_modified_at: '0001-01-01T00:00:00Z', created_at: '2026-01-05T00:00:00Z' })],
        votes: [vote({ last_modified_time: '2026-01-01T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['survey', 'vote']);
  });

  it('does not sort a document as ancient when updated_at is a Go zero-date', () => {
    const items = buildActivityFeed(
      emptyInput({
        documents: [document({ updated_at: '0001-01-01T00:00:00Z', created_at: '2026-01-05T00:00:00Z' })],
        votes: [vote({ last_modified_time: '2026-01-01T00:00:00Z' })],
      })
    );
    expect(items.map((i) => i.type)).toEqual(['document', 'vote']);
  });

  it('caps each source at 5 items before merging, keeping the most recent per source', () => {
    const pastMeetings = Array.from({ length: 7 }, (_, i) =>
      pastMeeting({ id: `pm-${i}`, meeting_and_occurrence_id: `pm-${i}-occ`, start_time: `2026-01-0${i + 1}T00:00:00Z` })
    );
    const items = buildActivityFeed(emptyInput({ pastMeetings }));
    expect(items).toHaveLength(5);
    // The 5 most recent (highest-dated) of the 7 survive the per-source cap.
    expect(items.map((i) => i.key)).toEqual([
      'past_meeting-pm-6-occ',
      'past_meeting-pm-5-occ',
      'past_meeting-pm-4-occ',
      'past_meeting-pm-3-occ',
      'past_meeting-pm-2-occ',
    ]);
  });

  it('caps the final merged feed at 8 items even when every source is full', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => i);
    const items = buildActivityFeed(
      emptyInput({
        pastMeetings: many(5).map((i) => pastMeeting({ id: `pm-${i}`, meeting_and_occurrence_id: `pm-${i}`, start_time: `2026-01-01T0${i}:00:00Z` })),
        votes: many(5).map((i) => vote({ uid: `vote-${i}`, last_modified_time: `2026-01-02T0${i}:00:00Z` })),
        surveys: many(5).map((i) => survey({ uid: `survey-${i}`, last_modified_at: `2026-01-03T0${i}:00:00Z` })),
        documents: many(5).map((i) => document({ uid: `doc-${i}`, updated_at: `2026-01-04T0${i}:00:00Z` })),
      })
    );
    expect(items).toHaveLength(8);
  });

  it('excludes vote items entirely when votingEnabled is false, but keeps the other sources', () => {
    const items = buildActivityFeed(
      emptyInput({
        votes: [vote()],
        surveys: [survey()],
        votingEnabled: false,
      })
    );
    expect(items.map((i) => i.type)).toEqual(['survey']);
  });

  it('falls back to created_at / creation_time when the modified/updated timestamp is absent', () => {
    const items = buildActivityFeed(
      emptyInput({
        votes: [vote({ last_modified_time: undefined, creation_time: '2026-01-05T00:00:00Z' })],
      })
    );
    expect(items[0].timestamp).toBe('2026-01-05T00:00:00Z');
  });

  it('labels documents by type — file, link, and folder render distinct labels and icons', () => {
    const items = buildActivityFeed(
      emptyInput({
        documents: [
          document({ uid: 'd-file', type: 'file', name: 'A', updated_at: '2026-01-01T00:00:00Z' }),
          document({ uid: 'd-link', type: 'link', name: 'B', updated_at: '2026-01-02T00:00:00Z' }),
          document({ uid: 'd-folder', type: 'folder', name: 'C', updated_at: '2026-01-03T00:00:00Z' }),
        ],
      })
    );
    const byUid = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byUid['document-d-file'].label).toBe('Document: A');
    expect(byUid['document-d-link'].label).toBe('Link: B');
    expect(byUid['document-d-folder'].label).toBe('Folder: C');
    expect(byUid['document-d-folder'].icon).toContain('folder');
  });

  it('maps vote status through POLL_STATUS_LABELS instead of leaking the raw enum value', () => {
    const items = buildActivityFeed(emptyInput({ votes: [vote({ status: PollStatus.ENDED })] }));
    expect(items[0].label).toBe('Vote Ended: Q1 Budget');
  });

  it('normalizes an uppercase/mixed-case vote status before mapping through POLL_STATUS_LABELS', () => {
    const items = buildActivityFeed(emptyInput({ votes: [vote({ status: 'ACTIVE' as PollStatus })] }));
    expect(items[0].label).toBe('Vote Active: Q1 Budget');
  });

  it('falls back to the raw vote status when it has no POLL_STATUS_LABELS entry', () => {
    const items = buildActivityFeed(emptyInput({ votes: [vote({ status: 'archived' as PollStatus })] }));
    expect(items[0].label).toBe('Vote archived: Q1 Budget');
  });

  it('falls back to a generic label instead of "Vote undefined" when status is missing', () => {
    const items = buildActivityFeed(emptyInput({ votes: [vote({ status: undefined })] }));
    expect(items[0].label).toBe('Vote Updated: Q1 Budget');
  });

  it('falls back to a generic label instead of "Vote :" when status is an empty string', () => {
    const items = buildActivityFeed(emptyInput({ votes: [vote({ status: '' as PollStatus })] }));
    expect(items[0].label).toBe('Vote Updated: Q1 Budget');
  });

  it('falls back to a generic label instead of "undefined:" when a document type is unrecognized', () => {
    const items = buildActivityFeed(emptyInput({ documents: [document({ type: 'unexpected' as CommitteeDocument['type'] })] }));
    expect(items[0].label).toBe('Document: Charter.pdf');
    expect(items[0].icon).toContain('file');
  });

  describe('action', () => {
    it("routes a past-meeting item to meeting.id — matching the Past Meeting card's own link — regardless of meeting_and_occurrence_id", () => {
      const withComposite = buildActivityFeed(emptyInput({ pastMeetings: [pastMeeting({ id: 'pm-42', meeting_and_occurrence_id: 'pm-42-occ-9' })] }));
      expect(withComposite[0].action).toEqual({ kind: 'past-meeting', meetingId: 'pm-42' });

      const withoutComposite = buildActivityFeed(emptyInput({ pastMeetings: [pastMeeting({ id: 'pm-42', meeting_and_occurrence_id: undefined })] }));
      expect(withoutComposite[0].action).toEqual({ kind: 'past-meeting', meetingId: 'pm-42' });
    });

    it('still prefers the composite occurrence id for the @for tracking key, independent of the navigation id', () => {
      const withComposite = buildActivityFeed(emptyInput({ pastMeetings: [pastMeeting({ id: 'pm-42', meeting_and_occurrence_id: 'pm-42-occ-9' })] }));
      expect(withComposite[0].key).toBe('past_meeting-pm-42-occ-9');

      const withoutComposite = buildActivityFeed(emptyInput({ pastMeetings: [pastMeeting({ id: 'pm-42', meeting_and_occurrence_id: undefined })] }));
      expect(withoutComposite[0].key).toBe('past_meeting-pm-42');
    });

    it('opens the vote drawer for a vote item', () => {
      const items = buildActivityFeed(emptyInput({ votes: [vote({ uid: 'vote-42' })] }));
      expect(items[0].action).toEqual({ kind: 'vote-drawer', voteUid: 'vote-42' });
    });

    it('opens the survey drawer for a survey item', () => {
      const items = buildActivityFeed(emptyInput({ surveys: [survey({ uid: 'survey-42' })] }));
      expect(items[0].action).toEqual({ kind: 'survey-drawer', surveyUid: 'survey-42' });
    });

    it('opens a link document directly when it has a valid http(s) url', () => {
      const items = buildActivityFeed(emptyInput({ documents: [document({ type: 'link', url: 'https://example.com/notes' })] }));
      expect(items[0].action).toEqual({ kind: 'external-url', url: 'https://example.com/notes' });
    });

    it('falls back to the documents tab for a link document with a missing or unsafe url', () => {
      const missingUrl = buildActivityFeed(emptyInput({ documents: [document({ type: 'link', url: undefined })] }));
      expect(missingUrl[0].action).toEqual({ kind: 'tab', tab: 'documents' });

      const unsafeUrl = buildActivityFeed(emptyInput({ documents: [document({ type: 'link', url: 'javascript:alert(1)' })] }));
      expect(unsafeUrl[0].action).toEqual({ kind: 'tab', tab: 'documents' });
    });

    it('falls back to the documents tab for a file document even when a url is present', () => {
      const items = buildActivityFeed(emptyInput({ documents: [document({ type: 'file', url: 'https://example.com/storage/charter.pdf' })] }));
      expect(items[0].action).toEqual({ kind: 'tab', tab: 'documents' });
    });

    it('falls back to the documents tab for a folder document', () => {
      const items = buildActivityFeed(emptyInput({ documents: [document({ type: 'folder' })] }));
      expect(items[0].action).toEqual({ kind: 'tab', tab: 'documents' });
    });
  });
});
