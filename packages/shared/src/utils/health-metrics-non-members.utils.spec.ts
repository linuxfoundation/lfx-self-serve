// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED } from '../constants/health-metrics-non-members.constants';
import {
  buildHealthMetricsNonMembersConversionView,
  buildHealthMetricsNonMembersOrgRows,
  buildHealthMetricsNonMembersPeopleCountLabel,
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
};

const CONVERSION: HealthMetricsNonMembersConversion = {
  measured: true,
  entryTierName: 'Silver',
  entryTierFeeUsd: 25000,
  organizationsTracked: 412,
  highFitCount: 2,
  newCount: 37,
  estimatedPipelineUsd: 50000,
  warmest: [
    { accountId: '0014100000AcmeAAAA', accountName: 'Acme Motors', meetingsAttended: 12, contributions: 400 },
    { accountId: '0014100000VendAAAA', accountName: 'Vendor Corp', meetingsAttended: 1, contributions: 100 },
  ],
};

const PERSON: HealthMetricsNonMembersPerson = {
  rowKey: '1',
  displayName: 'Jane Doe',
  jobTitle: 'Staff Engineer',
  accountId: '0014100000AcmeAAAA',
  accountName: 'Acme Motors',
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
      meetingsLabel: '12',
      peopleLabel: '3 people',
      contributionsLabel: '1,840',
      fitLabel: 'High',
      fitBadgeClass: 'bg-emerald-50 text-emerald-700',
    });
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

describe('parseHealthMetricsNonMembersOrgsFilter', () => {
  it('keeps a known cut and falls back to All', () => {
    expect(parseHealthMetricsNonMembersOrgsFilter('meetings')).toBe('meetings');
    expect(parseHealthMetricsNonMembersOrgsFilter('high-fit')).toBe('high-fit');
    for (const value of [null, undefined, '', 'High', 'constructor']) expect(parseHealthMetricsNonMembersOrgsFilter(value)).toBe('all');
  });
});

describe('buildHealthMetricsNonMembersPersonRows', () => {
  it('formats the meeting count and the last attended date, keeping the title', () => {
    expect(buildHealthMetricsNonMembersPersonRows([PERSON])).toEqual([
      {
        rowKey: '1',
        displayName: 'Jane Doe',
        jobTitle: 'Staff Engineer',
        organizationLabel: 'Acme Motors',
        meetingsLabel: '1,240',
        lastAttendedLabel: 'Mar 14, 2026',
      },
    ]);
  });

  it('drops a blank title and dashes a missing organization, count or date', () => {
    const [row] = buildHealthMetricsNonMembersPersonRows([
      { ...PERSON, jobTitle: '  ', accountId: null, accountName: null, meetingsAttended: null, lastAttendedDate: null },
    ]);

    expect(row.jobTitle).toBeNull();
    expect(row.organizationLabel).toBe('—');
    expect(row.meetingsLabel).toBe('—');
    expect(row.lastAttendedLabel).toBe('—');
  });

  it('falls back to the account id when the organization has no name', () => {
    expect(buildHealthMetricsNonMembersPersonRows([{ ...PERSON, accountName: '' }])[0].organizationLabel).toBe('0014100000AcmeAAAA');
  });
});

describe('buildHealthMetricsNonMembersPeopleCountLabel', () => {
  it('counts the engaged individuals', () => {
    expect(buildHealthMetricsNonMembersPeopleCountLabel(1412)).toBe('1,412 engaged individuals');
    expect(buildHealthMetricsNonMembersPeopleCountLabel(1)).toBe('1 engaged individual');
    expect(buildHealthMetricsNonMembersPeopleCountLabel(null)).toBe('Engaged individuals not available');
  });
});

describe('buildHealthMetricsNonMembersConversionView', () => {
  it('qualifies the estimate and counts the side stats', () => {
    const view = buildHealthMetricsNonMembersConversionView(CONVERSION);

    expect(view).toMatchObject({
      measured: true,
      summary: '412 companies tracked',
      pipelineValue: '$50K',
      pipelineLabel: 'Estimated pipeline',
      hasEstimate: true,
    });
    expect(view.side).toEqual([
      { key: 'high-fit', label: 'High-fit companies', value: '2' },
      { key: 'new', label: 'New this period', value: '37' },
    ]);
  });

  it('lists the warmest organizations with contributions, labelled with meetings', () => {
    expect(buildHealthMetricsNonMembersConversionView(CONVERSION).warmest).toEqual([
      { accountId: '0014100000AcmeAAAA', label: 'Acme Motors · 12 meetings', valueLabel: '400 contributions' },
      { accountId: '0014100000VendAAAA', label: 'Vendor Corp · 1 meeting', valueLabel: '100 contributions' },
    ]);
  });

  it('says not enough data, never $0, when the foundation has no entry-tier fee', () => {
    const view = buildHealthMetricsNonMembersConversionView({ ...CONVERSION, entryTierName: null, entryTierFeeUsd: null, estimatedPipelineUsd: null });

    expect(view.pipelineValue).toBe('—');
    expect(view.pipelineLabel).toBe('Estimated pipeline · not enough data');
    expect(view.hasEstimate).toBe(false);
  });

  it('renders a NULL count as not available but keeps a real zero', () => {
    const view = buildHealthMetricsNonMembersConversionView({
      ...CONVERSION,
      organizationsTracked: null,
      highFitCount: 0,
      newCount: null,
      warmest: [{ accountId: '0014100000AcmeAAAA', accountName: 'Acme Motors', meetingsAttended: null, contributions: null }],
    });

    expect(view.summary).toBe('Companies tracked not available');
    expect(view.side.map((stat) => stat.value)).toEqual(['0', 'not available']);
    expect(view.warmest).toEqual([{ accountId: '0014100000AcmeAAAA', label: 'Acme Motors · not available', valueLabel: 'not available' }]);
  });

  it('marks the unmeasured value as not measured, with a dashed, qualified estimate', () => {
    const view = buildHealthMetricsNonMembersConversionView(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED);

    expect(view.measured).toBe(false);
    expect(view.warmest).toEqual([]);
    expect(view).toMatchObject({ pipelineValue: '—', pipelineLabel: 'Estimated pipeline · not enough data', hasEstimate: false });
  });
});
