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
 * The 13-heading structural presence gate (contract §1): document_markdown
 * must contain each of these level-2 headings. Matching is heading-prefix
 * per line with a qualifier boundary, mirroring the agent's own
 * `missingHeadings` gate (e.g. "## 1a. Word-Count Derivatives (when a Brand
 * Kit exists)" passes).
 */
export const FOUNDATION_MESSAGE_REQUIRED_HEADINGS = [
  '## 0. Overview',
  '## 1. Project Definition',
  '## 1a. Word-Count Derivatives',
  '## 2. Voice & Tone',
  '## 3. Positioning Statement',
  '## 4. Unique Value Proposition',
  '## 5. Target Audiences',
  '## 6. Messaging Pillars',
  '## 7. Value Messages, Support Points & Proof Points',
  '## 8. Talking Points & Soundbites',
  '## 9. Terminology, Constraints & Differentiation',
  '## 10. Next Steps',
  '## Appendix: Interview Record',
] as const;

/** The five derivative keys the contract's `derivatives` object requires. */
export const FOUNDATION_MESSAGE_DERIVATIVE_KEYS = ['summary_25', 'summary_50', 'boilerplate', 'llms_txt', 'elevator_pitch_headline'] as const;

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
  elevator_pitch_headline: 10,
} as const;

/** Boilerplate sanity band in words (contract §1a gate G2; Paul's target is ~100-150). */
export const FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND = { min: 50, max: 250 } as const;

/** Result-surface chips for the five word-count-locked derivatives, in display order. */
export const FOUNDATION_MESSAGE_DERIVATIVE_CHIPS = [
  { key: 'summary_25', label: '25-word summary' },
  { key: 'summary_50', label: '50-word summary' },
  { key: 'boilerplate', label: 'Boilerplate' },
  { key: 'llms_txt', label: 'llms.txt' },
  { key: 'elevator_pitch_headline', label: 'Elevator pitch headline' },
] as const;

/** Minimum document length (chars) per the contract schema. */
export const FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH = 1000;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercase hex SHA-256 pattern. */
export const FOUNDATION_MESSAGE_SHA256_REGEX = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamp shape gate: date + time part required; offset/Z optional (shape gate, not a UTC enforcer). */
export const FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/** Intake log size bounds per the contract schema (variable-length interview). */
export const FOUNDATION_MESSAGE_INTAKE_ANSWERS_MIN = 2;
export const FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX = 15;

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
