// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the committee member permission resolver (LFXV2-2059).
//
// NOTE: this repo has no unit-test runner wired yet (`ng test` has no target; testing is
// Playwright E2E only). These specs are written against the pure resolver so they execute as-is
// once a runner (e.g. Vitest via `@angular/build:unit-test`) is added — that wiring is a tracked
// follow-up. They use the Vitest/Jest-compatible `describe`/`it`/`expect` globals.

import { Committee, CommitteeMember } from '../interfaces';
import { canManageCommitteeMembers, resolveCommitteeMemberPermission } from './committee.utils';

/** Minimal committee builder — only the fields the resolver reads. */
function committee(overrides: Partial<Committee> = {}): Committee {
  return {
    uid: 'cmte-1',
    name: 'AAIF Governing Board',
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
    committee_name: 'AAIF Governing Board',
    email: 'tli@linuxfoundation.org',
    first_name: 'Tracey',
    last_name: 'Li',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as CommitteeMember;
}

const tracey = { username: 'auth0|traceyli', email: 'tli@linuxfoundation.org', name: 'Tracey Li' };

describe('resolveCommitteeMemberPermission', () => {
  it('returns manage for a committee-scoped writer (direct, not inherited)', () => {
    const result = resolveCommitteeMemberPermission(committee({ writers: [tracey] }), member());
    expect(result).toEqual({ level: 'manage', inherited: false });
  });

  it('returns review for a committee-scoped auditor (direct, not inherited)', () => {
    const result = resolveCommitteeMemberPermission(committee({ auditors: [tracey] }), member());
    expect(result).toEqual({ level: 'review', inherited: false });
  });

  it('returns manage (inherited) for a foundation-level writer with no committee role — the Tracey Li case', () => {
    const result = resolveCommitteeMemberPermission(committee({ inherited_writers: [tracey] }), member());
    expect(result).toEqual({ level: 'manage', inherited: true });
  });

  it('returns review (inherited) for a foundation-level View grant with no committee role', () => {
    const result = resolveCommitteeMemberPermission(committee({ inherited_auditors: [tracey] }), member());
    expect(result).toEqual({ level: 'review', inherited: true });
  });

  it('returns member when the user has no committee-scoped or inherited grant', () => {
    const result = resolveCommitteeMemberPermission(committee(), member());
    expect(result).toEqual({ level: 'member', inherited: false });
  });

  it('matches by Auth0 username even when the member email differs from the grant email', () => {
    const result = resolveCommitteeMemberPermission(
      committee({ inherited_writers: [tracey] }),
      member({ username: 'auth0|traceyli', email: 'tracey@example.com' })
    );
    expect(result).toEqual({ level: 'manage', inherited: true });
  });

  it('falls back to a case-insensitive email match when the member has no username', () => {
    const result = resolveCommitteeMemberPermission(
      committee({ inherited_writers: [{ username: '', email: 'TLI@linuxfoundation.org', name: 'Tracey Li' }] }),
      member({ username: undefined, email: 'tli@linuxfoundation.org' })
    );
    expect(result).toEqual({ level: 'manage', inherited: true });
  });

  it('prefers the committee-scoped role over an inherited grant (direct manage is not labelled inherited)', () => {
    const result = resolveCommitteeMemberPermission(committee({ writers: [tracey], inherited_writers: [tracey] }), member());
    expect(result).toEqual({ level: 'manage', inherited: false });
  });

  it('ranks manage above review when grants exist at both levels', () => {
    const result = resolveCommitteeMemberPermission(committee({ auditors: [tracey], inherited_writers: [tracey] }), member());
    // A direct auditor role makes hasDirectRole true, so inherited is false even though the
    // winning manage level comes from inherited_writers.
    expect(result).toEqual({ level: 'manage', inherited: false });
  });

  it('returns member for a null committee', () => {
    expect(resolveCommitteeMemberPermission(null, member())).toEqual({ level: 'member', inherited: false });
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
