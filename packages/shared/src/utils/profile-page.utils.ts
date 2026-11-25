// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdpProjectAffiliation, ProfileInvolvementItem } from '../interfaces';
import { formatYearMonth } from './date-time.utils';

/**
 * The Profile page's Foundations & projects involvement (#6085): the user's LFX projects, read the way the hub's affiliations
 * tab reads them. The first role decides Maintainer or Contributor; a project is current while any role (or, with no roles,
 * any affiliation) is open. Current projects come first, then the newest start, then by name. `lfxSlugs` null keeps every
 * project, as the hub does when the slug list is unavailable.
 */
export function buildProfileInvolvement(affiliations: CdpProjectAffiliation[], lfxSlugs: ReadonlySet<string> | null): ProfileInvolvementItem[] {
  return affiliations
    .filter((project) => project.projectSlug && (!lfxSlugs || lfxSlugs.has(project.projectSlug)))
    .map((project): ProfileInvolvementItem => {
      const spans = (project.roles.length > 0 ? project.roles : project.affiliations).map((span) => ({ start: span.startDate || '', end: span.endDate || '' }));
      const current = spans.length === 0 || spans.some((span) => !span.end);
      const start =
        spans
          .map((span) => span.start)
          .filter(Boolean)
          .sort()[0] ?? '';
      const end = current
        ? ''
        : (spans
            .map((span) => span.end)
            .sort()
            .at(-1) ?? '');
      return {
        id: project.id,
        name: project.projectName,
        logo: project.projectLogo,
        role: project.roles[0]?.role === 'Maintainer' ? 'Maintainer' : 'Contributor',
        current,
        years: involvementLabel(start.slice(0, 4), end.slice(0, 4)),
        period: involvementLabel(formatYearMonth(start), formatYearMonth(end)),
        start,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.start.localeCompare(a.start) || a.name.localeCompare(b.name));
}

// "Since {from}" while current, "{from} – {to}" once ended; '' without a start.
function involvementLabel(from: string, to: string): string {
  if (!from) return '';
  return to ? `${from} – ${to}` : `Since ${from}`;
}
