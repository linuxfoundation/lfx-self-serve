// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationParticipatingOrg, FoundationParticipatingOrgProjectLine, FoundationParticipatingOrgsProject } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { decorateFoundationOrgRow, decorateProjectLine, groupProjectOptions, splitBreakdown } from './foundation-participating-orgs.util';

function line(index: number, overrides: Partial<FoundationParticipatingOrgProjectLine> = {}): FoundationParticipatingOrgProjectLine {
  return {
    projectSlug: `project-${index}`,
    name: `Synthetic Project ${index}`,
    maturity: null,
    commits: 100 - index,
    commitsChange: 0.1,
    contributors: 5,
    contributorsChange: 0,
    shareOfCompanyCommits: 0.05,
    ...overrides,
  };
}

function org(overrides: Partial<FoundationParticipatingOrg> = {}): FoundationParticipatingOrg {
  return {
    participantKey: 'synthetic-company',
    accountId: null,
    name: 'synthetic company',
    logoUrl: null,
    isMember: false,
    membershipTierClass: null,
    otherMemberships: [],
    projectsInvolved: 1,
    commits: 10,
    commitsChange: null,
    contributors: 2,
    contributorsChange: null,
    ...overrides,
  };
}

describe('splitBreakdown', () => {
  const lines = Array.from({ length: 12 }, (_, index) => line(index + 1));

  it('shows every line when there are 10 or fewer', () => {
    const result = splitBreakdown(lines.slice(0, 10), false, '');
    expect(result.shown).toHaveLength(10);
    expect(result.other).toBeNull();
  });

  it('shows the top 10 and folds the rest into Other N projects with their summed commits and share', () => {
    const result = splitBreakdown(lines, false, '');
    expect(result.shown).toHaveLength(10);
    expect(result.other).toEqual({ count: 2, commits: lines[10].commits + lines[11].commits, shareOfCompanyCommits: 0.1, shareLabel: '10%' });
  });

  it('shows everything for Show all, and filters by name without folding', () => {
    expect(splitBreakdown(lines, true, '').shown).toHaveLength(12);
    const filtered = splitBreakdown(lines, false, ' project 11 ');
    expect(filtered.shown.map((item) => item.name)).toEqual(['Synthetic Project 11']);
    expect(filtered.other).toBeNull();
  });
});

describe('change labels', () => {
  it('formats a rounded percent, signed, with 0% for a tiny move and a dash with no comparison', () => {
    expect(decorateFoundationOrgRow(org({ commitsChange: 0.256 })).commits.changeLabel).toBe('+26%');
    expect(decorateFoundationOrgRow(org({ commitsChange: -0.19 })).commits.changeLabel).toBe('-19%');
    expect(decorateFoundationOrgRow(org({ commitsChange: -0.001 })).commits.changeLabel).toBe('0%');
    expect(decorateFoundationOrgRow(org({ commitsChange: null })).commits.changeLabel).toBe('—');
  });

  it('labels members by tier and non-members with no badge', () => {
    const member = decorateFoundationOrgRow(org({ isMember: true, membershipTierClass: 'Platinum', otherMemberships: ['Project member'] }));
    expect(member.membershipLabel).toBe('Platinum Member');
    expect(member.otherMemberships).toEqual(['Project member']);
    expect(decorateFoundationOrgRow(org()).membershipLabel).toBeNull();
  });
});

describe('decorateProjectLine', () => {
  it('turns the share into a whole percent', () => {
    expect(decorateProjectLine(line(1, { shareOfCompanyCommits: 0.836 })).shareLabel).toBe('84%');
  });
});

describe('groupProjectOptions', () => {
  it('groups by maturity with counts, or into one flat group when there are none', () => {
    const projects: FoundationParticipatingOrgsProject[] = [
      { slug: 'a', name: 'A', maturity: 'Graduated' },
      { slug: 'b', name: 'B', maturity: 'Graduated' },
      { slug: 'c', name: 'C', maturity: 'Sandbox' },
    ];
    expect(groupProjectOptions(projects).map((group) => group.label)).toEqual(['Graduated · 2', 'Sandbox · 1']);
    expect(groupProjectOptions([{ slug: 'x', name: 'X', maturity: null }]).map((group) => group.label)).toEqual(['Projects']);
  });
});
