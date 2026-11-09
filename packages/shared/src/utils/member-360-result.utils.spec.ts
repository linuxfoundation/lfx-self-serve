// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { Member360Envelope } from '../interfaces/member-360.interface';
import {
  member360ActionTeams,
  member360ActionText,
  member360EvidenceGroups,
  member360EvidenceSource,
  member360QuarterLabel,
  member360TierGroupLabel,
  member360WeightRows,
} from './member-360-result.utils';

type Tabs = Member360Envelope['tabs'];
type Action = Tabs['actions_by_team'][number];

const baseAction: Action = {
  owner: 'Marketing',
  priority: 'Medium',
  member_organization: 'Org',
  engagement_tier: 'Passive',
  days_to_renewal: 21,
  recommended_action: 'Invite the voting rep to speak.',
  supporting_rationale: 'Rule 6.',
  suggested_deadline: '2026-12-15',
  routing_rule: 6,
};
const action = (over: Partial<Action>): Action => ({ ...baseAction, ...over });

describe('member360ActionText', () => {
  it.each([
    ['Marketing: offer the WG vice-chair a speaking slot.', 'Offer the WG vice-chair a speaking slot.'],
    ['Mktg owner: invite the seat holder to present.', 'Invite the seat holder to present.'],
    ['Member Success: book renewal review before 2026-11-30.', 'Book renewal review before 2026-11-30.'],
    ['Sales: close the 2026-11-30 renewal.', 'Close the 2026-11-30 renewal.'],
    ['Case-study owner: propose a Postman case study.', 'Propose a Postman case study.'],
  ])('drops the leading team label from %j', (text, expected) => {
    expect(member360ActionText({ recommended_action: text })).toBe(expected);
  });

  it('keeps an action that opens with anything else, and never empties one', () => {
    expect(member360ActionText({ recommended_action: 'Confirm AI Robotix renewal: before 2026-11-30.' })).toBe(
      'Confirm AI Robotix renewal: before 2026-11-30.'
    );
    expect(member360ActionText({ recommended_action: 'Marketing: ' })).toBe('Marketing: ');
  });
});

describe('member360ActionTeams', () => {
  const actions = [
    action({ owner: 'Marketing', priority: 'Medium', member_organization: 'B', suggested_deadline: '2026-12-01' }),
    action({ owner: 'Marketing', priority: 'High', member_organization: 'C', suggested_deadline: '2026-12-15' }),
    action({ owner: 'Marketing', priority: 'High', member_organization: 'A', suggested_deadline: '2026-11-20' }),
    action({ owner: 'Marketing', priority: 'Low', member_organization: 'D', suggested_deadline: null }),
    action({ owner: 'Sales', priority: 'High', member_organization: 'S', suggested_deadline: '2026-11-16' }),
  ];

  it('orders teams Sales, Marketing, Member Success, and rows High first, then nearest deadline', () => {
    const teams = member360ActionTeams(actions);
    expect(teams.map((team) => team.owner)).toEqual(['Sales', 'Marketing', 'Member Success']);
    expect(teams[1].actions.map((row) => row.member_organization)).toEqual(['A', 'C', 'B', 'D']);
  });

  it('counts each team by priority (zero counts left out) and names its earliest deadline', () => {
    const [sales, marketing, success] = member360ActionTeams(actions);
    expect(marketing.priorityCounts).toEqual([
      { priority: 'High', count: 2 },
      { priority: 'Medium', count: 1 },
      { priority: 'Low', count: 1 },
    ]);
    expect(marketing.nextDue).toBe('2026-11-20');
    expect(sales.priorityCounts).toEqual([{ priority: 'High', count: 1 }]);
    expect(success).toMatchObject({ key: 'member-success', actions: [], priorityCounts: [], nextDue: null });
  });
});

describe('member360EvidenceGroups and member360EvidenceSource', () => {
  const evidence: Tabs['evidence'] = [
    {
      member_organization: 'A',
      category: 'speaking',
      date: '2026-11-09',
      description: 'speakers aggregate: 1 signals',
      source: 'LFX MCP — lfx_mcp_query_lfx_standard_metrics',
      signal_weight: 1,
    },
    {
      member_organization: 'A',
      category: 'committees',
      date: '2026-11-09',
      description: 'Main — seat held',
      source: 'LFX MCP — lfx_mcp_search_committee_members',
      signal_weight: 1,
    },
    {
      member_organization: 'B',
      category: 'committees',
      date: '2026-11-09',
      description: 'Board — seat held',
      source: 'LFX MCP — lfx_mcp_search_committee_members',
      signal_weight: 1,
    },
  ];

  it('groups by category, largest first, keeping row order inside a group', () => {
    const groups = member360EvidenceGroups(evidence);
    expect(groups.map((group) => [group.key, group.rows.length])).toEqual([
      ['committees', 2],
      ['speaking', 1],
    ]);
    expect(groups[0].rows.map((row) => row.member_organization)).toEqual(['A', 'B']);
    expect(groups[0].label).toBe('Committees & governance');
  });

  it('names known LFX sources in words and shows any other source as written', () => {
    expect(member360EvidenceSource('LFX MCP — lfx_mcp_search_committee_members')).toBe('LFX · committee seats');
    expect(member360EvidenceSource('LFX MCP — lfx_mcp_query_lfx_standard_metrics')).toBe('LFX · event and speaker metrics');
    expect(member360EvidenceSource('Uploaded tracker: sponsors.xlsx')).toBe('Uploaded tracker: sponsors.xlsx');
  });
});

describe('member360WeightRows', () => {
  it('lists every category in heat order with its weight; only a category the run lists as without data reads as no data', () => {
    const rows = member360WeightRows({
      weights_used: { committees: 36.37, events: 36.36, speaking: 27.27, content: 0, community_programs: 0, marketing_social: 0 },
      weights_default: { committees: 20, events: 20, speaking: 15, content: 15, community_programs: 10, marketing_social: 20 },
      categories_no_data: [{ category: 'content', reason: 'No content tracker uploaded.' }],
    });
    expect(rows.map((row) => row.key)).toEqual(['events', 'speaking', 'community_programs', 'committees', 'content', 'marketing_social']);
    expect(rows.find((row) => row.key === 'events')).toMatchObject({ used: 36.36, default: 20, noDataReason: null });
    // Whole percents add up to 100 (largest remainder): committees 36.37 → 37, events 36.36 → 36, speaking 27.27 → 27.
    expect(rows.map((row) => [row.key, row.shownPercent])).toEqual([
      ['events', 36],
      ['speaking', 27],
      ['community_programs', 0],
      ['committees', 37],
      ['content', 0],
      ['marketing_social', 0],
    ]);
    expect(rows.find((row) => row.key === 'content')?.noDataReason).toBe('No content tracker uploaded.');
    expect(rows.find((row) => row.key === 'marketing_social')).toMatchObject({ used: 0, default: 20, noDataReason: null });
  });
});

describe('member360TierGroupLabel and member360QuarterLabel', () => {
  it('drops the project prefix and the word Membership, and keeps anything else', () => {
    const project = 'Agentic AI Foundation (AAIF)';
    expect(member360TierGroupLabel('Agentic AI Foundation (AAIF) - Gold Membership', project)).toBe('Gold');
    expect(member360TierGroupLabel('Agentic AI Foundation (AAIF) - Silver Membership (100 - 499)', project)).toBe('Silver (100 - 499)');
    expect(member360TierGroupLabel('General + Associate (merged)', project)).toBe('General + Associate (merged)');
  });

  it('names the calendar quarter of a run date, and nothing for a missing one', () => {
    expect(member360QuarterLabel('2026-11-15T12:00:00Z')).toBe('Q4 2026');
    expect(member360QuarterLabel('2026-02-15T12:00:00Z')).toBe('Q1 2026');
    // Local time, the clock the date pipe shows beside it: a run at local 30 Sep 23:30 is Q3, whatever UTC says.
    const lateSeptember = new Date(2026, 8, 30, 23, 30).toISOString();
    expect(member360QuarterLabel(lateSeptember)).toBe('Q3 2026');
    expect(member360QuarterLabel(null)).toBeNull();
    expect(member360QuarterLabel('not a date')).toBeNull();
  });
});
