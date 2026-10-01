// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE, HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { formatCurrency } from './number.utils';

import type {
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersConversionView,
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersOrgChannelView,
  HealthMetricsNonMembersOrgRowView,
  HealthMetricsNonMembersPerson,
  HealthMetricsNonMembersPersonRowView,
  HealthMetricsNonMembersSectionKey,
  HealthMetricsNonMembersSubNavItem,
  HealthMetricsNonMembersWarmOrg,
  HealthMetricsNonMembersWarmOrgBarView,
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

/** People rows. A person with no matched organization, or no attended date, renders a dash. */
export function buildHealthMetricsNonMembersPersonRows(rows: HealthMetricsNonMembersPerson[]): HealthMetricsNonMembersPersonRowView[] {
  return rows.map((row) => ({
    rowKey: row.rowKey,
    displayName: row.displayName,
    jobTitle: row.jobTitle?.trim() || null,
    organizationLabel: row.accountName || row.accountId || '—',
    meetingsLabel: formatCount(row.meetingsAttended),
    lastAttendedLabel: row.lastAttendedDate ? formatIsoDateLabel(row.lastAttendedDate) : '—',
  }));
}

/** The People count line: "214 engaged individuals". */
export function buildHealthMetricsNonMembersPeopleCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} engaged ${count === 1 ? 'individual' : 'individuals'}`;
}

/** Conversion opportunity. The estimate always carries its qualifier, and a NULL figure reads "not available", never 0. */
export function buildHealthMetricsNonMembersConversionView(conversion: HealthMetricsNonMembersConversion): HealthMetricsNonMembersConversionView {
  const pipeline = conversion.estimatedPipelineUsd;
  const hasEstimate = pipeline !== null;
  const tier = conversion.entryTierName?.trim();
  return {
    measured: conversion.measured,
    summary:
      conversion.organizationsTracked === null
        ? `Organizations tracked ${HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE}`
        : `${pluralize(conversion.organizationsTracked, 'organization')} tracked`,
    pipelineValue: hasEstimate ? formatCurrency(pipeline) : '—',
    pipelineLabel: hasEstimate ? 'Estimated pipeline' : 'Estimated pipeline · not enough data',
    hasEstimate,
    side: [
      { key: 'high-fit', label: 'High-fit organizations', value: formatStat(conversion.highFitCount) },
      { key: 'new', label: 'New this period', value: formatStat(conversion.newCount) },
    ],
    warmest: buildWarmestBars(conversion.warmest),
    footnote: `Estimated pipeline multiplies high-fit organizations by ${tier ? `the ${tier}` : 'an entry-tier'} fee and is indicative only.`,
  };
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

// Sized by contributions against the largest in the list; a NULL count draws no bar.
function buildWarmestBars(orgs: HealthMetricsNonMembersWarmOrg[]): HealthMetricsNonMembersWarmOrgBarView[] {
  const max = Math.max(0, ...orgs.map((org) => org.contributions ?? 0));
  return orgs.map((org) => ({
    accountId: org.accountId,
    label: `${org.accountName} · ${org.meetingsAttended === null ? HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE : pluralize(org.meetingsAttended, 'meeting')}`,
    valueLabel: org.contributions === null ? HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE : pluralize(org.contributions, 'contribution'),
    widthPct: max > 0 && org.contributions !== null ? (org.contributions / max) * 100 : 0,
  }));
}

function formatStat(value: number | null): string {
  return value === null ? HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE : Math.round(value).toLocaleString('en-US');
}
