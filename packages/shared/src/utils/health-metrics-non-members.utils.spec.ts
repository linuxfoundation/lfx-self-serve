// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED } from '../constants/health-metrics-non-members.constants';
import {
  buildHealthMetricsNonMembersConversionView,
  buildHealthMetricsNonMembersOrgRows,
  buildHealthMetricsNonMembersOtherMemberships,
  buildHealthMetricsNonMembersPersonRows,
  buildHealthMetricsNonMembersSubNavItems,
  parseHealthMetricsNonMembersOrgsFilter,
} from './health-metrics-non-members.utils';

import type {
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersPerson,
} from '../interfaces/health-metrics-non-members.interface';

const ORG: HealthMetricsNonMembersOrg = {
  accountId: '0014100000AcmeAAAA',
  accountName: 'Acme Motors',
  logoUrl: 'https://logos.example/acme.png',
  lastEngagedDate: '2026-03-14',
  meetingsAttended: 12,
  distinctPeople: 3,
  contributions: 1840,
  fitBand: 'High',
  otherMemberships: [{ foundationSlug: 'cncf', foundationName: 'Cloud Native Computing Foundation', tier: 'Gold Membership' }],
};

const CONVERSION: HealthMetricsNonMembersConversion = {
  measured: true,
  highFitCount: 2,
  newCount: 37,
  estimatedPipelineUsd: 50000,
  warmest: [
    { accountId: '0014100000AcmeAAAA', accountName: 'Acme Motors', logoUrl: 'https://logos.example/acme.png', meetingsAttended: 12, contributions: 1400 },
    { accountId: '0014100000VendAAAA', accountName: 'Vendor Corp', logoUrl: null, meetingsAttended: 1, contributions: 0 },
  ],
};

const PERSON: HealthMetricsNonMembersPerson = {
  rowKey: '1',
  displayName: 'Jane Doe',
  jobTitle: 'Staff Engineer',
  accountId: '0014100000AcmeAAAA',
  accountName: 'Acme Motors',
  logoUrl: 'https://logos.example/acme.png',
  lastAttendedDate: '2026-03-14',
  meetingsAttended: 1240,
};

describe('buildHealthMetricsNonMembersSubNavItems', () => {
  it('lists every section in render order, with its label and no note', () => {
    const items = buildHealthMetricsNonMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.label));
    expect(items.every((item) => item.note === '')).toBe(true);
  });
});

describe('buildHealthMetricsNonMembersOrgRows', () => {
  it('formats the counts, the people under the meetings and the last engaged date under the name', () => {
    const [row] = buildHealthMetricsNonMembersOrgRows([ORG]);

    expect(row).toEqual({
      accountId: ORG.accountId,
      accountName: 'Acme Motors',
      logoUrl: 'https://logos.example/acme.png',
      lastEngagedLabel: 'Last engaged Mar 14, 2026',
      otherMemberships: [{ key: 'cncf', label: 'CNCF', tierLabel: 'Gold membership' }],
      meetingsLabel: '12',
      peopleLabel: '3 people',
      contributionsLabel: '1,840',
      fitLabel: 'High',
      fitBadgeClass: 'bg-emerald-50 text-emerald-700',
    });
  });

  it('shows the account id for a company whose name is blank once trimmed', () => {
    expect(buildHealthMetricsNonMembersOrgRows([{ ...ORG, accountName: '   ' }])[0].accountName).toBe(ORG.accountId);
  });

  it('says one person in the singular', () => {
    expect(buildHealthMetricsNonMembersOrgRows([{ ...ORG, distinctPeople: 1 }])[0].peopleLabel).toBe('1 person');
  });

  it('renders a dash with no people line for no meetings, a dash for no contributions, and no date line without a date', () => {
    const [row] = buildHealthMetricsNonMembersOrgRows([{ ...ORG, meetingsAttended: 0, distinctPeople: 2, contributions: null, lastEngagedDate: null }]);

    expect(row).toMatchObject({ meetingsLabel: '—', peopleLabel: '', contributionsLabel: '—', lastEngagedLabel: '' });
  });

  it('badges each scored fit band as the design colours it, and dashes anything else', () => {
    const view = (fitBand: string | null) => buildHealthMetricsNonMembersOrgRows([{ ...ORG, fitBand }])[0];

    expect(view('Medium')).toMatchObject({ fitLabel: 'Medium', fitBadgeClass: 'bg-amber-50 text-amber-800' });
    expect(view(' Low ')).toMatchObject({ fitLabel: 'Low', fitBadgeClass: 'bg-red-50 text-red-700' });
    for (const band of [null, '  ', 'Unrated', 'constructor']) expect(view(band)).toMatchObject({ fitLabel: '—', fitBadgeClass: null });
  });
});

describe('buildHealthMetricsNonMembersOtherMemberships', () => {
  const membership = (foundationSlug: string, foundationName: string, tier: string | null) => ({ foundationSlug, foundationName, tier });

  it('keeps one badge per foundation at its highest tier, Diamond to Silver first, then A–Z', () => {
    const views = buildHealthMetricsNonMembersOtherMemberships([
      membership('zeta-foundation', 'Zeta Foundation', 'Silver Membership'),
      membership('cncf', 'Cloud Native Computing Foundation', 'Silver Membership'),
      membership('cncf', 'Cloud Native Computing Foundation', 'Platinum Membership'),
      membership('alpha-foundation', 'Alpha Foundation', 'Silver'),
      membership('openssf', 'Open Source Security Foundation', 'Associate'),
      membership('beta-foundation', 'Beta Foundation', 'Silver (100 - 499)'),
    ]);

    expect(views).toEqual([
      { key: 'cncf', label: 'CNCF', tierLabel: 'Platinum membership' },
      { key: 'alpha-foundation', label: 'Alpha Foundation', tierLabel: 'Silver membership' },
      { key: 'beta-foundation', label: 'Beta Foundation', tierLabel: 'Silver (100 - 499) membership' },
      { key: 'zeta-foundation', label: 'Zeta Foundation', tierLabel: 'Silver membership' },
      { key: 'openssf', label: 'OpenSSF', tierLabel: 'Associate membership' },
    ]);
  });

  it('runs every tier past Silver, and no tier, A–Z together', () => {
    const views = buildHealthMetricsNonMembersOtherMemberships([
      membership('zeta-foundation', 'Zeta Foundation', 'Associate'),
      membership('beta-foundation', 'Beta Foundation', null),
      membership('alpha-foundation', 'Alpha Foundation', 'Bronze'),
      membership('gamma-foundation', 'Gamma Foundation', 'End User Supporter'),
    ]);

    expect(views.map((view) => view.label)).toEqual(['Alpha Foundation', 'Beta Foundation', 'Gamma Foundation', 'Zeta Foundation']);
  });

  it('keeps a foundation\'s highest tier by the full ranking, says "Membership" with no tier, and falls back to the slug with no name', () => {
    const views = buildHealthMetricsNonMembersOtherMemberships([
      membership('constructor', '', null),
      membership('beta-foundation', 'Beta Foundation', 'Associate'),
      membership('beta-foundation', 'Beta Foundation', 'End User Supporter'),
    ]);

    expect(views).toEqual([
      { key: 'beta-foundation', label: 'Beta Foundation', tierLabel: 'Associate membership' },
      { key: 'constructor', label: 'constructor', tierLabel: 'Membership' },
    ]);
  });

  it('is empty for a company with no other membership', () => {
    expect(buildHealthMetricsNonMembersOtherMemberships([])).toEqual([]);
  });
});

describe('parseHealthMetricsNonMembersOrgsFilter', () => {
  it('keeps a known cut and falls back to All', () => {
    expect(parseHealthMetricsNonMembersOrgsFilter('meetings')).toBe('meetings');
    expect(parseHealthMetricsNonMembersOrgsFilter('high-fit')).toBe('high-fit');
    for (const value of [null, undefined, '', 'High', 'constructor']) expect(parseHealthMetricsNonMembersOrgsFilter(value)).toBe('all');
  });
});

describe('buildHealthMetricsNonMembersPersonRows', () => {
  it('formats the meeting count and the last attended date, with the title under the name and the company logo', () => {
    expect(buildHealthMetricsNonMembersPersonRows([PERSON])).toEqual([
      {
        rowKey: '1',
        displayName: 'Jane Doe',
        initials: '',
        jobTitle: 'Staff Engineer',
        companyLabel: 'Acme Motors',
        hasCompany: true,
        logoUrl: 'https://logos.example/acme.png',
        meetingsLabel: '1,240',
        lastAttendedLabel: 'Mar 14, 2026',
      },
    ]);
  });

  it('drops a blank title and dashes a missing company, count or date', () => {
    const [row] = buildHealthMetricsNonMembersPersonRows([
      { ...PERSON, jobTitle: '  ', accountId: null, accountName: null, meetingsAttended: null, lastAttendedDate: null },
    ]);

    expect(row).toMatchObject({ jobTitle: '', companyLabel: '—', hasCompany: false, meetingsLabel: '—', lastAttendedLabel: '—' });
  });

  it('gives a one-word name one initial, and leaves longer names to the avatar', () => {
    expect(buildHealthMetricsNonMembersPersonRows([{ ...PERSON, displayName: ' jane ' }])[0].initials).toBe('J');
    expect(buildHealthMetricsNonMembersPersonRows([{ ...PERSON, displayName: 'Jane Q Doe' }])[0].initials).toBe('');
  });

  it('falls back to the account id when the company has no name', () => {
    expect(buildHealthMetricsNonMembersPersonRows([{ ...PERSON, accountName: ' ' }])[0]).toMatchObject({
      companyLabel: '0014100000AcmeAAAA',
      hasCompany: true,
    });
  });
});

describe('buildHealthMetricsNonMembersConversionView', () => {
  it('shows the pipeline as compact currency beside the high-fit and new counts, with no trend or description', () => {
    expect(buildHealthMetricsNonMembersConversionView(CONVERSION).metrics).toEqual([
      { key: 'pipeline', label: 'Estimated pipeline', value: '$50K' },
      { key: 'high-fit', label: 'High-fit', value: '2' },
      { key: 'new', label: 'New', value: '37' },
    ]);
  });

  it('lists the warmest companies with their logos, dashing a zero, and sorting on the values shown', () => {
    const [acme, vendor] = buildHealthMetricsNonMembersConversionView(CONVERSION).warmest;

    expect(acme).toEqual({
      accountId: '0014100000AcmeAAAA',
      accountName: 'Acme Motors',
      logoUrl: 'https://logos.example/acme.png',
      meetingsLabel: '12',
      contributionsLabel: '1,400',
      sortValues: { company: 'Acme Motors', meetings: 12, contributions: 1400 },
    });
    expect(vendor).toMatchObject({ contributionsLabel: '—', sortValues: { contributions: null } });
  });

  it('dashes an unset figure, never 0, and keeps a real zero', () => {
    const view = buildHealthMetricsNonMembersConversionView({ ...CONVERSION, estimatedPipelineUsd: null, highFitCount: 0, newCount: null });

    expect(view.metrics.map((metric) => metric.value)).toEqual(['—', '0', '—']);
  });

  it('dashes every figure with no conversion row but still lists the companies, and is empty only with neither', () => {
    const unmeasured = buildHealthMetricsNonMembersConversionView({ ...HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED, warmest: CONVERSION.warmest });
    expect(unmeasured.metrics.map((metric) => metric.value)).toEqual(['—', '—', '—']);
    expect(unmeasured.warmest).toHaveLength(2);
    expect(unmeasured.empty).toBe(false);

    expect(buildHealthMetricsNonMembersConversionView(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED).empty).toBe(true);
    expect(buildHealthMetricsNonMembersConversionView({ ...CONVERSION, warmest: [] }).empty).toBe(false);
  });
});
