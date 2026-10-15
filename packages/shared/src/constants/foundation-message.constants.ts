// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Messaging Document contract constants (messaging-document-output/v1) —
// shared between the BFF's form renderer and envelope gates, the intake form
// UI, and tests. The agent keeps its Guild name (foundation-message), its
// store prefix and its catalog id (foundation-setup); only its document is
// now Paul's Messaging Document. Mirrors marketing-os-agents
// agents/foundation-message (src/envelope.ts, src/form.ts, src/questions.ts)
// and docs/contracts/messaging-document-output.md.

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const FOUNDATION_MESSAGE_CONTRACT_ID = 'messaging-document-output/v1';

/** Document kind within the contract. */
export const FOUNDATION_MESSAGE_KIND = 'messaging-document';

/** The Guild identifier the envelope's `agent.identifier` must carry. */
export const FOUNDATION_MESSAGE_AGENT_IDENTIFIER = 'linux-foundation~foundation-message';

/** Payload discriminator of the agent's generate form (`src/form.ts` GENERATE_FORM_TYPE). */
export const FOUNDATION_MESSAGE_FORM_TYPE = 'messaging_document_intake_form';

/** First line of the rendered generate form — the marker the agent's finalize tool parses back. */
export const FOUNDATION_MESSAGE_GENERATE_HEADER = 'BATCH INTAKE SUBMISSION (Messaging Document — GENERATE)';

// ---------------------------------------------------------------------------
// Paul's fixed intake wording — QUOTED VERBATIM from the agent's
// src/questions.ts (dec-paul-prompt-fidelity). Never paraphrased.
// ---------------------------------------------------------------------------

/** Step 0b — the four sources, in Paul's order ("none" is a valid answer). */
export const FOUNDATION_MESSAGE_SOURCE_KINDS = ['website', 'readme', 'press_release', 'brand_page'] as const;

/** Step 0b — Paul's label for each source. */
export const FOUNDATION_MESSAGE_SOURCE_LABELS = {
  website: 'the project or foundation website',
  readme: 'the GitHub repo or README',
  press_release: 'the launch press release (linuxfoundation.org/press or the project site)',
  brand_page: 'an existing brand page or guidelines, if any',
} as const;

/** The form keys each source travels under: its URL (the requester's answer) and the text LFX One fetched from it. */
export const FOUNDATION_MESSAGE_SOURCE_FIELDS = {
  website: { urlKey: 'website_url', textKey: 'website_text' },
  readme: { urlKey: 'github_url', textKey: 'readme_text' },
  press_release: { urlKey: 'press_release_url', textKey: 'press_release_text' },
  brand_page: { urlKey: 'brand_page_url', textKey: 'brand_page_text' },
} as const;

/**
 * Paul's ten Step 1 questions, in his priority order. Eight carry a quoted
 * question; two (7 and 10) are written as a description, quoted here as the
 * question text. `[Project]` is Paul's placeholder and stays as written in
 * what the agent receives.
 */
export const FOUNDATION_MESSAGE_QUESTIONS = [
  {
    key: 'vision_mission',
    label: 'Vision and mission',
    question:
      'Does the project have a written vision (long-term reason for being) and mission (purpose and scope)? Point me to them, give me your one-liners, or say TBD.',
  },
  {
    key: 'category',
    label: 'Category',
    question:
      'What category does [Project] compete in, in the words a buyer or adopter would use, and what is it *not* (the adjacent thing people confuse it with)?',
  },
  {
    key: 'audiences',
    label: 'Audiences',
    question: 'Who are the three to five primary audiences this messaging must speak to, and what does each one care about most?',
  },
  {
    key: 'alternatives',
    label: 'Alternatives',
    question:
      'What does an adopter use instead today — the status quo, a proprietary product, another open source project — and are any alternatives built by member organizations?',
  },
  {
    key: 'differentiation',
    label: 'Differentiation',
    question: 'What is the one thing that is true of [Project] and not of those alternatives?',
  },
  {
    key: 'use_cases',
    label: 'Use cases',
    question: 'What are the top three jobs organizations adopt [Project] to do?',
  },
  {
    key: 'proof_points',
    label: 'Proof points to confirm',
    question:
      'adopters, figures, milestones that may be cited by name, each with source and date. Naming a real organization is a factual and legal claim: confirm, never assume.',
  },
  {
    key: 'pillars',
    label: 'Pillars',
    question: 'Which three to five pillars should the message house be built on?',
  },
  {
    key: 'objections',
    label: 'Objections',
    question:
      'What are the two or three hardest questions skeptics, press, prospects or regulators ask, and what is the honest answer, including anything you would concede?',
  },
  {
    key: 'tagline_ctas_constraints',
    label: 'Tagline, CTAs and constraints',
    question:
      'whether a tagline is locked (site hero, press release) or should be recommended; the membership tier, working group or event the four CTA anchors should name; any Legal-approved phrase that must be used and any phrase that must not.',
  },
] as const;

/** Paul's placeholder for the project inside his question wording. */
export const FOUNDATION_MESSAGE_PROJECT_PLACEHOLDER = '[Project]';

// ---------------------------------------------------------------------------
// Form shapes and draft statuses (src/form.ts)
// ---------------------------------------------------------------------------

/** Status of a draft generated with no answers (Paul's pre-fill mode). */
export const FOUNDATION_MESSAGE_STATUS_PREFILLED = 'Draft — pre-filled';

/** Status of a draft generated from the requester's answers (with or without documents). */
export const FOUNDATION_MESSAGE_STATUS_FROM_DOCUMENTS = 'Draft — from your documents';

/** Paul's draft labels; an envelope's `status` must start with one of them. */
export const FOUNDATION_MESSAGE_DRAFT_STATUSES = [FOUNDATION_MESSAGE_STATUS_PREFILLED, FOUNDATION_MESSAGE_STATUS_FROM_DOCUMENTS] as const;

/** The FORM SHAPE line's label per shape, as the agent's renderer writes it. */
export const FOUNDATION_MESSAGE_SHAPE_LABELS = {
  answers: 'ANSWERS',
  'documents-with-answers': 'DOCUMENTS WITH ANSWERS',
  prefill: 'PRE-FILL',
} as const;

// ---------------------------------------------------------------------------
// Output contract gates (messaging-document-output/v1, contract §1a)
// ---------------------------------------------------------------------------

/**
 * The template's level-2 sections, in order — Paul's messaging-document 1.0.0
 * template (the agent's REQUIRED_HEADINGS). Matching is heading-prefix per
 * line with a qualifier boundary and a curly apostrophe tolerated, mirroring
 * the agent's own gate. Must stay in lockstep with the agent — every run fails
 * validation otherwise.
 */
export const FOUNDATION_MESSAGE_REQUIRED_HEADINGS = [
  '## Review Sheet',
  '## 1. Communications framework',
  '## 2. Positioning',
  '## 3. Project definition and governance',
  '## 4. Copy primitives',
  '## 5. Alternatives and differentiation',
  '## 6. Messaging pillars',
  '## 7. Message house',
  '## 8. Proof points',
  "## 9. Objections and what we don't claim",
  '## 10. CTA anchors, terminology and origin',
  '## 11. Open decisions and next steps',
  '## Appendix A: Inputs and interview record',
  '## Appendix B: Stat Bank',
] as const;

/** The 23 md.* fields of the sidecar, in the registry's order (input-doc-mapping.md §3). */
export const FOUNDATION_MESSAGE_FIELD_IDS = [
  'md.vision',
  'md.mission',
  'md.category',
  'md.positioning',
  'md.tagline',
  'md.audiences',
  'md.alternatives',
  'md.use_cases',
  'md.summary_25',
  'md.summary_50',
  'md.boilerplate',
  'md.elevator_pitch',
  'md.llms_txt',
  'md.pillars',
  'md.message_matrix',
  'md.proof_points',
  'md.objections',
  'md.what_we_dont_claim',
  'md.cta_anchors',
  'md.terminology',
  'md.origin_story',
  'md.governance_sentence',
  'md.trademark_sentence',
] as const;

/** The sidecar fields whose value is a list of objects; every other field's value is a string. */
export const FOUNDATION_MESSAGE_LIST_FIELD_IDS = ['md.pillars', 'md.message_matrix', 'md.proof_points', 'md.objections'] as const;

/** A sidecar field's status: approved only after the reviewer's Approve, never on a fresh draft. */
export const FOUNDATION_MESSAGE_FIELD_STATUSES = ['approved', 'draft', 'tbd'] as const;

/** F1 hard word caps of the length-locked copy primitives. */
export const FOUNDATION_MESSAGE_COPY_PRIMITIVE_WORD_CAPS = {
  'md.summary_25': 25,
  'md.summary_50': 50,
  'md.elevator_pitch': 90,
} as const;

/** F2 boilerplate sanity band in words (Paul's target is 100–150). */
export const FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND = { min: 50, max: 250 } as const;

/** F3: fields whose value must appear verbatim in the document. */
export const FOUNDATION_MESSAGE_VERBATIM_FIELD_IDS = [
  'md.summary_25',
  'md.summary_50',
  'md.boilerplate',
  'md.elevator_pitch',
  'md.llms_txt',
  'md.governance_sentence',
  'md.trademark_sentence',
] as const;

/** F4: most pillars and objections a document carries. */
export const FOUNDATION_MESSAGE_MAX_PILLARS = 5;

/**
 * Result-surface chips for the five copy primitives, in display order: the
 * derivative key the run shell stores, and the sidecar field it comes from.
 */
export const FOUNDATION_MESSAGE_DERIVATIVE_CHIPS = [
  { key: 'summary_25', field: 'md.summary_25', label: '25-word summary' },
  { key: 'summary_50', field: 'md.summary_50', label: '50-word summary' },
  { key: 'boilerplate', field: 'md.boilerplate', label: 'Boilerplate' },
  { key: 'llms_txt', field: 'md.llms_txt', label: 'llms.txt' },
  { key: 'elevator_pitch', field: 'md.elevator_pitch', label: 'Elevator pitch' },
] as const;

/** Minimum document length (chars) per the contract schema. */
export const FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH = 1000;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercase hex SHA-256 pattern. */
export const FOUNDATION_MESSAGE_SHA256_REGEX = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamp shape gate: date + time part required; offset/Z optional. */
export const FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/** A source URL the agent's form accepts (`HTTP_URL` in src/form.ts). */
export const FOUNDATION_MESSAGE_HTTP_URL_REGEX = /^https?:\/\/\S+$/;

/** The answer a requester gives for a source they do not have (Paul: "none" is a valid answer). */
export const FOUNDATION_MESSAGE_NONE_ANSWER = 'none';

// ---------------------------------------------------------------------------
// BFF-side plumbing: what LFX One reads to text before the agent runs
// ---------------------------------------------------------------------------

/**
 * Size cap (chars) for the server-fetched README passed as `readme_text`.
 * READMEs are prompt input, not storage — anything past this is truncated
 * with an explicit marker so the agent never sees a silently clipped document.
 */
export const FOUNDATION_MESSAGE_README_MAX_CHARS = 65536;

/** Marker appended when the fetched README exceeds the size cap. */
export const FOUNDATION_MESSAGE_README_TRUNCATION_MARKER = '\n\n…(README truncated by LFX before submission)';

/** Size cap (chars) for the text of a fetched web source (website, press release, brand page). */
export const FOUNDATION_MESSAGE_SOURCE_MAX_CHARS = 40000;

/** Size cap (chars) for the text of one existing document. */
export const FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS = 60000;

/** Marker appended when a source or document text exceeds its cap. */
export const FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER = '\n\n…(truncated by LFX before submission)';

/** Most existing documents one run takes. */
export const FOUNDATION_MESSAGE_MAX_DOCUMENTS = 6;

/** Largest uploaded file or linked document LFX One reads (bytes). */
export const FOUNDATION_MESSAGE_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** File types the existing-documents upload accepts: PDF, Word, Markdown and plain text. */
export const FOUNDATION_MESSAGE_FILE_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'] as const;

/** Content type of the raw upload body. */
export const FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE = 'application/octet-stream';

/** Header carrying the URI-encoded file name of an upload (never the URL, which the request logger writes). */
export const FOUNDATION_MESSAGE_FILE_NAME_HEADER = 'X-File-Name';

/** Longest document title kept (one line). */
export const FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS = 200;

/** What the form says when an existing document or a source could not be read, per reason. */
export const FOUNDATION_MESSAGE_READ_REASONS = {
  unsupported: 'Not a PDF, Word (.docx), Markdown or text file.',
  encrypted: 'The PDF is password-protected or encrypted. Export it without a password and upload it again.',
  'no-text': 'No text found — a scanned PDF or an image cannot be read. Upload a text version.',
  'not-shared': 'The document isn’t shared publicly. Share it as “Anyone with the link”, or upload it as a file.',
  'fetch-failed': 'LFX One couldn’t fetch this link. It goes to the agent as “not read”; upload the file instead if you have it.',
  'too-large': 'The file is larger than 20 MB.',
} as const;

/** BFF endpoints that turn an existing document into text before the run. */
export const FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS = {
  file: '/api/mktg-agents/foundation-message/documents/file',
  link: '/api/mktg-agents/foundation-message/documents/link',
} as const;
