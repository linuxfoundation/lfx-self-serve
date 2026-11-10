// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Company Lens empty-state registry (lfx-self-serve#2533, phase 1).
 *
 * Every Company Lens empty state — page-level and section-level — renders from one of these entries
 * through `lfx-org-lens-empty-state`; no page or section may render an empty-state string from any
 * other source — including the `/company/not-found` dead end, which has no exception now that Company Lens
 * is always on.
 *
 * No state offers a support link (#5447): the only links are the person's own profile, the documentation, and LFX Insights.
 *
 * Product and design review this file. Wording rules: sentence-case headlines, no exclamation marks,
 * never "Oops" / "Forbidden" / "Unauthorized" / "error"; the reason never blames the caller.
 *
 * Privacy (spec 050 DR-002 / 053 DR-001): the `no-access` and `wrong-organization` entries stay on
 * "this company" — they never interpolate an addressed company's name, because the caller
 * does not hold it. `{orgName}` is accepted only by states rendered to a caller who holds the org.
 */

import { OrgLensEmptyStateCopy, OrgLensEmptyStateName, OrgLensSectionErrorOutcome } from '../interfaces/org-lens-empty-state.interface';
import { LINKS_CONFIG } from './links.config';

/** In-app route of the LFX profile attributions page (FR-006 primary) — environment-agnostic. */
export const ORG_LENS_PROFILE_ATTRIBUTIONS_ROUTE = ['/profile', 'attributions'];

export const ORG_LENS_EMPTY_STATE_COPY: Record<OrgLensEmptyStateName, OrgLensEmptyStateCopy> = {
  'no-organization': {
    headline: 'No company linked to your account',
    reason:
      "Company Lens shows how a company shows up in open source — its projects, its people, and its membership footprint. Your account isn't linked to a company yet. Add one as an affiliation and it appears here once verified.",
    icon: 'fa-light fa-building',
    primary: { label: 'Add an affiliation', route: ORG_LENS_PROFILE_ATTRIBUTIONS_ROUTE },
    secondary: { label: 'How affiliations and access work', href: LINKS_CONFIG.DOCS.COMPANY_LENS_ACCESS },
  },
  'no-access': {
    headline: 'You do not have access to this company',
    reason:
      "Company Lens shows a company's open source footprint — contributions, projects, people, and membership activity. Access is granted by the company's own Company Lens administrators, not by the Linux Foundation. If you're not sure who yours are, your OSPO is a good place to start.",
    icon: 'fa-light fa-lock',
    primary: { label: 'How access to a company is granted', href: LINKS_CONFIG.DOCS.COMPANY_LENS_ACCESS },
    secondary: { label: 'See public activity in LFX Insights', href: LINKS_CONFIG.INSIGHTS.BASE },
  },
  'wrong-organization': {
    headline: 'You do not have access to this company',
    reason: 'This link points to a company that is not on your list. Here is what you do have access to:',
    icon: 'fa-light fa-lock',
    primary: { label: 'Your companies', action: 'org-list' },
    secondary: { label: 'How to get access to a company', href: LINKS_CONFIG.DOCS.COMPANY_LENS_ACCESS },
    noList: { reason: 'This link points to a company that is not on your list.' },
  },
  'not-found-staff': {
    headline: 'This link does not open a company',
    reason: 'Search for a company in the switcher above to open its Company Lens.',
    icon: 'fa-light fa-building-circle-xmark',
    primary: { label: 'Go to Company Lens', route: ['/company', 'overview'] },
  },
  'could-not-load': {
    headline: 'Some companies could not be loaded',
    reason: 'One or more of your companies did not load. This is a temporary problem on our side — nothing has been removed from your access.',
    icon: 'fa-light fa-rotate-right',
    primary: { label: 'Retry', action: 'retry' },
  },
  'staff-check-failed': {
    headline: 'We could not confirm your staff access',
    reason: 'The staff access check did not complete. This is a system problem on our side, not a change to your permissions. Reference: {correlationId}',
    icon: 'fa-light fa-id-badge',
    primary: { label: 'Retry', action: 'retry' },
  },
  // #2961 — an LF contractor with no grant for what is in front of them. The copy depends only on the
  // caller, never on the company in the link (it withholds its name, existence and administrators).
  'contractor-no-grant': {
    headline: 'Contractor accounts need a company grant',
    reason:
      "Company Lens shows a company's open source footprint — contributions, projects, people, and membership activity. LF contractor accounts no longer see every company automatically. Access to a specific company is granted by that company's Company Lens administrators.",
    icon: 'fa-light fa-lock',
    primary: { label: 'How access to a company is granted', href: LINKS_CONFIG.DOCS.COMPANY_LENS_ACCESS },
    secondary: { label: 'See public activity in LFX Insights', href: LINKS_CONFIG.INSIGHTS.BASE },
  },
  // #4225 — the caller is affiliated with an employer that IS an LF member, but holds no grant on it.
  // Distinct from `no-organization`, whose "Add an affiliation" CTA is a promise the code cannot keep
  // for this caller: they already have the affiliation, and adding another never produces a grant.
  // The employer is deliberately not named — the copy is about the caller, so it needs no interpolation.
  'affiliated-no-grant': {
    headline: 'You do not have access to the Company Lens',
    reason:
      'The "Company" section of LFX Self-Serve shows how your company is involved with LF projects. Because this includes sensitive information, access is limited to a small set of admins. If you need access, you can contact an admin (likely your OSPO) and they can grant you access.',
    icon: 'fa-light fa-lock',
    primary: { label: 'How access to a company is granted', href: LINKS_CONFIG.DOCS.COMPANY_LENS_ACCESS },
    secondary: { label: 'See public activity in LFX Insights', href: LINKS_CONFIG.INSIGHTS.BASE },
  },
  'section-empty': {
    headline: 'No {noun} in this period',
    reason: '{orgName} has no {noun} recorded for {period}. Try a wider date range.',
    icon: 'fa-light fa-calendar-xmark',
    primary: { label: 'Reset filters', action: 'reset-filters' },
    noPeriod: { headline: 'No {noun} recorded', reason: '{orgName} has no {noun} recorded yet.' },
  },
  'section-could-not-load': {
    headline: 'This section could not be loaded',
    reason: 'Something went wrong on our side. The rest of the page is unaffected.',
    icon: 'fa-light fa-triangle-exclamation',
    primary: { label: 'Retry', action: 'retry' },
  },
  'section-no-access': {
    headline: 'You do not have access to this company',
    reason: "Access is granted by the company's own Company Lens administrators. Contact them to request access.",
    icon: 'fa-light fa-lock',
    primary: { label: 'How access to a company is granted', href: LINKS_CONFIG.DOCS.COMPANY_LENS_ACCESS },
  },
  'section-could-not-verify': {
    headline: 'Access could not be verified',
    reason: 'We could not confirm your access to this company right now. This is a temporary problem — nothing has changed about your permissions.',
    icon: 'fa-light fa-rotate-right',
    primary: { label: 'Retry', action: 'retry' },
  },
};

/** Headline of the switcher notice shown when the caller's list is a lower bound (FR-010). */
export const ORG_LENS_LIST_INCOMPLETE_NOTICE = 'Some of your companies may be missing from this list. Retry to reload.';

/** Labels of the switcher notice's Retry control: idle, and while the shared Retry is in flight (FR-010). */
export const ORG_LENS_LIST_INCOMPLETE_RETRY_LABEL = 'Retry';
export const ORG_LENS_LIST_INCOMPLETE_RETRYING_LABEL = 'Retrying…';

/**
 * Refusal codes the Company Lens read gate answers when it could not check access (503) — a section that
 * receives one renders `section-could-not-verify`, never the no-access wording (FR-015).
 */
export const ORG_LENS_UNVERIFIABLE_ACCESS_CODES: ReadonlySet<string> = new Set(['ROLE_GRANTS_UNAVAILABLE', 'ACCESS_CHECK_UNAVAILABLE']);

/**
 * Severity order (lowest number wins) for reducing a section carousel's per-pipeline outcomes to one
 * overall outcome: a gate-level `denied`/`unverifiable` always outranks a single failed pipeline.
 */
export const ORG_LENS_OUTCOME_SEVERITY: Record<OrgLensSectionErrorOutcome, number> = { denied: 0, unverifiable: 1, failed: 2, records: 3 };
