// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the shared RSVP scope resolver (LFXV2-2864).
//
// These tests pin the exact production state of meeting `92442170146` at the time
// LFXV2-2864 was reported: Connie Krueger held a base `all` accept, a
// `this_and_following` accept anchored at Jul 21 UTC, and a single-occurrence
// decline for Aug 11 UTC (= Aug 12 in her local tz). Under the pre-fix strict
// equality on `occurrence_id`, the ITX endpoint's seconds-encoded ids never matched
// the RSVP records' millisecond-encoded ids, so the single decline was invisible
// and the "Your RSVP" chip fell through to whichever RSVP happened to come first
// in the query-service response.
//
// Data source: LFXV2-2864 Jira comment (Investigation notes — meeting 92442170146).
// All identifiers below are the ACTUAL production ids Connie owns; they are already
// posted publicly on the Jira ticket, so echoing them here keeps the fixture
// verifiable against real state rather than a synthetic reduction that could
// silently drift from the bug's real shape.

import { describe, expect, it } from 'vitest';

import { MeetingRsvp } from '../interfaces';
import { isSameOccurrenceId, occurrenceIdToMs, selectApplicableRsvp } from './rsvp-calculator.util';

/**
 * Build a MeetingRsvp with just the fields the resolver reads. Any other required
 * fields on the interface are cast on — the resolver never looks at them.
 */
function rsvp(overrides: Partial<MeetingRsvp>): MeetingRsvp {
  return {
    id: overrides.id || 'rsvp-1',
    meeting_id: overrides.meeting_id || '92442170146',
    registrant_id: overrides.registrant_id || '1e1322f3-d21e-42b9-8c9d-80cc7aa9f5f9',
    username: '',
    email: 'ckrueger@linuxfoundation.org',
    response_type: overrides.response_type || 'accepted',
    scope: overrides.scope || 'all',
    occurrence_id: overrides.occurrence_id,
    created_at: overrides.created_at || '2026-07-10T20:40:37Z',
    modified_at: overrides.modified_at,
    updated_at: overrides.updated_at,
    meeting_and_occurrence_id: overrides.meeting_and_occurrence_id,
    ...overrides,
  } as MeetingRsvp;
}

/**
 * Connie's real 3 RSVPs on meeting `92442170146`, as fetched from OpenSearch.
 * The full data breakdown lives on LFXV2-2864.
 */
const CONNIE_BASE_ALL_ACCEPT = rsvp({
  id: 'b7d3a81d-0c52-481f-8274-29099773ea2f',
  response_type: 'accepted',
  scope: 'all',
  occurrence_id: undefined,
  meeting_and_occurrence_id: '92442170146',
  created_at: '2026-07-10T20:40:37Z',
  modified_at: '2026-07-10T20:40:37Z',
});

const CONNIE_TAF_JUL_21_ACCEPT = rsvp({
  id: '67d85cd7-bba2-4880-9307-2b873a648de9',
  response_type: 'accepted',
  scope: 'this_and_following',
  occurrence_id: '1784642400000', // Jul 21 14:00 UTC (ms)
  meeting_and_occurrence_id: '92442170146-1784642400000',
  created_at: '2026-07-21T02:17:23Z',
  modified_at: '2026-07-21T02:17:23Z',
});

const CONNIE_SINGLE_AUG_11_DECLINE = rsvp({
  id: 'ea7dc865-f5ba-4ff3-8957-ec9b36109cbc',
  response_type: 'declined',
  scope: 'single',
  occurrence_id: '1786456800000', // Aug 11 14:00 UTC (ms)
  meeting_and_occurrence_id: '92442170146-1786456800000',
  created_at: '2026-07-27T21:43:07Z',
  modified_at: '2026-07-27T21:43:07Z',
});

const CONNIES_RSVPS = [CONNIE_BASE_ALL_ACCEPT, CONNIE_TAF_JUL_21_ACCEPT, CONNIE_SINGLE_AUG_11_DECLINE];

// The meeting-service occurrence calculator emits occurrence_id in Unix SECONDS
// (10 digits), matching what /itx/meetings/{id} returns to the frontend. These
// are the ids the resolver will actually receive from the caller — Connie's
// RSVPs store their occurrence_id as MILLISECONDS (13 digits) so we intentionally
// mix units to reproduce the wire reality.
const OCC_JUL_28_SECONDS = '1785247200';
const OCC_AUG_04_SECONDS = '1785852000';
const OCC_AUG_11_SECONDS = '1786456800';
const OCC_AUG_18_SECONDS = '1787061600';
const OCC_JUL_14_SECONDS = '1784037600';

describe('occurrenceIdToMs', () => {
  it('leaves ms-encoded ids alone', () => {
    expect(occurrenceIdToMs('1786456800000')).toBe(1786456800000);
  });

  it('widens seconds-encoded ids into ms', () => {
    expect(occurrenceIdToMs('1786456800')).toBe(1786456800 * 1000);
  });

  it('returns null for nullish / empty / unparseable input', () => {
    expect(occurrenceIdToMs(null)).toBeNull();
    expect(occurrenceIdToMs(undefined)).toBeNull();
    expect(occurrenceIdToMs('')).toBeNull();
    expect(occurrenceIdToMs('not-a-number')).toBeNull();
    expect(occurrenceIdToMs('0')).toBeNull();
    expect(occurrenceIdToMs('-1')).toBeNull();
  });
});

describe('isSameOccurrenceId', () => {
  it('matches identical seconds strings', () => {
    expect(isSameOccurrenceId('1786456800', '1786456800')).toBe(true);
  });

  it('matches identical ms strings', () => {
    expect(isSameOccurrenceId('1786456800000', '1786456800000')).toBe(true);
  });

  it('matches seconds against ms for the same instant (the LFXV2-2864 case)', () => {
    expect(isSameOccurrenceId('1786456800', '1786456800000')).toBe(true);
    expect(isSameOccurrenceId('1786456800000', '1786456800')).toBe(true);
  });

  it('does not match different instants regardless of unit', () => {
    expect(isSameOccurrenceId('1786456800', '1785247200000')).toBe(false); // Aug 11 sec vs Jul 28 ms
    expect(isSameOccurrenceId('1786456800000', '1785247200')).toBe(false); // Aug 11 ms vs Jul 28 sec
  });

  it('returns false when either side is nullish', () => {
    expect(isSameOccurrenceId(null, '1786456800000')).toBe(false);
    expect(isSameOccurrenceId('1786456800000', undefined)).toBe(false);
    expect(isSameOccurrenceId(undefined, undefined)).toBe(false);
    expect(isSameOccurrenceId('', '1786456800000')).toBe(false);
  });
});

describe('selectApplicableRsvp — Connie Krueger (LFXV2-2864)', () => {
  it('returns declined for the Aug 11 occurrence (her single decline in ms) when the caller passes seconds', () => {
    // Pre-fix: strict equality failed ("1786456800000" !== "1786456800"),
    // resolver walked past the single decline, returned the older T&F accept.
    // Post-fix: the resolver normalises both sides to ms and matches.
    const result = selectApplicableRsvp(OCC_AUG_11_SECONDS, CONNIES_RSVPS);
    expect(result?.id).toBe(CONNIE_SINGLE_AUG_11_DECLINE.id);
    expect(result?.response_type).toBe('declined');
  });

  it('returns accepted for Jul 28 (single decline does NOT apply, T&F does)', () => {
    // Sanity check on the shape of the bug the ticket describes: a single-occurrence
    // decline must not bleed onto other occurrences. Jul 28 is after the T&F anchor
    // (Jul 21) so the T&F accept wins over the base `all`.
    const result = selectApplicableRsvp(OCC_JUL_28_SECONDS, CONNIES_RSVPS);
    expect(result?.id).toBe(CONNIE_TAF_JUL_21_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });

  it('returns accepted for Aug 4 (T&F applies, single decline for Aug 11 does not)', () => {
    const result = selectApplicableRsvp(OCC_AUG_04_SECONDS, CONNIES_RSVPS);
    expect(result?.id).toBe(CONNIE_TAF_JUL_21_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });

  it('returns accepted for Aug 18 (post-decline occurrence — T&F still applies)', () => {
    const result = selectApplicableRsvp(OCC_AUG_18_SECONDS, CONNIES_RSVPS);
    expect(result?.id).toBe(CONNIE_TAF_JUL_21_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });

  it('returns the base `all` accept for Jul 14 (pre-T&F-anchor occurrence)', () => {
    // Anchor is Jul 21; Jul 14 is before it, so T&F does not apply. Single decline
    // is for Aug 11 only. Only the base `all` remains — this is the historical
    // "declined by association" trap the old T&F comparison-against-created_at
    // could fall into, since created_at (Jul 21T02:17) is also after Jul 14.
    const result = selectApplicableRsvp(OCC_JUL_14_SECONDS, CONNIES_RSVPS);
    expect(result?.id).toBe(CONNIE_BASE_ALL_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });
});

describe('selectApplicableRsvp — scope precedence and edges', () => {
  const meetingId = 'meeting-1';
  const registrantId = 'reg-1';

  it('returns null for an empty RSVP list', () => {
    expect(selectApplicableRsvp('1786456800', [])).toBeNull();
  });

  it('returns the most recent RSVP when no occurrence is provided (non-recurring or aggregate view)', () => {
    const older = rsvp({
      id: 'older',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'all',
      response_type: 'accepted',
      occurrence_id: undefined,
      modified_at: '2026-01-01T00:00:00Z',
    });
    const newer = rsvp({
      id: 'newer',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'all',
      response_type: 'declined',
      occurrence_id: undefined,
      modified_at: '2026-06-01T00:00:00Z',
    });

    const result = selectApplicableRsvp(undefined, [older, newer]);
    expect(result?.id).toBe('newer');
  });

  it('picks a fresher this_and_following over an older `all` for a covered occurrence', () => {
    // Regression guard: original three-tier "check all first, then single, then T&F"
    // ordering would surface the `all` RSVP even after the user had explicitly
    // overridden it via a T&F starting at or before the target occurrence.
    const staleAllDecline = rsvp({
      id: 'stale-all',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'all',
      response_type: 'declined',
      occurrence_id: undefined,
      modified_at: '2026-01-01T00:00:00Z',
    });
    const freshTafAccept = rsvp({
      id: 'fresh-taf',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'this_and_following',
      response_type: 'accepted',
      occurrence_id: OCC_JUL_28_SECONDS, // anchor exactly on target
      modified_at: '2026-07-27T00:00:00Z',
    });

    const result = selectApplicableRsvp(OCC_JUL_28_SECONDS, [staleAllDecline, freshTafAccept]);
    expect(result?.id).toBe('fresh-taf');
  });

  it('does not apply a this_and_following whose anchor is after the target occurrence', () => {
    const futureTaf = rsvp({
      id: 'future-taf',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'this_and_following',
      response_type: 'declined',
      occurrence_id: OCC_AUG_11_SECONDS, // anchored Aug 11
      modified_at: '2026-08-11T00:00:00Z',
    });
    const baseAllAccept = rsvp({
      id: 'base-all',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'all',
      response_type: 'accepted',
      occurrence_id: undefined,
      modified_at: '2026-01-01T00:00:00Z',
    });

    // Target is Jul 28 — before the T&F anchor at Aug 11 — so T&F must not apply.
    const result = selectApplicableRsvp(OCC_JUL_28_SECONDS, [futureTaf, baseAllAccept]);
    expect(result?.id).toBe('base-all');
    expect(result?.response_type).toBe('accepted');
  });

  it('gates this_and_following by anchor time rather than created_at (LFXV2-2864 T&F subtlety)', () => {
    // Row was WRITTEN long before the anchor occurrence (retroactive sync) — the
    // pre-fix `created_at <= occurrenceDate` check would have wrongly applied it
    // to a Jul 14 occurrence. The correct semantic is anchor-vs-target.
    const retroactiveTaf = rsvp({
      id: 'retro-taf',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'this_and_following',
      response_type: 'declined',
      occurrence_id: OCC_AUG_11_SECONDS, // anchor Aug 11
      created_at: '2026-06-01T00:00:00Z', // WRITTEN before Jul 14 target
      modified_at: '2026-06-01T00:00:00Z',
    });

    // Target Jul 14 is before the Aug 11 anchor → T&F does not apply → null.
    const result = selectApplicableRsvp(OCC_JUL_14_SECONDS, [retroactiveTaf]);
    expect(result).toBeNull();
  });

  it('matches single-scope RSVPs across seconds/ms boundaries symmetrically', () => {
    const singleDeclineMs = rsvp({
      id: 'single-ms',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'single',
      response_type: 'declined',
      occurrence_id: '1786456800000',
      modified_at: '2026-07-27T21:43:07Z',
    });
    const singleDeclineSeconds = rsvp({
      id: 'single-sec',
      meeting_id: 'meeting-2',
      registrant_id: registrantId,
      scope: 'single',
      response_type: 'declined',
      occurrence_id: '1786456800',
      modified_at: '2026-07-27T21:43:07Z',
    });

    // Caller passes seconds against a ms-stored RSVP: matches.
    expect(selectApplicableRsvp('1786456800', [singleDeclineMs])?.id).toBe('single-ms');
    // Caller passes ms against a seconds-stored RSVP: matches.
    expect(selectApplicableRsvp('1786456800000', [singleDeclineSeconds])?.id).toBe('single-sec');
  });

  it('skips a this_and_following RSVP that has no anchor (malformed data)', () => {
    const malformed = rsvp({
      id: 'malformed',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'this_and_following',
      response_type: 'declined',
      occurrence_id: undefined,
    });
    expect(selectApplicableRsvp(OCC_JUL_28_SECONDS, [malformed])).toBeNull();
  });
});
