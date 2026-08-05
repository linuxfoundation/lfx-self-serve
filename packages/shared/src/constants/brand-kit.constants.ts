// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Brand Kit persistence constants (brand-kit-output/v1) — shared between the
// BFF session-consumer validation gates and tests. Mirrors the normative
// contract in marketing-os-agents docs/contracts/brand-kit-output.md §1/§3.

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const BRAND_KIT_CONTRACT_ID = 'brand-kit-output/v1';

/** Document kind within the contract. */
export const BRAND_KIT_KIND = 'brand-kit';

/** Object key prefix — full key is `brand-kit/{project}/{content_sha256}.md`. */
export const BRAND_KIT_KEY_PREFIX = 'brand-kit';

/** Hard per-object size cap (bytes) per the LFX object-store design (20 MB). */
export const BRAND_KIT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const BRAND_KIT_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercase hex SHA-256 pattern. */
export const BRAND_KIT_SHA256_REGEX = /^[0-9a-f]{64}$/;

/**
 * The 12-heading structural presence gate (contract §1): document_markdown
 * must contain each of these level-2 headings, in order. Matching is
 * "starts with" per heading line, so trailing qualifiers the template allows
 * do not fail the gate.
 */
export const BRAND_KIT_REQUIRED_HEADINGS = [
  '## How to Use This Document',
  '## 1. Project Definition',
  '## 2. Positioning',
  '## 3. Brand Personality & Voice',
  '## 4. Primary Audiences & Messaging',
  '## 5. Key Brand Strengths',
  '## 6. Competitive Differentiation & Guardrails',
  '## 7. Visual Identity',
  '## 8. Tagline Options',
  '## 9. Channel Quick Reference',
  '## Appendix A: Document Architecture',
  '## Appendix B: Source Intake',
] as const;

/** Exact number of intake answers the contract requires. */
export const BRAND_KIT_INTAKE_ANSWER_COUNT = 7;

/** Minimum document length (chars) per the contract schema. */
export const BRAND_KIT_MIN_DOCUMENT_LENGTH = 1000;

/** ISO-8601 timestamp shape gate: date + time part required; offset/Z optional (shape gate, not a UTC enforcer). */
export const BRAND_KIT_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/** Max recursion depth when scanning event payloads for envelope candidates. */
export const BRAND_KIT_EXTRACTION_MAX_DEPTH = 16;
