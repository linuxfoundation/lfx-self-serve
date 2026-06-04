// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the pending-invitation pure helpers (LFXV2-2118).
//
// NOTE: this repo has no Angular unit-test runner wired (`ng test` has no target; component testing
// is Playwright E2E only). The accept/decline interaction logic lives in components and is covered
// by E2E; the framework-free row/copy logic is extracted here so it executes under the existing
// Vitest suite (`yarn test` → packages/shared). All fixtures use synthetic placeholder data.

import { describe, expect, it } from 'vitest';

import { PendingInvitation } from '../interfaces/committee.interface';
import { buildInvitationActions, buildInvitationSubtext, findPendingInvitationForCommittee, formatInviteExpiry } from './invitation.utils';

/** Minimal invitation builder — only the fields the helpers read. */
function invitation(overrides: Partial<PendingInvitation> = {}): PendingInvitation {
  return {
    uid: 'inv-1',
    committee_uid: 'cmte-1',
    committee_name: 'PyTorch TSC',
    invitee_email: 'invitee@example.com',
    status: 'pending',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildInvitationActions', () => {
  it('maps an invitation to an Invitation pending-action with accept/decline identifiers', () => {
    const [action] = buildInvitationActions([invitation({ project_name: 'PyTorch' })]);

    expect(action.type).toBe('Invitation');
    expect(action.buttonText).toBe('Accept');
    expect(action.inviteUid).toBe('inv-1');
    expect(action.committeeUid).toBe('cmte-1');
    expect(action.inviteGroupName).toBe('PyTorch TSC');
  });

  it('uses the project name as the badge, falling back to the committee name', () => {
    expect(buildInvitationActions([invitation({ project_name: 'PyTorch' })])[0].badge).toBe('PyTorch');
    expect(buildInvitationActions([invitation({ project_name: null })])[0].badge).toBe('PyTorch TSC');
  });

  it('degrades the title to "You\'ve been invited to {Group}" when no inviter is known', () => {
    expect(buildInvitationActions([invitation()])[0].text).toBe("You've been invited to PyTorch TSC");
  });

  it('names the inviter in the title when present', () => {
    const [action] = buildInvitationActions([invitation({ inviter_name: 'Nirav Patel' })]);
    expect(action.text).toBe('Nirav Patel invited you to PyTorch TSC');
  });

  it('omits the date when the invite carries no expiry', () => {
    expect(buildInvitationActions([invitation()])[0].date).toBeUndefined();
  });

  it('sets a formatted (not raw ISO) display date when an expiry is present', () => {
    const { date } = buildInvitationActions([invitation({ expires_at: '2026-06-20T12:00:00Z' })])[0];
    expect(date).toBeDefined();
    expect(date).not.toContain('T'); // not the raw ISO timestamp
    expect(date).toMatch(/2026/); // human-readable, includes the year
  });

  it('omits the date when the expiry is an unparseable timestamp', () => {
    expect(buildInvitationActions([invitation({ expires_at: 'not-a-date' })])[0].date).toBeUndefined();
  });

  it('maps each invitation in order', () => {
    const actions = buildInvitationActions([invitation({ uid: 'a' }), invitation({ uid: 'b' })]);
    expect(actions.map((a) => a.inviteUid)).toEqual(['a', 'b']);
  });
});

describe('buildInvitationSubtext', () => {
  it('returns "You\'ve been invited" with no inviter and no expiry', () => {
    expect(buildInvitationSubtext(invitation())).toBe("You've been invited");
  });

  it('names the inviter when present', () => {
    expect(buildInvitationSubtext(invitation({ inviter_name: 'Nirav Patel' }))).toBe('Nirav Patel invited you');
  });

  it('appends the formatted expiry only when both the expiry and a formatted string are supplied', () => {
    expect(buildInvitationSubtext(invitation({ expires_at: '2026-06-20T00:00:00Z' }), 'Jun 20, 2026')).toBe("You've been invited · expires Jun 20, 2026");
  });

  it('does not append an expiry when the invite has no expires_at, even if a date string is passed', () => {
    expect(buildInvitationSubtext(invitation(), 'Jun 20, 2026')).toBe("You've been invited");
  });

  it('falls back to base copy when the expiry is set but formatting produced nothing', () => {
    expect(buildInvitationSubtext(invitation({ expires_at: '2026-06-20T00:00:00Z' }), null)).toBe("You've been invited");
  });
});

describe('findPendingInvitationForCommittee', () => {
  const invites = [invitation({ uid: 'i1', committee_uid: 'c1' }), invitation({ uid: 'i2', committee_uid: 'c2' })];

  it('returns the unresolved invite matching the committee UID', () => {
    expect(findPendingInvitationForCommittee(invites, new Set(), 'c2')?.uid).toBe('i2');
  });

  it('returns null when no invite matches the committee', () => {
    expect(findPendingInvitationForCommittee(invites, new Set(), 'c3')).toBeNull();
  });

  it('returns null when the committee UID is missing', () => {
    expect(findPendingInvitationForCommittee(invites, new Set(), null)).toBeNull();
    expect(findPendingInvitationForCommittee(invites, new Set(), undefined)).toBeNull();
  });

  it('excludes an invite already resolved this session', () => {
    expect(findPendingInvitationForCommittee(invites, new Set(['i1']), 'c1')).toBeNull();
  });
});

describe('formatInviteExpiry', () => {
  it('returns null for missing values', () => {
    expect(formatInviteExpiry(null)).toBeNull();
    expect(formatInviteExpiry(undefined)).toBeNull();
    expect(formatInviteExpiry('')).toBeNull();
  });

  it('returns null for an unparseable timestamp (no "Invalid Date")', () => {
    expect(formatInviteExpiry('not-a-date')).toBeNull();
  });

  it('formats a valid RFC3339 timestamp as a human-readable date', () => {
    const formatted = formatInviteExpiry('2026-06-20T12:00:00Z');
    expect(formatted).not.toBeNull();
    expect(formatted).not.toContain('T');
    expect(formatted).not.toContain('Invalid');
    expect(formatted).toMatch(/2026/);
  });
});
