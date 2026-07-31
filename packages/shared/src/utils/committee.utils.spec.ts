// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for committee.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).
// Includes the committee member permission resolver (LFXV2-2059), the All Groups
// foundation-grouping helper (LFXV2-1715), and the Groups dashboard engagement stat-card builder
// (LFXV2-1711). `apps/lfx-one` has no Angular component-test runner (no `ng test` target), so
// component-level logic that needs coverage lives here as a pure, dependency-free function and is
// tested by this package's own Vitest runner instead.
//
// All fixtures use synthetic placeholder identities — never real user data.

import { describe, expect, it } from 'vitest';

import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { Committee, CommitteeMember, GroupsEngagementStats } from '../interfaces';
import { FOUNDATION_LEVEL_GROUP_FALLBACK_LABEL } from '../constants/committees.constants';
import { CommitteeMemberRole } from '../enums/committee-member.enum';
import {
  buildCommitteeCreateQueryParams,
  buildEngagementStatCards,
  canManageCommitteeMembers,
  countVotingReps,
  groupCommitteesByFoundation,
  resolveCommitteeMemberPermission,
  resolveGroupsCardRoleSeverity,
} from './committee.utils';

/** Minimal committee builder — only the fields the resolver reads. */
function committee(overrides: Partial<Committee> = {}): Committee {
  return {
    uid: 'cmte-1',
    name: 'Example Governing Board',
    category: 'Board',
    enable_voting: true,
    public: true,
    sso_group_enabled: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    total_members: 0,
    total_voting_repos: 0,
    project_uid: 'proj-1',
    ...overrides,
  } as Committee;
}

/** Minimal member builder — only the fields the matcher reads. */
function member(overrides: Partial<CommitteeMember> = {}): CommitteeMember {
  return {
    uid: 'mem-1',
    committee_uid: 'cmte-1',
    committee_name: 'Example Governing Board',
    email: 'jdoe@example.com',
    first_name: 'Jordan',
    last_name: 'Doe',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as CommitteeMember;
}

/** Synthetic grant entry that matches the default member by username and email. */
const grantee = { username: 'auth0|jdoe', email: 'jdoe@example.com', name: 'Jordan Doe' };

describe('resolveCommitteeMemberPermission', () => {
  it('returns manage for a committee-scoped writer (direct, not inherited)', () => {
    const result = resolveCommitteeMemberPermission(committee({ writers: [grantee] }), member());
    expect(result).toEqual({ level: 'manage', inherited: false });
  });

  it('returns review for a committee-scoped auditor (direct, not inherited)', () => {
    const result = resolveCommitteeMemberPermission(committee({ auditors: [grantee] }), member());
    expect(result).toEqual({ level: 'review', inherited: false });
  });

  it('returns manage (inherited) for a foundation-level writer with no committee role', () => {
    const result = resolveCommitteeMemberPermission(committee({ inherited_writers: [grantee] }), member());
    expect(result).toEqual({ level: 'manage', inherited: true });
  });

  it('returns review (inherited) for a foundation-level View grant with no committee role', () => {
    const result = resolveCommitteeMemberPermission(committee({ inherited_auditors: [grantee] }), member());
    expect(result).toEqual({ level: 'review', inherited: true });
  });

  it('returns member when the user has no committee-scoped or inherited grant', () => {
    const result = resolveCommitteeMemberPermission(committee(), member());
    expect(result).toEqual({ level: 'member', inherited: false });
  });

  it('matches by Auth0 username even when the member email differs from the grant email', () => {
    const result = resolveCommitteeMemberPermission(
      committee({ inherited_writers: [grantee] }),
      member({ username: 'auth0|jdoe', email: 'jordan-alt@example.com' })
    );
    expect(result).toEqual({ level: 'manage', inherited: true });
  });

  it('falls back to a case-insensitive email match when the member has no username', () => {
    const result = resolveCommitteeMemberPermission(
      committee({ inherited_writers: [{ username: '', email: 'JDOE@example.com', name: 'Jordan Doe' }] }),
      member({ username: undefined, email: 'jdoe@example.com' })
    );
    expect(result).toEqual({ level: 'manage', inherited: true });
  });

  it('prefers the committee-scoped role over an inherited grant (direct manage is not labelled inherited)', () => {
    const result = resolveCommitteeMemberPermission(committee({ writers: [grantee], inherited_writers: [grantee] }), member());
    expect(result).toEqual({ level: 'manage', inherited: false });
  });

  it('ranks manage above review when grants exist at both levels', () => {
    const result = resolveCommitteeMemberPermission(committee({ auditors: [grantee], inherited_writers: [grantee] }), member());
    // A direct auditor role makes hasDirectRole true, so inherited is false even though the
    // winning manage level comes from inherited_writers.
    expect(result).toEqual({ level: 'manage', inherited: false });
  });

  it('returns member for a null committee', () => {
    expect(resolveCommitteeMemberPermission(null, member())).toEqual({ level: 'member', inherited: false });
  });
});

describe('buildCommitteeCreateQueryParams', () => {
  it('includes the project slug when present', () => {
    expect(buildCommitteeCreateQueryParams(committee({ uid: 'cmte-9', project_slug: 'my-project' }))).toEqual({
      committee_uid: 'cmte-9',
      project: 'my-project',
    });
  });

  it('omits the project key when the committee has no project slug', () => {
    expect(buildCommitteeCreateQueryParams(committee({ uid: 'cmte-9' }))).toEqual({ committee_uid: 'cmte-9' });
  });
});

describe('canManageCommitteeMembers', () => {
  it('is true when the effective writer flag is set (covers inherited foundation Manage)', () => {
    expect(canManageCommitteeMembers(committee({ writer: true }))).toBe(true);
  });

  it('is false when the effective writer flag is absent', () => {
    expect(canManageCommitteeMembers(committee({ writer: false }))).toBe(false);
    expect(canManageCommitteeMembers(committee())).toBe(false);
  });

  it('is false for a null committee', () => {
    expect(canManageCommitteeMembers(null)).toBe(false);
  });
});

describe('resolveGroupsCardRoleSeverity', () => {
  it('maps Chair to info', () => {
    expect(resolveGroupsCardRoleSeverity(CommitteeMemberRole.CHAIR)).toBe('info');
  });

  it('maps Vice Chair to success', () => {
    expect(resolveGroupsCardRoleSeverity(CommitteeMemberRole.VICE_CHAIR)).toBe('success');
  });

  it('maps LF Staff to contrast', () => {
    expect(resolveGroupsCardRoleSeverity(CommitteeMemberRole.LF_STAFF)).toBe('contrast');
  });

  it('maps every other role, "Member", and undefined to secondary', () => {
    expect(resolveGroupsCardRoleSeverity(CommitteeMemberRole.SECRETARY)).toBe('secondary');
    expect(resolveGroupsCardRoleSeverity('Member')).toBe('secondary');
    expect(resolveGroupsCardRoleSeverity(undefined)).toBe('secondary');
  });
});

describe('groupCommitteesByFoundation', () => {
  it('returns an empty array for an empty input', () => {
    expect(groupCommitteesByFoundation([])).toEqual([]);
  });

  it('groups committees under the same project_uid into one bucket, keyed by project_uid', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-alpha', project_name: 'Alpha Project' }),
      committee({ uid: 'c2', project_uid: 'proj-alpha', project_name: 'Alpha Project' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'uid:proj-alpha', label: 'Alpha Project', testIdSlug: 'alpha-project' });
    expect(groups[0].committees.map((c) => c.uid)).toEqual(['c1', 'c2']);
  });

  it('keeps two distinct sub-projects separate even when they share a display label', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: 'Working Group' }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: 'Working Group' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(['uid:proj-a', 'uid:proj-b']);
    // Same label, different project_uid: testid slugs must still be unique.
    expect(new Set(groups.map((g) => g.testIdSlug)).size).toBe(2);
  });

  it('merges committees with no project_name but a shared foundation_name into one bucket', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: undefined, foundation_name: 'CNCF' }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: undefined, foundation_name: 'CNCF' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'label:CNCF', label: 'CNCF' });
    expect(groups[0].committees.map((c) => c.uid).sort()).toEqual(['c1', 'c2']);
  });

  it('merges fully degraded (no project_name, no foundation_name) committees into one fallback bucket', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: undefined, foundation_name: undefined, is_foundation: false }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: undefined, foundation_name: undefined, is_foundation: false }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Other Groups');
    expect(groups[0].committees).toHaveLength(2);
  });

  it('sorts the foundation-level bucket first regardless of alphabetical order', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-zeta', project_name: 'Zeta Project' }),
      committee({ uid: 'c2', project_uid: 'proj-root', project_name: 'Root Foundation', is_foundation: true }),
      committee({ uid: 'c3', project_uid: 'proj-alpha', project_name: 'Alpha Project' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Root Foundation', 'Alpha Project', 'Zeta Project']);
  });

  it('sorts the "Other Groups" fallback bucket last', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-zeta', project_name: 'Zeta Project' }),
      committee({ uid: 'c2', project_uid: 'proj-degraded', project_name: undefined, foundation_name: undefined, is_foundation: false }),
      committee({ uid: 'c3', project_uid: 'proj-alpha', project_name: 'Alpha Project' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Alpha Project', 'Zeta Project', 'Other Groups']);
  });

  it('disambiguates testid slugs that collide even though the labels differ', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: 'Alpha Project' }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: 'Alpha-Project' }),
    ]);
    const slugs = groups.map((g) => g.testIdSlug).sort();
    expect(slugs).toEqual(['alpha-project', 'alpha-project-2']);
  });

  it('assigns colliding testid slugs by key order, independent of the (locale-aware) label display order', () => {
    // "Foo Bar" and "Foo-Bar" both slugify to "foo-bar" but are genuinely distinct labels/projects.
    // Slug numbering must follow key order (proj-a < proj-z), not whichever label sorts first for
    // display — otherwise the '-2' suffix would route through localeCompare and could flip between
    // server and client under differing ICU collation.
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-z', project_name: 'Foo Bar' }),
      committee({ uid: 'c2', project_uid: 'proj-a', project_name: 'Foo-Bar' }),
    ]);
    // Guards this test's discriminating power: display order puts 'Foo Bar' (proj-z) before
    // 'Foo-Bar' (proj-a) under the current ICU collation. If a future runtime's collation ever
    // flips that, this assertion goes red instead of the test silently stopping to prove anything —
    // a key-ordered slug pass is only provably correct when display order disagrees with key order.
    expect(groups.map((g) => g.key)).toEqual(['uid:proj-z', 'uid:proj-a']);
    expect(groups.find((g) => g.key === 'uid:proj-a')?.testIdSlug).toBe('foo-bar');
    expect(groups.find((g) => g.key === 'uid:proj-z')?.testIdSlug).toBe('foo-bar-2');
  });

  it("keeps testid slugs unique when a disambiguated suffix collides with another bucket's base slug", () => {
    // Two "Alpha Project" buckets claim alpha-project / alpha-project-2; a third bucket whose own
    // label is literally "Alpha Project 2" bases to alpha-project-2 too. A naive per-base-slug
    // counter would emit alpha-project-2 twice; walking candidates until one is free must not.
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: 'Alpha Project' }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: 'Alpha Project' }),
      committee({ uid: 'c3', project_uid: 'proj-c', project_name: 'Alpha Project 2' }),
    ]);
    const slugs = groups.map((g) => g.testIdSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(groups.find((g) => g.key === 'uid:proj-a')?.testIdSlug).toBe('alpha-project');
    expect(groups.find((g) => g.key === 'uid:proj-b')?.testIdSlug).toBe('alpha-project-2');
    expect(groups.find((g) => g.key === 'uid:proj-c')?.testIdSlug).toBe('alpha-project-2-2');
  });

  it('merges a degraded committee into an existing named bucket that already carries the identical label', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-cncf', project_name: 'CNCF' }),
      committee({ uid: 'c2', project_uid: 'proj-degraded', project_name: undefined, foundation_name: 'CNCF' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'uid:proj-cncf', label: 'CNCF' });
    expect(groups[0].committees.map((c) => c.uid).sort()).toEqual(['c1', 'c2']);
  });

  const ambiguousLabelFixture = [
    committee({ uid: 'c1', project_uid: 'proj-a', project_name: 'CNCF' }),
    committee({ uid: 'c2', project_uid: 'proj-b', project_name: 'CNCF' }),
    committee({ uid: 'c3', project_uid: 'proj-degraded', project_name: undefined, foundation_name: 'CNCF' }),
  ];

  it.each([
    ['as listed (named, named, degraded)', ambiguousLabelFixture],
    ['reversed (degraded, named, named)', [...ambiguousLabelFixture].reverse()],
    ['degraded first, named projects swapped', [ambiguousLabelFixture[2], ambiguousLabelFixture[0], ambiguousLabelFixture[1]]],
  ])('does not merge a degraded committee into either bucket when two distinct named projects share the label — input order: %s', (_description, input) => {
    const groups = groupCommitteesByFoundation(input);
    // Which of the two ambiguous "CNCF" projects the degraded committee belongs to can't be
    // determined, so it gets its own label-keyed bucket rather than merging into an arbitrary one.
    expect(groups).toHaveLength(3);
    expect(groups.filter((g) => g.label === 'CNCF')).toHaveLength(3);
    const degradedGroup = groups.find((g) => g.committees.some((c) => c.uid === 'c3'));
    expect(degradedGroup?.key).toBe('label:CNCF');
    expect(degradedGroup?.committees.map((c) => c.uid)).toEqual(['c3']);
    // Render order and testid-slug suffixes among same-labelled buckets must be stable — keyed by
    // bucket key, not input/insertion order — so they don't flip across refreshes.
    expect(groups.map((g) => g.key)).toEqual(['label:CNCF', 'uid:proj-a', 'uid:proj-b']);
    expect(groups.map((g) => g.testIdSlug)).toEqual(['cncf', 'cncf-2', 'cncf-3']);
  });

  it('a merged bucket is foundation-level if any of its committees is, regardless of arrival order', () => {
    const nonFoundationFirst = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: undefined, foundation_name: 'CNCF', is_foundation: false }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: undefined, foundation_name: 'CNCF', is_foundation: true }),
    ]);
    expect(nonFoundationFirst).toHaveLength(1);
    expect(nonFoundationFirst[0].isFoundationLevel).toBe(true);

    const foundationFirst = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-b', project_name: undefined, foundation_name: 'CNCF', is_foundation: true }),
      committee({ uid: 'c2', project_uid: 'proj-a', project_name: undefined, foundation_name: 'CNCF', is_foundation: false }),
    ]);
    expect(foundationFirst).toHaveLength(1);
    expect(foundationFirst[0].isFoundationLevel).toBe(true);
  });

  it('treats a committee with a populated project_name but a falsy project_uid as degraded, not named', () => {
    // Upstream enrichment can leave project_uid '' alongside a populated passthrough project_name.
    // Two such committees must not collapse into a single ''-keyed bucket labeled with whichever
    // arrived first — they should merge only via the normal label-based degraded path.
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: '', project_name: 'Alpha Project' }),
      committee({ uid: 'c2', project_uid: '', project_name: 'Beta Project' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(['label:Alpha Project', 'label:Beta Project']);
  });

  it('merges a degraded (falsy project_uid) committee into a named bucket sharing its label', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-cncf', project_name: 'CNCF' }),
      committee({ uid: 'c2', project_uid: '', project_name: 'CNCF' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'uid:proj-cncf', label: 'CNCF' });
    expect(groups[0].committees.map((c) => c.uid).sort()).toEqual(['c1', 'c2']);
  });

  it('keeps a named foundation bucket and the fallback foundation bucket separate, both sorted first', () => {
    // Two isFoundationLevel buckets can coexist: a named foundation project, and a separate committee
    // that IS the foundation but degrades all the way to the fallback label (no project_name, no
    // foundation_name). Neither should be dropped or merged, and both must sort ahead of every
    // non-foundation bucket.
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-alpha', project_name: 'Alpha Project' }),
      committee({ uid: 'c2', project_uid: 'proj-root', project_name: 'Root Foundation', is_foundation: true }),
      committee({ uid: 'c3', project_uid: 'proj-x', project_name: undefined, foundation_name: undefined, is_foundation: true }),
    ]);
    expect(groups.filter((g) => g.isFoundationLevel)).toHaveLength(2);
    expect(groups.slice(0, 2).every((g) => g.isFoundationLevel)).toBe(true);
    expect(groups.map((g) => g.label)).toEqual([FOUNDATION_LEVEL_GROUP_FALLBACK_LABEL, 'Root Foundation', 'Alpha Project']);
  });

  it('does not merge a degraded committee into an unrelated named bucket whose project_uid equals its label', () => {
    // project_uid and a resolved label are both arbitrary strings drawn from the same value space.
    // Without namespacing the two key domains, a degraded committee whose label happens to be
    // byte-identical to a *different*, unrelated project's raw project_uid would look up that
    // project's bucket in the Map and silently merge into it.
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'Beta Project', project_name: 'Unrelated Named Project' }),
      committee({ uid: 'c2', project_uid: 'proj-degraded', project_name: undefined, foundation_name: 'Beta Project' }),
    ]);
    expect(groups).toHaveLength(2);
    const namedGroup = groups.find((g) => g.label === 'Unrelated Named Project');
    const degradedGroup = groups.find((g) => g.label === 'Beta Project');
    expect(namedGroup?.key).toBe('uid:Beta Project');
    expect(degradedGroup?.key).toBe('label:Beta Project');
    expect(namedGroup?.committees.map((c) => c.uid)).toEqual(['c1']);
    expect(degradedGroup?.committees.map((c) => c.uid)).toEqual(['c2']);
  });

  it('falls back to a "group" testid slug (disambiguated) for labels with no ASCII alphanumerics', () => {
    const groups = groupCommitteesByFoundation([
      committee({ uid: 'c1', project_uid: 'proj-a', project_name: '日本語プロジェクト' }),
      committee({ uid: 'c2', project_uid: 'proj-b', project_name: '开放原子' }),
    ]);
    const slugs = groups.map((g) => g.testIdSlug).sort();
    expect(slugs).toEqual(['group', 'group-2']);
  });
});

describe('countVotingReps', () => {
  it('counts only members with voting.status VOTING_REP, excluding Alternate/Observer/no-voting-info', () => {
    const members = [
      member({ uid: 'm-1', voting: { status: CommitteeMemberVotingStatus.VOTING_REP } }),
      member({ uid: 'm-2', voting: { status: CommitteeMemberVotingStatus.VOTING_REP } }),
      member({ uid: 'm-3', voting: { status: CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP } }),
      member({ uid: 'm-4', voting: { status: CommitteeMemberVotingStatus.OBSERVER } }),
      member({ uid: 'm-5' }),
    ];
    expect(countVotingReps(members)).toBe(2);
  });

  it('is 0 for an empty member list', () => {
    expect(countVotingReps([])).toBe(0);
  });
});

describe('buildEngagementStatCards', () => {
  const stats: GroupsEngagementStats = { active_members: 12, meetings_this_month: 3, computed_at: new Date().toISOString(), source: 'live' };

  it('renders em-dash placeholders with no sub-line while loading, regardless of stats', () => {
    const cards = buildEngagementStatCards(stats, true);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.label)).toEqual(['Active Members', 'Meetings This Month']);
    cards.forEach((card) => {
      expect(card.value).toBe('—');
      expect(card.subLine).toBeUndefined();
    });
  });

  it('renders the real values with a freshness sub-line once live stats resolve', () => {
    const cards = buildEngagementStatCards(stats, false);
    expect(cards[0]).toMatchObject({ label: 'Active Members', value: 12 });
    expect(cards[1]).toMatchObject({ label: 'Meetings This Month', value: 3 });
    cards.forEach((card) => expect(card.subLine).toMatch(/^Updated /));
  });

  it('renders "Sample data" instead of a freshness label for mock-sourced values', () => {
    const mockStats: GroupsEngagementStats = { ...stats, source: 'mock' };
    const cards = buildEngagementStatCards(mockStats, false);
    expect(cards[0]).toMatchObject({ label: 'Active Members', value: 12, subLine: 'Sample data' });
    expect(cards[1]).toMatchObject({ label: 'Meetings This Month', value: 3, subLine: 'Sample data' });
  });

  it('degrades to "Unavailable" em-dash cards when stats is null (fetch failed)', () => {
    const cards = buildEngagementStatCards(null, false);
    cards.forEach((card) => {
      expect(card.value).toBe('—');
      expect(card.subLine).toBe('Unavailable');
    });
  });

  it('degrades to "Unavailable" em-dash cards when the live backend returns null engagement fields', () => {
    const liveStub: GroupsEngagementStats = { active_members: null, meetings_this_month: null, computed_at: new Date().toISOString(), source: 'live' };
    const cards = buildEngagementStatCards(liveStub, false);
    cards.forEach((card) => {
      expect(card.value).toBe('—');
      expect(card.subLine).toBe('Unavailable');
    });
  });

  it('degrades each card independently — one null field does not blank the other', () => {
    const partial: GroupsEngagementStats = { active_members: 9, meetings_this_month: null, computed_at: new Date().toISOString(), source: 'live' };
    const cards = buildEngagementStatCards(partial, false);
    expect(cards[0]).toMatchObject({ label: 'Active Members', value: 9 });
    expect(cards[0].subLine).toMatch(/^Updated /);
    expect(cards[1]).toMatchObject({ label: 'Meetings This Month', value: '—', subLine: 'Unavailable' });
  });
});
