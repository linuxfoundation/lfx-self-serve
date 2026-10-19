// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_ACCOUNT_ID_PATTERN,
  PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES,
  PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES,
  PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS,
} from '@lfx-one/shared/constants';
import type {
  ProjectParticipatingOrg,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgChangeTone,
  ProjectParticipatingOrgMetricVm,
  ProjectParticipatingOrgNameKind,
  ProjectParticipatingOrgRowVm,
} from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';

/** A page's canonical member account ids, deduplicated and sorted, so the same members in another order compare equal. */
export function memberAccountIdsOf(page: ProjectParticipatingOrgsPage): string[] {
  const ids = page.rows.flatMap((row) => (row.isMember && row.accountId && ORG_ACCOUNT_ID_PATTERN.test(row.accountId) ? [row.accountId] : []));
  return [...new Set(ids)].sort();
}

/** Identity of one Org Lens links question: the project and the member set asked about. */
export function linksKey(slug: string, accountIds: readonly string[]): string {
  return `${slug}|${accountIds.join(',')}`;
}

/**
 * Decorate a wire row for the table. Only a member the viewer can open in Org Lens (`readableAccountIds`) gets a
 * link — to the company's membership page for this project's parent foundation; it falls back to the no-access hint
 * when either half of the address is missing, so a link is never built to a page that cannot resolve. While the
 * viewer's access is still loading (`readableAccountIds` null) a member name renders plain, with no hint yet.
 */
export function decorateParticipatingOrgRow(
  row: ProjectParticipatingOrg,
  foundationSlug: string | null,
  readableAccountIds: ReadonlySet<string> | null
): ProjectParticipatingOrgRowVm {
  const readable = row.isMember && row.accountId !== null && !!readableAccountIds?.has(row.accountId);
  const segment = readable && foundationSlug ? orgUrlSegment({ uid: row.accountId }) : null;
  const orgLensLink = segment && foundationSlug ? ['/org', segment, 'memberships', foundationSlug] : null;
  const tier = row.isMember ? row.membershipTierClass : null;
  return {
    participantKey: row.participantKey,
    name: row.name,
    logoUrl: row.logoUrl,
    initial: row.name.trim().charAt(0).toUpperCase() || '?',
    nameKind: nameKind(row, orgLensLink !== null, readableAccountIds === null),
    orgLensLink,
    membershipLabel: row.isMember ? `${tier ?? ''} Member`.trim() : null,
    membershipBadgeClass: row.isMember
      ? ((tier && PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES[tier]) ?? PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS)
      : null,
    commits: metric(row.commits, row.commitsPrev, row.commitsChange),
    contributors: metric(row.contributors, row.contributorsPrev, row.contributorsChange),
  };
}

function nameKind(row: ProjectParticipatingOrg, linked: boolean, accessPending: boolean): ProjectParticipatingOrgNameKind {
  if (linked) return 'org-lens-link';
  if (row.isMember && !accessPending) return 'no-access';
  return 'plain';
}

/** Whole-percent change from the modeled fraction; "New" from a zero baseline, "—" with no comparison (All Time, zero-to-zero). */
function metric(value: number, prev: number | null, fraction: number | null): ProjectParticipatingOrgMetricVm {
  const [changeLabel, changeTone] = change(value, prev, fraction);
  return { value, changeLabel, changeTone, changeClass: PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES[changeTone] };
}

function change(value: number, prev: number | null, fraction: number | null): [string, ProjectParticipatingOrgChangeTone] {
  if (fraction === null) {
    return prev === 0 && value > 0 ? ['New', 'new'] : ['—', 'none'];
  }
  // `+ 0` folds a rounded -0 into 0 so a tiny drop never reads "-0%".
  const percent = Math.round(fraction * 100) + 0;
  if (percent > 0) return [`+${percent}%`, 'positive'];
  if (percent < 0) return [`${percent}%`, 'negative'];
  return ['0%', 'neutral'];
}
