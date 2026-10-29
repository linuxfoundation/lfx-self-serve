// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Messaging Framework contract constants (messaging-framework-output/v1, the
// messaging-framework-questions/v1 and messaging-framework-answers/v1 turns)
// — shared between the BFF's form renderer and envelope gates, the intake
// form UI, the framework view and tests. The agent keeps its Guild name
// (foundation-message), its store prefix and its catalog id (foundation-setup);
// what it writes is the Messaging Framework: one JSON bundle (mf, icp, mh,
// nums) with its report, never a Markdown document. Mirrors marketing-os-agents
// agents/foundation-message 4.0.0 (src/envelope.ts, src/form.ts,
// src/questions-turn.ts) and docs/contracts/messaging-framework-*.md.

import type { FoundationMessageUrlDocumentField } from '../interfaces/foundation-message.interface';

/** Contract discriminator the BFF accepts; unknown majors are rejected. */
export const FOUNDATION_MESSAGE_CONTRACT_ID = 'messaging-framework-output/v1';

/** Document kind within the contract. */
export const FOUNDATION_MESSAGE_KIND = 'messaging-framework';

/** The Guild identifier the envelope's `agent.identifier` must carry. */
export const FOUNDATION_MESSAGE_AGENT_IDENTIFIER = 'linux-foundation~foundation-message';

/** Payload discriminator of the agent's intake form (`src/form.ts` FORM_TYPE). */
export const FOUNDATION_MESSAGE_FORM_TYPE = 'messaging_framework_intake_form';

/** How a run is produced: a new draft, a redraft from comments, or a check of a hand-edited version. */
export const FOUNDATION_MESSAGE_MODES = ['draft', 'redraft', 'check'] as const;

/** The two revision modes a form may carry (everything but a draft). */
export const FOUNDATION_MESSAGE_REVISION_MODES = ['redraft', 'check'] as const;

/** First line of the rendered form per mode — the marker the agent's finalize tool parses back. */
export const FOUNDATION_MESSAGE_INTAKE_HEADERS = {
  draft: 'BATCH INTAKE SUBMISSION (Messaging Framework — DRAFT)',
  redraft: 'BATCH INTAKE SUBMISSION (Messaging Framework — REDRAFT)',
  check: 'BATCH INTAKE SUBMISSION (Messaging Framework — CHECK)',
} as const;

// ---------------------------------------------------------------------------
// The form: the project, its sources as links (the agent fetches every one
// itself), and the documents, each tagged with what it is. There is no notes
// field (hand test, 18 Oct): audiences, goals and words to avoid are gathered
// by the agent's own gap questions after it has read and researched.
// ---------------------------------------------------------------------------

/**
 * The intake answer keys the BFF accepts, besides the documents: the
 * project, then one labelled field per source the agent reads (hand test,
 * 17 Oct: a guided form, not a bare links box), and `links`, which the
 * form no longer collects (hand test, 18 Oct: other links go in through
 * the documents section, tagged) but the validator and the payload builder
 * still take.
 */
export const FOUNDATION_MESSAGE_ANSWER_KEYS = [
  'project_name',
  'description',
  'website_url',
  'github_url',
  'press_release_url',
  'members_page_url',
  'projects_page_url',
  'deck_url',
  'plan_url',
  'brand_page_url',
  'links',
] as const;

/** The form key of the one-line description. */
export const FOUNDATION_MESSAGE_DESCRIPTION_KEY = 'description';

/** The form key of the website — the one required source. */
export const FOUNDATION_MESSAGE_WEBSITE_KEY = 'website_url';

/**
 * The form key of the GitHub repository or README (hand test, 18 Oct: "add
 * the GitHub"). The 4.0.0 contract has no repository key of its own, so it
 * reaches the agent as the first of its `links`; the same key as the Brand
 * Kit's and the ICP's, so the answer memory carries it between the forms.
 */
export const FOUNDATION_MESSAGE_GITHUB_KEY = 'github_url';

/** The form key of the launch press release or announcement (a `press` document to the agent). */
export const FOUNDATION_MESSAGE_PRESS_RELEASE_KEY = 'press_release_url';

/** The form key of the members or partners page (a link to the agent). */
export const FOUNDATION_MESSAGE_MEMBERS_PAGE_KEY = 'members_page_url';

/** The form key of the projects or products page (a link to the agent). */
export const FOUNDATION_MESSAGE_PROJECTS_PAGE_KEY = 'projects_page_url';

/** The form key of the existing deck or pitch given as a link (a `deck` document to the agent; an upload goes to the documents). */
export const FOUNDATION_MESSAGE_DECK_KEY = 'deck_url';

/** The form key of the marketing or strategy plan given as a link (a `plan` document to the agent; an upload goes to the documents). */
export const FOUNDATION_MESSAGE_PLAN_KEY = 'plan_url';

/** The form key of the brand page (a link to the agent). */
export const FOUNDATION_MESSAGE_BRAND_PAGE_KEY = 'brand_page_url';

/**
 * The answer key of extra links as a newline-separated string (an array in
 * the payload). The form no longer collects it — since the hand test of 18
 * Oct other links go in through the documents section, tagged — but the BFF
 * validator and the payload builder still accept it.
 */
export const FOUNDATION_MESSAGE_LINKS_KEY = 'links';

/**
 * The single-link fields of the form, in form order: each takes one
 * `https://` link, blank, or "none". The website is the only required one.
 */
export const FOUNDATION_MESSAGE_SOURCE_URL_KEYS = [
  FOUNDATION_MESSAGE_WEBSITE_KEY,
  FOUNDATION_MESSAGE_GITHUB_KEY,
  FOUNDATION_MESSAGE_PRESS_RELEASE_KEY,
  FOUNDATION_MESSAGE_MEMBERS_PAGE_KEY,
  FOUNDATION_MESSAGE_PROJECTS_PAGE_KEY,
  FOUNDATION_MESSAGE_DECK_KEY,
  FOUNDATION_MESSAGE_PLAN_KEY,
  FOUNDATION_MESSAGE_BRAND_PAGE_KEY,
] as const;

/**
 * The link fields that reach the agent as a tagged DOCUMENT (`documents[]`
 * with the matching kind, titled after the field), because the agent reads a
 * press release, a deck and a plan differently from a page. The rest of the
 * single-link fields reach it as plain `links`.
 */
export const FOUNDATION_MESSAGE_URL_DOCUMENT_FIELDS: Readonly<Record<string, FoundationMessageUrlDocumentField>> = {
  [FOUNDATION_MESSAGE_PRESS_RELEASE_KEY]: { kind: 'press', title: 'Launch press release or announcement' },
  [FOUNDATION_MESSAGE_DECK_KEY]: { kind: 'deck', title: 'Existing deck or pitch' },
  [FOUNDATION_MESSAGE_PLAN_KEY]: { kind: 'plan', title: 'Marketing or strategy plan' },
};

/** The single-link fields that reach the agent as plain `links`, in the order they go first: the repository, then the pages. */
export const FOUNDATION_MESSAGE_URL_LINK_KEYS = [
  FOUNDATION_MESSAGE_GITHUB_KEY,
  FOUNDATION_MESSAGE_MEMBERS_PAGE_KEY,
  FOUNDATION_MESSAGE_PROJECTS_PAGE_KEY,
  FOUNDATION_MESSAGE_BRAND_PAGE_KEY,
] as const;

/** Most links one run takes (the agent's own cap): the repository and page fields and any `links` answer together. */
export const FOUNDATION_MESSAGE_MAX_LINKS = 20;

/** Most entries the `links` answer takes: the agent's cap less the repository and page fields that travel as links. */
export const FOUNDATION_MESSAGE_MAX_OTHER_LINKS = FOUNDATION_MESSAGE_MAX_LINKS - FOUNDATION_MESSAGE_URL_LINK_KEYS.length;

/**
 * The document kinds of the agent's input contract (`sources.files[].kind`),
 * in the order the form offers them. A `logo` package is ignored by this
 * agent and never counts as a source.
 */
export const FOUNDATION_MESSAGE_DOCUMENT_KINDS = ['press', 'deck', 'doc', 'plan', 'logo'] as const;

/** The agent's own label per kind, rendered after it on the form's `KIND:` line — verbatim from its `DOCUMENT_KIND_LABELS`. */
export const FOUNDATION_MESSAGE_DOCUMENT_KIND_LABELS = {
  press: 'press release',
  deck: 'deck',
  doc: 'document',
  plan: 'integrated marketing plan',
  logo: 'logo package',
} as const;

/** What the form's tag picker calls each kind. */
export const FOUNDATION_MESSAGE_DOCUMENT_KIND_OPTIONS = [
  { value: 'press', label: 'Press release' },
  { value: 'deck', label: 'Deck' },
  { value: 'doc', label: 'Document' },
  { value: 'plan', label: 'Marketing plan' },
  { value: 'logo', label: 'Logo package' },
] as const;

/** The kind a document gets until the requester tags it. */
export const FOUNDATION_MESSAGE_DEFAULT_DOCUMENT_KIND = 'doc';

/** The document kind this agent ignores: a logo package is never a source. */
export const FOUNDATION_MESSAGE_LOGO_DOCUMENT_KIND = 'logo';

/** Most comments one redraft takes (the agent's own cap). */
export const FOUNDATION_MESSAGE_MAX_COMMENTS = 30;

/** A comment's field: a dotted / indexed path into the stored JSON (`mf.tagline`, `mf.goals[1].bite`, `icp[0].cta`, `mh.pillars[2].m`, `nums`). */
export const FOUNDATION_MESSAGE_FIELD_PATH_REGEX = /^(mf|icp|mh|nums)(\.[A-Za-z0-9_-]+|\[\d+\])*$/;

/** The agent's finalize tool: the only event source the BFF accepts an output envelope from (its tool RESULT). */
export const FOUNDATION_MESSAGE_FINALIZE_TOOL = 'finalize_messaging_framework';

/** The agent's questions tool: its result is the questions turn the run stops on. */
export const FOUNDATION_MESSAGE_ASK_TOOL = 'ask_requester';

// ---------------------------------------------------------------------------
// The questions turn (messaging-framework-questions/v1) and the answers turn
// (messaging-framework-answers/v1): after reading the sources and researching,
// the agent asks ONLY the gaps, each with a suggested answer; the requester
// accepts or edits every one and the answers go back to the same session.
// ---------------------------------------------------------------------------

/** Contract discriminator of the agent's questions block. */
export const FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID = 'messaging-framework-questions/v1';

/** First line of the agent's questions turn; a fenced ```json block with the questions follows. */
export const FOUNDATION_MESSAGE_QUESTIONS_HEADER = 'MESSAGING FRAMEWORK — QUESTIONS (messaging-framework-questions/v1)';

/** Contract discriminator of the answers turn LFX One renders. */
export const FOUNDATION_MESSAGE_ANSWERS_CONTRACT_ID = 'messaging-framework-answers/v1';

/** First line of the rendered answers turn — the marker the agent parses back. */
export const FOUNDATION_MESSAGE_ANSWERS_HEADER = 'MESSAGING FRAMEWORK — ANSWERS (messaging-framework-answers/v1)';

/**
 * Where an answer came from: `accepted` — the suggested answer, unchanged;
 * `edited` — the requester changed the suggestion; `requester` — there was
 * no suggestion and the requester wrote the answer.
 */
export const FOUNDATION_MESSAGE_ANSWER_ORIGINS = ['accepted', 'edited', 'requester'] as const;

/** Most questions one questions turn may carry (the agent's own cap). */
export const FOUNDATION_MESSAGE_MAX_QUESTIONS = 8;

/** Shape of a question id: the agent's stable kebab-case ids (`ranked-goals`, `words-to-avoid`), at most 40 characters. */
export const FOUNDATION_MESSAGE_QUESTION_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest question id. */
export const FOUNDATION_MESSAGE_QUESTION_ID_MAX_CHARS = 40;

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
// Output contract gates (messaging-framework-output/v1, the JSON Schema)
// ---------------------------------------------------------------------------

/** The source labels a proof point may carry: the skill's six plus the platform's `Notes` and `Web`. */
export const FOUNDATION_MESSAGE_SOURCE_LABELS = ['Website', 'Press release', 'Deck', 'Docs', 'Plan', 'LFX field', 'Notes', 'Web'] as const;

/** The two kinds of segment. */
export const FOUNDATION_MESSAGE_ICP_KINDS = ['Organization', 'Individual'] as const;

/** The three anchor questions every framework ends with, in order (the agent restores them on a check). */
export const FOUNDATION_MESSAGE_ANCHOR_QUESTIONS = ['Which goal does this serve?', 'Which segment is it for?', 'Which key message does it carry?'] as const;

/**
 * The array bounds of the content, as the schema states them (the agent
 * enforces the skill's tighter counts on a draft and a redraft and records a
 * breach in `checks.findings` on a check — so a hand-edited version can
 * still be read).
 */
export const FOUNDATION_MESSAGE_CONTENT_LIMITS = {
  goals: { min: 1, max: 8 },
  goalProof: { min: 1, max: 4 },
  say: { min: 1, max: 12 },
  avoid: { min: 0, max: 12 },
  anchor: { min: 1, max: 5 },
  icp: { min: 1, max: 10 },
  icpGoals: { min: 1, max: Number.POSITIVE_INFINITY },
  icpProof: { min: 1, max: 2 },
  channels: { min: 1, max: 6 },
  personas: { min: 1, max: 3 },
  pillars: { min: 1, max: 5 },
  pillarProof: { min: 1, max: 4 },
  aud: { min: 1, max: 6 },
  nums: { min: 1, max: 8 },
} as const;

/** The content keys of the bundle, in the order the framework view shows them. */
export const FOUNDATION_MESSAGE_CONTENT_KEYS = ['mf', 'icp', 'mh', 'nums'] as const;

/** Shape of an id inside the content (goal and segment ids): lowercase kebab-case. */
export const FOUNDATION_MESSAGE_CONTENT_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Shape of a reference to a goal or segment id: padding is tolerated on input (a hand-edited version read on a check). */
export const FOUNDATION_MESSAGE_CONTENT_ID_REF_REGEX = /^\s*[a-z0-9]+(?:-[a-z0-9]+)*\s*$/;

/** Project slug pattern (lowercase kebab-case, ≤64 chars) from the contract schema. */
export const FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercase hex SHA-256 pattern. */
export const FOUNDATION_MESSAGE_SHA256_REGEX = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamp shape gate: date + time part required; offset/Z optional. */
export const FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/** A date as the contract writes it, YYYY-MM-DD. */
export const FOUNDATION_MESSAGE_ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** A URL the agent's form accepts (`HTTP_URL` in src/form.ts). */
export const FOUNDATION_MESSAGE_HTTP_URL_REGEX = /^https?:\/\/\S+$/;

/** The answer a requester gives for a source they do not have ("none" is a valid answer). */
export const FOUNDATION_MESSAGE_NONE_ANSWER = 'none';

// ---------------------------------------------------------------------------
// The framework view: what the asset page calls each part of the bundle
// ---------------------------------------------------------------------------

/**
 * The tabs of the framework view, in order. The ICPs and the message house
 * stay in the stored bundle but are not shown (Paul, 29 Oct 2026: the ICPs
 * move to a coming Audience section; the message house is out for now).
 */
export const FOUNDATION_MESSAGE_VIEW_TABS = [
  { id: 'framework', label: 'Framework' },
  { id: 'numbers', label: 'Key numbers' },
  { id: 'sources', label: 'Sources and gaps' },
] as const;

/** How the view names a run's mode. */
export const FOUNDATION_MESSAGE_MODE_LABELS = {
  draft: 'Draft',
  redraft: 'Redraft',
  check: 'Checked',
} as const;

// ---------------------------------------------------------------------------
// BFF-side plumbing: the uploaded files LFX One reads to text before the run
// (the agent fetches every link itself)
// ---------------------------------------------------------------------------

/**
 * Size cap (chars) for a server-fetched README. The Messaging Framework agent
 * fetches its own sources; this serves the ICP's `readme_markdown` fetch
 * (`GithubReadmeService`). READMEs are prompt input, not storage — anything
 * past this is truncated with an explicit marker so the agent never sees a
 * silently clipped document.
 */
export const FOUNDATION_MESSAGE_README_MAX_CHARS = 65536;

/** Marker appended when the fetched README exceeds the size cap. */
export const FOUNDATION_MESSAGE_README_TRUNCATION_MARKER = '\n\n…(README truncated by LFX before submission)';

/** Size cap (chars) for the text of one uploaded document. */
export const FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS = 60000;

/** Marker appended when a document text exceeds its cap. */
export const FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER = '\n\n…(truncated by LFX before submission)';

/** Most documents one run takes on the form (the agent allows 20; the read gate sizes this). */
export const FOUNDATION_MESSAGE_MAX_DOCUMENTS = 6;

/** Largest uploaded file LFX One reads (bytes). */
export const FOUNDATION_MESSAGE_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** File types the documents upload accepts: PDF, Word, PowerPoint, Markdown and plain text. */
export const FOUNDATION_MESSAGE_FILE_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.md', '.txt'] as const;

/** Content type of the raw upload body. */
export const FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE = 'application/octet-stream';

/** Header carrying the URI-encoded file name of an upload (never the URL, which the request logger writes). */
export const FOUNDATION_MESSAGE_FILE_NAME_HEADER = 'X-File-Name';

/** Longest document title kept (one line). */
export const FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS = 200;

/** What the form says when an uploaded document could not be read, per reason. */
export const FOUNDATION_MESSAGE_READ_REASONS = {
  unsupported: 'Not a PDF, Word (.docx), PowerPoint (.pptx), Markdown or text file.',
  encrypted: 'The PDF is password-protected or encrypted. Export it without a password and upload it again.',
  'no-text': 'No text found — a scanned PDF or an image cannot be read. Upload a text version.',
  'too-complex': 'This document is too long or too complex to read here. Upload a shorter version, or export it again as PDF or text.',
  'too-large': 'The file is larger than 20 MB.',
  busy: 'LFX One is still reading your other documents. Try this one again in a moment.',
} as const;

/** BFF endpoint that turns an uploaded document into text before the run (a link goes to the agent as is). */
export const FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS = {
  file: '/api/mktg-agents/foundation-message/documents/file',
} as const;
