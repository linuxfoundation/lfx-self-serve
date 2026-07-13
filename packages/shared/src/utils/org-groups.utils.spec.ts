// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Vitest evaluates the full `../constants` barrel on import; some path through it (unlike
// meeting.utils.ts's use of the same barrel) reaches an Angular Location static initializer
// that needs the JIT compiler. Loading it upfront avoids the "PlatformLocation" JIT crash.
import '@angular/compiler';
import { describe, expect, it } from 'vitest';

import type { OrgGroup } from '../interfaces';
import { deriveDemoViewerIsGroupMember, splitOrgGroupsByPrivacy } from './org-groups.utils';

/** Builds an OrgGroup fixture, defaulting fields so tests set only what they assert on. */
function group(partial: Partial<OrgGroup>): OrgGroup {
  return {
    id: 'group-a',
    name: 'Group A',
    description: '',
    type: 'Other',
    foundation: 'CNCF',
    parentProject: 'kubernetes',
    visibility: 'PUBLIC',
    votingEnabled: false,
    memberCount: 1,
    hasMailingList: false,
    hasChatChannel: false,
    updatedAt: new Date('2026-01-01'),
    ...partial,
  };
}

// Ids picked so their deriveDemoViewerIsGroupMember hash is known and stable: 'group-a' resolves
// to viewer-is-member (true), 'hidden-group-2'/'hidden-group-5'/'hidden-group-8' resolve to
// viewer-is-not-member (false).
const MEMBER_ID = 'group-a';
const NON_MEMBER_IDS = ['hidden-group-2', 'hidden-group-5', 'hidden-group-8'];

describe('deriveDemoViewerIsGroupMember', () => {
  it('is deterministic for the same id', () => {
    expect(deriveDemoViewerIsGroupMember(MEMBER_ID)).toBe(deriveDemoViewerIsGroupMember(MEMBER_ID));
    expect(deriveDemoViewerIsGroupMember(NON_MEMBER_IDS[0])).toBe(deriveDemoViewerIsGroupMember(NON_MEMBER_IDS[0]));
  });

  it('resolves both membership outcomes across different ids', () => {
    expect(deriveDemoViewerIsGroupMember(MEMBER_ID)).toBe(true);
    expect(deriveDemoViewerIsGroupMember(NON_MEMBER_IDS[0])).toBe(false);
  });
});

describe('splitOrgGroupsByPrivacy', () => {
  it('treats every public group as visible regardless of membership', () => {
    const groups = [group({ id: NON_MEMBER_IDS[0], visibility: 'PUBLIC' })];
    const { visible, rollup } = splitOrgGroupsByPrivacy(groups);
    expect(visible).toEqual(groups);
    expect(rollup).toBeNull();
  });

  it('treats a private group the viewer is a member of as visible', () => {
    const groups = [group({ id: MEMBER_ID, visibility: 'PRIVATE' })];
    const { visible, rollup } = splitOrgGroupsByPrivacy(groups);
    expect(visible).toEqual(groups);
    expect(rollup).toBeNull();
  });

  it('hides a private group the viewer is not a member of and rolls it up instead', () => {
    const groups = [group({ id: NON_MEMBER_IDS[0], visibility: 'PRIVATE' })];
    const { visible, rollup } = splitOrgGroupsByPrivacy(groups);
    expect(visible).toEqual([]);
    expect(rollup?.totalCount).toBe(1);
  });

  it('returns a null rollup when there are no hidden groups', () => {
    const groups = [group({ id: MEMBER_ID, visibility: 'PUBLIC' }), group({ id: MEMBER_ID, visibility: 'PRIVATE' })];
    expect(splitOrgGroupsByPrivacy(groups).rollup).toBeNull();
  });

  it('aggregates bucket counts, project/foundation counts, and member totals across hidden groups', () => {
    const hiddenGroups: OrgGroup[] = [
      group({ id: NON_MEMBER_IDS[0], visibility: 'PRIVATE', type: 'Board', foundation: 'CNCF', parentProject: 'kubernetes', memberCount: 3 }),
      group({ id: NON_MEMBER_IDS[1], visibility: 'PRIVATE', type: 'TAC', foundation: 'CNCF', parentProject: 'prometheus', memberCount: 2 }),
      group({
        id: NON_MEMBER_IDS[2],
        visibility: 'PRIVATE',
        type: 'Marketing Committee',
        foundation: 'LF AI & Data',
        parentProject: 'kubernetes',
        memberCount: 4,
      }),
    ];

    const { visible, rollup } = splitOrgGroupsByPrivacy(hiddenGroups);
    expect(visible).toEqual([]);
    expect(rollup?.totalCount).toBe(3);
    expect(rollup?.projectCount).toBe(2); // kubernetes, prometheus
    expect(rollup?.foundationCount).toBe(2); // CNCF, LF AI & Data
    expect(rollup?.memberCount).toBe(9); // 3 + 2 + 4
    expect(rollup?.typeBadges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: 'Board', count: 1 }),
        expect.objectContaining({ bucket: 'Working Group', count: 1 }), // TAC buckets into Working Group
        expect.objectContaining({ bucket: 'Other', count: 1 }), // Marketing Committee buckets into Other
      ])
    );
  });

  it('buckets Working Group and TAC types together under the "Working Group" rollup bucket', () => {
    const hiddenGroups = [
      group({ id: NON_MEMBER_IDS[0], visibility: 'PRIVATE', type: 'Working Group' }),
      group({ id: NON_MEMBER_IDS[1], visibility: 'PRIVATE', type: 'TAC' }),
    ];
    const { rollup } = splitOrgGroupsByPrivacy(hiddenGroups);
    expect(rollup?.typeBadges).toEqual([expect.objectContaining({ bucket: 'Working Group', count: 2 })]);
  });

  it('buckets Marketing Committee and Other types together under the "Other" rollup bucket', () => {
    const hiddenGroups = [
      group({ id: NON_MEMBER_IDS[0], visibility: 'PRIVATE', type: 'Marketing Committee' }),
      group({ id: NON_MEMBER_IDS[1], visibility: 'PRIVATE', type: 'Other' }),
    ];
    const { rollup } = splitOrgGroupsByPrivacy(hiddenGroups);
    expect(rollup?.typeBadges).toEqual([expect.objectContaining({ bucket: 'Other', count: 2 })]);
  });
});
