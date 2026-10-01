// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED } from '../constants/health-metrics-non-members.constants';
import {
  buildHealthMetricsNonMembersConversionView,
  buildHealthMetricsNonMembersOrgRows,
  buildHealthMetricsNonMembersOrgsSummary,
  buildHealthMetricsNonMembersPeopleCountLabel,
  buildHealthMetricsNonMembersPersonRows,
  buildHealthMetricsNonMembersSubNavItems,
} from './health-metrics-non-members.utils';

import type {
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersPerson,
} from '../interfaces/health-metrics-non-members.interface';

const ORG: HealthMetricsNonMembersOrg = {
  accountId: '0014100000AcmeAAAA',
  accountName: 'Acme Motors',
  lastEngagedDate: '2026-03-14',
  meetingsAttended: 12,
  distinctPeople: 3,
  contributions: 1840,
  isNew: false,
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
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsNonMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.label));
  });

  it('badges only the sections given a count', () => {
    const items = buildHealthMetricsNonMembersSubNavItems({ orgs: 412 });

    expect(items.map((item) => item.count)).toEqual([412, null, null]);
    expect(items.every((item) => item.note === '')).toBe(true);
  });
});

describe('buildHealthMetricsNonMembersOrgRows', () => {
  it('formats the counts and the last engaged date, with a chip per active channel', () => {
    const [row] = buildHealthMetricsNonMembersOrgRows([ORG]);

    expect(row).toEqual({
      accountId: ORG.accountId,
      accountName: 'Acme Motors',
      channels: [
        { key: 'meetings', label: 'Attends meetings' },
        { key: 'code', label: 'Contributes code' },
      ],
      meetingsLabel: '12',
      peopleLabel: '3',
      contributionsLabel: '1,840',
      lastEngagedLabel: 'Mar 14, 2026',
    });
  });

  it('renders a dash for a zero or NULL count and leaves that channel without a chip', () => {
    const [row] = buildHealthMetricsNonMembersOrgRows([{ ...ORG, meetingsAttended: null, distinctPeople: null, contributions: 0, lastEngagedDate: null }]);

    expect(row.meetingsLabel).toBe('—');
    expect(row.peopleLabel).toBe('—');
    expect(row.contributionsLabel).toBe('—');
    expect(row.lastEngagedLabel).toBe('—');
    expect(row.channels).toEqual([]);
  });
});

describe('buildHealthMetricsNonMembersOrgsSummary', () => {
  it('counts the organizations and the new ones', () => {
    expect(buildHealthMetricsNonMembersOrgsSummary(1412, 37)).toBe('1,412 organizations · 37 new this period');
    expect(buildHealthMetricsNonMembersOrgsSummary(1, 0)).toBe('1 organization · 0 new this period');
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
  });
});

describe('buildHealthMetricsNonMembersConversionView', () => {
  it('qualifies the estimate, counts the side stats and names the tier in the footnote', () => {
    const view = buildHealthMetricsNonMembersConversionView(CONVERSION);

    expect(view).toMatchObject({
      measured: true,
      summary: '412 organizations tracked',
      pipelineValue: '$50K',
      pipelineLabel: 'Estimated pipeline',
      hasEstimate: true,
      footnote: 'Estimated pipeline multiplies high-fit organizations by the Silver fee and is indicative only.',
    });
    expect(view.side).toEqual([
      { key: 'high-fit', label: 'High-fit organizations', value: '2' },
      { key: 'new', label: 'New this period', value: '37' },
    ]);
  });

  it('sizes the warmest bars by contributions, labelled with meetings', () => {
    expect(buildHealthMetricsNonMembersConversionView(CONVERSION).warmest).toEqual([
      { accountId: '0014100000AcmeAAAA', label: 'Acme Motors · 12 meetings', valueLabel: '400 contributions', widthPct: 100 },
      { accountId: '0014100000VendAAAA', label: 'Vendor Corp · 1 meeting', valueLabel: '100 contributions', widthPct: 25 },
    ]);
  });

  it('says not enough data, never $0, when the foundation has no entry-tier fee', () => {
    const view = buildHealthMetricsNonMembersConversionView({ ...CONVERSION, entryTierName: null, entryTierFeeUsd: null, estimatedPipelineUsd: null });

    expect(view.pipelineValue).toBe('—');
    expect(view.pipelineLabel).toBe('Estimated pipeline · not enough data');
    expect(view.hasEstimate).toBe(false);
    expect(view.footnote).toBe('Estimated pipeline multiplies high-fit organizations by an entry-tier fee and is indicative only.');
  });

  it('renders a NULL count as not available but keeps a real zero', () => {
    const view = buildHealthMetricsNonMembersConversionView({
      ...CONVERSION,
      organizationsTracked: null,
      highFitCount: 0,
      newCount: null,
      warmest: [{ accountId: '0014100000AcmeAAAA', accountName: 'Acme Motors', meetingsAttended: null, contributions: null }],
    });

    expect(view.summary).toBe('Organizations tracked not available');
    expect(view.side.map((stat) => stat.value)).toEqual(['0', 'not available']);
    expect(view.warmest).toEqual([{ accountId: '0014100000AcmeAAAA', label: 'Acme Motors · not available', valueLabel: 'not available', widthPct: 0 }]);
  });

  it('marks the unmeasured value as not measured with no bars', () => {
    const view = buildHealthMetricsNonMembersConversionView(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED);

    expect(view.measured).toBe(false);
    expect(view.warmest).toEqual([]);
  });
});
