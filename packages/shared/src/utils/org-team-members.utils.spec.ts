// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { orgTeamMembersUrlParam, parseOrgTeamMembersFilter } from './org-team-members.utils';

// lfx-self-serve#4685 — Include/Exclude CDP team members.
describe('parseOrgTeamMembersFilter', () => {
  it.each(['include', 'exclude'] as const)('reads %s', (value) => {
    expect(parseOrgTeamMembersFilter(value)).toBe(value);
  });

  it.each([null, undefined, '', 'Exclude', 'true'])('reads %s as not allowed', (value) => {
    expect(parseOrgTeamMembersFilter(value)).toBeNull();
  });
});

describe('orgTeamMembersUrlParam', () => {
  it('drops the default (exclude, as LFX Insights) and keeps include', () => {
    expect(orgTeamMembersUrlParam('exclude')).toBeNull();
    expect(orgTeamMembersUrlParam('include')).toBe('include');
  });
});
