// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { PUBLIC_PROFILE_INVOLVEMENT_COPY } from '../constants/public-profile.constants';
import { PublicProfileProject, PublicProfileYearContribution } from '../interfaces/public-profile.interface';
import { buildPublicProfileInvolvement, mapYearLabelToNumber } from './public-profile.utils';

describe('mapYearLabelToNumber', () => {
  it('resolves the upstream relative labels against the current year', () => {
    expect(mapYearLabelToNumber('current_year', 2026)).toBe(2026);
    expect(mapYearLabelToNumber('last_year', 2026)).toBe(2025);
    expect(mapYearLabelToNumber('2nd_last_year', 2026)).toBe(2024);
    expect(mapYearLabelToNumber('3rd_last_year', 2026)).toBe(2023);
    expect(mapYearLabelToNumber('4th_last_year', 2026)).toBe(2022);
  });

  it('accepts a four-digit year string', () => {
    expect(mapYearLabelToNumber('2021', 2026)).toBe(2021);
  });

  it('returns undefined for unknown or non-string labels so the row is dropped', () => {
    expect(mapYearLabelToNumber('2021-06-30', 2026)).toBeUndefined();
    expect(mapYearLabelToNumber('all-time', 2026)).toBeUndefined();
    expect(mapYearLabelToNumber('', 2026)).toBeUndefined();
    expect(mapYearLabelToNumber(undefined, 2026)).toBeUndefined();
    expect(mapYearLabelToNumber(2026, 2026)).toBeUndefined();
  });
});

describe('buildPublicProfileInvolvement', () => {
  const year = (n: number, commits = 1): PublicProfileYearContribution => ({ year: n, commits, deleted: 0, added: 0, prs: 0, issues: 0 });
  const project = (name: string, years: PublicProfileYearContribution[], extra: Partial<PublicProfileProject> = {}): PublicProfileProject => ({
    Name: name,
    commits: 4,
    deleted: 0,
    added: 0,
    prs: 2,
    issues: 1,
    years,
    ...extra,
  });

  it('puts current projects first, keeping the profile order within each group', () => {
    const items = buildPublicProfileInvolvement(
      [project('Past', [year(2022), year(2020)]), project('Now', [year(2026), year(2021)]), project('Also now', [year(2026)])],
      2026
    );

    expect(items.map((item) => [item.name, item.current, item.years])).toEqual([
      ['Now', true, 'Since 2021'],
      ['Also now', true, 'Since 2026'],
      ['Past', false, '2020 – 2022'],
    ]);
  });

  it('spans only the years with activity, and carries the totals', () => {
    const [item] = buildPublicProfileInvolvement([project('Quiet', [year(2026, 0), year(2023), year(2019, 0)])], 2026);

    expect(item).toEqual({ id: '0', name: 'Quiet', logo: '', current: false, years: '2023', commits: 4, prs: 2, issues: 1 });
  });

  it('falls back to the slug, then a placeholder, and leaves the years out with none on record', () => {
    const items = buildPublicProfileInvolvement([project(' ', [], { Slug: 'kube' }), project('', [], { LogoURL: ' https://logo.example/a.png ' })], 2026);

    expect(items.map((item) => [item.name, item.logo, item.years])).toEqual([
      ['kube', '', ''],
      [PUBLIC_PROFILE_INVOLVEMENT_COPY.untitled, 'https://logo.example/a.png', ''],
    ]);
  });
});
