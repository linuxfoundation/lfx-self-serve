// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import {
  buildHealthMetricsNonMembersOrgRows,
  buildHealthMetricsNonMembersOrgsSummary,
  buildHealthMetricsNonMembersSubNavItems,
} from './health-metrics-non-members.utils';

import type { HealthMetricsNonMembersOrg } from '../interfaces/health-metrics-non-members.interface';

const ORG: HealthMetricsNonMembersOrg = {
  accountId: '0014100000AcmeAAAA',
  accountName: 'Acme Motors',
  lastEngagedDate: '2026-03-14',
  meetingsAttended: 12,
  distinctPeople: 3,
  contributions: 1840,
  isNew: false,
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
