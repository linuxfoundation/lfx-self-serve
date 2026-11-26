// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PUBLIC_PROFILE_INVOLVEMENT_COPY } from '../constants/public-profile.constants';
import { PublicProfileBasic, PublicProfileInvolvementItem, PublicProfileProject } from '../interfaces/public-profile.interface';
import { formatInvolvementPeriod } from './profile-page.utils';

/**
 * Resolves the contributor's current employer for display. `AccountName` values
 * containing "Individual" are an upstream placeholder for "no employer" and are
 * hidden. Returns an empty string when there is no employer to show.
 */
export function resolveAffiliationCompany(basic: PublicProfileBasic | null | undefined): string {
  const account = basic?.AccountName?.trim();
  return account && !account.includes('Individual') ? account : '';
}

/**
 * Resolves an upstream relative contribution label (`current_year`, `last_year`, `2nd_last_year`, …)
 * or a four-digit year string to a calendar year. Returns undefined for anything else so the caller
 * drops the row instead of attributing it to the wrong year.
 */
export function mapYearLabelToNumber(label: unknown, currentYear: number): number | undefined {
  if (typeof label !== 'string') {
    return undefined;
  }
  const value = label.trim();
  if (value === 'current_year') {
    return currentYear;
  }
  if (value === 'last_year') {
    return currentYear - 1;
  }
  const yearsAgo = /^(\d+)(?:st|nd|rd|th)_last_year$/.exec(value);
  if (yearsAgo) {
    return currentYear - Number(yearsAgo[1]);
  }
  return /^\d{4}$/.test(value) ? Number(value) : undefined;
}

/**
 * Formats a single-line affiliation as "{Title} at {Company}", omitting either side
 * when it is absent (and hiding the "Individual" no-employer placeholder via
 * {@link resolveAffiliationCompany}). Used where title and company share one line
 * (e.g. the sticky topbar); the hero renders them separately so it can show a logo.
 */
export function formatAffiliation(basic: PublicProfileBasic | null | undefined): string {
  const title = basic?.Title?.trim() || '';
  const company = resolveAffiliationCompany(basic);
  if (title && company) {
    return `${title} at ${company}`;
  }
  return title || company;
}

/**
 * The redesigned public profile's Foundations & projects involvement (#6093): each project with its totals and the span of
 * years that had any activity. A project is current when its latest such year is `currentYear`; current projects come
 * first, each group keeping the profile's own order.
 */
export function buildPublicProfileInvolvement(projects: PublicProfileProject[], currentYear: number): PublicProfileInvolvementItem[] {
  return projects
    .map((project, index): PublicProfileInvolvementItem => {
      const active = (project.years ?? [])
        .filter((row) => row.commits + row.prs + row.issues + row.added + row.deleted > 0)
        .map((row) => row.year)
        .sort((a, b) => a - b);
      const first = active[0];
      const last = active.at(-1);
      const current = last !== undefined && last >= currentYear;
      return {
        id: `${index}`,
        name: project.Name?.trim() || project.Slug?.trim() || PUBLIC_PROFILE_INVOLVEMENT_COPY.untitled,
        logo: project.LogoURL?.trim() ?? '',
        current,
        years: first === undefined ? '' : formatInvolvementPeriod(`${first}`, current ? '' : `${last}`),
        commits: project.commits,
        prs: project.prs,
        issues: project.issues,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
}
