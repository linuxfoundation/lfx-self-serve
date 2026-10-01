// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { formatIsoDateLabel } from './date-time.utils';

import type {
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersOrgChannelView,
  HealthMetricsNonMembersOrgRowView,
  HealthMetricsNonMembersSectionKey,
  HealthMetricsNonMembersSubNavItem,
} from '../interfaces/health-metrics-non-members.interface';

/** Sub-nav items for the Non-Members tab; a section without a count carries no badge. */
export function buildHealthMetricsNonMembersSubNavItems(
  counts: Partial<Record<HealthMetricsNonMembersSectionKey, number | null>> = {}
): HealthMetricsNonMembersSubNavItem[] {
  return HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: counts[section.key] ?? null, note: '' }));
}

/** Company participation rows. A zero or NULL count renders a dash; only channels with activity get a chip. */
export function buildHealthMetricsNonMembersOrgRows(rows: HealthMetricsNonMembersOrg[]): HealthMetricsNonMembersOrgRowView[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    channels: buildChannels(row),
    meetingsLabel: formatCount(row.meetingsAttended),
    peopleLabel: formatCount(row.distinctPeople),
    contributionsLabel: formatCount(row.contributions),
    lastEngagedLabel: row.lastEngagedDate ? formatIsoDateLabel(row.lastEngagedDate) : '—',
  }));
}

/** The unfiltered count line: "412 organizations · 37 new this period". */
export function buildHealthMetricsNonMembersOrgsSummary(scopeTotal: number, newCount: number): string {
  return `${pluralize(scopeTotal, 'organization')} · ${newCount.toLocaleString('en-US')} new this period`;
}

// Training, sponsorship and speaking have no non-member feed yet, so they never get a chip.
function buildChannels(row: HealthMetricsNonMembersOrg): HealthMetricsNonMembersOrgChannelView[] {
  const channels: HealthMetricsNonMembersOrgChannelView[] = [];
  if ((row.meetingsAttended ?? 0) > 0) channels.push({ key: 'meetings', label: 'Attends meetings' });
  if ((row.contributions ?? 0) > 0) channels.push({ key: 'code', label: 'Contributes code' });
  return channels;
}

function formatCount(value: number | null): string {
  return value === null || value <= 0 ? '—' : Math.round(value).toLocaleString('en-US');
}

function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? noun : `${noun}s`}`;
}
