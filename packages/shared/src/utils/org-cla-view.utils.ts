// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaCoverageChip, OrgClaGroup } from '../interfaces/cla.interface';

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
