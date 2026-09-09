// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaGroup } from '../interfaces/cla.interface';

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

export function orgClaCoverageChips(group: Pick<OrgClaGroup, 'projects' | 'foundationName'>): string[] {
  const { projects, foundationName } = group;

  if (projects.length === 0) return foundationName ? [foundationName] : [];
  if (projects.length === 1) return [projects[0].projectName];

  const projectsChip = `Covers ${projects.length} projects`;
  return foundationName ? [foundationName, projectsChip] : [projectsChip];
}
