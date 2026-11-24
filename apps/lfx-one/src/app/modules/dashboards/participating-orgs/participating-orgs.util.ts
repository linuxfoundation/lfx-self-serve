// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CDP_COMPANY_ID_PATTERN,
  CDP_COMPANY_ROUTE_PREFIX,
  LENS_DEFAULT_ROUTES,
  ORG_ACCOUNT_ID_PATTERN,
  PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES,
  PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES,
  PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS,
} from '@lfx-one/shared/constants';
import type {
  ProjectParticipatingOrg,
  ProjectParticipatingOrgsLinks,
  ProjectParticipatingOrgsLinksQuery,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgChangeTone,
  ProjectParticipatingOrgMetricVm,
  ProjectParticipatingOrgNameKind,
  ProjectParticipatingOrgRowVm,
} from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';

/** Ids of one page the links read asks about, each deduplicated and sorted so the same rows in another order compare equal. */
export function linksIdsOf(page: ProjectParticipatingOrgsPage): ProjectParticipatingOrgsLinksQuery {
  const accountIds = new Set<string>();
  const nonMemberAccountIds = new Set<string>();
  const cdpIds = new Set<string>();
  for (const row of page.rows) {
    if (row.accountId && ORG_ACCOUNT_ID_PATTERN.test(row.accountId)) {
      (row.isMember ? accountIds : nonMemberAccountIds).add(row.accountId);
    } else if (row.isUnidentified && row.organizationId && CDP_COMPANY_ID_PATTERN.test(row.organizationId)) {
      cdpIds.add(row.organizationId);
    }
  }
  return { accountIds: [...accountIds].sort(), nonMemberAccountIds: [...nonMemberAccountIds].sort(), cdpIds: [...cdpIds].sort() };
}

/** Identity of one links question: the project and the member, non-member and CDP ids asked about. */
export function linksKey(slug: string, ids: ProjectParticipatingOrgsLinksQuery): string {
  return `${slug}|${ids.accountIds.join(',')}|${ids.nonMemberAccountIds.join(',')}|${ids.cdpIds.join(',')}`;
}

/**
 * Decorate a wire row for the table (spec 062 FR-040, DR-041, DR-042). A member the viewer can open in Company Lens
 * links to its membership page for this project's parent foundation, and falls back to the no-access hint when either
 * half of that address is missing. A non-member the viewer can read links to its Company Lens home; an Unidentified
 * company that is an addressable CDP company links to its CDP page. Anything else renders plain, with no hint. While
 * the viewer's links are still loading (`links` null) every name renders plain, with no hint yet.
 */
export function decorateParticipatingOrgRow(
  row: ProjectParticipatingOrg,
  foundationSlug: string | null,
  links: ProjectParticipatingOrgsLinks | null
): ProjectParticipatingOrgRowVm {
  // Built from the account id alone, so it is null for any id Company Lens cannot address — never a link to nowhere.
  const segment = row.accountId === null ? null : orgUrlSegment({ uid: row.accountId });
  const kind = nameKind(row, segment, foundationSlug, links);
  const tier = row.isMember ? row.membershipTierClass : null;
  return {
    participantKey: row.participantKey,
    name: row.name,
    logoUrl: row.logoUrl,
    initial: row.name.trim().charAt(0).toUpperCase() || '?',
    nameKind: kind,
    orgLensLink: nameLink(row, segment, foundationSlug, kind),
    membershipLabel: row.isMember ? `${tier ?? ''} Member`.trim() : null,
    membershipBadgeClass: row.isMember
      ? ((tier && PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES[tier]) ?? PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS)
      : null,
    commits: metric(row.commits, row.commitsPrev, row.commitsChange),
    contributors: metric(row.contributors, row.contributorsPrev, row.contributorsChange),
  };
}

function nameKind(
  row: ProjectParticipatingOrg,
  segment: string | null,
  foundationSlug: string | null,
  links: ProjectParticipatingOrgsLinks | null
): ProjectParticipatingOrgNameKind {
  if (!links) return 'plain';
  if (row.isMember) {
    return segment && foundationSlug && row.accountId !== null && links.readable.has(row.accountId) ? 'org-lens-link' : 'no-access';
  }
  if (segment && row.accountId !== null && links.readable.has(row.accountId)) return 'org-lens-home-link';
  if (row.isUnidentified && row.organizationId !== null && links.cdpCompanyIds.has(row.organizationId)) return 'cdp-link';
  return 'plain';
}

function nameLink(row: ProjectParticipatingOrg, segment: string | null, foundationSlug: string | null, kind: ProjectParticipatingOrgNameKind): string[] | null {
  switch (kind) {
    case 'org-lens-link':
      return [LENS_DEFAULT_ROUTES.org, segment ?? '', 'memberships', foundationSlug ?? ''];
    case 'org-lens-home-link':
      return [LENS_DEFAULT_ROUTES.org, segment ?? ''];
    case 'cdp-link':
      return ['/', CDP_COMPANY_ROUTE_PREFIX, row.organizationId ?? ''];
    default:
      return null;
  }
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
