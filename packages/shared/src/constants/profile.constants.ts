// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IdentityProvider, IdentityProviderOption, ProfileTab } from '../interfaces';

/**
 * Profile tab configuration
 */
export const PROFILE_TABS: ProfileTab[] = [
  { id: 'attribution', label: 'Work history & Affiliations', route: 'attribution' },
  { id: 'identities', label: 'Identities', route: 'identities' },
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
  { id: 'email', name: 'Email', description: 'Add an email address for notifications and attribution', icon: 'fa-light fa-envelope' },
  { id: 'lfid', name: 'LF ID', description: 'Connect your Linux Foundation ID', icon: 'fa-light fa-id-badge' },
];

/**
 * Platforms that the UI supports verification for.
 * Only identities on these platforms are returned to the frontend.
 */
export const IDENTITY_DISPLAY_PLATFORMS: readonly string[] = ['github', 'email'];

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
 * CDP platform to icon class mapping
 */
export const CDP_PLATFORM_ICONS: Record<string, string> = {
  github: 'fa-brands fa-github',
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
