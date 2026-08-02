// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the shared RSVP scope resolver (LFXV2-2864).
//
// These tests pin the exact shape of the production state observed at the time
// LFXV2-2864 was reported: the affected user held a base `all` accept, a
// `this_and_following` accept anchored at Jul 21 UTC, and a single-occurrence
// decline for Aug 11 UTC (= Aug 12 in their local tz). Under the pre-fix strict
// equality on `occurrence_id`, the ITX endpoint's seconds-encoded ids never
// matched the RSVP records' millisecond-encoded ids, so the single decline was
// invisible and the "Your RSVP" chip fell through to whichever RSVP happened to
// come first in the query-service response.
//
// Identifiers below are synthetic (`series-1`, `reg-1`, `rsvp-N`,
// `user@example.com`); the value comes from the response-type + scope +
// occurrence_id + timestamp arrangement, not from any specific meeting or user.
// See LFXV2-2864 for the original data breakdown.

import { describe, expect, it } from 'vitest';

import { MeetingRsvp } from '../interfaces';
import { countRegistrantAttendance, getRegistrantAttendanceStatus, isSameOccurrenceId, occurrenceIdToMs, selectApplicableRsvp } from './rsvp-calculator.util';

/**
 * Build a MeetingRsvp with just the fields the resolver reads. Any other required
 * fields on the interface are cast on — the resolver never looks at them.
 */
function rsvp(overrides: Partial<MeetingRsvp>): MeetingRsvp {
  return {
    id: overrides.id || 'rsvp-1',
    meeting_id: overrides.meeting_id || 'series-1',
    registrant_id: overrides.registrant_id || 'reg-1',
    username: '',
    email: 'user@example.com',
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
 * Synthetic reproduction of the 3-RSVP prod fingerprint from LFXV2-2864:
 * base `all` accept + Jul-21 T&F accept + Aug-11 `single` decline.
 */
const BASE_ALL_ACCEPT = rsvp({
  id: 'rsvp-1',
  response_type: 'accepted',
  scope: 'all',
  occurrence_id: undefined,
  meeting_and_occurrence_id: 'series-1',
  created_at: '2026-07-10T20:40:37Z',
  modified_at: '2026-07-10T20:40:37Z',
});

const TAF_JUL_21_ACCEPT = rsvp({
  id: 'rsvp-2',
  response_type: 'accepted',
  scope: 'this_and_following',
  occurrence_id: '1784642400000', // Jul 21 14:00 UTC (ms)
  meeting_and_occurrence_id: 'series-1-1784642400000',
  created_at: '2026-07-21T02:17:23Z',
  modified_at: '2026-07-21T02:17:23Z',
});

const SINGLE_AUG_11_DECLINE = rsvp({
  id: 'rsvp-3',
  response_type: 'declined',
  scope: 'single',
  occurrence_id: '1786456800000', // Aug 11 14:00 UTC (ms)
  meeting_and_occurrence_id: 'series-1-1786456800000',
  created_at: '2026-07-27T21:43:07Z',
  modified_at: '2026-07-27T21:43:07Z',
});

const MIXED_UNIT_RSVPS = [BASE_ALL_ACCEPT, TAF_JUL_21_ACCEPT, SINGLE_AUG_11_DECLINE];

// The meeting-service occurrence calculator emits occurrence_id in Unix SECONDS
// (10 digits), matching what /itx/meetings/{id} returns to the frontend. These
// are the ids the resolver will actually receive from the caller — the affected
// user's RSVPs store their occurrence_id as MILLISECONDS (13 digits) so we
// intentionally mix units to reproduce the wire reality.
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

  it('returns false for equal-but-malformed strings (no string fast-path)', () => {
    // Both sides go through occurrenceIdToMs — malformed equal strings must not
    // shortcut to `true` via reference equality; that would let a malformed
    // single-occurrence RSVP falsely match its own bogus occurrence_id.
    expect(isSameOccurrenceId('0', '0')).toBe(false);
    expect(isSameOccurrenceId('not-a-number', 'not-a-number')).toBe(false);
    expect(isSameOccurrenceId('-1', '-1')).toBe(false);
  });
});

describe('selectApplicableRsvp — LFXV2-2864 prod fingerprint', () => {
  it('returns declined for the Aug 11 occurrence (single decline in ms) when the caller passes seconds', () => {
    // Pre-fix: strict equality failed ("1786456800000" !== "1786456800"),
    // resolver walked past the single decline, returned the older T&F accept.
    // Post-fix: the resolver normalises both sides to ms and matches.
    const result = selectApplicableRsvp(OCC_AUG_11_SECONDS, MIXED_UNIT_RSVPS);
    expect(result?.id).toBe(SINGLE_AUG_11_DECLINE.id);
    expect(result?.response_type).toBe('declined');
  });

  it('returns accepted for Jul 28 (single decline does NOT apply, T&F does)', () => {
    // Sanity check on the shape of the bug the ticket describes: a single-occurrence
    // decline must not bleed onto other occurrences. Jul 28 is after the T&F anchor
    // (Jul 21) so the T&F accept wins over the base `all`.
    const result = selectApplicableRsvp(OCC_JUL_28_SECONDS, MIXED_UNIT_RSVPS);
    expect(result?.id).toBe(TAF_JUL_21_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });

  it('returns accepted for Aug 4 (T&F applies, single decline for Aug 11 does not)', () => {
    const result = selectApplicableRsvp(OCC_AUG_04_SECONDS, MIXED_UNIT_RSVPS);
    expect(result?.id).toBe(TAF_JUL_21_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });

  it('returns accepted for Aug 18 (post-decline occurrence — T&F still applies)', () => {
    const result = selectApplicableRsvp(OCC_AUG_18_SECONDS, MIXED_UNIT_RSVPS);
    expect(result?.id).toBe(TAF_JUL_21_ACCEPT.id);
    expect(result?.response_type).toBe('accepted');
  });

  it('returns the base `all` accept for Jul 14 (pre-T&F-anchor occurrence)', () => {
    // Anchor is Jul 21; Jul 14 is before it, so T&F does not apply. Single decline
    // is for Aug 11 only. Only the base `all` remains — this is the historical
    // "declined by association" trap the old T&F comparison-against-created_at
    // could fall into, since created_at (Jul 21T02:17) is also after Jul 14.
    const result = selectApplicableRsvp(OCC_JUL_14_SECONDS, MIXED_UNIT_RSVPS);
    expect(result?.id).toBe(BASE_ALL_ACCEPT.id);
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

  it('picks a fresher `all` over an older matching `single` for the same occurrence', () => {
    // Regression guard for the "newest applicable wins" semantic: if a user
    // previously declined a specific occurrence via `single` and then re-accepted
    // the entire series via `all`, the newer series-wide answer must win — the
    // resolver is not a strict single > all hierarchy.
    const olderSingleDecline = rsvp({
      id: 'older-single',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'single',
      response_type: 'declined',
      occurrence_id: OCC_JUL_28_SECONDS,
      modified_at: '2026-06-01T00:00:00Z',
    });
    const newerAllAccept = rsvp({
      id: 'newer-all',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'all',
      response_type: 'accepted',
      occurrence_id: undefined,
      modified_at: '2026-07-01T00:00:00Z',
    });

    const result = selectApplicableRsvp(OCC_JUL_28_SECONDS, [olderSingleDecline, newerAllAccept]);
    expect(result?.id).toBe('newer-all');
    expect(result?.response_type).toBe('accepted');
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

  it('matches a single-scope RSVP that carries only the composite key (empty occurrence_id)', () => {
    // Defensive fallback for a query-service shape we can't fully prove from
    // code: every known write path sets `occurrence_id` directly, but if a
    // `single`-scope row ever arrives with only the `meeting_and_occurrence_id`
    // composite populated, the resolver must still match on the composite's
    // suffix — otherwise the chip silently degrades to the invite_accepted
    // fallback and we reintroduce LFXV2-2864.
    const compositeOnly = rsvp({
      id: 'composite-only',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'single',
      response_type: 'declined',
      occurrence_id: '',
      meeting_and_occurrence_id: `${meetingId}-1786456800000`,
      modified_at: '2026-07-27T21:43:07Z',
    });
    // Caller supplies seconds; composite suffix is ms. Fallback + unit
    // normalisation must both fire to match.
    const result = selectApplicableRsvp(OCC_AUG_11_SECONDS, [compositeOnly]);
    expect(result?.id).toBe('composite-only');
    expect(result?.response_type).toBe('declined');
  });

  it('gates a this_and_following anchor from the composite suffix when occurrence_id is empty', () => {
    // Same fallback for T&F: the anchor lives in the composite suffix. Rows
    // anchored after the target must still be excluded, and rows anchored
    // at/before the target must apply.
    const compositeTafPostAnchor = rsvp({
      id: 'composite-taf-post',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'this_and_following',
      response_type: 'declined',
      occurrence_id: '',
      meeting_and_occurrence_id: `${meetingId}-1786456800000`, // anchor Aug 11 ms
      modified_at: '2026-08-11T00:00:00Z',
    });
    // Jul 28 target is before the Aug 11 anchor → does not apply.
    expect(selectApplicableRsvp(OCC_JUL_28_SECONDS, [compositeTafPostAnchor])).toBeNull();
    // Aug 18 target is after the anchor → applies.
    expect(selectApplicableRsvp(OCC_AUG_18_SECONDS, [compositeTafPostAnchor])?.id).toBe('composite-taf-post');
  });

  it('does not match when neither occurrence_id nor composite carry a usable id', () => {
    const noOccurrenceIdentifiers = rsvp({
      id: 'no-ids',
      meeting_id: meetingId,
      registrant_id: registrantId,
      scope: 'single',
      response_type: 'declined',
      occurrence_id: '',
      meeting_and_occurrence_id: `${meetingId}-`, // trailing dash, no suffix
      modified_at: '2026-07-27T21:43:07Z',
    });
    expect(selectApplicableRsvp(OCC_AUG_11_SECONDS, [noOccurrenceIdentifiers])).toBeNull();
  });
});

describe('getRegistrantAttendanceStatus', () => {
  it('returns accepted when the RSVP is accepted', () => {
    expect(getRegistrantAttendanceStatus({ rsvp: { response_type: 'accepted' }, invite_accepted: null })).toBe('accepted');
  });

  it('returns declined when the RSVP is declined', () => {
    expect(getRegistrantAttendanceStatus({ rsvp: { response_type: 'declined' }, invite_accepted: null })).toBe('declined');
  });

  it('returns maybe when the RSVP is maybe', () => {
    expect(getRegistrantAttendanceStatus({ rsvp: { response_type: 'maybe' }, invite_accepted: null })).toBe('maybe');
  });

  it('falls back to invite_accepted=true when there is no applicable RSVP', () => {
    // The exact LFXV2-2864 shape: single-scope decline for a future occurrence
    // resolves to `rsvp: null` on today's occurrence, but the calendar invite
    // itself was accepted. The chip renders "accepted"; counts must agree.
    expect(getRegistrantAttendanceStatus({ rsvp: null, invite_accepted: true })).toBe('accepted');
    expect(getRegistrantAttendanceStatus({ rsvp: undefined, invite_accepted: true })).toBe('accepted');
  });

  it('falls back to invite_accepted=false when there is no applicable RSVP', () => {
    // Inverse of the case above: Google Calendar decline sets invite_accepted=false
    // on the registrant, and the resulting single-scope decline may not apply to
    // the currently-rendered occurrence. Chip shows declined; counts must too.
    expect(getRegistrantAttendanceStatus({ rsvp: null, invite_accepted: false })).toBe('declined');
    expect(getRegistrantAttendanceStatus({ rsvp: undefined, invite_accepted: false })).toBe('declined');
  });

  it('returns pending when both RSVP and invite_accepted are absent', () => {
    expect(getRegistrantAttendanceStatus({ rsvp: null, invite_accepted: null })).toBe('pending');
    expect(getRegistrantAttendanceStatus({})).toBe('pending');
  });

  it('prefers RSVP response over invite_accepted (deliberate action wins)', () => {
    // Declining series-wide via calendar then explicitly accepting a single
    // occurrence via LFX RSVP: the deliberate per-occurrence action wins.
    expect(getRegistrantAttendanceStatus({ rsvp: { response_type: 'accepted' }, invite_accepted: false })).toBe('accepted');
    expect(getRegistrantAttendanceStatus({ rsvp: { response_type: 'declined' }, invite_accepted: true })).toBe('declined');
  });
});

describe('countRegistrantAttendance', () => {
  it('returns zeros for an empty registrant list', () => {
    expect(countRegistrantAttendance([])).toEqual({ accepted: 0, declined: 0, maybe: 0, total: 0 });
  });

  it('counts each registrant into exactly one bucket, including pending in total', () => {
    const registrants = [
      { rsvp: { response_type: 'accepted' }, invite_accepted: null },
      { rsvp: { response_type: 'declined' }, invite_accepted: null },
      { rsvp: { response_type: 'maybe' }, invite_accepted: null },
      { rsvp: null, invite_accepted: null }, // pending — no info at all
    ];
    expect(countRegistrantAttendance(registrants)).toEqual({ accepted: 1, declined: 1, maybe: 1, total: 4 });
  });

  it('honours invite_accepted fallback for registrants with no applicable RSVP', () => {
    // Reproduces the meeting-card list-view bug (LFXV2-2864): guest chip shows 1
    // declined because invite_accepted=false, but pre-fix counts stayed at 0/0/0.
    const registrants = [
      { rsvp: null, invite_accepted: false }, // Google Calendar decline, no matching RSVP
      { rsvp: null, invite_accepted: true }, // Google Calendar accept, no matching RSVP
      { rsvp: { response_type: 'declined' }, invite_accepted: null }, // Explicit LFX decline
    ];
    expect(countRegistrantAttendance(registrants)).toEqual({ accepted: 1, declined: 2, maybe: 0, total: 3 });
  });
});
