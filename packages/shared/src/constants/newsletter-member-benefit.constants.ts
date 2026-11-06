// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOOTER_LEGAL_LINKS } from './footer.constants';

/**
 * Registrable-domain labels of personal (consumer) mailbox providers. An address whose registrable
 * domain starts with one of these labels never qualifies for the member benefit, even if a member
 * company lists that domain — label-based so regional variants match too (`outlook.jp`,
 * `yahoo.co.in`, `gmx.de`). Mirrors lf-dbt `consumer_freemail_labels()`
 * (`macros/company_email_domains.sql`).
 *
 * Deliberate trade-off: matching on the label is coarse, so a member company whose own registrable
 * domain starts with a generic label here (e.g. `mail.*`, `inbox.*`, `zoho.com`) is treated as
 * personal and its employees are denied. That fails closed — it never grants access — and keeps
 * parity with the data team's definition; add an explicit override only when a real member hits it.
 */
export const PERSONAL_EMAIL_PROVIDER_LABELS: ReadonlySet<string> = new Set([
  'outlook',
  'live',
  'hotmail',
  'msn',
  'gmail',
  'googlemail',
  'yahoo',
  'ymail',
  'rocketmail',
  'icloud',
  'me',
  'mac',
  'proton',
  'protonmail',
  'gmx',
  'yandex',
  'mail',
  'inbox',
  'qq',
  '163',
  '126',
  'sina',
  'foxmail',
  'aol',
  'zoho',
  'fastmail',
  'tutanota',
]);

/**
 * Hosts whose subdomains belong to different customers and can receive mail (help desks, hosted
 * tenants). A tenant (`acme.zendesk.com`) is treated as its own registrable domain, so an address
 * there can never qualify through the host company's own domain (`zendesk.com`). The Public Suffix
 * List's private section does not list these.
 */
export const MULTI_TENANT_MAIL_PARENT_DOMAINS: ReadonlySet<string> = new Set([
  'onmicrosoft.com',
  'atlassian.net',
  'zendesk.com',
  'freshdesk.com',
  'service-now.com',
  'my.salesforce.com',
  'force.com',
  'helpscoutapp.com',
  'groups.io',
  'googlegroups.com',
]);

/** 404 code the reader endpoint returns for an unsent (draft/scheduled) issue opened by a non-manager — the page shows its draft notice. */
export const NEWSLETTER_NOT_SENT_ERROR_CODE = 'NEWSLETTER_NOT_SENT';

/** 403 code of a write refused because the caller is impersonating (BFF `blockDuringImpersonation`). */
export const IMPERSONATION_READ_ONLY_ERROR_CODE = 'IMPERSONATION_READ_ONLY';

/** Linux Foundation (TLF) project slug whose corporate memberships make a company's employees eligible. */
export const MEMBER_BENEFIT_FOUNDATION_SLUG = 'tlf';

/** Display name of {@link MEMBER_BENEFIT_FOUNDATION_SLUG}, used when a newsletter falls back to TLF membership. */
export const MEMBER_BENEFIT_FOUNDATION_NAME = 'The Linux Foundation';

/** `project.funding_model` entry marking a project whose companies join as members (it has its own roster). */
export const MEMBER_BENEFIT_MEMBERSHIP_FUNDING_MODEL = 'Membership';

/** `project.legal_entity_type` of internal LF cost centres — never a membership roster of their own. */
export const MEMBER_BENEFIT_INTERNAL_ALLOCATION_ENTITY_TYPE = 'Internal Allocation';

/** `project_membership.status` values (compared case-insensitively) that count as an active membership. */
export const MEMBER_BENEFIT_ACTIVE_MEMBERSHIP_STATUSES: ReadonlySet<string> = new Set(['active', 'purchased']);

/** In-process TTL of the TLF member domain index (memberships change on a days-long cadence). */
export const MEMBER_BENEFIT_DOMAIN_INDEX_TTL_MS = 10 * 60 * 1000;

/** Upper bound on member-benefit candidate domains checked per user (several verified emails × parent domains). */
export const MEMBER_BENEFIT_MAX_CANDIDATE_DOMAINS = 20;

/**
 * `project_membership.status` filters sent to query-service, derived from the active statuses in
 * both the stored (`Active`) and lowercase casing — matching is exact and case-sensitive upstream;
 * responses are re-filtered case-insensitively.
 */
export const MEMBER_BENEFIT_ACTIVE_STATUS_FILTERS: readonly string[] = [...MEMBER_BENEFIT_ACTIVE_MEMBERSHIP_STATUSES].flatMap((status) => [
  `status:${status.charAt(0).toUpperCase()}${status.slice(1)}`,
  `status:${status}`,
]);

/** Most b2b_org rows read for one domain check — a handful of companies can share an alias. */
export const MEMBER_BENEFIT_B2B_ORG_MAX_RESULTS = 200;

/** Email shapes safe to interpolate into an `email:<value>` query-service filter. */
export const MEMBER_BENEFIT_FILTER_SAFE_EMAIL = /^[^\s:,@]+@[a-z0-9.-]+$/;

/** Invites one user may send per window (per pod — see `newsletterInviteRateLimiter`). */
export const NEWSLETTER_INVITE_RATE_LIMIT_MAX = 20;

/** Window of the newsletter invite rate limit. */
export const NEWSLETTER_INVITE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Query param on the My Newsletters foundation drill-down that carries an invite's newsletter group uid. */
export const NEWSLETTER_INVITE_QUERY_PARAM = 'invite';

/**
 * How long the newsletter reader waits after the member-benefit join before re-checking invite
 * eligibility: my-foundations reads memberships from the query-service index, which is updated
 * asynchronously after the committee write.
 */
export const NEWSLETTER_INVITE_RELOOKUP_DELAY_MS = 3000;

/** Link-preview title for a newsletter permalink that has nothing it may show (unknown, unsent, or the lookup failed). */
export const NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE = 'LFX Newsletter';

/**
 * Accepted `:projectSlug` of the public newsletter share-preview endpoint. Deliberately looser than
 * `PROJECT_SLUG_REGEX` (project-service's create-time rule), which slugs created before that rule may
 * not meet; it only bounds the value to one safe NATS lookup key. The lookup needs no token, and a
 * rejected slug merely gets the neutral preview card.
 */
export const NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** 404 code of an invite whose group is not a Newsletter-category group (or no longer exists). */
export const NEWSLETTER_INVITE_INVALID_ERROR_CODE = 'NEWSLETTER_INVITE_INVALID';

/** 403 code of an invite refused because the sender may not invite to that foundation. */
export const NEWSLETTER_INVITE_FORBIDDEN_ERROR_CODE = 'NEWSLETTER_INVITE_FORBIDDEN';

/** 400 code of an invite to a personal mailbox domain. */
export const NEWSLETTER_INVITE_PERSONAL_EMAIL_ERROR_CODE = 'NEWSLETTER_INVITE_PERSONAL_EMAIL';

/** 400 code of an invite to a domain that is not a Linux Foundation member company. */
export const NEWSLETTER_INVITE_NOT_MEMBER_ERROR_CODE = 'NEWSLETTER_INVITE_NOT_MEMBER_COMPANY';

/** 403 code of a member-benefit join refused because the caller is not eligible. */
export const NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE_ERROR_CODE = 'NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE';

/** The same address is emailed an invite to the same newsletter group at most once per window (per pod). */
export const NEWSLETTER_INVITE_RECIPIENT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Longest inviter display name put in an invite email; longer names are cut with an ellipsis. */
export const NEWSLETTER_INVITE_INVITER_NAME_MAX_LENGTH = 64;

/**
 * Shape a newsletter invite recipient must have (after lowercasing): a plain dot-atom address, so the
 * `to` sent to the email service and the `email:` roster filter can only name one ordinary mailbox.
 */
export const NEWSLETTER_INVITE_EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * `res.locals` key the invite controller sets when a failed invite must still spend the sender's
 * rate-limit budget (anything past input-shape checks, e.g. a non-member domain) — so the member
 * domain check cannot be probed for free.
 */
export const NEWSLETTER_INVITE_COUNTED_LOCALS_KEY = 'newsletterInviteCounted';

/** App route a signed-out invitee lands on from a newsletter invite email; the signed token rides in the URL fragment. */
export const NEWSLETTER_GUEST_INVITE_PATH = '/newsletters/invite';

/** Legal pages the signed-out newsletter modal's consent line links to (the app footer is not shown on guest pages). */
export const NEWSLETTER_GUEST_LEGAL_LINKS = {
  privacyPolicy: FOOTER_LEGAL_LINKS.privacyPolicy,
  termsOfUse: 'https://www.linuxfoundation.org/legal/terms',
} as const;

/** Longest plain-text excerpt of an issue a signed-out reader sees behind the guest modal before they qualify. */
export const NEWSLETTER_GUEST_TEASER_MAX_LENGTH = 600;

/** URL-fragment key of the signed newsletter invite token (`/newsletters/invite#token=…`), kept out of server and proxy logs. */
export const NEWSLETTER_INVITE_TOKEN_FRAGMENT_KEY = 'token';

/** How long a signed newsletter invite or subscription-confirmation link stays valid. */
export const NEWSLETTER_INVITE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Longest signed newsletter invite token or guest cookie value the BFF will try to verify. */
export const NEWSLETTER_GUEST_TOKEN_MAX_LENGTH = 1024;

/** Browser-session cookie that lets a signed-out member-company reader see a foundation's newsletter. */
export const NEWSLETTER_GUEST_COOKIE_NAME = 'lfx_newsletter_guest';

/** Path the guest cookie is scoped to — only the public newsletter endpoints ever receive it. */
export const NEWSLETTER_GUEST_COOKIE_PATH = '/public/api/newsletters';

/** Guest newsletter requests (invite checks, email checks) one IP may make per window (per pod). */
export const NEWSLETTER_GUEST_RATE_LIMIT_MAX = 30;

/** Window of the guest newsletter rate limit. */
export const NEWSLETTER_GUEST_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Code of a signed-out reader whose email is not at a member company of the newsletter's foundation: 400 on the shared-link email check, 403 on an invite accept. */
export const NEWSLETTER_GUEST_NOT_ELIGIBLE_ERROR_CODE = 'NEWSLETTER_GUEST_NOT_ELIGIBLE';

/** 404 code of a shared newsletter link a signed-out reader cannot open as a member benefit (unknown, unsent, or sent to no newsletter group). */
export const NEWSLETTER_GUEST_UNAVAILABLE_ERROR_CODE = 'NEWSLETTER_GUEST_UNAVAILABLE';

/** 400 code of an expired or tampered newsletter invite link. */
export const NEWSLETTER_INVITE_EXPIRED_ERROR_CODE = 'NEWSLETTER_INVITE_EXPIRED';

/** How long a signed-out reader's guest session is honoured, whatever the browser does with the session cookie. */
export const NEWSLETTER_GUEST_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** HMAC purpose label of a signed newsletter invite / confirmation link token — keeps a cookie from replaying as a token. */
export const NEWSLETTER_INVITE_TOKEN_PURPOSE = 'newsletter-invite';

/** HMAC purpose label of a signed newsletter guest session cookie. */
export const NEWSLETTER_GUEST_SESSION_PURPOSE = 'newsletter-guest';

/** HKDF info label deriving the newsletter guest signing key from `PCC_AUTH0_SECRET` (never the raw session secret). */
export const NEWSLETTER_GUEST_SIGNING_KEY_INFO = 'lfx-newsletter-guest-v1';

/** 503 code of the guest newsletter endpoints when the signing secret is not configured. */
export const NEWSLETTER_GUEST_SIGNING_UNAVAILABLE_ERROR_CODE = 'NEWSLETTER_GUEST_SIGNING_UNAVAILABLE';
