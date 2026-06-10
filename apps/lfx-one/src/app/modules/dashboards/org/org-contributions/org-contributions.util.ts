// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ContributionSource,
  OrgCommitterEventItem,
  OrgCommitterGovernanceItem,
  OrgCommitterTrainingItem,
  OrgContributionCommitRow,
  OrgContributionCommitRowVm,
  OrgContributionRepoRow,
  OrgContributionRepoRowVm,
} from '@lfx-one/shared/interfaces';

import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { computePersonAvatarColorClass, computePersonInitials } from '@shared/utils/person-avatar.util';

/** Source badge label + Font Awesome icon per upstream system — inferred upstream of this in the data layer. */
const SOURCE_BADGE: Record<ContributionSource, { label: string; iconClass: string }> = {
  github: { label: 'GitHub', iconClass: 'fa-brands fa-github' },
  gitlab: { label: 'GitLab', iconClass: 'fa-brands fa-gitlab' },
  gerrit: { label: 'Gerrit', iconClass: 'fa-light fa-code-branch' },
  git: { label: 'Git', iconClass: 'fa-brands fa-git-alt' },
};

/** Public user-profile base per source — null where the source has no simple public profile page. */
const SOURCE_PROFILE_BASE: Record<ContributionSource, string | null> = {
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
  gerrit: null,
  git: null,
};

/** Build a committer's external profile URL from source + handle, or null when unavailable. */
function profileUrlFor(source: ContributionSource, username: string | null): string | null {
  const base = SOURCE_PROFILE_BASE[source];
  return base && username ? `${base}/${username}` : null;
}

/** Decorate a wire Repositories row with source-badge metadata and preformatted dates. */
export function decorateRepoRow(row: OrgContributionRepoRow): OrgContributionRepoRowVm {
  const badge = SOURCE_BADGE[row.source] ?? SOURCE_BADGE.git;
  return {
    repositoryId: row.repositoryId,
    repositoryPath: row.repositoryPath,
    projectName: row.projectName,
    projectLogoUrl: row.projectLogoUrl,
    projectInitials: computePersonInitials(row.projectName),
    projectLogoColorClass: computePersonAvatarColorClass(row.projectName),
    source: row.source,
    sourceLabel: badge.label,
    sourceIconClass: badge.iconClass,
    upstreamUrl: row.upstreamUrl,
    commits: row.commits,
    firstCommitTs: row.firstCommitTs,
    firstCommitLabel: row.firstCommitTs ? formatLongDateUtc(row.firstCommitTs) : '—',
    lastCommitTs: row.lastCommitTs,
    lastCommitLabel: row.lastCommitTs ? formatLongDateUtc(row.lastCommitTs) : '—',
  };
}

/** Decorate an org-wide commit-feed row with source icon, committer avatar, and a preformatted date. */
export function decorateCommitFeedRow(row: OrgContributionCommitRow): OrgContributionCommitRowVm {
  const badge = SOURCE_BADGE[row.source] ?? SOURCE_BADGE.git;
  return {
    commitSha: row.commitSha,
    projectName: row.projectName,
    committerName: row.committerName,
    committerTitle: row.committerTitle,
    username: row.username,
    source: row.source,
    sourceLabel: badge.label,
    sourceIconClass: badge.iconClass,
    profileUrl: profileUrlFor(row.source, row.username),
    committedTs: row.committedTs,
    committedLabel: row.committedTs ? formatLongDateUtc(row.committedTs) : '—',
    message: row.message,
    commitUrl: row.commitUrl,
    initials: computePersonInitials(row.committerName),
    avatarColorClass: computePersonAvatarColorClass(row.username ?? row.committerName),
  };
}

// Demo cross-engagement pools for the committer panel's Events / Training / Governance tabs.
// SCAFFOLD only — the real panel reads the LFX person-profile detail endpoint.
const DEMO_EVENT_POOL: readonly OrgCommitterEventItem[] = [
  { name: 'KubeCon + CloudNativeCon NA 2025', date: '2025-11-12', role: 'Attendee' },
  { name: 'Open Source Summit Europe 2025', date: '2025-09-03', role: 'Speaker' },
  { name: 'Linux Plumbers Conference 2025', date: '2025-10-08', role: 'Attendee' },
  { name: 'CNCF Maintainer Summit 2025', date: '2025-11-11', role: 'Panelist' },
];
const DEMO_TRAINING_POOL: readonly OrgCommitterTrainingItem[] = [
  { course: 'Kubernetes Fundamentals (LFS258)', status: 'Completed' },
  { course: 'Certified Kubernetes Administrator (CKA)', status: 'In Progress' },
  { course: 'Open Source Licensing Basics (LFC191)', status: 'Completed' },
  { course: 'Linux Foundation Mentorship', status: 'Completed' },
];
const DEMO_GOVERNANCE_POOL: readonly OrgCommitterGovernanceItem[] = [
  { role: 'TOC Member', body: 'CNCF Technical Oversight Committee' },
  { role: 'Maintainer Council', body: 'Kubernetes Steering Committee' },
];

/** Deterministic FNV-ish hash so demo extras are stable per committer name (not random per render). */
function hashName(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Build stable demo Events / Training / Governance for a committer, keyed off their name. */
export function buildCommitterExtras(name: string): {
  events: OrgCommitterEventItem[];
  training: OrgCommitterTrainingItem[];
  governance: OrgCommitterGovernanceItem[];
} {
  const hash = hashName(name);
  return {
    events: DEMO_EVENT_POOL.slice(0, hash % 3),
    training: DEMO_TRAINING_POOL.slice(0, (hash >> 2) % 3),
    governance: DEMO_GOVERNANCE_POOL.slice(0, (hash >> 4) % 2),
  };
}
