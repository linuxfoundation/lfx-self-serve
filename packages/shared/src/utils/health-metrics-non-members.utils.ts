// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_NON_MEMBERS_FIT_BADGE_CLASSES,
  HEALTH_METRICS_NON_MEMBERS_FOUNDATION_SHORT_NAMES,
  HEALTH_METRICS_NON_MEMBERS_FIT_BANDS,
  HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS,
  HEALTH_METRICS_NON_MEMBERS_SECTIONS,
} from '../constants/health-metrics-non-members.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { healthMetricsTierSortRank, resolveHealthMetricsMembersTier } from './health-metrics-table.utils';
import { formatCurrency } from './number.utils';

import type {
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersConversionView,
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersOrgRowView,
  HealthMetricsNonMembersOrgsFilter,
  HealthMetricsNonMembersOtherMembership,
  HealthMetricsNonMembersOtherMembershipView,
  HealthMetricsNonMembersPerson,
  HealthMetricsNonMembersPersonRowView,
  HealthMetricsNonMembersSubNavItem,
  HealthMetricsNonMembersWarmOrg,
  HealthMetricsNonMembersWarmOrgRowView,
} from '../interfaces/health-metrics-non-members.interface';

/** Sub-nav items for the Non-Members tab; no section here carries a note. */
export function buildHealthMetricsNonMembersSubNavItems(): HealthMetricsNonMembersSubNavItem[] {
  return HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: '' }));
}

/** Company participation rows. A zero or NULL count renders a dash, and a dashed meetings count carries no people line. */
export function buildHealthMetricsNonMembersOrgRows(rows: HealthMetricsNonMembersOrg[]): HealthMetricsNonMembersOrgRowView[] {
  return rows.map((row) => {
    const meetingsLabel = formatCount(row.meetingsAttended);
    const people = row.distinctPeople === null ? 0 : Math.round(row.distinctPeople);
    return {
      accountId: row.accountId,
      accountName: row.accountName,
      logoUrl: row.logoUrl,
      lastEngagedLabel: row.lastEngagedDate ? `Last engaged ${formatIsoDateLabel(row.lastEngagedDate)}` : '',
      otherMemberships: buildHealthMetricsNonMembersOtherMemberships(row.otherMemberships),
      meetingsLabel,
      peopleLabel: meetingsLabel === '—' || people <= 0 ? '' : pluralize(people, 'person', 'people'),
      contributionsLabel: formatCount(row.contributions),
      ...buildFit(row.fitBand),
    };
  });
}

/**
 * The Other memberships badges: one per foundation, named by its short name (else its full name), with its highest tier
 * in the tooltip. Diamond, Platinum, Gold and Silver first, in that order, then every other tier together; name A–Z within each.
 */
export function buildHealthMetricsNonMembersOtherMemberships(
  memberships: HealthMetricsNonMembersOtherMembership[]
): HealthMetricsNonMembersOtherMembershipView[] {
  const best = new Map<string, { membership: HealthMetricsNonMembersOtherMembership; rank: number }>();
  for (const membership of memberships) {
    const rank = healthMetricsTierSortRank(membership.tier) ?? -1;
    const held = best.get(membership.foundationSlug);
    if (!held || rank > held.rank) best.set(membership.foundationSlug, { membership, rank });
  }

  return [...best.values()]
    .map(({ membership }) => ({
      rank: badgeOrderRank(membership.tier),
      view: {
        key: membership.foundationSlug,
        label: foundationShortName(membership),
        tierLabel: membership.tier?.trim() ? `${resolveHealthMetricsMembersTier(membership.tier).label} membership` : 'Membership',
      },
    }))
    .sort((a, b) => b.rank - a.rank || a.view.label.localeCompare(b.view.label, 'en', { sensitivity: 'base' }))
    .map(({ view }) => view);
}

/** The header switch's value from the URL or the switch; anything else is All. */
export function parseHealthMetricsNonMembersOrgsFilter(value: string | null | undefined): HealthMetricsNonMembersOrgsFilter {
  return HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS.find((filter) => filter === value) ?? 'all';
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
export function buildHealthMetricsNonMembersPeopleCountLabel(count: number | null): string {
  if (count === null) return 'Engaged individuals not available';
  return `${count.toLocaleString('en-US')} engaged ${count === 1 ? 'individual' : 'individuals'}`;
}

/** Conversion opportunity. The estimate always carries its qualifier, and a NULL figure reads "not available", never 0. */
export function buildHealthMetricsNonMembersConversionView(conversion: HealthMetricsNonMembersConversion): HealthMetricsNonMembersConversionView {
  const pipeline = conversion.estimatedPipelineUsd;
  const hasEstimate = pipeline !== null;
  return {
    measured: conversion.measured,
    summary:
      conversion.organizationsTracked === null
        ? `Companies tracked ${HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE}`
        : `${pluralize(conversion.organizationsTracked, 'company', 'companies')} tracked`,
    pipelineValue: hasEstimate ? formatCurrency(pipeline) : '—',
    pipelineLabel: hasEstimate ? 'Estimated pipeline' : 'Estimated pipeline · not enough data',
    hasEstimate,
    side: [
      { key: 'high-fit', label: 'High-fit companies', value: formatStat(conversion.highFitCount) },
      { key: 'new', label: 'New this period', value: formatStat(conversion.newCount) },
    ],
    warmest: buildWarmestRows(conversion.warmest),
  };
}

// Silver and up keep the sort's rank, which reads warehouse forms such as "Silver (100 - 499)"; every other tier, or none,
// shares the lowest, so those badges run A–Z.
function badgeOrderRank(tier: string | null): number {
  const rank = healthMetricsTierSortRank(tier);
  const silver = healthMetricsTierSortRank('Silver') ?? Number.POSITIVE_INFINITY;
  return rank !== null && rank >= silver ? rank : 0;
}

// Own keys only, so a slug such as `constructor` falls back to its name rather than to Object's prototype.
function foundationShortName(membership: HealthMetricsNonMembersOtherMembership): string {
  const names = HEALTH_METRICS_NON_MEMBERS_FOUNDATION_SHORT_NAMES;
  if (Object.hasOwn(names, membership.foundationSlug)) return names[membership.foundationSlug];
  return membership.foundationName.trim() || membership.foundationSlug;
}

function formatCount(value: number | null): string {
  return value === null || value <= 0 ? '—' : Math.round(value).toLocaleString('en-US');
}

function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? noun : plural}`;
}

// Name and value only, as the design's ranked list; a NULL count reads as not available.
function buildWarmestRows(orgs: HealthMetricsNonMembersWarmOrg[]): HealthMetricsNonMembersWarmOrgRowView[] {
  return orgs.map((org) => ({
    accountId: org.accountId,
    label: `${org.accountName} · ${org.meetingsAttended === null ? HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE : pluralize(org.meetingsAttended, 'meeting')}`,
    valueLabel: org.contributions === null ? HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE : pluralize(org.contributions, 'contribution'),
  }));
}

function formatStat(value: number | null): string {
  return value === null ? HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE : Math.round(value).toLocaleString('en-US');
}

// Only a band the model scores gets a badge; unscored reads "—", which the Fit sort puts last too.
function buildFit(fitBand: string | null): Pick<HealthMetricsNonMembersOrgRowView, 'fitLabel' | 'fitBadgeClass'> {
  const band = HEALTH_METRICS_NON_MEMBERS_FIT_BANDS.find((candidate) => candidate === fitBand?.trim());
  return band ? { fitLabel: band, fitBadgeClass: HEALTH_METRICS_NON_MEMBERS_FIT_BADGE_CLASSES[band] } : { fitLabel: '—', fitBadgeClass: null };
}
