// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AccountSettingsNavGroup,
  AccountSettingsTarget,
  CdpIdentityType,
  EmailVerificationCallbackStatus,
  EmailVerificationStatus,
  IdentityProvider,
  IdentityProviderOption,
  PasswordStrength,
  ProfileTab,
  UiBadgeTone,
} from '../interfaces';

/**
 * sessionStorage key for a profile-edit form interrupted by a Flow C
 * (management-token) authorization. Written by the profile-edit dialog and
 * replayed by ProfileAuthReturnService (provided by the Profile & Account hub and
 * Account & Settings) on return; cleared before unrelated
 * profile-auth flows. Centralized here because it is shared across the profile
 * layout, the profile-edit dialog, and the settings feature.
 */
export const PENDING_PROFILE_SAVE_KEY = 'lfx_profile_pending_save';
/** Session key for a primary email chosen on Personal information when its save left for Flow C; the page restores it on return. */
export const PENDING_PRIMARY_EMAIL_KEY = 'lfx_profile_pending_primary_email';
/** Session key for a Linux.com forwarding address chosen on Account & Settings when its save left for Flow C (#6075). */
export const PENDING_LINUX_FORWARD_KEY = 'lfx_profile_pending_linux_forward';
/** How long a kept forwarding address stays usable, the same as a pending profile save. */
export const PENDING_LINUX_FORWARD_TTL_MS = 10 * 60 * 1000;
/** How long a kept primary email choice stays usable, the same as a pending profile save. */
export const PENDING_PRIMARY_EMAIL_TTL_MS = 10 * 60 * 1000;

/** Opaque one-shot handle for an already-linked callback's private support context; never an email. */
export const EMAIL_LINKED_SUPPORT_CONTEXT_PARAM = 'email_support_context';
export const EMAIL_LINKED_SUPPORT_HANDLE_PATTERN = /^[a-f0-9]{64}$/;

/**
 * sessionStorage key for the one-shot Linux.com forward re-auth redirect guard.
 * Written by ProfileLinuxEmailComponent before its automatic Flow C redirect so a
 * still-tokenless return can't loop; shared with its e2e/unit specs so a rename
 * can't silently desync the guard from what the tests pre-latch or assert.
 */
export const LINUX_EMAIL_FORWARD_REAUTH_KEY = 'linux-email:forward-reauth-attempted';

/**
 * Maximum length of the free-text "About Me" (bio) profile field. Shared across
 * the BFF validator, the reactive-form validator, and the textarea's maxlength
 * so the client and server enforce a single contract.
 */
export const PROFILE_BIO_MAX_LENGTH = 2000;

/**
 * Sentinel accepted by the meeting-service `preferred_email.set` RPC in place of an address to
 * clear the meeting-invitation override. Must stay in sync with `primaryEmailSentinel` in
 * lfx-v2-meeting-service; the upstream match is case-insensitive. The UI no longer sends it:
 * invitations stick to an address, so it always pins a literal one (#3983).
 */
export const MEETING_INVITE_PRIMARY_SENTINEL = 'primary';

/**
 * Explanation shown for the Organization field's info icon on the profile-edit drawer.
 * Bound to both `aria-label` and `pTooltip` so accessibility and visible copy can't drift apart.
 */
export const ORGANIZATION_INFO_TOOLTIP =
  'Companies in this list come from Work Experience. Add one there to choose a new company. An existing saved company may still appear.';

/**
 * Profile tab configuration
 */
export const PROFILE_TABS: ProfileTab[] = [
  { id: 'attribution', label: 'Work history & Affiliations', route: 'attributions' },
  { id: 'identities', label: 'Identities', route: 'identities' },
  { id: 'individual-enrollment', label: 'Individual Enrollment', route: 'individual-enrollment' },
  { id: 'clas', label: 'CLAs', route: 'clas' },
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
  { id: 'gitlab', name: 'GitLab', description: 'Connect your GitLab account for code contributions', icon: 'fa-brands fa-gitlab' },
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
 * Auth0 connection name of the generic OAuth2 social connection that links
 * GitLab accounts (#4187). Its reverse-map entry above supplies the
 * `connection=gitlab` sent to Auth0 when connecting.
 */
export const GITLAB_AUTH0_CONNECTION = 'gitlab';

/**
 * Auth0 provider of identities linked through the GitLab connection. `oauth2`
 * is the generic strategy shared by any custom social connection, so only the
 * connection name identifies GitLab; unlinking needs this provider, not the
 * connection name.
 */
export const GITLAB_AUTH0_PROVIDER = 'oauth2';

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
 * and intentionally excluded from this allowlist. Combos surfaced only when the
 * user has linked the account live in `AUTH0_LINKED_ONLY_IDENTITY_COMBOS`.
 */
export const CDP_DISPLAYABLE_IDENTITY_COMBOS: ReadonlySet<string> = new Set(['github+username', 'linkedin+email', 'email+email', 'google+email']);

/**
 * (platform, type) combos shown in the profile identities UI only when backed
 * by an identity linked in auth-service. CDP-only rows for these combos stay
 * hidden, so they are never offered for verification (Product decision, #4190).
 */
export const AUTH0_LINKED_ONLY_IDENTITY_COMBOS: ReadonlySet<string> = new Set(['gitlab+username']);

/**
 * CDP platform to icon class mapping
 */
export const CDP_PLATFORM_ICONS: Record<string, string> = {
  github: 'fa-brands fa-github',
  gitlab: 'fa-brands fa-gitlab',
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
 * Generic, non-identifying message returned when, after a correct code, OTP verification or the
 * identity link reports the email is already linked. Intentionally never names the owning
 * account — surfacing the owning LFID would enable account enumeration — and never asserts
 * "another account", since the upstream conflict alone does not prove that. Keeps the "already linked" marker the dialogs' support-link classifier
 * (`isIdentityAlreadyLinkedError`) matches.
 */
export const EMAIL_ALREADY_LINKED_MESSAGE =
  'You’ve verified this email address, but it’s already linked to an LFX account. Contact support for help with next steps.';

/** Successful no-op status: the proven address is already connected to the caller's own account. */
export const EMAIL_ALREADY_CONNECTED_STATUS: EmailVerificationStatus = 'already_connected';

/** Shared toast heading for an address already connected to the caller's account. */
export const EMAIL_ALREADY_CONNECTED_SUMMARY = 'Already connected';

/**
 * Success copy for an address already connected to the caller's account. Deliberately avoids the
 * "already linked" markers, so it can never trigger the linked-to-another-account support link.
 */
export const EMAIL_ALREADY_CONNECTED_MESSAGE = 'This email is already connected to your account.';

/**
 * Social callback `success` marker: the reconnected social identity resolved to the caller's own
 * account (same subject), so the callback returned without linking, verifying, or syncing anything.
 * A UI notice only — never proof of verification or ownership.
 */
export const IDENTITY_ALREADY_CONNECTED_STATUS = 'identity_already_connected';

/** Shared toast heading for a social identity already connected to the caller's account. */
export const IDENTITY_ALREADY_CONNECTED_SUMMARY = 'Already connected';

/**
 * Success copy for a social identity already connected to the caller's account. Deliberately avoids
 * the "already linked" markers, so it can never trigger the linked-to-another-account support link.
 */
export const IDENTITY_ALREADY_CONNECTED_MESSAGE = 'This identity is already connected to your account.';

/** Query parameter carrying the pending-email outcome on the Flow C authorization-success redirect. */
export const EMAIL_CALLBACK_STATUS_PARAM = 'email_status';

/** Flow C callback outcome: a replayed pending email verification did not finish. */
export const EMAIL_CALLBACK_RETRY_REQUIRED_STATUS: EmailVerificationCallbackStatus = 'retry_required';

/** Flow C callback outcome: the replayed code was correct, but the address is already linked to an LFX account. */
export const EMAIL_CALLBACK_ALREADY_LINKED_STATUS: EmailVerificationCallbackStatus = 'already_linked';

/** PrimeNG toast key for the sticky already-linked notice that carries a pre-filled Contact support action. */
export const EMAIL_LINKED_SUPPORT_TOAST_KEY = 'email-linked-support';

/** Title of the already-linked notice shown on the Settings code step and after the Flow C callback. */
export const EMAIL_LINKED_SUPPORT_TITLE = 'Email already linked';

/** Fixed guidance for a pending email verification that did not finish during the Flow C callback. */
export const EMAIL_CALLBACK_RETRY_MESSAGE =
  'Email verification did not finish. Return to Email Settings or Identities and request a new verification code to try again.';

/** Code entry proves inbox ownership before the separate account-linking check. */
export const EMAIL_VERIFICATION_CODE_INSTRUCTIONS = 'Enter it to confirm you own this address. We’ll then check whether it can be linked to your account.';

/** Enumeration-safe response shared by accepted and already-linked send-code requests. */
export const EMAIL_VERIFICATION_SENT_MESSAGE = `Check your email for a 6-digit verification code. ${EMAIL_VERIFICATION_CODE_INSTRUCTIONS}`;

/** Resends allowed on the code step before Resend is replaced by a Contact support action. */
export const EMAIL_RESEND_SUPPORT_THRESHOLD = 1;

/** Digits in an email verification code. */
export const EMAIL_VERIFICATION_CODE_LENGTH = 6;

/** Heading for the initial code-step guidance, neutral about delivery and linked-account status. */
export const EMAIL_CODE_NOT_RECEIVED_TITLE = 'No code yet?';

/** Standalone code-step hint shown alongside a secondary Contact support action. */
export const EMAIL_CODE_NOT_RECEIVED_HINT = 'Check the email address above and your spam or junk folder.';

/** Heading for the support-first state after the allowed successful resend. */
export const EMAIL_RESEND_SUPPORT_TITLE = 'Still waiting for your code?';

/** Escalation guidance that makes no delivery-time promise and preserves late-code entry. */
export const EMAIL_RESEND_SUPPORT_MESSAGE = "If it hasn't arrived, contact support for help. You can still enter the code here if it arrives later.";

/** Retryable, non-identifying error shown when a resend request fails. */
export const EMAIL_RESEND_FAILED_MESSAGE = "We couldn't request another code. Please try again.";

/** Generic error code for wrong, expired or otherwise failed OTP verification (not outages or proven conflicts). */
export const EMAIL_VERIFICATION_FAILED_ERROR = 'verification_failed';

/** Non-identifying guidance for wrong, expired or otherwise failed OTP verification; proven conflicts use EMAIL_ALREADY_LINKED_MESSAGE. */
export const EMAIL_VERIFICATION_FAILED_MESSAGE = 'Verification failed. Please try again or request a new code.';

/** Minimum upstream-to-response duration for send-code replies and non-outage OTP failures. */
export const EMAIL_VERIFICATION_MIN_RESPONSE_MS = 1500;

/** Send-code rate-limit window shared by the per-user and per-target limiters. */
export const EMAIL_SEND_CODE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Requests one user may make per window, per pod. */
export const EMAIL_SEND_CODE_USER_RATE_LIMIT_MAX = 120;

/** Requests one normalized email address may receive per window, per pod. */
export const EMAIL_SEND_CODE_TARGET_RATE_LIMIT_MAX = 20;

/**
 * Path/fragment vocabulary for the Flow C `returnTo` contract and the Settings page's TOC
 * deep-link sections. Shared across the BFF allowlist (profile.controller.ts), the legacy-page
 * redirects (profile.routes.ts), and AccountSettingsComponent's section ids so a rename can't
 * silently desync the redirect target from the deep link it's supposed to land on.
 */
export const PROFILE_SETTINGS_PATH = '/profile/settings';
export const PROFILE_EMAIL_PATH = '/profile/email';
export const PROFILE_EMAILS_PATH = '/profile/emails';
export const PROFILE_PASSWORD_PATH = '/profile/password';
export const PROFILE_DEVELOPER_SETTINGS_PATH = '/profile/developer-settings';

/**
 * AccountSettingsComponent's TOC section ids, doubling as the DOM element ids the deep-link
 * fragment scrolls to. See the note on the path constants above.
 */
export const ACCOUNT_SETTINGS_SECTIONS = {
  EMAIL_SETTINGS: 'email-settings',
  PASSWORD: 'password',
  DEVELOPER_SETTINGS: 'developer-settings',
} as const;

/** Items a profile section grid shows before "View all (N)": nine pills, or six group cards (#6067). */
export const PROFILE_GRID_LIMIT = 9;
export const PROFILE_GROUP_GRID_LIMIT = 6;

/** Copy of the Profile page hero, behind the profile redesign flag (#6082). */
export const PROFILE_PAGE_COPY = {
  addTitle: 'Add job title and company',
  noBio: 'No bio yet. A few lines about what you work on and care about help others know who you are.',
  addBio: 'Add bio',
  uploadPhoto: 'Upload photo',
  uploadNewPhoto: 'Upload new photo',
  githubLabel: 'GitHub: ',
  githubTooltip: 'GitHub · ',
  memberSince: 'Member since: ',
  loadFailed: 'We couldn’t load your profile.',
  retry: 'Try again',
} as const;

/** Copy of the Profile page's openprofile card and links (#6083). */
export const PROFILE_ASIDE_COPY = {
  privateTitle: 'Show the world what you build',
  privateText: 'Turn on your public profile to showcase your contributions, badges and leadership roles with one link you can share anywhere.',
  makePublic: 'Make my profile public',
  publicTitle: 'Your profile is public',
  publicText: 'Anyone with the link can see your contributions, badges and roles. Choose what is shown in Profile settings.',
  viewPublic: 'View my public profile',
  settings: 'Open Profile settings',
  editProfile: 'Edit profile',
  manageIdentities: 'Manage identities',
  manageAffiliations: 'Manage affiliations',
  publicStatus: 'Public',
  privateStatus: 'Private',
} as const;

/** Base path of the Account & Settings area that replaces the Profile & Account hub's tabs (#6067). */
export const ACCOUNT_BASE_PATH = '/account';
/** Account & Settings pages that start Flow C from their own address, so the server accepts them as a return path. */
export const ACCOUNT_IDENTITIES_PATH = '/account/identities';
export const ACCOUNT_LINUX_EMAIL_PATH = '/account/linux-email';
export const ACCOUNT_PERSONAL_INFORMATION_PATH = '/account/personal-information';
/** Account & Settings › Work history & Affiliations, which the Profile page links to (#6083). */
export const ACCOUNT_WORK_HISTORY_PATH = '/account/work-history';

/** Copy for the Account & Settings Personal information page (#6072). */
export const PERSONAL_INFORMATION_COPY = {
  infoSubtitle:
    'A complete profile helps community members identify and connect with you, enables event organizers to plan in-person meetups, and ensures you receive contributor recognition.',
  photoHint: 'PNG, JPEG, or WEBP. Max 2MB.',
  companyHelp: 'Companies in this list come from your work history. Add one there to choose a new company. A company you saved before may still appear.',
  emailSubtitle: 'The address we send notifications, meeting invites and account messages to. You can choose any verified email on your account.',
  phoneHint: 'Optional. Only used for urgent event notifications and swag delivery.',
  tshirtSubtitle: 'We use it to send you swag, like the t-shirts given to speakers, maintainers and event attendees.',
  saved: 'Personal information updated',
} as const;

/** Copy for the Account & Settings Identities page and its dialogs (#6074). */
export const ACCOUNT_IDENTITIES_COPY = {
  subtitle: 'Manage the accounts used to identify you and attribute contributions.',
  unverifiedNote: 'You have unverified identities connected to your profile. Please verify them to validate your project affiliations and work history.',
  emptyText:
    'No connected accounts were found for your profile. Link GitHub, LinkedIn, Google or an email address so your contributions are attributed to you.',
  primaryEmailRemoveReason: 'This email is your primary email and receives meeting invitations. Choose a different one in Email settings before removing it.',
  addSubtitle:
    'Identities are used to attribute contributions and participation across projects. Adding verified identities helps ensure accurate project affiliations.',
  emailProviderDescription: 'Add and verify an email address you use for open source work',
} as const;

/** Copy of Account & Settings › Developer settings (#6081). */
export const ACCOUNT_DEVELOPER_SETTINGS_COPY = {
  guidelinesTitle: 'Security Guidelines',
  guidelines: [
    'This token is short-lived and automatically regenerated by the system.',
    'Never share it publicly. Keep this token secure.',
    'Never commit this token to version control.',
  ],
  /** The guidelines once LFX Insights API tokens are on, which covers both kinds of token. */
  guidelinesInsights: [
    'The Personal Access Token is short-lived and automatically regenerated by the system.',
    'Never share a token publicly. Keep it secure.',
    'Never commit a token to version control.',
    'Give each integration its own LFX Insights API token, so you can revoke one without affecting the others.',
  ],
  apiTokenTitle: 'API Token',
  apiTokenSubtitle: 'Your API tokens provide programmatic access to LFX services.',
  apiTokenSubtitleSingle: 'Your API token provides programmatic access to LFX services.',
  patLabel: 'Personal Access Token',
  showToken: 'Show token',
  hideToken: 'Hide token',
  copyToken: 'Copy token',
  copied: 'Copied',
  insightsTitle: 'LFX Insights API Tokens',
  emptyTitle: 'No LFX Insights API tokens yet',
  emptyText: 'Create a token to pull project health and contribution data into your own dashboards, reports and tools.',
  createTitle: 'New LFX Insights API token',
  namePlaceholder: 'e.g. Quarterly report',
  nameHint: 'Name it after the script or tool that will use it.',
  createdWarning: 'Copy this token now. You won’t be able to see it again.',
  revokeTitle: 'Revoke token?',
  revokeTextBefore: 'Anything using',
  // Not "immediately" as designed: the Worker caches an exchanged token for up to 10 minutes (insights-tokens.md).
  revokeTextAfter: 'will lose access to the LFX Insights API within 10 minutes. This action can’t be undone.',
  revokeConfirm: 'Revoke token',
} as const;

/** Copy of Account & Settings › Password (#6080). */
export const ACCOUNT_PASSWORD_COPY = {
  changeTitle: 'Change Password',
  changeSubtitle: 'Keep your account secure by using a strong password and enabling two-factor authentication.',
  recoveryTitle: 'Account Recovery',
  recoverySubtitle: 'Can’t remember your password? We’ll email a link to your primary address so you can set a new one.',
  resetSentSummary: 'Password reset link sent to {email}',
  resetSentDetail: 'Check your inbox and follow the link to set a new password.',
  resetSentFallbackEmail: 'your primary email',
  twoFactorTitle: 'Two-Factor Authentication',
  twoFactorSubtitle:
    'Add a second step when you sign in, like a code from an authenticator app, to keep your account secure even if your password is compromised.',
  twoFactorUnavailable: 'Two-factor authentication settings are currently unavailable.',
  requirementsTitle: 'Requirements (must meet at least 3 of 4 criteria):',
  mismatch: 'Passwords do not match',
} as const;

/** The strength badge's tone for each strength on Account & Settings › Password (#6080). */
export const ACCOUNT_PASSWORD_STRENGTH_TONES: Record<PasswordStrength['label'], UiBadgeTone> = {
  weak: 'danger',
  fair: 'warning',
  good: 'warning',
  strong: 'success',
};

/** Copy of Account & Settings › Email settings (#6079). The add and code steps keep the hub's copy. */
export const ACCOUNT_EMAIL_SETTINGS_COPY = {
  heading: 'Email Addresses',
  subtitle: 'Manage your email addresses. All email addresses are verified before they can be used.',
  primaryHint: 'Used for account communications',
  deletePrimaryReason: 'You can’t delete your primary email.',
  deleteInviteReason: 'This email is set for meeting invitations.',
  deleteTitle: 'Delete email address?',
  deleteText: 'will be removed from your account. Activity linked to it may no longer be attributed to you. This action can’t be undone.',
  deleteConfirm: 'Delete email address',
} as const;

/** Copy for the Account & Settings Linux.com email page (#6075). `{domain}` is the alias domain the server reports. */
export const ACCOUNT_LINUX_EMAIL_COPY = {
  subtitle: 'A personal @{domain} address that forwards to an inbox you choose. It’s a one-time add-on for Individual Supporters.',
  claimNote: 'Your add-on is active. Pick your alias and where its email should go. You can’t change the alias later.',
  aliasHint: 'Your alias can’t be changed after it’s claimed.',
  forwardHint: 'Email sent to your alias is forwarded here.',
  emptyTitle: 'Get your own Linux.com email',
  emptyText:
    'Show your support for Linux and open source with a personal @{domain} address that forwards to any inbox. It’s a one-time purchase for Individual Supporters.',
  noVerifiedEmail: 'You don’t have a verified email address to forward to yet. Add and verify an email address first, then return here to set up forwarding.',
} as const;

/** Length limits of the Personal information fields; the server rejects longer values. */
export const PERSONAL_INFORMATION_FIELD_LIMITS = {
  given_name: 50,
  family_name: 50,
  organization: 200,
  job_title: 100,
  country: 50,
  state_province: 50,
  city: 50,
  postal_code: 20,
  address: 200,
  phone_number: 20,
} as const;

export const ACCOUNT_SETTINGS_TITLE = 'Account & Settings';
export const ACCOUNT_DISCARD_CHANGES_TITLE = 'Discard unsaved changes?';
export const ACCOUNT_DISCARD_CHANGES_MESSAGE = "You've made changes that haven't been saved. If you leave now, they'll be lost.";
export const ACCOUNT_CHANGES_REVERTED_MESSAGE = 'Changes reverted';
export const ACCOUNT_SETTINGS_DESCRIPTION = 'Manage your work history, linked identities, agreements, billing and sign-in.';

/** The Account & Settings pages in nav order; the landing page reads the same list. */
export const ACCOUNT_SETTINGS_NAV: AccountSettingsNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    items: [
      {
        route: 'personal-information',
        label: 'Personal information',
        icon: 'fa-light fa-id-card',
        blurb: 'Your name, bio, job title, contact email and location.',
      },
      {
        route: 'work-history',
        label: 'Work history & Affiliations',
        icon: 'fa-light fa-briefcase',
        blurb: 'Your employment history and the company credited for each project you contribute to.',
      },
      { route: 'identities', label: 'Identities', icon: 'fa-light fa-fingerprint', blurb: 'GitHub, GitLab, social and email identities linked to your work.' },
      { route: 'linux-email', label: 'Linux.com email', icon: 'fa-light fa-at', blurb: 'Your personal @linux.com alias and where its email is forwarded.' },
      {
        route: 'individual-enrollment',
        label: 'Individual Enrollment',
        icon: 'fa-light fa-heart',
        blurb: 'Your Linux Foundation Individual Supporter membership and auto-renew.',
      },
      { route: 'clas', label: 'CLAs', icon: 'fa-light fa-file-signature', blurb: 'Individual CLAs you signed and corporate CLAs that cover you.' },
      { route: 'transactions', label: 'Transactions', icon: 'fa-light fa-receipt', blurb: 'Receipts for memberships, certifications and event registrations.' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      {
        route: 'email-settings',
        label: 'Email settings',
        icon: 'fa-light fa-envelope',
        blurb: 'Addresses on your account and which one receives notifications.',
      },
      { route: 'password', label: 'Password', icon: 'fa-light fa-lock', blurb: 'Change your password and set up two-factor authentication.' },
      { route: 'developer-settings', label: 'Developer settings', icon: 'fa-light fa-code', blurb: 'Personal API tokens for scripts and integrations.' },
    ],
  },
];

/**
 * Where each old Profile & Account tab lives under `/account` once the redesign flag is on. Settings is keyed by
 * its section fragment, since the old Settings tab held all three pages.
 */
export const PROFILE_TAB_ACCOUNT_ROUTES: Readonly<Record<string, string>> = {
  identities: 'identities',
  'linux-email': 'linux-email',
  'individual-enrollment': 'individual-enrollment',
  clas: 'clas',
  transactions: 'transactions',
  settings: 'email-settings',
  'settings#email-settings': 'email-settings',
  'settings#password': 'password',
  'settings#developer-settings': 'developer-settings',
  // The Account Recovery card sits in the Password section.
  'settings#account-recovery': 'password',
};

/** The Profile & Account hub page each `/account` page falls back to while the redesign flag is off. */
export const ACCOUNT_ROUTE_PROFILE_TARGETS: Readonly<Record<string, AccountSettingsTarget>> = {
  'personal-information': { path: '/profile' },
  'work-history': { path: '/profile/attributions' },
  identities: { path: '/profile/identities' },
  'linux-email': { path: '/profile/linux-email' },
  'individual-enrollment': { path: '/profile/individual-enrollment' },
  clas: { path: '/profile/clas' },
  transactions: { path: '/profile/transactions' },
  'email-settings': { path: PROFILE_SETTINGS_PATH, fragment: ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS },
  password: { path: PROFILE_SETTINGS_PATH, fragment: ACCOUNT_SETTINGS_SECTIONS.PASSWORD },
  'developer-settings': { path: PROFILE_SETTINGS_PATH, fragment: ACCOUNT_SETTINGS_SECTIONS.DEVELOPER_SETTINGS },
};

/**
 * Error codes from the Flow C profile-auth (`/passwordless/callback`) round trip,
 * owned by ProfileAuthReturnService — the Profile & Account hub and Account & Settings
 * each provide it, so it handles these once on whichever page the flow returns to. `invalid_state`
 * and `no_code` are also emitted by the identity-link callback below, but their
 * wording is flow-agnostic and ProfileIdentitiesComponent's own hasOwn guard on
 * this map already skips them, so keeping them here (rather than duplicated in
 * both maps) is safe against a double toast. `impersonation_read_only` is the same
 * kind of shared code: it's also emitted by `/social/callback`, but the message is
 * identical regardless of which flow blocked it, so one entry here covers both.
 */
export const PROFILE_AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  profile_auth_not_configured: 'Authorization is not available right now. Please try again later.',
  profile_auth_failed: 'Authorization failed. Please try again.',
  token_exchange_failed: 'Authorization failed. Please try again.',
  login_session_invalid: 'Your session has expired. Please sign in again.',
  user_mismatch: 'You authorized a different account. Please sign in as yourself and try again.',
  invalid_state: 'Security validation failed. Please try again.',
  no_code: 'Authorization did not complete. Please try again.',
  impersonation_read_only: 'This action is not available while impersonating a user.',
};

/**
 * Error codes from the identity-link (social auth) callback, owned by
 * ProfileIdentitiesComponent. `invalid_state` / `no_code` live in
 * PROFILE_AUTH_ERROR_MESSAGES above instead — see the note there.
 */
export const IDENTITY_LINK_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  social_auth_failed: 'Social authentication failed. Please try again.',
  link_failed: 'Failed to link identity. Please try again.',
  social_verification_failed: 'Identity verification failed. Please try again.',
  invalid_provider: 'Invalid identity provider specified.',
  no_management_token: 'Authorization expired. Please try again.',
  no_identity_token: 'No identity token received. Please try again.',
};
