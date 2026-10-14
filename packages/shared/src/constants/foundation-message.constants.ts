// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Message Foundation contract constants (message-foundation-output/v1) —
// shared between the BFF session-consumer validation gates, the intake form
// UI, and tests. Mirrors the normative contract and intake wording in
// marketing-os-agents agents/foundation-message-ts (src/envelope.ts,
// src/form.ts, src/questions.ts).

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const FOUNDATION_MESSAGE_CONTRACT_ID = 'message-foundation-output/v1';

/** Document kind within the contract. */
export const FOUNDATION_MESSAGE_KIND = 'message-foundation';

/** Batch payload discriminator of the agent's form-mode input contract. */
export const FOUNDATION_MESSAGE_FORM_TYPE = 'message_foundation_intake_form';

// ---------------------------------------------------------------------------
// Paul's fixed-wording interview questions — QUOTED VERBATIM from the agent's
// src/questions.ts (dec-paul-prompt-fidelity). Never paraphrased.
// ---------------------------------------------------------------------------

/** Q1a — project name (verbatim). */
export const FOUNDATION_MESSAGE_Q_PROJECT_NAME = "What's the name of the LF project?";

/** Q1b — GitHub / README URL (verbatim). */
export const FOUNDATION_MESSAGE_Q_GITHUB_URL = "What's the URL of the project's GitHub repo or README?";

/**
 * Q1c — brand kit or brand discovery (verbatim). Rendered ONLY inside the
 * agent-facing batch message (`renderFoundationMessageFormText`), never in
 * the LFX UI: per dec-agent-dependency-gating the form auto-attaches the
 * project's stored Brand Kit instead of asking this question.
 */
export const FOUNDATION_MESSAGE_Q_BRAND_KIT = 'Do you already have a `[Project Name] Brand Kit` I should use, and if so where is it?';

/**
 * Q1c sub-questions 1–5 (verbatim) — brand discovery, asked only when no
 * Brand Kit exists. Keys match the agent's batch form schema field names,
 * aligned 1:1 with the question order.
 */
export const FOUNDATION_MESSAGE_DISCOVERY_QUESTIONS = [
  { key: 'one_line_description', question: 'In one line, what does it do — beyond the name?' },
  {
    key: 'primary_audience',
    question:
      "Who's the primary audience — who does this project's messaging need to speak to (e.g. AI/ML platform engineers, enterprise buyers, agent-framework contributors)?",
  },
  { key: 'voice_adjectives', question: 'Give me three adjectives for the voice you want.' },
  {
    key: 'constraints',
    question: 'Any constraints — colors/marks to avoid, an existing LF-family look to stay consistent with, trademark concerns?',
  },
  { key: 'reference_brands', question: 'One to three reference brands or projects you admire, or want to differentiate from?' },
] as const;

/** Discovery answer keys, in question order (the conditional-requirement set). */
export const FOUNDATION_MESSAGE_DISCOVERY_KEYS = FOUNDATION_MESSAGE_DISCOVERY_QUESTIONS.map((entry) => entry.key);

// ---------------------------------------------------------------------------
// Output contract gates (message-foundation-output/v1)
// ---------------------------------------------------------------------------

/**
 * The 14-heading structural presence gate (contract §1): document_markdown
 * must contain each of these level-2 headings. Matching is heading-prefix
 * per line with a qualifier boundary, mirroring the agent's own
 * `missingHeadings` gate (e.g. "## 3. Copy Primitives (word-count-locked)"
 * passes).
 *
 * The message-foundation 0.5.0 template (agent 1.1.0, marketing-os-agents
 * wi-re-pin-our-message-foundation-agent-to-p): the document opens with the
 * two-page Review Sheet and a How-to-use routing block, runs §1–§9, and
 * closes with Appendices A (inputs & interview record), B (Stat Bank) and C
 * (source trace). Must stay in lockstep with the agent's own
 * REQUIRED_HEADINGS — every run fails validation otherwise.
 */
export const FOUNDATION_MESSAGE_REQUIRED_HEADINGS = [
  '## Review Sheet',
  '## How to Use This Document',
  '## 1. Brand Message Hierarchy',
  '## 2. Project Definition',
  '## 3. Copy Primitives',
  '## 4. Voice',
  '## 5. Messaging Pillars',
  '## 6. Message Matrix',
  '## 7. Proof Points',
  "## 8. Objections & What We Don't Claim",
  '## 9. Origin, CTAs, Terminology & Next Steps',
  '## Appendix A: Inputs & Interview Record',
  '## Appendix B: Stat Bank / Proof-Point Ledger',
  '## Appendix C: Source Trace',
] as const;

/**
 * The five derivative keys the contract's `derivatives` object requires —
 * the 0.5.0 template's §3 copy primitives. `elevator_pitch` (the full ≤90-word
 * pitch) replaced the 0.1.0 `elevator_pitch_headline` (a ≤10-word slide
 * headline) in the agent's 1.1.0 re-pin.
 */
export const FOUNDATION_MESSAGE_DERIVATIVE_KEYS = ['summary_25', 'summary_50', 'boilerplate', 'llms_txt', 'elevator_pitch'] as const;

/**
 * Hard word caps of the length-locked derivatives (contract §1a gate G1),
 * quoted from the agent's own `derivativeViolations`. The BFF re-checks them
 * rather than trusting the wrapper: the envelope scanner reads every event
 * payload, so a shape-compatible draft that never passed the finalize tool
 * could otherwise be surfaced to the user as "word-count-locked".
 */
export const FOUNDATION_MESSAGE_DERIVATIVE_WORD_CAPS = {
  summary_25: 25,
  summary_50: 50,
  elevator_pitch: 90,
} as const;

/** Boilerplate sanity band in words (contract §1a gate G2; Paul's target is ~100-150). */
export const FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND = { min: 50, max: 250 } as const;

/** Result-surface chips for the five word-count-locked derivatives, in display order. */
export const FOUNDATION_MESSAGE_DERIVATIVE_CHIPS = [
  { key: 'summary_25', label: '25-word summary' },
  { key: 'summary_50', label: '50-word summary' },
  { key: 'boilerplate', label: 'Boilerplate' },
  { key: 'llms_txt', label: 'llms.txt' },
  { key: 'elevator_pitch', label: 'Elevator pitch' },
] as const;

/** Minimum document length (chars) per the contract schema. */
export const FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH = 1000;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercase hex SHA-256 pattern. */
export const FOUNDATION_MESSAGE_SHA256_REGEX = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamp shape gate: date + time part required; offset/Z optional (shape gate, not a UTC enforcer). */
export const FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/**
 * Intake log size bounds per the contract schema (variable-length interview).
 * The cap rose 15 → 20 with the 0.5.0 template (Step 1d gap-fill grew from five to
 * eight questions).
 */
export const FOUNDATION_MESSAGE_INTAKE_ANSWERS_MIN = 2;
export const FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX = 20;

// ---------------------------------------------------------------------------
// BFF-side batch submission plumbing
// ---------------------------------------------------------------------------

/**
 * Preamble lines of the batch form-mode message, quoted VERBATIM from the
 * agent's own `renderFormMessage` (marketing-os-agents
 * `agents/foundation-message-ts` src/form.ts) — the exact text the agent's
 * MODE RULES section tells the model to expect. Single copy: used by the
 * BFF's `renderFoundationMessageFormText` and registered as the intake's
 * `batchPreamble`.
 */
export const FOUNDATION_MESSAGE_FORM_PREAMBLE_LINES = [
  'BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).',
  'The interview inputs were collected on a single LFX form and are provided',
  'below, paired with your Step 1 questions. Do NOT re-ask them; proceed',
  'directly to Step 2.',
] as const;

/**
 * Size cap (chars) for the server-fetched README passed as
 * `readme_markdown`. READMEs are prompt input, not storage — anything past
 * this is truncated with an explicit marker so the agent never sees a
 * silently clipped document.
 */
export const FOUNDATION_MESSAGE_README_MAX_CHARS = 65536;

/** Marker appended when the fetched README exceeds the size cap. */
export const FOUNDATION_MESSAGE_README_TRUNCATION_MARKER = '\n\n…(README truncated by LFX before submission)';

/**
 * Synthesized feedback used for an edit-inputs resubmit (no user feedback):
 * the agent's form contract only carries the "finalize as version N+1"
 * directive inside the feedback block, so a revision without feedback still
 * needs one to version correctly. Engineering plumbing, not Paul's wording.
 */
export const FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK =
  'The intake answers in this submission replace the prior draft’s inputs — regenerate the document from the updated answers.';
