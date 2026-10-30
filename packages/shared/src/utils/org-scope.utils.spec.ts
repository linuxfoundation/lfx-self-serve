// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { effectiveOrgScope, orgScopeOptions, orgScopeTooltip, orgScopeUrlParam, parseOrgScopeFilter, servedOrgScopeForCaption } from './org-scope.utils';

// lfx-self-serve-ops#1219 — Insights organization vs all related organizations.
describe('parseOrgScopeFilter', () => {
  it.each(['insights', 'all'] as const)('reads %s', (value) => {
    expect(parseOrgScopeFilter(value)).toBe(value);
  });

  it.each([null, undefined, '', 'Insights', 'account'])('reads %s as not allowed', (value) => {
    expect(parseOrgScopeFilter(value)).toBeNull();
  });
});

describe('orgScopeUrlParam', () => {
  it('drops the default (insights, as LFX Insights) and keeps all', () => {
    expect(orgScopeUrlParam('insights')).toBeNull();
    expect(orgScopeUrlParam('all')).toBe('all');
  });
});

describe('effectiveOrgScope', () => {
  it('serves insights only for an account with an Insights organization', () => {
    expect(effectiveOrgScope('insights', { hasInsightsOrg: true })).toBe('insights');
    expect(effectiveOrgScope('all', { hasInsightsOrg: true })).toBe('all');
  });

  it('falls back to all without an Insights organization or without a scope row', () => {
    expect(effectiveOrgScope('insights', { hasInsightsOrg: false })).toBe('all');
    expect(effectiveOrgScope('insights', null)).toBe('all');
  });
});

describe('servedOrgScopeForCaption', () => {
  it('names all once the account is known to have no Insights organization', () => {
    expect(servedOrgScopeForCaption('insights', { hasInsightsOrg: false })).toBe('all');
    expect(servedOrgScopeForCaption('all', { hasInsightsOrg: false })).toBe('all');
  });

  it('keeps the pick for an account with an Insights organization and while its metadata is unknown', () => {
    expect(servedOrgScopeForCaption('insights', { hasInsightsOrg: true })).toBe('insights');
    expect(servedOrgScopeForCaption('all', { hasInsightsOrg: true })).toBe('all');
    expect(servedOrgScopeForCaption('insights', null)).toBe('insights');
    expect(servedOrgScopeForCaption('insights', undefined)).toBe('insights');
  });
});

describe('orgScopeOptions', () => {
  it('counts the related organizations on the All option', () => {
    expect(orgScopeOptions({ relatedOrgCount: 4 }).map((option) => option.label)).toEqual(['Insights organization', 'All related organizations (4)']);
  });

  it('keeps the plain labels while the count is unknown', () => {
    expect(orgScopeOptions(null).map((option) => option.label)).toEqual(['Insights organization', 'All related organizations']);
  });
});

describe('orgScopeTooltip', () => {
  it('names the Insights organization under insights', () => {
    expect(orgScopeTooltip('insights', { insightsOrgName: 'Acme' })).toBe(
      'Counts only Acme, the organization on its LFX Insights page, and only repositories LFX Insights counts. Maintainer roles are not affected.'
    );
  });

  it('describes every related organization under all', () => {
    expect(orgScopeTooltip('all', { insightsOrgName: 'Acme' })).toContain('Counts every organization linked to this company account');
  });
});
