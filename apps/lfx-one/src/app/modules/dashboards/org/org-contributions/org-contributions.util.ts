// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CONTRIBUTIONS_PROJECT_SCOPE_PHRASE, ORG_LENS_TIME_RANGE_DAYS } from '@lfx-one/shared/constants';
import type {
  ContributionSource,
  OrgCommitFilters,
  OrgContributionCommitRow,
  OrgContributionCommitRowVm,
  OrgContributionRepoRow,
  OrgContributionRepoRowVm,
  OrgLensTimeRange,
  OrgProjectScope,
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

/**
 * Exact window the KPI strip and tables aggregate over, in UTC — mirrors the BFF predicates
 * (`activity_ts::date >= DATEADD(day, -N, CURRENT_DATE())`) so reviewers can match filters against source records.
 */
export function describeContributionsWindow(range: OrgLensTimeRange, now: Date = new Date()): string {
  if (range === 'all') {
    return 'across all recorded history';
  }
  const start = new Date(now.getTime());
  start.setUTCDate(start.getUTCDate() - ORG_LENS_TIME_RANGE_DAYS[range]);
  return `from ${formatLongDateUtc(start.toISOString())} to ${formatLongDateUtc(now.toISOString())} (UTC)`;
}

/**
 * Counting rule under the KPI strip for the active filters, ending with the exact window from
 * {@link describeContributionsWindow}, so the figures can be matched to source data.
 */
export function describeContributionsCaption(filters: OrgCommitFilters, companyName: string, window: string): string {
  const scope = CONTRIBUTIONS_PROJECT_SCOPE_PHRASE[filters.projectScope];
  if (filters.metric === 'code') {
    return `Code contributions (commits, pull requests, reviews and comments) by contributors affiliated with ${companyName}${scope}, ${window}. Bots excluded.`;
  }
  const branch = filters.commitScope === 'merged' ? 'only commits on the main branch' : 'on any branch (including pull-request commits not yet merged)';
  return `Commits authored by contributors affiliated with ${companyName}, ${branch}${scope}, counted once each, ${window}. Bots excluded.`;
}

/** Who the People -> Contributors tab counts, worded like {@link describeContributionsCaption}. */
export function describeContributorsTooltip(projectScope: OrgProjectScope, companyName: string, window: string): string {
  return (
    `People with at least one code contribution (commit, pull request, review or comment) credited to ${companyName}` +
    `${CONTRIBUTIONS_PROJECT_SCOPE_PHRASE[projectScope]}, ${window}. ` +
    'Each contribution is credited to the employer the person had at the time, so people who have since left are included. ' +
    'Declared project maintainers count as Maintainers; everyone else counts as Contributors. Bots excluded.'
  );
}
