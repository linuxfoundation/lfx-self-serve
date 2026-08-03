// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Matches any UUID-shaped string (8-4-4-4-12 hex groups). Does NOT enforce
 * the v4 version/variant bits — it is intentionally permissive so callers
 * can recognize any canonical UUID produced by project-service / other LFX
 * microservices, not only v4. Use this to distinguish a project-service UUID
 * from a Salesforce-style ID before handing the value to downstream lookups.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Salesforce Account ID — "001" prefix + 12 (15-char form) or 15 (18-char form) alphanumeric chars. General Salesforce account-id validator (events, analytics). */
export const SALESFORCE_ACCOUNT_ID_PATTERN = /^001[A-Za-z0-9]{12,15}$/;

/** Org account id (b2b_org canonical identifier) — "001" prefix + exactly 15 alphanumeric chars (the canonical 18-char SFID). Spec 002 is a hard cut-over to the 18-char SFID; the non-canonical 15-char form is rejected. Scoped to org-lens identifiers so it does not narrow the shared `SALESFORCE_ACCOUNT_ID_PATTERN` used by events/analytics. */
export const ORG_ACCOUNT_ID_PATTERN = /^001[A-Za-z0-9]{15}$/;

/** Generic Salesforce ID shape (no object-prefix constraint) — exactly 15 (case-sensitive form) or exactly 18 (its case-insensitive checksum-suffixed form) characters, anchored, no other length accepted. Matches the v1 platform's own `sfid.IsValid` gate (any object type: Contact, Lead, Account, custom objects). Unlike `SALESFORCE_ACCOUNT_ID_PATTERN`/`ORG_ACCOUNT_ID_PATTERN`, this doesn't check for a specific 3-char object prefix — use it where the caller only needs to know "is this SFID-shaped at all" (e.g. the LFXV2-1705 committee-member v1-mapping bridge, where the resolved identity could be a Contact SFID or another object type). The exact 15-or-18-character length is what rejects a UUID today, in either of its two forms (a UUID is 32 characters hyphen-free, or 36 with its canonical hyphens — never 15 or 18) — this is the load-bearing constraint `member-v1-mapping.helper.ts`'s `parseMemberMappingResponse` relies on to reject a "poisoned" pre-backfill mapping (LFXV2-2673) without a separate UUID check. Do not widen the length bound without confirming it still excludes both 32 and 36. The `[A-Za-z0-9]`-only character class is a secondary guard that only additionally blocks the *hyphenated* form; it provides no protection for the hex-only (non-hyphenated) form, since hex digits are already alphanumeric. Audit `parseMemberMappingResponse` before widening the length bound. */
export const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;

/**
 * General-purpose SSR path parameter validator — mixed-case alphanumerics + hyphens, length 1-64.
 * Currently used to validate `foundationId` path parameters on the Org Lens membership
 * and Board & Committee SSR endpoints.
 *
 * Allowed values intentionally span three legitimate id shapes the SSR layer sees:
 *   1. Salesforce 18-char custom-object IDs (e.g. "a0941000002wBz2AAE") — the
 *      PRODUCTION foundationId shape, mixed case base32+checksum
 *   2. Synthetic v1 mock IDs (e.g. "sample-foundation") — kebab-case lowercase foundation slug
 *   3. Future UUID v8 shape from `lfx-v2-member-service` (hex + hyphens, 36 chars)
 *
 * Defense-in-depth at the SSR boundary; caps payload size to 64 chars (DoS guard)
 * and rejects everything outside the alphanumeric + hyphen character class
 * (whitespace, punctuation, control bytes, XSS/SQLi probes).
 */
export const FOUNDATION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Basic email-format regex for client-side blur validation (FR-017a).
 *
 * The domain is matched as discrete dot-separated labels (`label(.label)+`)
 * where each label class excludes `.`. This removes the ambiguous overlap a
 * naive `[^@\s]+\.[^@\s]+` pattern has (the `.` is matchable by both sides),
 * which CodeQL flags as a polynomial-ReDoS risk on uncontrolled input. With
 * non-overlapping labels there is exactly one way to match, so it runs linearly.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Org People `person_key` — LFID or opaque `cdp:`-prefixed id; 4–128 URL-safe chars (request-boundary bound, not a schema). */
export const PERSON_KEY_PATTERN = /^(cdp:)?[A-Za-z0-9_-]{4,128}$/;
