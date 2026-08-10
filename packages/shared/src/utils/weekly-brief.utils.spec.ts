// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for weekly-brief.utils.ts. All fixtures use synthetic placeholder identities —
// never real user data.

import { describe, expect, it } from 'vitest';

import { WeeklyBriefSourceRef } from '../interfaces';
import { mapWeeklyBriefSourceRefsToChips } from './weekly-brief.utils';

function sourceRef(overrides: Partial<WeeklyBriefSourceRef> = {}): WeeklyBriefSourceRef {
  return { id: 'ref-1', kind: 'meeting', ...overrides };
}

describe('mapWeeklyBriefSourceRefsToChips', () => {
  it('returns an empty array when given no source refs', () => {
    expect(mapWeeklyBriefSourceRefsToChips([])).toEqual([]);
  });

  it('maps a meeting ref to a past-meeting action and its title as the label', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'pm-1', kind: 'meeting', title: 'Weekly Sync' })]);
    expect(chips).toEqual([
      { id: 'pm-1', label: 'Weekly Sync', icon: 'fa-light fa-clock-rotate-left', action: { kind: 'past-meeting', meetingId: 'pm-1', password: null } },
    ]);
  });

  it('falls back to the "Meeting" default label when a meeting ref has no title', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'pm-2', kind: 'meeting' })]);
    expect(chips[0].label).toBe('Meeting');
  });

  it('falls back to the default label when title is an empty string, not a blank chip', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'doc-1', kind: 'doc', title: '' })]);
    expect(chips[0].label).toBe('Document');
  });

  it('maps a doc ref to the documents tab action', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'doc-1', kind: 'doc', title: 'Charter.pdf' })]);
    expect(chips[0]).toEqual({ id: 'doc-1', label: 'Charter.pdf', icon: 'fa-light fa-file-lines', action: { kind: 'tab', tab: 'documents' } });
  });

  it('maps a vote ref to the vote-drawer action, carrying its id as voteUid', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'vote-1', kind: 'vote', title: 'Q1 Budget' })]);
    expect(chips[0]).toEqual({ id: 'vote-1', label: 'Q1 Budget', icon: 'fa-light fa-check-to-slot', action: { kind: 'vote-drawer', voteUid: 'vote-1' } });
  });

  it('maps a members ref to the members tab action', () => {
    // Upstream (group_weekly_brief_generator.go) always sets Title: "Member roster changes"
    // for this kind — the "Members" default label below is a defensive fallback, not what
    // production actually renders.
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'members-1', kind: 'members', title: 'Member roster changes' })]);
    expect(chips[0]).toEqual({ id: 'members-1', label: 'Member roster changes', icon: 'fa-light fa-users', action: { kind: 'tab', tab: 'members' } });
  });

  it('falls back to the "Members" default label if a members ref ever arrives with no title', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'members-2', kind: 'members' })]);
    expect(chips[0].label).toBe('Members');
  });

  it('renders a mailing-list ref unlinked — no archive URL exists in this contract to resolve', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'ml-1', kind: 'mailing-list' })]);
    expect(chips[0]).toEqual({ id: 'ml-1', label: 'Mailing List', icon: 'fa-light fa-envelope', action: null });
  });

  it('renders an unrecognized kind unlinked, with the fallback icon and the raw kind string as the label', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'x-1', kind: 'some_future_kind' })]);
    expect(chips[0]).toEqual({ id: 'x-1', label: 'some_future_kind', icon: 'fa-light fa-circle-question', action: null });
  });

  it('prefers an unrecognized kind ref title over the raw kind string when present', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'x-2', kind: 'some_future_kind', title: 'Custom Title' })]);
    expect(chips[0].label).toBe('Custom Title');
  });

  it('maps multiple refs independently, preserving order', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([
      sourceRef({ id: 'a', kind: 'meeting' }),
      sourceRef({ id: 'b', kind: 'doc' }),
      sourceRef({ id: 'c', kind: 'members' }),
    ]);
    expect(chips.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});
