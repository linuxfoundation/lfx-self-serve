// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Messaging Document contract constants (messaging-document-output/v1, the
// messaging-document-questions/v1 and messaging-document-answers/v1 turns) —
// shared between the BFF's form renderer and envelope gates, the intake form
// UI, and tests. The agent keeps its Guild name (foundation-message), its
// store prefix and its catalog id (foundation-setup); only its document is
// now Paul's Messaging Document. Mirrors marketing-os-agents
// agents/foundation-message (src/envelope.ts, src/form.ts, src/questions.ts,
// src/questions-turn.ts) and docs/contracts/messaging-document-*.md.

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
// The sources — Paul's four Step 0b source labels, QUOTED VERBATIM from the
// agent's src/questions.ts (dec-paul-prompt-fidelity). The agent fetches every
// link itself (web fetch, Exa search): LFX One sends URLs only.
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

/** The form key each source's URL travels under. */
export const FOUNDATION_MESSAGE_SOURCE_URL_KEYS = {
  website: 'website_url',
  readme: 'github_url',
  press_release: 'press_release_url',
  brand_page: 'brand_page_url',
} as const;

/** The form key of the optional list of further links (one per line on the form; an array in the payload). */
export const FOUNDATION_MESSAGE_OTHER_LINKS_KEY = 'other_links';

/** Most other links one run takes. */
export const FOUNDATION_MESSAGE_MAX_OTHER_LINKS = 10;

/**
 * The ten intake answer keys, in the agent's priority order (its
 * `ANSWER_KEYS`, src/questions.ts). The form asks none of them: the rendered
 * intake declares every one open (`ANSWERS ON THE FORM: 0 of 10 — open: …`),
 * and the agent asks back only the gaps its research leaves.
 */
export const FOUNDATION_MESSAGE_ANSWER_KEYS = [
  'vision_mission',
  'category',
  'audiences',
  'alternatives',
  'differentiation',
  'use_cases',
  'proof_points',
  'pillars',
  'objections',
  'tagline_ctas_constraints',
] as const;

/** The agent's finalize tool: the only event source the BFF accepts an output envelope from (its tool RESULT). */
export const FOUNDATION_MESSAGE_FINALIZE_TOOL = 'finalize_messaging_document';

// ---------------------------------------------------------------------------
// The questions turn (messaging-document-questions/v1) and the answers turn
// (messaging-document-answers/v1): after reading the sources and researching,
// the agent asks ONLY the gaps, each with a suggested answer; the requester
// accepts or edits every one and the answers go back to the same session.
// ---------------------------------------------------------------------------

/** Contract discriminator of the agent's questions block. */
export const FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID = 'messaging-document-questions/v1';

/** First line of the agent's questions turn; a fenced ```json block with the questions follows. */
export const FOUNDATION_MESSAGE_QUESTIONS_HEADER = 'MESSAGING DOCUMENT — QUESTIONS (messaging-document-questions/v1)';

/** Contract discriminator of the answers turn LFX One renders. */
export const FOUNDATION_MESSAGE_ANSWERS_CONTRACT_ID = 'messaging-document-answers/v1';

/** First line of the rendered answers turn — the marker the agent parses back. */
export const FOUNDATION_MESSAGE_ANSWERS_HEADER = 'MESSAGING DOCUMENT — ANSWERS (messaging-document-answers/v1)';

/**
 * Where an answer came from: `accepted` — the suggested answer, unchanged;
 * `edited` — the requester changed the suggestion; `requester` — there was
 * no suggestion and the requester wrote the answer.
 */
export const FOUNDATION_MESSAGE_ANSWER_ORIGINS = ['accepted', 'edited', 'requester'] as const;

/** Most questions one questions turn may carry (Paul's ten, with room for a split one). */
export const FOUNDATION_MESSAGE_MAX_QUESTIONS = 20;

/** Shape of a question key: the agent's snake_case field keys. */
export const FOUNDATION_MESSAGE_QUESTION_KEY_REGEX = /^[a-z0-9][a-z0-9_]{0,63}$/;

/** Longest answer text accepted on the answers turn. */
export const FOUNDATION_MESSAGE_ANSWER_MAX_CHARS = 4000;

/**
 * An answer that is not one: there is no skip and no TBD on the questions
 * step — the agent already suggested what it could, so what is left needs a
 * real answer from the requester.
 */
export const FOUNDATION_MESSAGE_NON_ANSWER_REGEX = /^(?:tbd|skip|skipped|n\/?a|none|-+|\?+)\.?$/i;

/** BFF endpoint the answers turn is posted to. */
export const FOUNDATION_MESSAGE_ANSWERS_ENDPOINT = '/api/mktg-agents/foundation-message/answers';

// ---------------------------------------------------------------------------
// Form shapes and draft statuses (src/form.ts)
// ---------------------------------------------------------------------------

/** Status of a draft generated with no answers (Paul's pre-fill mode). */
export const FOUNDATION_MESSAGE_STATUS_PREFILLED = 'Draft — pre-filled';

/** Status of a draft generated from the requester's answers (with or without documents). */
export const FOUNDATION_MESSAGE_STATUS_FROM_DOCUMENTS = 'Draft — from your documents';

/** Paul's draft labels; an envelope's `status` must start with one of them. */
export const FOUNDATION_MESSAGE_DRAFT_STATUSES = [FOUNDATION_MESSAGE_STATUS_PREFILLED, FOUNDATION_MESSAGE_STATUS_FROM_DOCUMENTS] as const;

/** The generate shapes the envelope's `intake.shape` records (the agent's GenerateShape). */
export const FOUNDATION_MESSAGE_GENERATE_SHAPES = ['answers', 'documents-with-answers', 'prefill'] as const;

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

/** A URL the agent's form accepts (`HTTP_URL` in src/form.ts). */
export const FOUNDATION_MESSAGE_HTTP_URL_REGEX = /^https?:\/\/\S+$/;

/** The answer a requester gives for a source they do not have (Paul: "none" is a valid answer). */
export const FOUNDATION_MESSAGE_NONE_ANSWER = 'none';

// ---------------------------------------------------------------------------
// BFF-side plumbing: the uploaded files LFX One reads to text before the run
// (the agent fetches every link itself)
// ---------------------------------------------------------------------------

/**
 * Size cap (chars) for a server-fetched README. The Messaging Document agent
 * fetches its own sources now; this serves the ICP's `readme_markdown` fetch
 * (`GithubReadmeService`). READMEs are prompt input, not storage — anything
 * past this is truncated with an explicit marker so the agent never sees a
 * silently clipped document.
 */
export const FOUNDATION_MESSAGE_README_MAX_CHARS = 65536;

/** Marker appended when the fetched README exceeds the size cap. */
export const FOUNDATION_MESSAGE_README_TRUNCATION_MARKER = '\n\n…(README truncated by LFX before submission)';

/** Size cap (chars) for the text of one existing document. */
export const FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS = 60000;

/** Marker appended when a document text exceeds its cap. */
export const FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER = '\n\n…(truncated by LFX before submission)';

/** Most existing documents one run takes. */
export const FOUNDATION_MESSAGE_MAX_DOCUMENTS = 6;

/** Largest uploaded file LFX One reads (bytes). */
export const FOUNDATION_MESSAGE_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** File types the existing-documents upload accepts: PDF, Word, Markdown and plain text. */
export const FOUNDATION_MESSAGE_FILE_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'] as const;

/** Content type of the raw upload body. */
export const FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE = 'application/octet-stream';

/** Header carrying the URI-encoded file name of an upload (never the URL, which the request logger writes). */
export const FOUNDATION_MESSAGE_FILE_NAME_HEADER = 'X-File-Name';

/** Longest document title kept (one line). */
export const FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS = 200;

/** What the form says when an uploaded document could not be read, per reason. */
export const FOUNDATION_MESSAGE_READ_REASONS = {
  unsupported: 'Not a PDF, Word (.docx), Markdown or text file.',
  encrypted: 'The PDF is password-protected or encrypted. Export it without a password and upload it again.',
  'no-text': 'No text found — a scanned PDF or an image cannot be read. Upload a text version.',
  'too-complex': 'This document is too long or too complex to read here. Upload a shorter version, or export it again as PDF or text.',
  'too-large': 'The file is larger than 20 MB.',
  busy: 'LFX One is still reading your other documents. Try this one again in a moment.',
} as const;

/** BFF endpoint that turns an uploaded existing document into text before the run (a link goes to the agent as is). */
export const FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS = {
  file: '/api/mktg-agents/foundation-message/documents/file',
} as const;
