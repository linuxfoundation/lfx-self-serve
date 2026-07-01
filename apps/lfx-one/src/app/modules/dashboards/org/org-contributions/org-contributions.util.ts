// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ContributionSource,
  OrgContributionCommitRow,
  OrgContributionCommitRowVm,
  OrgContributionRepoRow,
  OrgContributionRepoRowVm,
} from '@lfx-one/shared/interfaces';

import { avatarColorClass } from '@lfx-one/shared/utils';
import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

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
    projectLogoColorClass: avatarColorClass(row.projectName),
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
    contributorId: row.contributorId,
    personKey: row.personKey,
    projectName: row.projectName,
    committerName: row.committerName,
    committerTitle: row.committerTitle,
    committerAvatarUrl: row.committerAvatarUrl,
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
    avatarColorClass: avatarColorClass(row.username ?? row.committerName),
  };
}
