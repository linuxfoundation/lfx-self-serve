// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Brand Kit contract constants (brand-kit-output/v1) — shared between the
// BFF session-consumer validation gates, the intake form UI, and tests. Mirrors the normative
// contract in marketing-os-agents docs/contracts/brand-kit-output.md §1/§3.

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const BRAND_KIT_CONTRACT_ID = 'brand-kit-output/v1';

/** Document kind within the contract. */
export const BRAND_KIT_KIND = 'brand-kit';

/** Key-prefix namespace for Brand Kit objects in the shared marketing artifacts bucket (dec-brand-kit-storage-v2). */
export const BRAND_KIT_KEY_PREFIX = 'brand-kit';

/** Hard per-object size cap (bytes) per the LFX object-store design (20 MB). */
export const BRAND_KIT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const BRAND_KIT_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Shape gate for the storage partition segment of `brand-kit/{project}/…`.
 *
 * The partition is the SERVER-RESOLVED LFX project uid that owns the document
 * — never the agent envelope's own slug (which is derived from a free-text
 * project name and identifies nothing in LFX). Deliberately wider than
 * {@link BRAND_KIT_PROJECT_SLUG_REGEX} because LFX uids are opaque upstream
 * identifiers, but still exactly one safe key segment: no separators, no
 * dots, so no traversal.
 */
export const BRAND_KIT_PROJECT_PARTITION_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

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

/**
 * Batch-mode preamble lines of the form-mode first message
 * (dec-brand-kit-intake-form) — the exact wording the agent's MODE RULES key
 * on to skip the conversational intake and draft directly. Single source for
 * `renderBrandKitFormMessage` and the run-page intake registry
 * (`BRAND_KIT_INTAKE.batchPreamble`) so the two copies can never drift.
 */
export const BRAND_KIT_FORM_PREAMBLE_LINES = [
  'BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).',
  'All seven intake answers were collected on a single LFX form and are',
  'provided below, in the same order as your Step 1 questions. Do NOT ask',
  'the intake questions; proceed directly to Step 2.',
] as const;

/**
 * Paul's 7 intake questions, VERBATIM (dec-paul-prompt-fidelity) — the same
 * strings the agent's finalize wrapper stamps into the envelope intake log.
 * Rendered as the LFX one-page form (dec-brand-kit-intake-form); keys match
 * the agent's brand_kit_intake_form input schema field names.
 */
export const BRAND_KIT_INTAKE_QUESTIONS = [
  { questionNumber: 1, key: 'project_name', question: "What's the name of the LF project?" },
  { questionNumber: 2, key: 'github_url', question: "What's the URL of the project's GitHub repo or README?" },
  { questionNumber: 3, key: 'one_line_description', question: 'One-line description — what does it do, beyond the name?' },
  {
    questionNumber: 4,
    key: 'primary_audience',
    question: 'Primary audience — who does this brand need to speak to? (e.g., AI/ML platform engineers, enterprise buyers, agent-framework contributors)',
  },
  { questionNumber: 5, key: 'voice_adjectives', question: 'Three adjectives for the voice you want?' },
  {
    questionNumber: 6,
    key: 'constraints',
    question: 'Any constraints — colors/marks to avoid, an existing LF-family look to stay consistent with, trademark concerns?',
  },
  {
    questionNumber: 7,
    key: 'reference_brands',
    question: 'One to three reference brands or projects — ones they admire, or want to differentiate from?',
  },
] as const;
