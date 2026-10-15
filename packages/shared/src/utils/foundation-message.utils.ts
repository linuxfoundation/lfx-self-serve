// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure Messaging Document helpers (messaging-document-output/v1 and the
// questions/answers turns): request validation, the generate form payload and
// its rendering into the one text message the agent receives, the questions
// block the agent sends back, the answers turn LFX One renders, and envelope
// validation. The SHA-256 recompute is deliberately NOT here — hashing is
// environment-specific (node:crypto on the server) and the shared package
// stays platform-neutral; callers recompute the hash and compare against
// `envelope.content_sha256`.

import {
  FOUNDATION_MESSAGE_AGENT_IDENTIFIER,
  FOUNDATION_MESSAGE_ANSWER_KEYS,
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_ANSWER_ORIGINS,
  FOUNDATION_MESSAGE_ANSWERS_HEADER,
  FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND,
  FOUNDATION_MESSAGE_CONTRACT_ID,
  FOUNDATION_MESSAGE_COPY_PRIMITIVE_WORD_CAPS,
  FOUNDATION_MESSAGE_DERIVATIVE_CHIPS,
  FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS,
  FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS,
  FOUNDATION_MESSAGE_DRAFT_STATUSES,
  FOUNDATION_MESSAGE_FIELD_IDS,
  FOUNDATION_MESSAGE_FIELD_STATUSES,
  FOUNDATION_MESSAGE_FORM_TYPE,
  FOUNDATION_MESSAGE_GENERATE_HEADER,
  FOUNDATION_MESSAGE_HTTP_URL_REGEX,
  FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX,
  FOUNDATION_MESSAGE_KIND,
  FOUNDATION_MESSAGE_LIST_FIELD_IDS,
  FOUNDATION_MESSAGE_MAX_DOCUMENTS,
  FOUNDATION_MESSAGE_MAX_OTHER_LINKS,
  FOUNDATION_MESSAGE_MAX_PILLARS,
  FOUNDATION_MESSAGE_MAX_QUESTIONS,
  FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH,
  FOUNDATION_MESSAGE_NON_ANSWER_REGEX,
  FOUNDATION_MESSAGE_NONE_ANSWER,
  FOUNDATION_MESSAGE_OTHER_LINKS_KEY,
  FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX,
  FOUNDATION_MESSAGE_QUESTION_KEY_REGEX,
  FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID,
  FOUNDATION_MESSAGE_REQUIRED_HEADINGS,
  FOUNDATION_MESSAGE_SHA256_REGEX,
  FOUNDATION_MESSAGE_SOURCE_KINDS,
  FOUNDATION_MESSAGE_SOURCE_LABELS,
  FOUNDATION_MESSAGE_SOURCE_URL_KEYS,
  FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER,
  FOUNDATION_MESSAGE_VERBATIM_FIELD_IDS,
} from '../constants/foundation-message.constants';
import {
  FoundationMessageEnvelope,
  FoundationMessageField,
  FoundationMessageFormInputs,
  FoundationMessageFormPayload,
  FoundationMessageQuestion,
  FoundationMessageValidationResult,
} from '../interfaces/foundation-message.interface';
import { MktgRunAnswer, MktgRunAnswerOrigin, MktgRunQuestion } from '../interfaces/mktg-run.interface';
import { extractMktgEnvelopeCandidates } from './mktg-envelope.utils';

const ONE_LINE = /^[^\r\n]+$/;
const SOURCE_URL_KEYS: string[] = FOUNDATION_MESSAGE_SOURCE_KINDS.map((kind) => FOUNDATION_MESSAGE_SOURCE_URL_KEYS[kind]);
const FORM_ANSWER_KEYS = new Set<string>(['project_name', ...SOURCE_URL_KEYS, FOUNDATION_MESSAGE_OTHER_LINKS_KEY]);

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * The source URL an answer names, or null for a blank answer or Paul's
 * "none". Whatever else it is must already have passed
 * {@link validateFoundationMessageIntakeAnswers}.
 */
export function foundationMessageSourceUrl(answer: string | undefined): string | null {
  const trimmed = (answer ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === FOUNDATION_MESSAGE_NONE_ANSWER) {
    return null;
  }
  return trimmed;
}

/** The other links an answer lists, one per line, blank lines dropped. */
export function foundationMessageOtherLinks(answer: string | undefined): string[] {
  return (answer ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Validate a generate-request answers record: `project_name` required and one
 * line; the four source URLs optional — blank, "none", or an http(s) URL (the
 * agent's own rule); the other links optional, one http(s) URL per line; no
 * unknown keys. There are no questions on this form: the agent reads the
 * sources, researches, and asks only the gaps afterwards.
 */
export function validateFoundationMessageIntakeAnswers(answers: unknown): FoundationMessageValidationResult {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { valid: false, errors: ['answers must be an object keyed by intake field key'] };
  }
  const record = answers as Record<string, unknown>;
  const errors: string[] = [];

  const projectName = record['project_name'];
  if (typeof projectName !== 'string' || !projectName.trim() || !ONE_LINE.test(projectName.trim())) {
    errors.push('answers.project_name is required and must be one line');
  }

  for (const key of SOURCE_URL_KEYS) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string') {
      errors.push(`answers.${key} must be a string when provided`);
      continue;
    }
    const url = foundationMessageSourceUrl(value);
    if (url !== null && !FOUNDATION_MESSAGE_HTTP_URL_REGEX.test(url)) {
      errors.push(`answers.${key} must be an http(s) URL or "none"`);
    }
  }

  const otherLinks = record[FOUNDATION_MESSAGE_OTHER_LINKS_KEY];
  if (otherLinks !== undefined) {
    if (typeof otherLinks !== 'string') {
      errors.push(`answers.${FOUNDATION_MESSAGE_OTHER_LINKS_KEY} must be a string when provided`);
    } else {
      const links = foundationMessageOtherLinks(otherLinks);
      if (links.length > FOUNDATION_MESSAGE_MAX_OTHER_LINKS) {
        errors.push(`answers.${FOUNDATION_MESSAGE_OTHER_LINKS_KEY} takes at most ${FOUNDATION_MESSAGE_MAX_OTHER_LINKS} links`);
      }
      if (links.some((link) => !FOUNDATION_MESSAGE_HTTP_URL_REGEX.test(link))) {
        errors.push(`answers.${FOUNDATION_MESSAGE_OTHER_LINKS_KEY} must be http(s) URLs, one per line`);
      }
    }
  }

  for (const key of Object.keys(record)) {
    if (!FORM_ANSWER_KEYS.has(key)) {
      errors.push(`answers.${key} is not an intake field key`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a generate request's existing documents: at most
 * `FOUNDATION_MESSAGE_MAX_DOCUMENTS`; a link carries its URL and never text
 * (the agent fetches it); a file carries its title and the text the BFF
 * extracted from it.
 */
export function validateFoundationMessageDocuments(documents: unknown): FoundationMessageValidationResult {
  if (documents === undefined) {
    return { valid: true, errors: [] };
  }
  if (!Array.isArray(documents)) {
    return { valid: false, errors: ['documents must be an array when provided'] };
  }
  const errors: string[] = [];
  if (documents.length > FOUNDATION_MESSAGE_MAX_DOCUMENTS) {
    errors.push(`documents takes at most ${FOUNDATION_MESSAGE_MAX_DOCUMENTS} entries`);
  }
  // A cut text carries the marker, so allow for it on top of the cap.
  const maxTextChars = FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS + FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER.length;
  documents.forEach((entry: unknown, index) => {
    const at = `documents[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const doc = entry as Record<string, unknown>;
    const unknownKeys = Object.keys(doc).filter((key) => !['kind', 'title', 'url', 'text'].includes(key));
    if (unknownKeys.length > 0) {
      errors.push(`${at} has unknown keys: ${unknownKeys.join(', ')}`);
    }
    const title = doc['title'];
    if (typeof title !== 'string' || !title.trim() || !ONE_LINE.test(title.trim()) || title.trim().length > FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS) {
      errors.push(`${at}.title must be one non-empty line of at most ${FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS} characters`);
    }
    if (doc['kind'] === 'link') {
      const url = doc['url'];
      if (typeof url !== 'string' || !FOUNDATION_MESSAGE_HTTP_URL_REGEX.test(url.trim())) {
        errors.push(`${at}.url must be an http(s) URL`);
      }
      if (doc['text'] !== undefined) {
        errors.push(`${at}.text is not accepted for a link — the agent reads the link itself`);
      }
    } else if (doc['kind'] === 'file') {
      const text = doc['text'];
      if (typeof text !== 'string' || !text.trim() || text.length > maxTextChars) {
        errors.push(`${at}.text must be the file's non-empty text, at most ${FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS} characters`);
      }
      if (doc['url'] !== undefined) {
        errors.push(`${at}.url is not accepted for a file`);
      }
    } else {
      errors.push(`${at}.kind must be "link" or "file"`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// The generate form and its rendering (mirror of the agent's src/form.ts)
// ---------------------------------------------------------------------------

/**
 * Build the `messaging_document_intake_form` payload from a VALIDATED answers
 * record. The project name and links pass through trimmed but otherwise
 * verbatim; a "none" or blank source is omitted.
 */
export function buildFoundationMessageFormPayload(answers: Record<string, string>, inputs: FoundationMessageFormInputs = {}): FoundationMessageFormPayload {
  const payload: FoundationMessageFormPayload = { type: FOUNDATION_MESSAGE_FORM_TYPE, project_name: (answers['project_name'] ?? '').trim() };
  if (inputs.projectUid) {
    payload.project_uid = inputs.projectUid;
  }
  for (const kind of FOUNDATION_MESSAGE_SOURCE_KINDS) {
    const urlKey = FOUNDATION_MESSAGE_SOURCE_URL_KEYS[kind];
    const url = foundationMessageSourceUrl(answers[urlKey]);
    if (url !== null) {
      payload[urlKey] = url;
    }
  }
  const otherLinks = foundationMessageOtherLinks(answers[FOUNDATION_MESSAGE_OTHER_LINKS_KEY]);
  if (otherLinks.length > 0) {
    payload.other_links = otherLinks;
  }
  if (inputs.documents && inputs.documents.length > 0) {
    payload.existing_documents = inputs.documents;
  }
  if (inputs.runDate) {
    payload.run_date = inputs.runDate;
  }
  return payload;
}

/**
 * Embedded third-party text must not be able to forge a marker line: a line
 * that would start like one ("--- ", "===== ") gets one leading space. Only
 * such lines change; everything else passes byte for byte.
 */
export function guardFoundationMessageText(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('--- ') || line.startsWith('===== ') ? ` ${line}` : line))
    .join('\n');
}

/**
 * The GitHub organization avatar of a GitHub URL (`https://github.com/<owner>.png`),
 * the last fallback in the agent's logo order; null for any other URL. A
 * mirror of the agent's `githubAvatarUrl`: the rendered intake carries it on
 * its `LOGO FALLBACK` line.
 */
export function foundationMessageGithubAvatarUrl(githubUrl: string | undefined): string | null {
  if (githubUrl === undefined) {
    return null;
  }
  const match = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:[/?#]|$)/.exec(githubUrl);
  return match === null ? null : `https://github.com/${match[1]}.png`;
}

/**
 * Render the generate form into the one text message the agent receives — a
 * mirror of the agent's own `renderGenerate` (marketing-os-agents
 * `agents/foundation-message/src/form.ts`), byte-identical for the same
 * payload; foundation-message.utils.spec.ts pins renderings produced by that
 * renderer. The form is small on purpose: the project, the run date, its LFX
 * uid, the sources as URLs (the agent fetches and researches them itself;
 * nothing is read here) with the GitHub avatar as the logo fallback, the
 * other links, the existing documents — an uploaded file as its text, a link
 * as its URL — and the answers line, which declares all ten intake questions
 * open because this form asks none. The marker lines are load-bearing: the
 * agent's finalize tool parses the project name, uid, sources, documents and
 * answers back from them (`parseGenerate`), so any drift makes every run fail.
 *
 * Why the BFF renders instead of sending the typed payload as a structured
 * `agent_input`: Guild coerces a structured input to
 * `{type:'text', text: JSON.stringify(payload)}` before the agent's preprocess
 * runs (live smoke, 2026-08-20), so the model would receive raw JSON.
 */
export function renderFoundationMessageFormText(payload: FoundationMessageFormPayload, now: Date = new Date()): string {
  const runDate = payload.run_date ?? now.toISOString().slice(0, 10);
  const docs = payload.existing_documents ?? [];
  const otherLinks = payload.other_links ?? [];

  const lines: string[] = [
    FOUNDATION_MESSAGE_GENERATE_HEADER,
    `PROJECT NAME: ${payload.project_name}`,
    `RUN DATE: ${runDate}`,
    `LFX PROJECT UID: ${payload.project_uid ?? 'not supplied'}`,
    '',
    'SOURCES (URLs only — read each one yourself with the fetch tool; none = the requester has none):',
  ];
  for (const kind of FOUNDATION_MESSAGE_SOURCE_KINDS) {
    const url = payload[FOUNDATION_MESSAGE_SOURCE_URL_KEYS[kind]];
    lines.push(`SOURCE ${kind} (${FOUNDATION_MESSAGE_SOURCE_LABELS[kind]}): ${url ?? 'none'}`);
  }
  lines.push(`LOGO FALLBACK (GitHub organization avatar, last in the logo order): ${foundationMessageGithubAvatarUrl(payload.github_url) ?? 'none'}`);
  lines.push(`OTHER LINKS: ${otherLinks.length === 0 ? 'none' : `${otherLinks.length} — read each one`}`);
  otherLinks.forEach((link) => lines.push(`- ${link}`));
  lines.push('');

  lines.push(`EXISTING DOCUMENTS: ${docs.length === 0 ? 'none supplied' : `${docs.length} supplied — read every one in full and map it first`}`);
  docs.forEach((doc, index) => {
    const n = index + 1;
    lines.push(`--- DOCUMENT ${n}: ${doc.title ?? doc.url ?? `document ${n}`} ---`);
    lines.push(`URL: ${doc.url ?? 'none'}`);
    if (doc.text === undefined) {
      lines.push('TEXT: not supplied — read the URL yourself');
    } else {
      lines.push('TEXT: read by LFX One, follows', guardFoundationMessageText(doc.text));
    }
    lines.push(`--- END DOCUMENT ${n} ---`);
  });
  lines.push('');

  // This form carries no answers, so every intake question is open: the agent
  // answers what its research can and asks back the rest.
  lines.push(`ANSWERS ON THE FORM: 0 of ${FOUNDATION_MESSAGE_ANSWER_KEYS.length} — open: ${FOUNDATION_MESSAGE_ANSWER_KEYS.join(', ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The questions turn (messaging-document-questions/v1) and the answers turn
// (messaging-document-answers/v1)
// ---------------------------------------------------------------------------

/** The links a question's `basis` names: a list, a single string, or nothing. */
function basisLinks(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return (value as string[]).map((entry) => entry.trim()).filter((entry) => entry !== '');
  }
  return null;
}

/**
 * The agent's questions block as the run shell takes it, or null when the
 * candidate is not one: the contract id, a `questions` list of one to
 * `FOUNDATION_MESSAGE_MAX_QUESTIONS` entries with unique snake_case keys, a
 * label and a question each. `why`, `suggested_answer` and `basis` are read
 * leniently (absent is empty): a question without a suggestion is one the
 * requester answers from scratch.
 */
export function readFoundationMessageQuestions(candidate: unknown): MktgRunQuestion[] | null {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const block = candidate as Record<string, unknown>;
  if (block['contract'] !== FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID || !Array.isArray(block['questions'])) {
    return null;
  }
  const entries = block['questions'] as unknown[];
  if (entries.length === 0 || entries.length > FOUNDATION_MESSAGE_MAX_QUESTIONS) {
    return null;
  }
  const questions: MktgRunQuestion[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return null;
    }
    const question = entry as Partial<FoundationMessageQuestion>;
    const key = typeof question.key === 'string' ? question.key.trim() : '';
    const label = typeof question.label === 'string' ? question.label.trim() : '';
    const text = typeof question.question === 'string' ? question.question.trim() : '';
    const basis = basisLinks(question.basis);
    if (!FOUNDATION_MESSAGE_QUESTION_KEY_REGEX.test(key) || seen.has(key) || !label || !text || basis === null) {
      return null;
    }
    seen.add(key);
    questions.push({
      key,
      label,
      question: text,
      why: typeof question.why === 'string' ? question.why.trim() : '',
      suggestedAnswer: typeof question.suggested_answer === 'string' ? question.suggested_answer.trim() : '',
      basis,
    });
  }
  return questions;
}

/**
 * The questions block in one text the agent itself wrote (an agent text turn
 * out of `extractMktgAgentTexts`), when it carries one: the latest valid
 * block wins. Lenient about where in the text it sits — any JSON object
 * whose contract is the questions contract, inside the fenced ```json block
 * of the questions turn or not — because the exact event type the agent's
 * text turn rides is Guild's to choose. Never hand it a whole event payload
 * or a tool result: a page the agent fetched could carry a block too, and
 * only the agent's own text counts.
 */
export function extractFoundationMessageQuestions(agentText: string): MktgRunQuestion[] | null {
  let found: MktgRunQuestion[] | null = null;
  for (const candidate of extractMktgEnvelopeCandidates(agentText, FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID)) {
    found = readFoundationMessageQuestions(candidate) ?? found;
  }
  return found;
}

/**
 * A stable id for a questions block — FNV-1a over its JSON, as eight hex
 * digits. Platform-neutral (no node:crypto): it tells one block from
 * another so the run shell never re-asks a block it already answered, and
 * needs nothing stronger than that.
 */
export function foundationMessageQuestionsId(questions: MktgRunQuestion[]): string {
  const text = JSON.stringify(questions);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Where an answer came from: the suggestion unchanged, an edited one, or the requester's own where there was none. */
export function foundationMessageAnswerOrigin(text: string, suggestedAnswer: string): MktgRunAnswerOrigin {
  const suggestion = suggestedAnswer.trim();
  if (!suggestion) {
    return 'requester';
  }
  return text.trim() === suggestion ? 'accepted' : 'edited';
}

/** True when the text is a real answer — not blank, not a skip, not a TBD. */
export function isFoundationMessageAnswerSubstantive(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== '' && !FOUNDATION_MESSAGE_NON_ANSWER_REGEX.test(trimmed);
}

/**
 * Validate the answers of an answers request: one to
 * `FOUNDATION_MESSAGE_MAX_QUESTIONS` entries, each a `{ key, text, origin }`
 * with a unique snake_case key, a substantive text (no skip, no TBD, no
 * empty) within the length cap, and a known origin; no unknown keys.
 */
export function validateFoundationMessageAnswers(answers: unknown): FoundationMessageValidationResult {
  if (!Array.isArray(answers)) {
    return { valid: false, errors: ['answers must be an array'] };
  }
  const errors: string[] = [];
  if (answers.length === 0 || answers.length > FOUNDATION_MESSAGE_MAX_QUESTIONS) {
    errors.push(`answers takes 1 to ${FOUNDATION_MESSAGE_MAX_QUESTIONS} entries`);
  }
  const seen = new Set<string>();
  answers.forEach((entry: unknown, index) => {
    const at = `answers[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const answer = entry as Record<string, unknown>;
    const unknownKeys = Object.keys(answer).filter((key) => !['key', 'text', 'origin'].includes(key));
    if (unknownKeys.length > 0) {
      errors.push(`${at} has unknown keys: ${unknownKeys.join(', ')}`);
    }
    const key = answer['key'];
    if (typeof key !== 'string' || !FOUNDATION_MESSAGE_QUESTION_KEY_REGEX.test(key)) {
      errors.push(`${at}.key must be a snake_case question key`);
    } else if (seen.has(key)) {
      errors.push(`${at}.key repeats ${key}`);
    } else {
      seen.add(key);
    }
    const text = answer['text'];
    if (typeof text !== 'string' || !isFoundationMessageAnswerSubstantive(text)) {
      errors.push(`${at}.text must be an answer — not empty, not a skip, not a TBD`);
    } else if (text.length > FOUNDATION_MESSAGE_ANSWER_MAX_CHARS) {
      errors.push(`${at}.text must be at most ${FOUNDATION_MESSAGE_ANSWER_MAX_CHARS} characters`);
    }
    if (!(FOUNDATION_MESSAGE_ANSWER_ORIGINS as readonly string[]).includes(answer['origin'] as string)) {
      errors.push(`${at}.origin must be one of ${FOUNDATION_MESSAGE_ANSWER_ORIGINS.join(', ')}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * Render the answers turn (messaging-document-answers/v1) the agent parses
 * back: the header, then per answer `--- A <key> (<origin>) ---`,
 * `ANSWER: follows`, the text, `--- END A <key> ---`. Sent as a follow-up on
 * the session that asked the questions.
 */
export function renderFoundationMessageAnswersText(answers: MktgRunAnswer[]): string {
  const lines: string[] = [FOUNDATION_MESSAGE_ANSWERS_HEADER];
  for (const answer of answers) {
    lines.push(`--- A ${answer.key} (${answer.origin}) ---`, 'ANSWER: follows', guardFoundationMessageText(answer.text.trim()), `--- END A ${answer.key} ---`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Envelope gates (contract §1a)
// ---------------------------------------------------------------------------

/**
 * Contract word count: a whitespace-delimited token containing at least one
 * Unicode letter or digit. Reproduces the agent wrapper's `countWords`.
 */
export function countFoundationMessageWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Index of the line a required heading starts, mirroring the agent: case-insensitive, curly apostrophes tolerated, qualifier boundary. */
function headingLineIndex(lines: string[], heading: string): number {
  const want = heading.toLowerCase();
  return lines.findIndex((raw) => {
    const line = raw.replace(/[‘’]/g, "'").toLowerCase();
    return line.startsWith(want) && (line.length === want.length || /^[\s(:—-]/.test(line.slice(want.length)));
  });
}

/** The required headings missing from the document. */
export function findMissingFoundationMessageHeadings(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split(/\r?\n/);
  return FOUNDATION_MESSAGE_REQUIRED_HEADINGS.filter((heading) => headingLineIndex(lines, heading) < 0);
}

/** Required headings that appear out of the template's order. */
export function findFoundationMessageHeadingOrderViolations(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split(/\r?\n/);
  const violations: string[] = [];
  let cursor = -1;
  for (const heading of FOUNDATION_MESSAGE_REQUIRED_HEADINGS) {
    const index = headingLineIndex(lines, heading);
    if (index < 0) {
      continue;
    }
    if (index <= cursor) {
      violations.push(`'${heading}' is out of the template's order`);
    } else {
      cursor = index;
    }
  }
  return violations;
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) {
    count++;
  }
  return count;
}

/** Shape check of one sidecar field; returns the error or null. */
function fieldShapeError(id: string, field: unknown): string | null {
  if (typeof field !== 'object' || field === null || Array.isArray(field)) {
    return `fields.${id} must be an object`;
  }
  const { value, source, status } = field as Partial<FoundationMessageField>;
  const isList = (FOUNDATION_MESSAGE_LIST_FIELD_IDS as readonly string[]).includes(id);
  const valueOk = isList ? Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null) : typeof value === 'string' && !!value;
  if (!valueOk) {
    return `fields.${id}.value must be ${isList ? 'a list of objects' : 'a non-empty string'}`;
  }
  if (typeof source !== 'string' || !source) {
    return `fields.${id}.source must be a non-empty string`;
  }
  if (!(FOUNDATION_MESSAGE_FIELD_STATUSES as readonly string[]).includes(status ?? '')) {
    return `fields.${id}.status must be one of ${FOUNDATION_MESSAGE_FIELD_STATUSES.join(', ')}`;
  }
  return null;
}

/**
 * The sidecar against the document — gates F1–F4 of the agent's
 * `fieldViolations`, re-run BFF-side over shape-valid fields. These are the
 * wrapper's own deterministic gates, so an envelope that really came from the
 * finalize tool always passes; re-running them is what keeps a
 * shape-compatible draft the model printed mid-run from being stored.
 */
export function findFoundationMessageFieldViolations(fields: Record<string, FoundationMessageField>, documentMarkdown: string): string[] {
  const violations: string[] = [];
  const text = (id: string): string => (typeof fields[id]?.value === 'string' ? (fields[id].value as string) : '');

  for (const [id, cap] of Object.entries(FOUNDATION_MESSAGE_COPY_PRIMITIVE_WORD_CAPS)) {
    const words = countFoundationMessageWords(text(id));
    if (words > cap) {
      violations.push(`F1: ${id} is ${words} words — the hard cap is ${cap}`);
    }
  }
  if (fields['md.boilerplate'].status !== 'tbd') {
    const words = countFoundationMessageWords(text('md.boilerplate'));
    if (words < FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.min || words > FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.max) {
      violations.push(
        `F2: md.boilerplate is ${words} words — the gate is ${FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.min}-${FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.max}`
      );
    }
  }
  if (fields['md.llms_txt'].status !== 'tbd') {
    const first = text('md.llms_txt')
      .split(/\r?\n/)
      .find((line) => line.trim() !== '');
    if (first === undefined || !first.trimStart().startsWith('# ')) {
      violations.push("F2: md.llms_txt must start with an '# ' H1 line");
    }
  }
  for (const id of FOUNDATION_MESSAGE_VERBATIM_FIELD_IDS) {
    if (!documentMarkdown.includes(text(id))) {
      violations.push(`F3: ${id} does not appear verbatim in document_markdown`);
    }
  }
  if (fields['md.positioning'].status !== 'tbd' && occurrences(documentMarkdown, text('md.positioning')) < 2) {
    violations.push('F3: md.positioning must appear verbatim in both §1 and §2');
  }
  const list = (id: string): Record<string, unknown>[] => (Array.isArray(fields[id]?.value) ? (fields[id].value as Record<string, unknown>[]) : []);
  for (const id of FOUNDATION_MESSAGE_LIST_FIELD_IDS) {
    if (fields[id].status !== 'tbd' && list(id).length === 0) {
      violations.push(`F4: ${id} is empty but not tbd`);
    }
  }
  for (const id of ['md.pillars', 'md.objections']) {
    if (list(id).length > FOUNDATION_MESSAGE_MAX_PILLARS) {
      violations.push(`F4: ${id} has more than ${FOUNDATION_MESSAGE_MAX_PILLARS} entries`);
    }
  }
  const tags = list('md.pillars').map((pillar) => pillar['tag']);
  const columns = list('md.message_matrix').map((column) => column['pillar']);
  if (fields['md.message_matrix'].status !== 'tbd' && (columns.length !== tags.length || columns.some((column) => !tags.includes(column)))) {
    violations.push('F4: md.message_matrix must have exactly one column per pillar, each naming a pillar tag');
  }
  return violations;
}

/** The document gates: length, title line and the required headings in order. */
function documentErrors(documentMarkdown: unknown): string[] {
  if (typeof documentMarkdown !== 'string' || documentMarkdown.length < FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH) {
    return [`document_markdown must be a string of at least ${FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH} characters`];
  }
  const errors: string[] = [];
  const first = documentMarkdown.split(/\r?\n/).find((line) => line.trim() !== '');
  if (first === undefined || !/^# \S.* Messaging Document\s*$/.test(first)) {
    errors.push('document_markdown must open with the title "# [Project Name] Messaging Document"');
  }
  const missing = findMissingFoundationMessageHeadings(documentMarkdown);
  if (missing.length > 0) {
    errors.push(`document_markdown is missing required headings: ${missing.join(' | ')}`);
  }
  errors.push(...findFoundationMessageHeadingOrderViolations(documentMarkdown).map((violation) => `document_markdown: ${violation}`));
  return errors;
}

/** The sidecar gates: all 23 fields shape-valid, none approved on a generate, then F1–F4. */
function fieldsErrors(fields: unknown, mode: unknown, documentMarkdown: unknown): string[] {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return ['fields must be an object'];
  }
  const record = fields as Record<string, unknown>;
  const errors = FOUNDATION_MESSAGE_FIELD_IDS.map((id) => fieldShapeError(id, record[id])).filter((error): error is string => error !== null);
  if (errors.length > 0) {
    return errors;
  }
  const typed = record as Record<string, FoundationMessageField>;
  if (mode === 'generate') {
    const approved = FOUNDATION_MESSAGE_FIELD_IDS.filter((id) => typed[id].status === 'approved');
    if (approved.length > 0) {
      errors.push(`fields approved on a new draft: ${approved.join(', ')} — only the reviewer's Approve approves`);
    }
  }
  if (typeof documentMarkdown === 'string') {
    errors.push(...findFoundationMessageFieldViolations(typed, documentMarkdown));
  }
  return errors;
}

/** The provenance gates: brand seed, inputs record, intake, revision, capabilities, timestamps and the producer. */
function provenanceErrors(envelope: Partial<FoundationMessageEnvelope>): string[] {
  const errors: string[] = [];
  const isObject = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
  const isTimestamp = (value: unknown): boolean =>
    typeof value === 'string' && FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX.test(value) && !Number.isNaN(new Date(value).getTime());

  const seed = envelope.brand_seed;
  const logo = seed?.logo;
  const logoOk =
    isObject(logo) && [logo?.light, logo?.dark].every((url) => url === null || (typeof url === 'string' && FOUNDATION_MESSAGE_HTTP_URL_REGEX.test(url)));
  if (!isObject(seed) || typeof seed?.project_name !== 'string' || !logoOk || !isObject(seed?._source)) {
    errors.push('brand_seed must carry project_name, logo { light, dark } as URLs or null, and _source');
  }
  if (envelope.inputs_record !== null && !isObject(envelope.inputs_record)) {
    errors.push('inputs_record must be an object or null');
  }
  if (!isObject(envelope.intake) || envelope.intake?.mode !== 'form' || !isTimestamp(envelope.intake?.completed_at)) {
    errors.push('intake must be { mode: "form", shape, completed_at }');
  }
  if (envelope.revision !== null && !isObject(envelope.revision)) {
    errors.push('revision must be an object or null');
  }
  if (!isObject(envelope.capabilities)) {
    errors.push('capabilities must be an object');
  }
  if (!isTimestamp(envelope.generated_at)) {
    errors.push('generated_at must be an ISO-8601 timestamp');
  }
  const agent = envelope.agent;
  if (!isObject(agent) || agent?.identifier !== FOUNDATION_MESSAGE_AGENT_IDENTIFIER || !/^\d+\.\d+\.\d+$/.test(agent?.agent_version ?? '')) {
    errors.push(`agent must name ${FOUNDATION_MESSAGE_AGENT_IDENTIFIER} and its semver version`);
  }
  return errors;
}

/**
 * Validate a candidate Messaging Document envelope against the v1 contract:
 * the schema gates, the document's title and 14 required headings in order,
 * a draft status, and the sidecar gates F1–F4. Hash equality is the caller's
 * job — see the module note.
 */
export function validateFoundationMessageEnvelope(candidate: unknown): FoundationMessageValidationResult {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }
  const envelope = candidate as Partial<FoundationMessageEnvelope>;
  const errors: string[] = [];

  if (envelope.contract !== FOUNDATION_MESSAGE_CONTRACT_ID) {
    // Reject unknown contract majors outright — never interpret them.
    errors.push(`contract must be "${FOUNDATION_MESSAGE_CONTRACT_ID}" (got ${JSON.stringify(envelope.contract ?? null)})`);
  }
  if (envelope.kind !== FOUNDATION_MESSAGE_KIND) {
    errors.push(`kind must be "${FOUNDATION_MESSAGE_KIND}"`);
  }
  if (typeof envelope.project !== 'string' || !FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX.test(envelope.project)) {
    errors.push('project must be a lowercase kebab-case slug');
  }
  if (typeof envelope.project_name !== 'string' || !envelope.project_name.trim()) {
    errors.push('project_name must be a non-empty string');
  }
  if (typeof envelope.version !== 'number' || !Number.isInteger(envelope.version) || envelope.version < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (envelope.mode !== 'generate' && envelope.mode !== 'revise') {
    errors.push('mode must be "generate" or "revise"');
  }
  if (typeof envelope.status !== 'string' || !FOUNDATION_MESSAGE_DRAFT_STATUSES.some((label) => (envelope.status as string).startsWith(label))) {
    errors.push(`status must start with one of the draft labels: ${FOUNDATION_MESSAGE_DRAFT_STATUSES.join(' | ')}`);
  }
  if (typeof envelope.content_sha256 !== 'string' || !FOUNDATION_MESSAGE_SHA256_REGEX.test(envelope.content_sha256)) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }

  errors.push(...documentErrors(envelope.document_markdown));
  errors.push(...fieldsErrors(envelope.fields, envelope.mode, envelope.document_markdown));
  errors.push(...provenanceErrors(envelope));

  return { valid: errors.length === 0, errors };
}

/**
 * The five copy primitives of a validated envelope, keyed by the run shell's
 * derivative chip keys. A `tbd` primitive is left out — a chip must never
 * offer "Needs input" as copy.
 */
export function foundationMessageDerivatives(envelope: FoundationMessageEnvelope): Record<string, string> {
  const derivatives: Record<string, string> = {};
  for (const chip of FOUNDATION_MESSAGE_DERIVATIVE_CHIPS) {
    const field = envelope.fields[chip.field];
    if (field && field.status !== 'tbd' && typeof field.value === 'string' && field.value.trim()) {
      derivatives[chip.key] = field.value;
    }
  }
  return derivatives;
}
