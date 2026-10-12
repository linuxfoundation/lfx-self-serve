// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Registrable-domain labels of personal (consumer) mailbox providers. An address whose registrable
 * domain starts with one of these labels never qualifies for the member benefit, even if a member
 * company lists that domain — label-based so regional variants match too (`outlook.jp`,
 * `yahoo.co.in`, `gmx.de`). Mirrors lf-dbt `consumer_freemail_labels()`
 * (`macros/company_email_domains.sql`).
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
 * Two-label public suffixes under which the registrable domain is the last THREE labels
 * (`acme.co.uk`, not `co.uk`). Used to stop the parent-domain walk before a bare public suffix and
 * to find the provider label of addresses like `name@yahoo.co.in`.
 */
export const MULTI_PART_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'org.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'co.kr',
  'or.kr',
  'co.in',
  'net.in',
  'org.in',
  'co.za',
  'org.za',
  'co.il',
  'org.il',
  'com.br',
  'net.br',
  'org.br',
  'com.cn',
  'net.cn',
  'org.cn',
  'com.hk',
  'com.tw',
  'com.sg',
  'com.my',
  'com.mx',
  'com.ar',
  'com.tr',
  'com.pl',
  'co.id',
  'co.th',
]);

/** 404 code the reader endpoint returns for an unsent (draft/scheduled) issue opened by a non-manager — the page shows its draft notice. */
export const NEWSLETTER_NOT_SENT_ERROR_CODE = 'NEWSLETTER_NOT_SENT';

/** Linux Foundation (TLF) project slug whose corporate memberships make a company's employees eligible. */
export const MEMBER_BENEFIT_FOUNDATION_SLUG = 'tlf';

/** `project_membership.status` values (compared case-insensitively) that count as an active membership. */
export const MEMBER_BENEFIT_ACTIVE_MEMBERSHIP_STATUSES: ReadonlySet<string> = new Set(['active', 'purchased']);

/** In-process TTL of the TLF member domain index (memberships change on a days-long cadence). */
export const MEMBER_BENEFIT_DOMAIN_INDEX_TTL_MS = 10 * 60 * 1000;

/** Upper bound on member-benefit candidate domains checked per user (several verified emails × parent domains). */
export const MEMBER_BENEFIT_MAX_CANDIDATE_DOMAINS = 20;

/** `project_membership.status` filters sent to query-service (exact, case-sensitive); responses are re-filtered case-insensitively. */
export const MEMBER_BENEFIT_ACTIVE_STATUS_FILTERS: readonly string[] = ['status:Active', 'status:Purchased', 'status:active', 'status:purchased'];

/** Most b2b_org rows read for one domain check — a handful of companies can share an alias. */
export const MEMBER_BENEFIT_B2B_ORG_MAX_RESULTS = 200;

/** Email shapes safe to interpolate into an `email:<value>` query-service filter. */
export const MEMBER_BENEFIT_FILTER_SAFE_EMAIL = /^[^\s:,@]+@[a-z0-9.-]+$/;
