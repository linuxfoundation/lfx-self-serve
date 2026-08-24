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
      {
        id: 'pm-1',
        label: 'Weekly Sync',
        icon: 'fa-light fa-clock-rotate-left',
        kind: 'meeting',
        action: { kind: 'past-meeting', meetingId: 'pm-1', password: null },
      },
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
    expect(chips[0]).toEqual({ id: 'doc-1', label: 'Charter.pdf', icon: 'fa-light fa-file-lines', kind: 'doc', action: { kind: 'tab', tab: 'documents' } });
  });

  it('maps a vote ref to the vote-drawer action, carrying its id as voteUid', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'vote-1', kind: 'vote', title: 'Q1 Budget' })]);
    expect(chips[0]).toEqual({
      id: 'vote-1',
      label: 'Q1 Budget',
      icon: 'fa-light fa-check-to-slot',
      kind: 'vote',
      action: { kind: 'vote-drawer', voteUid: 'vote-1' },
    });
  });

  it('maps a members ref to the members tab action', () => {
    // Upstream (group_weekly_brief_generator.go) always sets Title: "Member roster changes"
    // for this kind — the "Members" default label below is a defensive fallback, not what
    // production actually renders.
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'members-1', kind: 'members', title: 'Member roster changes' })]);
    expect(chips[0]).toEqual({
      id: 'members-1',
      label: 'Member roster changes',
      icon: 'fa-light fa-users',
      kind: 'members',
      action: { kind: 'tab', tab: 'members' },
    });
  });

  it('falls back to the "Members" default label if a members ref ever arrives with no title', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'members-2', kind: 'members' })]);
    expect(chips[0].label).toBe('Members');
  });

  it('renders a mailing-list ref unlinked — no archive URL exists in this contract to resolve', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'ml-1', kind: 'mailing-list' })]);
    expect(chips[0]).toEqual({ id: 'ml-1', label: 'Mailing List', icon: 'fa-light fa-envelope', kind: 'mailing-list', action: null });
  });

  it('renders an unrecognized kind unlinked, with the fallback icon and the raw kind string as the label', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([sourceRef({ id: 'x-1', kind: 'some_future_kind' })]);
    expect(chips[0]).toEqual({ id: 'x-1', label: 'some_future_kind', icon: 'fa-light fa-circle-question', kind: 'some_future_kind', action: null });
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

  it('leaves an all-unique input byte-identical to pre-dedup behavior — no chip gets a group field', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([
      sourceRef({ id: 'a', kind: 'meeting', title: 'Weekly Sync' }),
      sourceRef({ id: 'b', kind: 'doc', title: 'Charter.pdf' }),
      sourceRef({ id: 'c', kind: 'meeting', title: 'Budget Review' }),
    ]);
    expect(chips).toHaveLength(3);
    expect(chips.every((chip) => chip.group === undefined)).toBe(true);
  });

  it('never groups untitled refs together, even when they share a kind (and so a fallback label)', () => {
    // Three untitled meeting refs would all resolve to the same fallback label ("Meeting"),
    // but they're three distinct meetings that merely lack titles -- grouping on the resolved
    // label would wrongly present them as one recurring meeting.
    const chips = mapWeeklyBriefSourceRefsToChips([
      sourceRef({ id: 'm-1', kind: 'meeting' }),
      sourceRef({ id: 'm-2', kind: 'meeting' }),
      sourceRef({ id: 'm-3', kind: 'meeting' }),
    ]);

    expect(chips).toHaveLength(3);
    expect(chips.every((chip) => chip.group === undefined)).toBe(true);
    expect(chips.every((chip) => chip.label === 'Meeting')).toBe(true);
    expect(chips.map((c) => c.id)).toEqual(['m-1', 'm-2', 'm-3']);
  });

  it('collapses same-kind-and-label refs into one group chip, leaving unique ones untouched', () => {
    const chips = mapWeeklyBriefSourceRefsToChips([
      sourceRef({ id: 'm-1', kind: 'meeting', title: 'AAIF Technical Committee Meeting' }),
      sourceRef({ id: 'doc-1', kind: 'doc', title: 'Charter.pdf' }),
      sourceRef({ id: 'm-2', kind: 'meeting', title: 'AAIF Technical Committee Meeting' }),
      sourceRef({ id: 'm-3', kind: 'meeting', title: 'AAIF Technical Committee Meeting' }),
    ]);

    // Overall order follows first occurrence of each (kind, label) group.
    expect(chips.map((c) => c.label)).toEqual(['AAIF Technical Committee Meeting', 'Charter.pdf']);

    const [meetingGroup, docChip] = chips;
    expect(docChip.group).toBeUndefined();

    expect(meetingGroup.action).toBeNull();
    expect(meetingGroup.group?.count).toBe(3);
    expect(meetingGroup.group?.instances.map((i) => i.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(meetingGroup.group?.instances.map((i) => i.label)).toEqual([
      'AAIF Technical Committee Meeting #1',
      'AAIF Technical Committee Meeting #2',
      'AAIF Technical Committee Meeting #3',
    ]);
    // Each instance keeps its own real click-through action — the group wrapper is the only
    // thing whose action is nulled out.
    meetingGroup.group?.instances.forEach((instance, index) => {
      expect(instance.action).toEqual({ kind: 'past-meeting', meetingId: `m-${index + 1}`, password: null });
      expect(instance.group).toBeUndefined();
    });
  });

  it('collapses an all-duplicate input into a single group chip covering every ref', () => {
    const refs = [
      sourceRef({ id: 'v-1', kind: 'vote', title: 'Q1 Budget' }),
      sourceRef({ id: 'v-2', kind: 'vote', title: 'Q1 Budget' }),
      sourceRef({ id: 'v-3', kind: 'vote', title: 'Q1 Budget' }),
      sourceRef({ id: 'v-4', kind: 'vote', title: 'Q1 Budget' }),
    ];
    const chips = mapWeeklyBriefSourceRefsToChips(refs);

    expect(chips).toHaveLength(1);
    expect(chips[0].group?.count).toBe(refs.length);
    expect(chips[0].group?.instances.map((i) => i.id)).toEqual(['v-1', 'v-2', 'v-3', 'v-4']);
    expect(chips[0].group?.instances.map((i) => i.label)).toEqual(['Q1 Budget #1', 'Q1 Budget #2', 'Q1 Budget #3', 'Q1 Budget #4']);
  });
});
