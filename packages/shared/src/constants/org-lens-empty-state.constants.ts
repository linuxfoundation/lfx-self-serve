// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens empty-state registry (lfx-self-serve#2533, phase 1).
 *
 * Every Org Lens empty state — page-level and section-level — renders from one of these entries
 * through `lfx-org-lens-empty-state`; no page or section may render an empty-state string from any
 * other source. Product and design review this file. Wording rules: sentence-case headlines, no
 * exclamation marks, never "Oops" / "Forbidden" / "Unauthorized" / "error"; the reason never blames
 * the caller.
 *
 * Privacy (spec 050 DR-002 / 053 DR-001): the `no-access` and `wrong-organization` entries stay on
 * "this organization" — they never interpolate an addressed organization's name, because the caller
 * does not hold it. `{orgName}` is accepted only by states rendered to a caller who holds the org.
 */

/** Names of the states shipped in phase 1. */
export type OrgLensEmptyStateName =
  | 'no-organization'
  | 'no-access'
  | 'wrong-organization'
  | 'could-not-load'
  | 'staff-check-failed'
  | 'not-found-staff'
  | 'section-empty'
  | 'section-could-not-load'
  | 'section-no-access'
  | 'section-could-not-verify';

/** What the primary / secondary control does when it is not a plain link. */
export type OrgLensEmptyStateActionKind = 'retry' | 'org-list' | 'reset-filters' | 'contact-support';

export interface OrgLensEmptyStateAction {
  label: string;
  /** External URL — rendered as an anchor. */
  href?: string;
  /** In-app route — rendered as a router link. */
  route?: string[];
  /** Emitted through the component's `primaryAction` / `secondaryAction` output. */
  action?: OrgLensEmptyStateActionKind;
}

export interface OrgLensEmptyStateCopy {
  headline: string;
  /** One line on what Organization Lens is — present for every state a first-time visitor can reach. */
  productLine?: string;
  /** May interpolate `{orgName}` `{noun}` `{period}` `{correlationId}`. */
  reason: string;
  /** Font Awesome class. */
  icon: string;
  /** Exactly one primary action, except `section-empty` with no applicable filter (renders reason-only). */
  primary?: OrgLensEmptyStateAction;
  secondary?: OrgLensEmptyStateAction;
  /** `section-empty` only — wording when the section has no selectable period (FR-013 "No {noun} recorded"). */
  noPeriod?: { headline: string; reason: string };
}

const PRODUCT_LINE = 'Organization Lens shows how a company is involved in open source — the projects it contributes to, the people doing the work, and its membership footprint.';

export const ORG_LENS_PROFILE_ATTRIBUTIONS_URL = 'https://app.lfx.dev/profile/attributions';
export const ORG_LENS_INSIGHTS_PUBLIC_URL = 'https://insights.linuxfoundation.org';

export const ORG_LENS_EMPTY_STATE_COPY: Record<OrgLensEmptyStateName, OrgLensEmptyStateCopy> = {
  'no-organization': {
    headline: 'No organization linked to your account',
    productLine: PRODUCT_LINE,
    reason: 'Your account is not linked to an organization yet, so there is nothing to show here. Add your organization as an affiliation in your LFX profile. Once it is verified, it will appear here.',
    icon: 'fa-light fa-building',
    primary: { label: 'Add an affiliation', href: ORG_LENS_PROFILE_ATTRIBUTIONS_URL },
    secondary: { label: 'Already added one? Contact support', action: 'contact-support' },
  },
  'no-access': {
    headline: 'You do not have access to this organization',
    productLine: PRODUCT_LINE,
    reason:
      "Access is granted by the organization's own Organization Lens administrators, not by the Linux Foundation. Contact your administrators and they can grant you access. If you are not sure who they are, your OSPO is a good place to start.",
    icon: 'fa-light fa-lock',
    primary: { label: 'Contact support', action: 'contact-support' },
    secondary: { label: 'See public activity in LFX Insights', href: ORG_LENS_INSIGHTS_PUBLIC_URL },
  },
  'wrong-organization': {
    headline: 'You do not have access to this organization',
    productLine: PRODUCT_LINE,
    reason: 'This link points to an organization that is not on your list. Here is what you do have access to:',
    icon: 'fa-light fa-lock',
    primary: { label: 'Your organizations', action: 'org-list' },
    secondary: { label: 'Ask for access to the organization in this link', action: 'contact-support' },
  },
  'not-found-staff': {
    headline: 'This link does not open an organization',
    productLine: PRODUCT_LINE,
    reason: 'Search for an organization in the switcher above to open its Organization Lens.',
    icon: 'fa-light fa-building-circle-xmark',
    primary: { label: 'Go to Organization Lens', route: ['/org', 'overview'] },
  },
  'could-not-load': {
    headline: 'Some organizations could not be loaded',
    productLine: PRODUCT_LINE,
    reason: 'One or more of your organizations did not load. This is a temporary problem on our side — nothing has been removed from your access.',
    icon: 'fa-light fa-rotate-right',
    primary: { label: 'Retry', action: 'retry' },
  },
  'staff-check-failed': {
    headline: 'We could not confirm your staff access',
    productLine: PRODUCT_LINE,
    reason:
      'Your account looks like Linux Foundation staff, but the staff access check did not complete. This is a system problem, not a change to your permissions. Reference: {correlationId}',
    icon: 'fa-light fa-id-badge',
    primary: { label: 'Retry', action: 'retry' },
    secondary: { label: 'Still failing? Send this reference to support', action: 'contact-support' },
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
    headline: 'You do not have access to this organization',
    reason: "Access is granted by the organization's own Organization Lens administrators. Contact them to request access.",
    icon: 'fa-light fa-lock',
    primary: { label: 'Contact support', action: 'contact-support' },
  },
  'section-could-not-verify': {
    headline: 'Access could not be verified',
    reason: 'We could not confirm your access to this organization right now. This is a temporary problem — nothing has changed about your permissions.',
    icon: 'fa-light fa-rotate-right',
    primary: { label: 'Retry', action: 'retry' },
  },
};

/** Headline of the switcher notice shown when the caller's list is a lower bound (FR-010). */
export const ORG_LENS_LIST_INCOMPLETE_NOTICE = 'Some of your organizations may be missing from this list. Retry to reload.';

/** Legacy no-access copy retired by #2533; kept only so the single-source audit can grep for stragglers. */
export const ORG_LENS_RETIRED_NO_ACCESS_COPY = ['Organization Lens is not available', 'You do not have Org Lens access for this organization.'] as const;
