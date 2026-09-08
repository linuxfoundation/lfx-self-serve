// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaGroup, OrgClaStatusDisplay } from '../interfaces/cla.interface';

export const ORG_CLA_STATUS_DISPLAY: Record<OrgClaGroup['status'], OrgClaStatusDisplay> = {
  signed: { label: 'Signed', severity: 'success' },
  'not-started': { label: 'Not started', severity: 'secondary' },
  sanctioned: { label: 'Sanctioned', severity: 'danger' },
};

export const ORG_CLA_HEADING_STATUS: Record<OrgClaGroup['status'], string> = {
  signed: 'Signed',
  'not-started': 'Not yet signed',
  sanctioned: 'Unavailable',
};

export function orgClaCoverageSummary(group: Pick<OrgClaGroup, 'projects'>): string {
  const { projects } = group;

  if (projects.length === 0) return '';
  return projects.length === 1 ? projects[0].projectName : `${projects.length} projects`;
}

export function orgClaCoverageChips(group: Pick<OrgClaGroup, 'projects' | 'foundationName'>): string[] {
  const { projects, foundationName } = group;

  if (projects.length === 0) return foundationName ? [foundationName] : [];
  if (projects.length === 1) return [projects[0].projectName];

  const projectsChip = `Covers ${projects.length} projects`;
  return foundationName ? [foundationName, projectsChip] : [projectsChip];
}
