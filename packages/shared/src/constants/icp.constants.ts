// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ICP & Target Markets contract constants (icp-output/v1) — shared between the
// BFF session-consumer validation gates, the intake form UI, and tests.
// Mirrors the normative contract and intake wording in marketing-os-agents
// agents/icp-ts (src/envelope.ts, src/form.ts, src/questions.ts).
//
// The per-agent duplication of the shape gates below (slug / sha256 / ISO
// timestamp / project uid) is deliberate and matches the brand-kit and
// foundation-message precedents: each agent contract pins its own gates, so a
// contract revision in one agent can never silently loosen another's.

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const ICP_CONTRACT_ID = 'icp-output/v1';

/** Document kind within the contract. */
export const ICP_KIND = 'icp';

/** Batch payload discriminator of the agent's form-mode input contract. */
export const ICP_FORM_TYPE = 'icp_intake_form';

/** Key-prefix namespace for ICP objects in the shared marketing artifacts bucket (dec-brand-kit-storage-v2). */
export const ICP_KEY_PREFIX = 'icp';

/** Hard per-object size cap (bytes) per the LFX object-store design (20 MB). */
export const ICP_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Paul's fixed-wording interview questions — QUOTED VERBATIM from the agent's
// src/questions.ts (dec-paul-prompt-fidelity). Never paraphrased.
// ---------------------------------------------------------------------------

/** Q1a — project name (verbatim). */
export const ICP_Q_PROJECT_NAME = "What's the name of the LF project?";

/** Q1b — GitHub / README URL (verbatim). */
export const ICP_Q_GITHUB_URL = "What's the URL of the project's GitHub repo or README?";

/**
 * Q1c — Brand Kit and Message Foundation document (verbatim). Rendered ONLY
 * inside the agent-facing batch message (`renderIcpFormText`), never in the
 * LFX UI: the form auto-attaches whichever sibling documents the project has
 * stored instead of asking for them (dec-agent-dependency-gating), and ICP
 * consumes both OPTIONALLY — Paul explicitly allows proceeding without them.
 */
export const ICP_Q_SIBLING_DOCS = 'Do you already have a `[Project Name] Brand Kit` and/or Message Foundation document, and if so, where are they?';

/**
 * Q1d.1–1d.5 (verbatim) — Paul's gap-filling questions in his stated priority
 * order. Keys match the agent's batch form schema field names, aligned 1:1
 * with the question order. `business_outcome` is Paul's never-skip question
 * and is the only required one (agent form contract, src/form.ts).
 */
export const ICP_GAP_FILL_QUESTIONS = [
  {
    key: 'business_outcome',
    question:
      'What business outcome should this ICP be optimized toward right now — membership growth, event attendance, training/certification enrollment, demand-gen pipeline, or some mix?',
  },
  { key: 'competitive_landscape', question: 'Who do ICP-fit organizations typically evaluate against or migrate from?' },
  {
    key: 'disqualifiers',
    question: "Who is clearly NOT a good fit — any org profile, use case, or situation you'd want this ICP to explicitly screen out?",
  },
  { key: 'trigger_events', question: 'What typically triggers an org or team to start evaluating/adopting this project right now?' },
  { key: 'known_member_orgs', question: 'Any known member organizations or contributor companies already in the ecosystem, to seed firmographics?' },
] as const;

/** Gap-fill answer keys, in Paul's priority order. */
export const ICP_GAP_FILL_KEYS = ICP_GAP_FILL_QUESTIONS.map((entry) => entry.key);

/** The one gap-fill answer the agent's form contract requires (Paul marks 1d.1 never-skip). */
export const ICP_REQUIRED_GAP_FILL_KEY = 'business_outcome';

// ---------------------------------------------------------------------------
// Output contract gates (icp-output/v1)
// ---------------------------------------------------------------------------

/**
 * Structural presence gate S1 (contract §1): Paul's template skeleton, as
 * level-2 headings. Matching is heading-prefix per line with a qualifier
 * boundary, mirroring the agent's own `missingHeadings` gate (e.g.
 * "## 2. ICP Definitions (Organization-Level)" passes).
 */
export const ICP_REQUIRED_HEADINGS = [
  '## Cover',
  '## How to Use This Document',
  '## 1. Market Segment Overview',
  '## 2. ICP Definitions',
  '## 3. Persona Definitions',
  '## 4. Fit & Warmth Scoring Inputs',
  '## 5. Messaging & Content Handoff',
  '## 6. Validation & Review',
  '## Appendix A: Document Architecture',
  '## Appendix B: Source Intake',
] as const;

/**
 * The four level-3 subsections Paul's template specifies inside section 1.
 * Section 1.4 is present in BOTH paths: with no live member data the template
 * requires the subsection to stay and carry "TBD — needs input".
 */
export const ICP_REQUIRED_SUBHEADINGS = [
  '### 1.1 Category & Why Now',
  '### 1.2 Competitive & Peer Landscape',
  '### 1.3 Addressable Landscape',
  '### 1.4 Current Member/Adopter Segments',
] as const;

/**
 * The five ICP dimensions — Velocity Engine field names, verbatim from the
 * agent's `ICP_DIMENSION_FIELDS` (structure gate G5).
 */
export const ICP_DIMENSION_FIELDS = [
  'ICP',
  'Trigger Events / Compelling Moments',
  'Who is not an ideal customer',
  'Customer Use Cases',
  'Customer Pain Points',
] as const;

/**
 * The twelve persona fields, verbatim from the agent's `PERSONA_FIELDS`
 * (structure gate G5).
 */
export const ICP_PERSONA_FIELDS = [
  'Title',
  'Nickname',
  'Role',
  'Goals',
  'Challenges',
  'Works for',
  'Other Roles Performed',
  'Trusted Sources',
  'Key Responsibilities',
  'Statements to share with the boss',
  'Features and Persona Benefits',
  'Example Use Cases',
] as const;

/** Gate G1 — Paul's dual-audience default, collapsible to one ICP. */
export const ICP_ICPS_BAND = { min: 1, max: 2 } as const;

/** Gate G1 — "2-3 personas per ICP". */
export const ICP_PERSONAS_PER_ICP_BAND = { min: 2, max: 3 } as const;

/** Gate G2 — 4-6 attributes an actual contact or org can be scored against. */
export const ICP_FIT_WARMTH_BAND = { min: 4, max: 6 } as const;

/** The two disqualifier confidence states the contract allows. */
export const ICP_DISQUALIFIER_STATES = ['confirmed', 'inferred_draft'] as const;

/** Gate G6 — the label an unconfirmed disqualifier set must carry in the document. */
export const ICP_INFERRED_DRAFT_LABEL = 'inferred draft';

/** Minimum document length (chars) per the contract schema. */
export const ICP_MIN_DOCUMENT_LENGTH = 1000;

/** Intake log size bounds per the contract schema (variable-length interview). */
export const ICP_INTAKE_ANSWERS_MIN = 3;
export const ICP_INTAKE_ANSWERS_MAX = 8;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const ICP_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercase hex SHA-256 pattern. */
export const ICP_SHA256_REGEX = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamp shape gate: date + time part required; offset/Z optional (shape gate, not a UTC enforcer). */
export const ICP_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/**
 * Shape gate for an LFX project uid wherever it becomes ONE PATH SEGMENT: the
 * storage partition of `icp/{project}/…` AND the upstream `/projects/{uid}`
 * lookup the ICP result endpoint runs before it. Both interpolate the uid
 * unencoded, so a value carrying `/`, `.`, `?` or `#` would reshape a key or
 * an authenticated upstream URL. Deliberately identical to the Brand Kit's
 * gate — same rule, same reason — and pinned per contract for the reason in
 * the module note.
 */
export const ICP_PROJECT_UID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// ---------------------------------------------------------------------------
// BFF-side batch submission plumbing
// ---------------------------------------------------------------------------

/**
 * Preamble lines of the batch form-mode message, quoted VERBATIM from the
 * agent's own `renderFormMessage` (marketing-os-agents `agents/icp-ts`
 * src/form.ts) — the exact text the agent's MODE RULES section tells the model
 * to expect. Single copy: used by the BFF's `renderIcpFormText` and registered
 * as the intake's `batchPreamble`.
 */
export const ICP_FORM_PREAMBLE_LINES = [
  'BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).',
  'The interview inputs were collected on a single LFX form and are provided',
  'below, paired with your Step 1 questions. Do NOT re-ask them; proceed',
  'directly to Step 2.',
] as const;

/**
 * Synthesized feedback used for an edit-inputs resubmit (no user feedback):
 * the agent's form contract only carries the "finalize as version N+1"
 * directive inside the feedback block, so a revision without feedback still
 * needs one to version correctly. Engineering plumbing, not Paul's wording.
 */
export const ICP_REVISED_INTAKE_FEEDBACK =
  'The intake answers in this submission replace the prior draft’s inputs — regenerate the document from the updated answers.';
