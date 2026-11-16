// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// FAQ contract constants (faq-output/v1, the faq-questions/v1 and
// faq-answers/v1 turns) — shared between the BFF's form renderer and envelope
// gates, the intake form UI, the FAQ view and tests. Mirrors marketing-os-agents
// agents/faq 1.0.0 (src/form.ts, src/envelope.ts, src/questions-turn.ts,
// src/framework-gate.ts, src/submit-hardening.ts) and docs/contracts/faq-*.md.

import { FOUNDATION_MESSAGE_CONTRACT_ID } from './foundation-message.constants';

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const FAQ_CONTRACT_ID = 'faq-output/v1';

/** Document kind within the contract. */
export const FAQ_KIND = 'faq';

/** The Guild identifier the envelope's `agent.identifier` must carry. */
export const FAQ_AGENT_IDENTIFIER = 'linux-foundation~faq';

/** Payload discriminator of the agent's intake form (`src/form.ts` FORM_TYPE). */
export const FAQ_FORM_TYPE = 'faq_intake_form';

/** How a run is produced: a new draft, a redraft from comments, or a check of a hand-edited version. */
export const FAQ_MODES = ['draft', 'redraft', 'check'] as const;

/** The two revision modes a form may carry (everything but a draft). */
export const FAQ_REVISION_MODES = ['redraft', 'check'] as const;

/** First line of the rendered form per mode — the marker the agent's finalize tool parses back. */
export const FAQ_INTAKE_HEADERS = {
  draft: 'BATCH INTAKE SUBMISSION (FAQ — DRAFT)',
  redraft: 'BATCH INTAKE SUBMISSION (FAQ — REDRAFT)',
  check: 'BATCH INTAKE SUBMISSION (FAQ — CHECK)',
} as const;

/** The MESSAGING FRAMEWORK line when the approved framework is attached — verbatim from the agent's `FRAMEWORK_SUPPLIED`. */
export const FAQ_FRAMEWORK_SUPPLIED_LINE =
  'supplied (the approved framework, JSON follows) — choose the questions and word the answers from it; facts still come from the sources';

/** The MESSAGING FRAMEWORK line without one — verbatim from the agent's `FRAMEWORK_NONE`. The BFF never sends it: it refuses the run first. */
export const FAQ_FRAMEWORK_NONE_LINE = 'none supplied (the FAQ requires the approved messaging framework: this run is refused)';

/** The contract of the framework the FAQ reads: a stored Messaging Framework envelope is unwrapped to its content. */
export const FAQ_FRAMEWORK_CONTRACT_ID = FOUNDATION_MESSAGE_CONTRACT_ID;

// ---------------------------------------------------------------------------
// The form: the project from LFX, the website and the repository as links,
// other links and documents in one section, the notes, and the approved
// messaging framework, attached by the run page from the document store.
// ---------------------------------------------------------------------------

/** The form key of the one-line description. */
export const FAQ_DESCRIPTION_KEY = 'description';

/** The form key of the website — the form's one required source. */
export const FAQ_WEBSITE_KEY = 'website_url';

/**
 * The form key of the GitHub repository or README. The contract has no
 * repository key, so it reaches the agent as the first of its `links`; the
 * same key as the other agents' forms, so the answer memory carries it.
 */
export const FAQ_GITHUB_KEY = 'github_url';

/** The form key of the notes: who asks what, words to avoid — data, not instructions. */
export const FAQ_NOTES_KEY = 'notes';

/**
 * The answer key the approved messaging framework travels under in the
 * generate body — the agent's own form key. Never an intake field: the run
 * page attaches the project's latest stored framework revision itself, and
 * the BFF unwraps it to the framework's content.
 */
export const FAQ_FRAMEWORK_ANSWER_KEY = 'messaging_framework';

/** The answer keys the BFF accepts. */
export const FAQ_ANSWER_KEYS = ['project_name', FAQ_DESCRIPTION_KEY, FAQ_WEBSITE_KEY, FAQ_GITHUB_KEY, FAQ_NOTES_KEY, FAQ_FRAMEWORK_ANSWER_KEY] as const;

/** Most links one form takes (the agent's own cap). */
export const FAQ_MAX_LINKS = 20;

/** Most documents one form takes (the agent's own cap): the links and uploads of the "Other links and documents" section. */
export const FAQ_MAX_DOCUMENTS = 20;

/** The serialized messaging framework, at most this many characters — a framework is field-sized, never document-sized. */
export const FAQ_MAX_FRAMEWORK_CHARS = 400_000;

/**
 * The document kinds the form tags a link or an upload with, in the order
 * the picker offers them. The agent also takes `logo`, which it ignores, so
 * the form never offers it.
 */
export const FAQ_DOCUMENT_KINDS = ['press', 'deck', 'doc', 'plan'] as const;

/** The agent's own label per kind, rendered after it on the form's `KIND:` line — verbatim from its `DOCUMENT_KIND_LABELS`. */
export const FAQ_DOCUMENT_KIND_LABELS = {
  press: 'press release',
  deck: 'deck',
  doc: 'document',
  plan: 'integrated marketing plan',
} as const;

/** What the form's tag picker calls each kind. */
export const FAQ_DOCUMENT_KIND_OPTIONS = [
  { value: 'press', label: 'Press release' },
  { value: 'deck', label: 'Deck' },
  { value: 'doc', label: 'Document' },
  { value: 'plan', label: 'Marketing plan' },
] as const;

/** The kind a document gets until the requester tags it. */
export const FAQ_DEFAULT_DOCUMENT_KIND = 'doc';

// ---------------------------------------------------------------------------
// The agent's tools, its questions turn (faq-questions/v1) and the answers
// turn LFX One sends back (faq-answers/v1)
// ---------------------------------------------------------------------------

/** The agent's finalize tool: the only event source the BFF accepts an output envelope from (its tool RESULT). */
export const FAQ_FINALIZE_TOOL = 'finalize_faq';

/** Contract discriminator of the agent's questions block. */
export const FAQ_QUESTIONS_CONTRACT_ID = 'faq-questions/v1';

/** First line of the agent's questions turn; a fenced ```json block with the questions follows. */
export const FAQ_QUESTIONS_HEADER = 'FAQ — QUESTIONS (faq-questions/v1)';

/** First line of the rendered answers turn — the marker the agent parses back. */
export const FAQ_ANSWERS_HEADER = 'FAQ — ANSWERS (faq-answers/v1)';

/** Most questions one questions turn may carry (the agent's own cap). */
export const FAQ_MAX_QUESTIONS = 6;

/** BFF endpoint the answers turn is posted to. */
export const FAQ_ANSWERS_ENDPOINT = '/api/mktg-agents/faq/answers';

// ---------------------------------------------------------------------------
// Replies that end a run without an FAQ (the session is over; nothing is stored)
// ---------------------------------------------------------------------------

/**
 * How the agent's refusal opens (src/framework-gate.ts; faq-output.md §2d):
 * a run without the approved messaging framework, or with a JSON that is not
 * one, is refused up front with one plain-text reply.
 */
export const FAQ_REFUSAL_OPENINGS = ['The FAQ request for ', 'The messaging framework attached to the FAQ request for '] as const;

/** The clause every refusal carries after its opening — what tells it from an agent text that merely mentions the request. */
export const FAQ_REFUSAL_CLAUSE = 'this run was not started';

/**
 * The reply of a run that ended before its FAQ passed the checks, verbatim
 * (src/submit-hardening.ts `NOT_FINALIZED_REPLY`; faq-output.md §2e): not an
 * envelope — the page shows it and nothing is stored.
 */
export const FAQ_NOT_FINALIZED_REPLY =
  "The FAQ was not delivered: this run ended before the draft passed its checks (the question and answer counts, the sources named, the framework's avoid list), so nothing unchecked was returned. Please send the request again.";

// ---------------------------------------------------------------------------
// Output contract gates (faq-output/v1, the JSON Schema)
// ---------------------------------------------------------------------------

/** The array bounds of the content, as the schema states them (the agent enforces the skill's 3–4 groups and 8–10 questions itself). */
export const FAQ_CONTENT_LIMITS = {
  groups: { min: 1, max: 8 },
  questions: { min: 1, max: 12 },
} as const;

/** Non-answers the deployed Slides exporter omits, case-insensitively after trimming. */
export const FAQ_SLIDES_UNANSWERED_REGEX = /^(tbd|n\/a|none|-)$/i;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const FAQ_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// ---------------------------------------------------------------------------
// The FAQ view
// ---------------------------------------------------------------------------

/** The tabs of the FAQ view, in order. */
export const FAQ_VIEW_TABS = [
  { id: 'faq', label: 'FAQ' },
  { id: 'unanswered', label: 'Needs an answer' },
  { id: 'sources', label: 'Sources and gaps' },
] as const;

/** How the view names a run's mode. */
export const FAQ_MODE_LABELS = {
  draft: 'Draft',
  redraft: 'Redraft',
  check: 'Checked',
} as const;

/** What the view says in place of an answer the sources did not give. */
export const FAQ_NEEDS_ANSWER_LABEL = 'Needs an answer from your team';
/** A resolved answer exists in a later, server-listed revision, not this historical asset. */
export const FAQ_ANSWERED_REVISION_LABEL = 'Answered in v{version} · Open it';
