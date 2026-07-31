// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for activity-feed.utils.ts. All fixtures use synthetic placeholder identities —
// never real user data.

import { describe, expect, it } from 'vitest';

import { PollStatus, SurveyStatus } from '../enums';
import { ActivityEvent, CommitteeDocumentType } from '../interfaces';
import { mapActivityEventsToFeedItems } from './activity-feed.utils';

const COMMITTEE_UID = 'committee-1';

function meetingHeld(overrides: Partial<Extract<ActivityEvent, { type: 'meeting_held' }>['payload']> = {}, occurredAt = '2026-01-01T10:00:00Z'): ActivityEvent {
  return {
    type: 'meeting_held',
    occurred_at: occurredAt,
    committee_uid: COMMITTEE_UID,
    payload: { meeting_id: 'pm-1', title: 'Weekly Sync', ...overrides },
  };
}

function voteEvent(
  type: 'vote_opened' | 'vote_closed',
  overrides: Partial<Extract<ActivityEvent, { type: 'vote_opened' }>['payload']> = {},
  occurredAt = '2026-01-02T10:00:00Z'
): ActivityEvent {
  return {
    type,
    occurred_at: occurredAt,
    committee_uid: COMMITTEE_UID,
    payload: { vote_uid: 'vote-1', name: 'Q1 Budget', status: PollStatus.ACTIVE, ...overrides },
  };
}

function surveyEvent(
  type: 'survey_published' | 'survey_closed',
  overrides: Partial<Extract<ActivityEvent, { type: 'survey_published' }>['payload']> = {},
  occurredAt = '2026-01-03T10:00:00Z'
): ActivityEvent {
  return {
    type,
    occurred_at: occurredAt,
    committee_uid: COMMITTEE_UID,
    payload: { survey_uid: 'survey-1', title: 'Community Feedback', status: SurveyStatus.OPEN, ...overrides },
  };
}

function documentUploaded(
  overrides: Partial<Extract<ActivityEvent, { type: 'document_uploaded' }>['payload']> = {},
  occurredAt = '2026-01-04T10:00:00Z'
): ActivityEvent {
  return {
    type: 'document_uploaded',
    occurred_at: occurredAt,
    committee_uid: COMMITTEE_UID,
    payload: { document_uid: 'doc-1', name: 'Charter.pdf', document_type: 'file', ...overrides },
  };
}

describe('mapActivityEventsToFeedItems', () => {
  it('returns an empty array when given no events', () => {
    expect(mapActivityEventsToFeedItems([], { votingEnabled: true })).toEqual([]);
  });

  it('preserves the server-provided order — no re-sorting or capping client-side', () => {
    const items = mapActivityEventsToFeedItems([documentUploaded(), voteEvent('vote_closed'), surveyEvent('survey_published'), meetingHeld()], {
      votingEnabled: true,
    });
    expect(items.map((i) => i.type)).toEqual(['document', 'vote', 'survey', 'past_meeting']);
  });

  it('carries occurred_at straight through as the item timestamp', () => {
    const items = mapActivityEventsToFeedItems([meetingHeld({}, '2026-01-05T00:00:00Z')], { votingEnabled: true });
    expect(items[0].timestamp).toBe('2026-01-05T00:00:00Z');
  });

  it('excludes vote events entirely when votingEnabled is false, but keeps the other sources', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_opened'), surveyEvent('survey_published')], { votingEnabled: false });
    expect(items.map((i) => i.type)).toEqual(['survey']);
  });

  it('keeps vote_closed events excluded too when votingEnabled is false', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_closed')], { votingEnabled: false });
    expect(items).toEqual([]);
  });

  it('labels documents by type — file, link, and folder render distinct labels and icons', () => {
    const items = mapActivityEventsToFeedItems(
      [
        documentUploaded({ document_uid: 'd-file', document_type: 'file', name: 'A' }),
        documentUploaded({ document_uid: 'd-link', document_type: 'link', name: 'B' }),
        documentUploaded({ document_uid: 'd-folder', document_type: 'folder', name: 'C' }),
      ],
      { votingEnabled: true }
    );
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['document-d-file'].label).toBe('Document: A');
    expect(byKey['document-d-link'].label).toBe('Link: B');
    expect(byKey['document-d-folder'].label).toBe('Folder: C');
    expect(byKey['document-d-folder'].icon).toContain('folder');
  });

  it('maps vote status through POLL_STATUS_LABELS instead of leaking the raw enum value', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_closed', { status: PollStatus.ENDED })], { votingEnabled: true });
    expect(items[0].label).toBe('Vote Ended: Q1 Budget');
  });

  it('normalizes an uppercase/mixed-case vote status before mapping through POLL_STATUS_LABELS', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_opened', { status: 'ACTIVE' })], { votingEnabled: true });
    expect(items[0].label).toBe('Vote Active: Q1 Budget');
  });

  it('falls back to the raw vote status when it has no POLL_STATUS_LABELS entry', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_opened', { status: 'archived' })], { votingEnabled: true });
    expect(items[0].label).toBe('Vote archived: Q1 Budget');
  });

  it('falls back to a generic label instead of "Vote undefined" when status is missing', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_opened', { status: undefined as unknown as string })], { votingEnabled: true });
    expect(items[0].label).toBe('Vote Updated: Q1 Budget');
  });

  it('falls back to a generic label instead of "Vote :" when status is an empty string', () => {
    const items = mapActivityEventsToFeedItems([voteEvent('vote_opened', { status: '' })], { votingEnabled: true });
    expect(items[0].label).toBe('Vote Updated: Q1 Budget');
  });

  it('renders the survey status label for both published and closed events', () => {
    const published = mapActivityEventsToFeedItems([surveyEvent('survey_published', { status: SurveyStatus.DRAFT })], { votingEnabled: true });
    expect(published[0].label).toBe('Survey Draft: Community Feedback');

    const closed = mapActivityEventsToFeedItems([surveyEvent('survey_closed', { status: SurveyStatus.CLOSED })], { votingEnabled: true });
    expect(closed[0].label).toBe('Survey Closed: Community Feedback');
  });

  it('falls back to a generic label instead of "undefined:" when a document type is unrecognized', () => {
    const items = mapActivityEventsToFeedItems([documentUploaded({ document_type: 'unexpected' as CommitteeDocumentType })], {
      votingEnabled: true,
    });
    expect(items[0].label).toBe('Document: Charter.pdf');
    expect(items[0].icon).toContain('file');
  });

  it('silently drops deferred event types instead of throwing', () => {
    const deferred: ActivityEvent = { type: 'document_deleted', occurred_at: '2026-01-01T00:00:00Z', committee_uid: COMMITTEE_UID, payload: {} };
    const items = mapActivityEventsToFeedItems([deferred, meetingHeld()], { votingEnabled: true });
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('past_meeting');
  });

  describe('action', () => {
    it('routes a meeting_held item to its meeting_id', () => {
      const items = mapActivityEventsToFeedItems([meetingHeld({ meeting_id: 'pm-42' })], { votingEnabled: true });
      expect(items[0].action).toEqual({ kind: 'past-meeting', meetingId: 'pm-42' });
      expect(items[0].key).toBe('past_meeting-pm-42');
    });

    it('opens the vote drawer for a vote event', () => {
      const items = mapActivityEventsToFeedItems([voteEvent('vote_opened', { vote_uid: 'vote-42' })], { votingEnabled: true });
      expect(items[0].action).toEqual({ kind: 'vote-drawer', voteUid: 'vote-42' });
    });

    it('opens the survey drawer for a survey event', () => {
      const items = mapActivityEventsToFeedItems([surveyEvent('survey_published', { survey_uid: 'survey-42' })], { votingEnabled: true });
      expect(items[0].action).toEqual({ kind: 'survey-drawer', surveyUid: 'survey-42' });
    });

    it('opens a link document directly when it has a valid http(s) url', () => {
      const items = mapActivityEventsToFeedItems([documentUploaded({ document_type: 'link', url: 'https://example.com/notes' })], { votingEnabled: true });
      expect(items[0].action).toEqual({ kind: 'external-url', url: 'https://example.com/notes' });
    });

    it('falls back to the documents tab for a link document with a missing or unsafe url', () => {
      const missingUrl = mapActivityEventsToFeedItems([documentUploaded({ document_type: 'link', url: undefined })], { votingEnabled: true });
      expect(missingUrl[0].action).toEqual({ kind: 'tab', tab: 'documents' });

      const unsafeUrl = mapActivityEventsToFeedItems([documentUploaded({ document_type: 'link', url: 'javascript:alert(1)' })], { votingEnabled: true });
      expect(unsafeUrl[0].action).toEqual({ kind: 'tab', tab: 'documents' });
    });

    it('falls back to the documents tab for a file document even when a url is present', () => {
      const items = mapActivityEventsToFeedItems([documentUploaded({ document_type: 'file', url: 'https://example.com/storage/charter.pdf' })], {
        votingEnabled: true,
      });
      expect(items[0].action).toEqual({ kind: 'tab', tab: 'documents' });
    });

    it('falls back to the documents tab for a folder document', () => {
      const items = mapActivityEventsToFeedItems([documentUploaded({ document_type: 'folder' })], { votingEnabled: true });
      expect(items[0].action).toEqual({ kind: 'tab', tab: 'documents' });
    });
  });
});
