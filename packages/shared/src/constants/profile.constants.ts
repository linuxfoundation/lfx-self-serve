// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdpIdentityType, IdentityProvider, IdentityProviderOption, ProfileTab } from '../interfaces';

/**
 * sessionStorage key for a profile-edit form interrupted by a Flow C
 * (management-token) authorization. Written by the profile-edit dialog and
 * replayed by ProfileLayoutComponent on return; cleared before unrelated
 * profile-auth flows. Centralized here because it is shared across the profile
 * layout, the profile-edit dialog, and the settings feature.
 */
export const PENDING_PROFILE_SAVE_KEY = 'lfx_profile_pending_save';

/**
 * Profile tab configuration
 */
export const PROFILE_TABS: ProfileTab[] = [
  { id: 'attribution', label: 'Work history & Affiliations', route: 'attributions' },
  { id: 'identities', label: 'Identities', route: 'identities' },
  { id: 'individual-enrollment', label: 'Individual Enrollment', route: 'individual-enrollment' },
  { id: 'transactions', label: 'Transactions', route: 'transactions' },
  { id: 'settings', label: 'Settings', route: 'settings' },
];

/**
 * Month options for date selectors
 */
export const MONTH_OPTIONS = [
  { label: 'January', value: '01' },
  { label: 'February', value: '02' },
  { label: 'March', value: '03' },
  { label: 'April', value: '04' },
  { label: 'May', value: '05' },
  { label: 'June', value: '06' },
  { label: 'July', value: '07' },
  { label: 'August', value: '08' },
  { label: 'September', value: '09' },
  { label: 'October', value: '10' },
  { label: 'November', value: '11' },
  { label: 'December', value: '12' },
];

/**
 * Abbreviated month options for affiliation period date selectors
 */
export const MONTH_ABBREV_OPTIONS: { label: string; value: string }[] = [
  { label: 'Jan', value: 'Jan' },
  { label: 'Feb', value: 'Feb' },
  { label: 'Mar', value: 'Mar' },
  { label: 'Apr', value: 'Apr' },
  { label: 'May', value: 'May' },
  { label: 'Jun', value: 'Jun' },
  { label: 'Jul', value: 'Jul' },
  { label: 'Aug', value: 'Aug' },
  { label: 'Sep', value: 'Sep' },
  { label: 'Oct', value: 'Oct' },
  { label: 'Nov', value: 'Nov' },
  { label: 'Dec', value: 'Dec' },
];

/**
 * Year options for date selectors (current year down 50 years)
 */
export const YEAR_OPTIONS: { label: string; value: string }[] = Array.from({ length: 50 }, (_, i) => {
  const year = (new Date().getFullYear() - i).toString();
  return { label: year, value: year };
}).reverse();

/**
 * Identity provider options for the Add Account dialog
 */
export const IDENTITY_PROVIDER_OPTIONS: IdentityProviderOption[] = [
  { id: 'github', name: 'GitHub', description: 'Connect your GitHub account for code contributions', icon: 'fa-brands fa-github' },
  { id: 'linkedin', name: 'LinkedIn', description: 'Connect your LinkedIn account for employer recognition', icon: 'fa-brands fa-linkedin' },
  { id: 'google', name: 'Google', description: 'Connect your Google account to verify your email', icon: 'fa-brands fa-google' },
  { id: 'email', name: 'Email', description: 'Add an email address for notifications and attribution', icon: 'fa-light fa-envelope' },
  { id: 'lfid', name: 'LF ID', description: 'Connect your Linux Foundation ID', icon: 'fa-light fa-id-badge' },
];

/**
 * Maps Auth0 identity provider names to CDP platform names
 * Used to cross-reference Auth0 linked identities with CDP identities
 */
export const AUTH0_TO_CDP_PROVIDER_MAP: Record<string, string> = {
  github: 'github',
  'google-oauth2': 'google',
  linkedin: 'linkedin',
  gitlab: 'gitlab',
  email: 'email',
  auth0: 'lfid',
};

/**
 * Reverse of AUTH0_TO_CDP_PROVIDER_MAP — maps CDP platform names back to Auth0 provider names.
 * Used when unlinking identities (Auth0 expects its own provider names, not CDP platform names).
 * Note: Assumes a 1:1 mapping — if two Auth0 providers map to the same CDP platform,
 * the last entry wins silently. Currently all mappings are unique.
 */
export const CDP_TO_AUTH0_PROVIDER_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(AUTH0_TO_CDP_PROVIDER_MAP).map(([auth0, cdp]) => [cdp, auth0])
);

/**
 * Default mapping from CDP platform → identity type, used when LFX One POSTs
 * new identities to CDP from auth-service (where the value's shape is known
 * because we control it — Auth0 always gives us email for LinkedIn, nickname
 * for GitHub, etc.). NOT used as a GET-side fallback for legacy CDP rows
 * missing `type`; that path infers from the value's shape directly (see
 * cdp.service.ts).
 */
export const CDP_PLATFORM_TO_TYPE_MAP: Readonly<Record<string, CdpIdentityType | undefined>> = {
  github: 'username',
  gitlab: 'username',
  lfid: 'username',
  google: 'email',
  linkedin: 'email',
  email: 'email',
  custom: 'email',
};

/**
 * Allowlist of (platform, type) combos that LFX One supports surfacing in the
 * profile identities UI and syncing to CDP from auth-service. Applied AFTER
 * the `custom → email` remap in cdp.service.ts, so email-style entries appear
 * here as `email + email`. LFID is handled by a dedicated auto-verify branch
 * and intentionally excluded from this allowlist.
 */
export const CDP_DISPLAYABLE_IDENTITY_COMBOS: ReadonlySet<string> = new Set(['github+username', 'linkedin+email', 'email+email', 'google+email']);

/**
 * CDP platform to icon class mapping
 */
export const CDP_PLATFORM_ICONS: Record<string, string> = {
  github: 'fa-brands fa-github',
  google: 'fa-brands fa-google',
  linkedin: 'fa-brands fa-linkedin',
  email: 'fa-light fa-envelope',
  lfid: 'fa-light fa-id-badge',
};

/**
 * Display labels for identity providers
 */
export const IDENTITY_PROVIDER_LABELS: Record<IdentityProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  google: 'Google',
  email: 'Email',
  lfid: 'LF ID',
};

/**
 * Source identifier for work experiences created via LFX One UI
 */
export const LFX_ONE_WORK_EXPERIENCE_SOURCE = 'lfxOne';

/**
 * Generic, non-identifying message returned when an email is already linked to
 * another account. Intentionally never names the owning account — surfacing the
 * owning LFID would enable account enumeration.
 */
export const EMAIL_ALREADY_LINKED_MESSAGE = 'This email is already linked to another account';
