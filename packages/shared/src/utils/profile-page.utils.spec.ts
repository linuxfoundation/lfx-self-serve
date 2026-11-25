// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CdpProjectAffiliation, CdpProjectAffiliationEntry, CdpProjectAffiliationRole, MyCommittee } from '../interfaces';
import { CommitteeMemberRole } from '../enums/committee-member.enum';
import { buildProfileGroups, buildProfileInvolvement } from './profile-page.utils';

const role = (name: string, startDate: string, endDate = ''): CdpProjectAffiliationRole => ({
  id: name,
  role: name,
  startDate,
  endDate,
  repoUrl: '',
  repoFileUrl: '',
});
const affiliation = (startDate: string, endDate: string | null = null, type = 'project'): CdpProjectAffiliationEntry => ({
  id: `${type}-${startDate}`,
  organizationLogo: '',
  organizationId: 'org-1',
  organizationName: 'Acme Motors',
  verified: true,
  verifiedBy: 'ada',
  source: 'cdp',
  startDate,
  endDate,
  type,
});
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
  it('takes the badge from the first role, and the years from the whole involvement', () => {
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

  it('falls back to the project affiliations without roles, and to no date without either', () => {
    const items = buildProfileInvolvement(
      [project('otel', [], [affiliation('2022-09-01', '2023-01-31'), affiliation('2015-01-01', null, 'organization')]), project('bare', [])],
      null
    );

    expect(items.find((item) => item.id === 'otel')).toEqual(expect.objectContaining({ role: 'Contributor', current: false, years: '2022 – 2023' }));
    expect(items.find((item) => item.id === 'bare')).toEqual(expect.objectContaining({ current: true, years: '', period: '' }));
  });

  it('names a single year once for a stint that starts and ends in it', () => {
    const [item] = buildProfileInvolvement([project('short', [role('Contributor', '2020-03-01', '2020-09-30')])], null);

    expect(item).toEqual(expect.objectContaining({ years: '2020', period: 'Mar 2020 – Sep 2020' }));
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

const group = (uid: string, category: string, extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({
    uid,
    name: `${uid} group`,
    category,
    enable_voting: false,
    public: true,
    sso_group_enabled: false,
    created_at: '',
    updated_at: '',
    total_members: 12,
    project_uid: 'p1',
    project_name: 'Acme Project',
    my_role: 'Member',
    ...extra,
  }) as MyCommittee;

describe('buildProfileGroups', () => {
  it('names the design’s type for each group, in its Groups page colour', () => {
    const items = buildProfileGroups([
      group('board', 'Board'),
      group('tsc', 'Technical Steering Committee'),
      group('wg', 'Working Group'),
      group('sig', 'Special Interest Group'),
    ]);

    expect(items.map((item) => [item.uid, item.type, item.typeTone])).toEqual([
      ['board', 'Board', 'feature'],
      ['tsc', 'Technical', 'success'],
      ['wg', 'Working group', 'warning'],
      ['sig', 'Special Interest Group', 'accent'],
    ]);
  });

  it('reads the org, the role and the member count, with one member said once', () => {
    const [item] = buildProfileGroups([
      group('one', 'Board', {
        foundation_name: 'Acme Foundation',
        project_logo_url: 'https://logos.example/acme.png',
        total_members: 1,
        my_role: CommitteeMemberRole.CHAIR,
      }),
    ]);

    expect(item).toEqual(expect.objectContaining({ org: 'Acme Foundation', orgLogo: 'https://logos.example/acme.png', role: 'Chair', members: '1 member' }));
    expect(item.commands.at(-1)).toBe('one');
  });
});
