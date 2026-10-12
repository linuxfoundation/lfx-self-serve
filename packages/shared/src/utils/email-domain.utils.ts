// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getDomain } from 'tldts';

import { MULTI_TENANT_MAIL_PARENT_DOMAINS, PERSONAL_EMAIL_PROVIDER_LABELS } from '../constants/newsletter-member-benefit.constants';

/** Lowercase LDH labels separated by dots, at least two labels — the only shape a domain may take in a query-service filter. */
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalizes a stored or typed domain for exact comparison: trims, lowercases, drops a URL scheme,
 * path, port, trailing dot and leading `www.`. Returns null for anything that is not a plausible
 * multi-label domain, so a malformed value can never match or reach a query filter.
 */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let domain = value.trim().toLowerCase();
  if (!domain) return null;
  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  domain = domain.split(/[/?#]/, 1)[0];
  domain = domain.replace(/:\d+$/, '').replace(/\.$/, '');
  if (domain.startsWith('www.')) domain = domain.slice(4);
  return DOMAIN_PATTERN.test(domain) ? domain : null;
}

/** The normalized domain part of an email address, or null when the address has no usable domain. */
export function emailDomain(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return normalizeDomain(email.slice(at + 1));
}

/**
 * The registrable domain (the part one organization owns) of a normalized domain, from the Public
 * Suffix List including its private section (`eng.acme.co.uk` → `acme.co.uk`). Under a multi-tenant
 * mail host the tenant is the owner (`support.acme.zendesk.com` → `acme.zendesk.com`), so a tenant
 * address never stands in for the host company. Null when the domain is itself a public suffix.
 */
export function registrableDomain(domain: string): string | null {
  for (const parent of MULTI_TENANT_MAIL_PARENT_DOMAINS) {
    if (domain.endsWith(`.${parent}`)) {
      const tenantLabel = domain
        .slice(0, -(parent.length + 1))
        .split('.')
        .pop();
      return `${tenantLabel}.${parent}`;
    }
  }
  return getDomain(domain, { allowPrivateDomains: true });
}

/** True when the domain belongs to a personal mailbox provider (`gmail.com`, `outlook.jp`, `yahoo.co.in`, …). */
export function isPersonalEmailDomain(domain: string): boolean {
  const registrable = registrableDomain(domain);
  return !!registrable && PERSONAL_EMAIL_PROVIDER_LABELS.has(registrable.split('.')[0]);
}

/**
 * Domains a member company may have recorded for this address's domain: the domain itself, then
 * each parent down to (and including) the registrable domain — `eng.acme.com` → `[eng.acme.com,
 * acme.com]`. Never walks up to a public suffix (`co.uk`, `com.vn`) or out of a multi-tenant tenant
 * (`acme.atlassian.net` never yields `atlassian.net`), so a parent only matches a company that
 * registered that exact domain and controls every mailbox under it.
 */
export function candidateMemberDomains(domain: string): string[] {
  const registrable = registrableDomain(domain);
  if (!registrable) return [];
  const candidates: string[] = [];
  let current = domain;
  while (current.length >= registrable.length) {
    candidates.push(current);
    if (current === registrable) break;
    current = current.slice(current.indexOf('.') + 1);
  }
  return candidates;
}
