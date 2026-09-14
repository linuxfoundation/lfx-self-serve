// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaCoverageChip, OrgClaGroup, OrgClaSignSelection } from '../interfaces/cla.interface';

export function orgClaCoverageSummary(group: Pick<OrgClaGroup, 'projects'>): string {
  const { projects } = group;

  if (projects.length === 0) return '';
  return projects.length === 1 ? projects[0].projectName : `${projects.length} projects`;
}

/**
 * Accessible name for the link that opens one agreement.
 *
 * Carries `signingEntityName` because the CLA Group name alone is not unique: an organization that
 * signed under several entities gets one row per entity, all sharing that name. The card shows the
 * entity as a visible subline for exactly that reason, and a link naming only the group would leave
 * a screen-reader user choosing between identical "Open …" links.
 *
 * Comma-joined rather than reusing the card's own "Signed by …" / "Signing entity: …" subline: that
 * copy is status-dependent, and a link's name should say which row it opens, not restate the row's
 * state, which the card body already reads out.
 */
export function orgClaOpenLabel(group: Pick<OrgClaGroup, 'claGroupName' | 'signingEntityName'>): string {
  const { claGroupName, signingEntityName } = group;

  return signingEntityName ? `Open ${claGroupName}, ${signingEntityName}` : `Open ${claGroupName}`;
}

/**
 * Coverage chips for one row, each saying whether it stands for a list worth opening.
 *
 * Only the "Covers N projects" chip does. A foundation name says where the agreement sits, and a
 * single project's name already *is* the whole coverage — neither has anything a list view could
 * add, so neither may be dressed as activatable. The approved design draws exactly this line: the
 * projects chip alone carries the arrow and the link treatment.
 *
 * `opensCoverage` travels with the label rather than being re-derived per consumer, because the
 * rule is one of coverage semantics and both the card and the detail header have to agree on it.
 */
export function orgClaCoverageChips(group: Pick<OrgClaGroup, 'projects' | 'foundationName'>): OrgClaCoverageChip[] {
  const { projects, foundationName } = group;

  if (projects.length === 0) return foundationName ? [{ label: foundationName, opensCoverage: false }] : [];
  if (projects.length === 1) return [{ label: projects[0].projectName, opensCoverage: false }];

  const projectsChip: OrgClaCoverageChip = { label: `Covers ${projects.length} projects`, opensCoverage: true };
  return foundationName ? [{ label: foundationName, opensCoverage: false }, projectsChip] : [projectsChip];
}

/**
 * The agreement a group address is about, out of the organization's own list (#2364).
 *
 * The address is the CLA Group, which names an agreement *template* rather than one organization's
 * agreement: the upstream grain is (signing entity × CLA group), so an organization holding two
 * signing entities holds two rows at one group id. Hence the two-step rule.
 *
 * - **A named signature wins**, which is how a card opens the row that was clicked.
 * - **A signature that names no row falls through** rather than being treated as "no such
 *   agreement". A copied link outlives the list it was copied from — the row may have been
 *   superseded — and answering a stale `sig` with the group's current agreement is both what the
 *   reader wanted and strictly more useful than an empty page. The group id is the authoritative
 *   part of the address; `sig` only narrows it.
 * - **Otherwise the newest signed agreement**, by signed date.
 *
 * The tiebreak is the part that has to be stated rather than left to `find`. `signedOn` is absent
 * whenever upstream sends no signing timestamp, so "latest date" cannot decide every case; and
 * first-match is not a safe default here, because once a second signing entity signs it can
 * silently hand back the other entity's agreement. Falling back to the list's own order is
 * deterministic — upstream sorts by signing-entity name, then group name, then group id — so the
 * same address resolves to the same agreement on every load.
 *
 * Candidates are **not** filtered to signed rows. An unsigned row is a legitimate answer — the
 * detail page has a not-started view built for exactly that — and withholding it would replace a
 * page explaining how to sign with an empty state. Such a row loses the ordering on its own merit
 * instead: carrying no `signedOn`, it ranks below any signed sibling, so a signed agreement still
 * wins wherever both exist for one group.
 */
export function orgClaGroupForAddress(groups: readonly OrgClaGroup[], claGroupId: string, signatureId?: string): OrgClaGroup | undefined {
  if (!claGroupId) return undefined;

  const candidates = groups.filter((group) => group.claGroupId === claGroupId);
  if (candidates.length === 0) return undefined;

  if (signatureId) {
    const named = candidates.find((group) => group.id === signatureId);
    if (named) return named;
  }

  // `reduce` over the already-ordered list, keeping the incumbent on anything that is not a
  // strictly later date. That is what makes the absent-date and equal-date cases both resolve to
  // the earlier position in upstream order, rather than to whichever the comparator happened to
  // visit second.
  return candidates.reduce((best, group) => (orgClaSignedAtMs(group) > orgClaSignedAtMs(best) ? group : best));
}

/**
 * `signedOn` as a comparable instant, or `-Infinity` when there is nothing to compare.
 *
 * Absent and unparseable collapse to the same answer deliberately: both mean "this row cannot
 * claim to be the newest", which hands the decision to upstream order via the caller's reduce.
 * Returning 0 instead would rank such a row above nothing and below everything, which reads the
 * same for real dates but silently makes an unparseable value beat a missing one.
 */
function orgClaSignedAtMs(group: OrgClaGroup): number {
  if (!group.signedOn) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(group.signedOn);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The row the pre-signing preview page renders, built from the picker's choice rather than fetched
 * (#1983).
 *
 * The preview describes an agreement that does not exist yet, so there is no list row to find:
 * the page is addressed by CLA Group, and nobody has signed that group. Everything the detail page
 * shows already works off an `OrgClaGroup`, so this is the one place the selection becomes that
 * shape.
 *
 * Two fields carry the whole reason this is a function rather than a spread:
 *
 * - **`projects` holds exactly the one entry search named.** That single entry is what routes the
 *   signing scope through the single-covered-project branch, which returns the SFID search gave.
 * - **`foundationSfid` is left unset**, even though search resolves `projectSfid` to the foundation
 *   for a foundation-level group. Setting it would *assert* a foundation where search may have
 *   named a project, and the signing scope reads `foundationSfid` first — so the assertion would
 *   change the scope the corporate agreement is opened at rather than merely mislabel it.
 *
 * `id` is empty because no signature exists. Nothing keys off it here: the document offer reads
 * `signed`, and the list lookup is bypassed entirely.
 */
export function orgClaPreviewGroup(selection: OrgClaSignSelection): OrgClaGroup {
  return {
    id: '',
    claGroupId: selection.claGroupId,
    claGroupName: selection.claGroupName,
    projects: [{ projectName: selection.projectName, projectSfid: selection.projectSfid }],
    signed: false,
    status: 'not-started',
    needsClaManager: false,
    claManagersCount: 0,
    // 0, not absent. Absence means the deployment did not report a count; this agreement genuinely
    // has no approval criteria, because it has no signature for them to hang off.
    approvalCriteriaCount: 0,
  };
}
