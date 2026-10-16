// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ProjectParticipatingOrg,
  ProjectParticipatingOrgMetricVm,
  ProjectParticipatingOrgNameKind,
  ProjectParticipatingOrgRowVm,
} from '@lfx-one/shared/interfaces';
import { avatarColorClass, computePeriodDelta, orgUrlSegment } from '@lfx-one/shared/utils';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

/**
 * Decorate a wire row for the table. Only a member the viewer can open in Org Lens gets a link — to the company's
 * membership page for this project's parent foundation; it falls back to the no-access hint when either half of the
 * address is missing, so a link is never built to a page that cannot resolve.
 */
export function decorateParticipatingOrgRow(row: ProjectParticipatingOrg, foundationSlug: string | null): ProjectParticipatingOrgRowVm {
  const segment = row.isMember && row.canOpenOrgLens && foundationSlug ? orgUrlSegment({ uid: row.accountId }) : null;
  const orgLensLink = segment && foundationSlug ? ['/org', segment, 'memberships', foundationSlug] : null;
  return {
    participantKey: row.participantKey,
    name: row.name,
    logoUrl: row.logoUrl,
    initials: computePersonInitials(row.name),
    avatarColorClass: avatarColorClass(row.name),
    nameKind: nameKind(row, orgLensLink !== null),
    orgLensLink,
    membershipLabel: row.isMember ? (row.membershipTierClass ?? 'Member') : null,
    commits: metric(row.commits, row.commitsPrev),
    contributors: metric(row.contributors, row.contributorsPrev),
  };
}

function nameKind(row: ProjectParticipatingOrg, linked: boolean): ProjectParticipatingOrgNameKind {
  if (row.isUnidentified) return 'unidentified';
  if (linked) return 'org-lens-link';
  if (row.isMember) return 'no-access';
  return 'plain';
}

/** No comparison for All Time (`prev` null) or a zero-to-zero window; a company with no prior activity is "New". */
function metric(value: number, prev: number | null): ProjectParticipatingOrgMetricVm {
  if (prev === null) return { value, delta: null, isNew: false };
  if (prev === 0) return { value, delta: null, isNew: value > 0 };
  return { value, delta: computePeriodDelta([prev, value], ''), isNew: false };
}
