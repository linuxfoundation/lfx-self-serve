// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CdpProjectAffiliation, CdpProjectAffiliationEntry, CdpProjectAffiliationRole } from '../interfaces';
import { buildProfileInvolvement } from './profile-page.utils';

const role = (name: string, startDate: string, endDate = ''): CdpProjectAffiliationRole => ({
  id: name,
  role: name,
  startDate,
  endDate,
  repoUrl: '',
  repoFileUrl: '',
});
const affiliation = (startDate: string, endDate: string | null = null) => ({ startDate, endDate }) as CdpProjectAffiliationEntry;
const project = (slug: string, roles: CdpProjectAffiliationRole[], affiliations: CdpProjectAffiliationEntry[] = []): CdpProjectAffiliation => ({
  id: slug,
  projectSlug: slug,
  projectName: slug.toUpperCase(),
  projectLogo: `https://logos.example/${slug}.png`,
  contributionCount: 0,
  roles,
  affiliations,
});

describe('buildProfileInvolvement', () => {
  it('reads the first role, with the years it covers', () => {
    const [item] = buildProfileInvolvement([project('kube', [role('Maintainer', '2021-03-01'), role('Contributor', '2019-06-01', '2021-02-28')])], null);

    expect(item).toEqual(
      expect.objectContaining({ role: 'Maintainer', current: true, years: 'Since 2019', period: 'Since Jun 2019', logo: 'https://logos.example/kube.png' })
    );
  });

  it('dates a project whose roles have all ended from first start to last end', () => {
    const [item] = buildProfileInvolvement(
      [project('envoy', [role('Contributor', '2018-01-01', '2020-05-01'), role('Contributor', '2019-01-01', '2022-06-30')])],
      null
    );

    expect(item).toEqual(expect.objectContaining({ role: 'Contributor', current: false, years: '2018 – 2022', period: 'Jan 2018 – Jun 2022' }));
  });

  it('falls back to the affiliations without roles, and to no date without either', () => {
    const items = buildProfileInvolvement([project('otel', [], [affiliation('2022-09-01', '2023-01-31')]), project('bare', [])], null);

    expect(items.find((item) => item.id === 'otel')).toEqual(expect.objectContaining({ role: 'Contributor', current: false, years: '2022 – 2023' }));
    expect(items.find((item) => item.id === 'bare')).toEqual(expect.objectContaining({ current: true, years: '', period: '' }));
  });

  it('puts current projects first, newest start first, and past ones last', () => {
    const items = buildProfileInvolvement(
      [
        project('past', [role('Contributor', '2023-01-01', '2024-01-01')]),
        project('older', [role('Contributor', '2018-01-01')]),
        project('newer', [role('Contributor', '2022-01-01')]),
      ],
      null
    );

    expect(items.map((item) => item.id)).toEqual(['newer', 'older', 'past']);
  });

  it('keeps LFX projects only, unless the slug list is unavailable', () => {
    const projects = [project('kube', []), project('other', []), { ...project('none', []), projectSlug: '' }];

    expect(buildProfileInvolvement(projects, new Set(['kube'])).map((item) => item.id)).toEqual(['kube']);
    expect(
      buildProfileInvolvement(projects, null)
        .map((item) => item.id)
        .sort()
    ).toEqual(['kube', 'other']);
  });
});
