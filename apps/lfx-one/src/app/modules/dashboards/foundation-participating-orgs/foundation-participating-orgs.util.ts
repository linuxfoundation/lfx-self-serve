// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N,
  PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES,
  PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES,
  PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS,
} from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrg,
  FoundationParticipatingOrgChangeTone,
  FoundationParticipatingOrgMetricVm,
  FoundationParticipatingOrgOtherProjects,
  FoundationParticipatingOrgProjectLine,
  FoundationParticipatingOrgProjectLineVm,
  FoundationParticipatingOrgRowVm,
  FoundationParticipatingOrgsProject,
  FoundationParticipatingOrgsProjectOptionGroup,
} from '@lfx-one/shared/interfaces';

const NO_MATURITY_LABEL = 'Projects';

export function decorateFoundationOrgRow(row: FoundationParticipatingOrg): FoundationParticipatingOrgRowVm {
  const tier = row.isMember ? row.membershipTierClass : null;
  return {
    participantKey: row.participantKey,
    accountId: row.accountId,
    name: row.name,
    logoUrl: row.logoUrl,
    initial: row.name.trim().charAt(0).toUpperCase() || '?',
    projectsInvolved: row.projectsInvolved,
    projectsInvolvedLabel: `${row.projectsInvolved} ${row.projectsInvolved === 1 ? 'project' : 'projects'} involved`,
    membershipLabel: row.isMember ? `${tier ?? ''} Member`.trim() : null,
    membershipBadgeClass: row.isMember
      ? ((tier && PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES[tier]) ?? PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS)
      : null,
    otherMemberships: row.otherMemberships,
    commits: metric(row.commits, row.commitsChange),
    contributors: metric(row.contributors, row.contributorsChange),
  };
}

export function decorateProjectLine(line: FoundationParticipatingOrgProjectLine): FoundationParticipatingOrgProjectLineVm {
  const percent = Math.round(line.shareOfCompanyCommits * 100);
  return {
    ...line,
    commitsVm: metric(line.commits, line.commitsChange),
    contributorsVm: metric(line.contributors, line.contributorsChange),
    shareLabel: `${percent}%`,
    sharePercent: percent,
  };
}

/**
 * The lines a breakdown shows: all of them, or — for a company in more than the top-N projects — the top N plus an
 * "Other N projects" row whose commits make the column add up to the total.
 */
export function splitBreakdown(
  lines: FoundationParticipatingOrgProjectLine[],
  showAll: boolean,
  filter: string
): { shown: FoundationParticipatingOrgProjectLine[]; other: FoundationParticipatingOrgOtherProjects | null } {
  const needle = filter.trim().toLowerCase();
  const matching = needle ? lines.filter((line) => line.name.toLowerCase().includes(needle)) : lines;
  if (showAll || needle || matching.length <= FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N) return { shown: matching, other: null };

  const rest = matching.slice(FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N);
  const otherShare = rest.reduce((sum, line) => sum + line.shareOfCompanyCommits, 0);
  return {
    shown: matching.slice(0, FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N),
    other: {
      count: rest.length,
      commits: rest.reduce((sum, line) => sum + line.commits, 0),
      shareOfCompanyCommits: otherShare,
      shareLabel: `${Math.round(otherShare * 100)}%`,
    },
  };
}

/** Option groups for the project scope picker: one group per maturity level with counts, or one flat group without any. */
export function groupProjectOptions(projects: FoundationParticipatingOrgsProject[]): FoundationParticipatingOrgsProjectOptionGroup[] {
  const groups = new Map<string, FoundationParticipatingOrgsProjectOptionGroup>();
  for (const project of projects) {
    const label = project.maturity ?? NO_MATURITY_LABEL;
    const group = groups.get(label) ?? { label, items: [] };
    group.items.push({ label: project.name, value: project.slug });
    groups.set(label, group);
  }
  return [...groups.values()].map((group) => ({ ...group, label: group.label === NO_MATURITY_LABEL ? group.label : `${group.label} · ${group.items.length}` }));
}

function metric(value: number, fraction: number | null): FoundationParticipatingOrgMetricVm {
  const [changeLabel, changeTone] = change(fraction);
  return { value, changeLabel, changeTone, changeClass: PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES[changeTone] };
}

function change(fraction: number | null): [string, FoundationParticipatingOrgChangeTone] {
  if (fraction === null) return ['—', 'none'];
  // `+ 0` folds a rounded -0 into 0 so a tiny drop never reads "-0%".
  const percent = Math.round(fraction * 100) + 0;
  if (percent > 0) return [`+${percent}%`, 'positive'];
  if (percent < 0) return [`${percent}%`, 'negative'];
  return ['0%', 'neutral'];
}
