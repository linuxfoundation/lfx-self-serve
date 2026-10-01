// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import {
  buildHealthMetricsNonMembersOrgRows,
  buildHealthMetricsNonMembersOrgsSummary,
  buildHealthMetricsNonMembersPeopleCountLabel,
  buildHealthMetricsNonMembersPersonRows,
  buildHealthMetricsNonMembersSubNavItems,
} from './health-metrics-non-members.utils';

import type { HealthMetricsNonMembersOrg, HealthMetricsNonMembersPerson } from '../interfaces/health-metrics-non-members.interface';

const ORG: HealthMetricsNonMembersOrg = {
  accountId: '0014100000AcmeAAAA',
  accountName: 'Acme Motors',
  lastEngagedDate: '2026-03-14',
  meetingsAttended: 12,
  distinctPeople: 3,
  contributions: 1840,
  isNew: false,
};

const PERSON: HealthMetricsNonMembersPerson = {
  personKey: 'person-0001',
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
        personKey: 'person-0001',
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
