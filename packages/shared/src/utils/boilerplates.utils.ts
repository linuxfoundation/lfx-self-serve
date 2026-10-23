// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure Boilerplates helpers (boilerplates-output/v1 and the questions/answers
// turns): request validation, the draft form payload and its rendering into
// the one text message the agent receives, the questions block the agent
// sends back, the answers turn LFX One renders, the agent's end-of-run reply,
// envelope validation, and the view model of the Boilerplates view. The
// SHA-256 recompute is deliberately NOT here — hashing is
// environment-specific (node:crypto on the server) and the shared package
// stays platform-neutral; callers recompute the hash and compare against
// `envelope.content_sha256`.

import {
  BOILERPLATES_AGENT_IDENTIFIER,
  BOILERPLATES_AGENT_VERSION_REGEX,
  BOILERPLATES_ANSWER_MAX_CHARS,
  BOILERPLATES_ANSWERS_HEADER,
  BOILERPLATES_CONTENT_KEYS,
  BOILERPLATES_CONTRACT_ID,
  BOILERPLATES_DRAFT_HEADER,
  BOILERPLATES_FIELD_KEYS,
  BOILERPLATES_FORM_LINES,
  BOILERPLATES_FORM_TYPE,
  BOILERPLATES_FRAMEWORK_ANSWER_KEY,
  BOILERPLATES_FRAMEWORK_CONTRACT_ID,
  BOILERPLATES_HTTP_URL_REGEX,
  BOILERPLATES_ISO_DATE_REGEX,
  BOILERPLATES_ISO_TIMESTAMP_REGEX,
  BOILERPLATES_KIND,
  BOILERPLATES_LENGTH_HINTS,
  BOILERPLATES_LENGTHS,
  BOILERPLATES_MAX_FRAMEWORK_CHARS,
  BOILERPLATES_MAX_QUESTIONS,
  BOILERPLATES_MODES,
  BOILERPLATES_PROJECT_SLUG_REGEX,
  BOILERPLATES_QUESTIONS_CONTRACT_ID,
  BOILERPLATES_REFUSAL_CLAUSES,
  BOILERPLATES_REFUSAL_OPENINGS,
  BOILERPLATES_SHA256_REGEX,
} from '../constants/boilerplates.constants';
import {
  FOUNDATION_MESSAGE_ANSWER_ORIGINS,
  FOUNDATION_MESSAGE_NONE_ANSWER,
  FOUNDATION_MESSAGE_QUESTION_ID_MAX_CHARS,
  FOUNDATION_MESSAGE_QUESTION_ID_REGEX,
} from '../constants/foundation-message.constants';
import {
  BoilerplatesChecks,
  BoilerplatesContent,
  BoilerplatesEnvelope,
  BoilerplatesFormInputs,
  BoilerplatesFormPayload,
  BoilerplatesLengthRow,
  BoilerplatesMode,
  BoilerplatesReport,
  BoilerplatesValidationResult,
} from '../interfaces/boilerplates.interface';
import { FoundationMessageQuestion } from '../interfaces/foundation-message.interface';
import { MktgBoilerplatesAsset, MktgRunAnswer, MktgRunQuestion } from '../interfaces/mktg-run.interface';
import { foundationMessageBasisLinks, foundationMessageQuestionLabel, isFoundationMessageAnswerSubstantive } from './foundation-message.utils';
import { extractMktgEnvelopeCandidates } from './mktg-envelope.utils';
import { MKTG_INTAKE_ANSWER_LIMITS } from '../constants/mktg-intake.constants';
import { validateMktgIntakeAnswerLengths } from './mktg-intake-validation.utils';

const ONE_LINE = /^[^\r\n]+$/;
const FORM_ANSWER_KEYS = new Set<string>([...Object.values(BOILERPLATES_FIELD_KEYS), BOILERPLATES_FRAMEWORK_ANSWER_KEY]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && BOILERPLATES_ISO_TIMESTAMP_REGEX.test(value) && !Number.isNaN(new Date(value).getTime());
}

function isQuestionId(id: string): boolean {
  return FOUNDATION_MESSAGE_QUESTION_ID_REGEX.test(id) && id.length <= FOUNDATION_MESSAGE_QUESTION_ID_MAX_CHARS;
}

// ---------------------------------------------------------------------------
// The messaging framework the run attaches
// ---------------------------------------------------------------------------

/**
 * Whether a value is a messaging framework's content: an object with an
 * `mf` (the framework) or `mh` (the message house) object — the agent's own
 * `isFrameworkContent` (src/form.ts), the rule its gate refuses a run by.
 */
export function isBoilerplatesFrameworkContent(value: unknown): value is UnknownRecord {
  return isRecord(value) && (isRecord(value['mf']) || isRecord(value['mh']));
}

/**
 * The framework's content from a stored messaging framework revision: the
 * content itself, or the `messaging-framework-output/v1` envelope as the
 * document store's sidecar read rebuilds it (the content back under
 * `content`), unwrapped — the agent's `frameworkContentOf`. Null when it is
 * neither, which the agent would refuse: a revision whose sidecar does not
 * carry the framework is never sent.
 */
export function boilerplatesFrameworkContentOf(value: UnknownRecord): UnknownRecord | null {
  if (isBoilerplatesFrameworkContent(value)) {
    return value;
  }
  const content = value['content'];
  if (value['contract'] === BOILERPLATES_FRAMEWORK_CONTRACT_ID && isBoilerplatesFrameworkContent(content)) {
    return content;
  }
  return null;
}

/** The framework's content from the attachment's JSON text, or null when the text is not JSON or not a framework. */
export function parseBoilerplatesFramework(text: string): UnknownRecord | null {
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? boilerplatesFrameworkContentOf(parsed) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/** The URL an optional answer names, or null for a blank answer or "none". */
export function boilerplatesOptionalUrl(answer: string | undefined): string | null {
  const trimmed = (answer ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === FOUNDATION_MESSAGE_NONE_ANSWER) {
    return null;
  }
  return trimmed;
}

/**
 * Validate a generate-request answers record: `project_name` required and
 * one line; `website_url` optional — blank, "none", or an http(s) URL (its
 * host is the domain the 100-word version ends on); `notes` optional free
 * text; the messaging framework (`BOILERPLATES_FRAMEWORK_ANSWER_KEY`)
 * required — the latest stored revision's JSON, at most
 * `BOILERPLATES_MAX_FRAMEWORK_CHARS` characters, carrying the framework's
 * content ({@link parseBoilerplatesFramework}); no unknown keys. There are no
 * questions on this form: the agent reads its sources and asks only the gaps.
 */
export function validateBoilerplatesIntakeAnswers(answers: unknown): BoilerplatesValidationResult {
  if (!isRecord(answers)) {
    return { valid: false, errors: ['answers must be an object keyed by intake field key'] };
  }
  const errors = validateMktgIntakeAnswerLengths(answers, MKTG_INTAKE_ANSWER_LIMITS.boilerplates);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const projectName = answers[BOILERPLATES_FIELD_KEYS.projectName];
  if (typeof projectName !== 'string' || !projectName.trim() || !ONE_LINE.test(projectName.trim())) {
    errors.push(`answers.${BOILERPLATES_FIELD_KEYS.projectName} is required and must be one line`);
  }

  const website = answers[BOILERPLATES_FIELD_KEYS.websiteUrl];
  if (website !== undefined) {
    if (typeof website !== 'string') {
      errors.push(`answers.${BOILERPLATES_FIELD_KEYS.websiteUrl} must be a string when provided`);
    } else {
      const url = boilerplatesOptionalUrl(website);
      if (url !== null && !BOILERPLATES_HTTP_URL_REGEX.test(url)) {
        errors.push(`answers.${BOILERPLATES_FIELD_KEYS.websiteUrl} must be an http(s) URL or "none"`);
      }
    }
  }

  const notes = answers[BOILERPLATES_FIELD_KEYS.notes];
  if (notes !== undefined && typeof notes !== 'string') {
    errors.push(`answers.${BOILERPLATES_FIELD_KEYS.notes} must be a string when provided`);
  }

  // The messaging framework is required: the boilerplates carry its
  // positioning and proof. A revision that does not carry the framework is
  // refused here, not by the agent minutes later.
  const framework = answers[BOILERPLATES_FRAMEWORK_ANSWER_KEY];
  if (typeof framework !== 'string' || !framework.trim()) {
    errors.push(`answers.${BOILERPLATES_FRAMEWORK_ANSWER_KEY} is required: the project needs a messaging framework first`);
  } else if (framework.length > BOILERPLATES_MAX_FRAMEWORK_CHARS) {
    errors.push(`answers.${BOILERPLATES_FRAMEWORK_ANSWER_KEY} must be at most ${BOILERPLATES_MAX_FRAMEWORK_CHARS} characters`);
  } else if (parseBoilerplatesFramework(framework) === null) {
    errors.push(
      `answers.${BOILERPLATES_FRAMEWORK_ANSWER_KEY} must be a JSON object carrying the framework (mf or mh), or the ${BOILERPLATES_FRAMEWORK_CONTRACT_ID} envelope wrapping it as content`
    );
  }

  for (const key of Object.keys(answers)) {
    if (!FORM_ANSWER_KEYS.has(key)) {
      errors.push(`answers.${key} is not an intake field key`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// The draft form and its rendering (mirror of the agent's src/form.ts)
// ---------------------------------------------------------------------------

/**
 * Build the `boilerplates_intake_form` payload from a VALIDATED answers
 * record. The project name and the website pass through trimmed but
 * otherwise verbatim; a "none" or blank website is omitted, as are blank
 * notes; the framework is its content, unwrapped from the stored envelope.
 */
export function buildBoilerplatesFormPayload(answers: Record<string, string>, inputs: BoilerplatesFormInputs = {}): BoilerplatesFormPayload {
  const payload: BoilerplatesFormPayload = {
    type: BOILERPLATES_FORM_TYPE,
    project_name: (answers[BOILERPLATES_FIELD_KEYS.projectName] ?? '').trim(),
  };
  if (inputs.runDate) {
    payload.run_date = inputs.runDate;
  }
  if (inputs.projectUid) {
    payload.project_uid = inputs.projectUid;
  }
  const website = boilerplatesOptionalUrl(answers[BOILERPLATES_FIELD_KEYS.websiteUrl]);
  if (website !== null) {
    payload.website_url = website;
  }
  const notes = (answers[BOILERPLATES_FIELD_KEYS.notes] ?? '').trim();
  if (notes) {
    payload.notes = notes;
  }
  const framework = parseBoilerplatesFramework(answers[BOILERPLATES_FRAMEWORK_ANSWER_KEY] ?? '');
  if (framework !== null) {
    payload.messaging_framework = framework;
  }
  return payload;
}

/**
 * Embedded third-party text must not be able to forge a marker line: a line
 * that would start like one ("--- ", "===== ") gets one leading space. Only
 * such lines change; everything else passes byte for byte (the agent's
 * `guardText`).
 */
export function guardBoilerplatesText(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('--- ') || line.startsWith('===== ') ? ` ${line}` : line))
    .join('\n');
}

/**
 * Render the draft form into the one text message the agent receives — a
 * mirror of the agent's own `renderFormMessage` for a draft (marketing-os-agents
 * `agents/boilerplates/src/form.ts`), byte-identical for the same payload;
 * boilerplates.utils.spec.ts pins renderings produced by that renderer. The
 * marker lines are load-bearing: the agent's tools parse the project name,
 * the uid, the website, the notes and the framework back from them
 * (`parseFormMessage`), so any drift makes every run fail. The BFF renders
 * because Guild coerces a structured `agent_input` to JSON text before the
 * agent's preprocess runs.
 */
export function renderBoilerplatesFormText(payload: BoilerplatesFormPayload, now: Date = new Date()): string {
  const runDate = payload.run_date ?? now.toISOString().slice(0, 10);
  const lines: string[] = [
    BOILERPLATES_DRAFT_HEADER,
    `PROJECT NAME: ${payload.project_name}`,
    `RUN DATE: ${runDate}`,
    `LFX PROJECT UID: ${payload.project_uid ?? BOILERPLATES_FORM_LINES.uidNotSupplied}`,
    `WEBSITE: ${payload.website_url ?? BOILERPLATES_FORM_LINES.none}`,
  ];
  if (payload.notes === undefined) {
    lines.push(BOILERPLATES_FORM_LINES.notesNone);
  } else {
    lines.push(BOILERPLATES_FORM_LINES.notesFollow, guardBoilerplatesText(payload.notes), BOILERPLATES_FORM_LINES.notesEnd);
  }
  lines.push('');
  if (payload.messaging_framework === undefined) {
    lines.push(BOILERPLATES_FORM_LINES.frameworkNone);
  } else {
    // The envelope as stored is rendered as its content, as the agent's renderer does.
    const content = boilerplatesFrameworkContentOf(payload.messaging_framework) ?? payload.messaging_framework;
    lines.push(
      BOILERPLATES_FORM_LINES.frameworkSupplied,
      BOILERPLATES_FORM_LINES.frameworkStart,
      guardBoilerplatesText(JSON.stringify(content, null, 2)),
      BOILERPLATES_FORM_LINES.frameworkEnd
    );
  }
  lines.push('');
  lines.push(BOILERPLATES_FORM_LINES.revisionNone);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The questions turn (boilerplates-questions/v1) and the answers turn
// (boilerplates-answers/v1)
// ---------------------------------------------------------------------------

/**
 * The agent's questions block as the run shell takes it, or null when the
 * candidate is not one: the contract id, a `questions` list of one to
 * `BOILERPLATES_MAX_QUESTIONS` entries with unique kebab-case ids and a
 * question each. `why`, `suggested_answer` and `basis` are read leniently
 * (absent is empty): a question without a suggestion is one the requester
 * answers from scratch.
 */
export function readBoilerplatesQuestions(candidate: unknown): MktgRunQuestion[] | null {
  if (!isRecord(candidate) || candidate['contract'] !== BOILERPLATES_QUESTIONS_CONTRACT_ID || !Array.isArray(candidate['questions'])) {
    return null;
  }
  const entries = candidate['questions'] as unknown[];
  if (entries.length === 0 || entries.length > BOILERPLATES_MAX_QUESTIONS) {
    return null;
  }
  const questions: MktgRunQuestion[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) {
      return null;
    }
    const question = entry as Partial<FoundationMessageQuestion>;
    const id = typeof question.id === 'string' ? question.id.trim() : '';
    const text = typeof question.question === 'string' ? question.question.trim() : '';
    const basis = question.basis === undefined ? '' : question.basis;
    if (!isQuestionId(id) || seen.has(id) || !text || typeof basis !== 'string') {
      return null;
    }
    seen.add(id);
    questions.push({
      key: id,
      label: foundationMessageQuestionLabel(id),
      question: text,
      why: typeof question.why === 'string' ? question.why.trim() : '',
      suggestedAnswer: typeof question.suggested_answer === 'string' ? question.suggested_answer.trim() : '',
      basis: foundationMessageBasisLinks(basis),
    });
  }
  return questions;
}

/**
 * The questions block in one text the agent itself wrote (an agent text turn
 * out of `extractMktgAgentTexts`), when it carries one: the latest valid
 * block wins. Never hand it a whole event payload or a tool result: a page
 * the agent fetched could carry a block too, and only the agent's own text
 * counts.
 */
export function extractBoilerplatesQuestions(agentText: string): MktgRunQuestion[] | null {
  let found: MktgRunQuestion[] | null = null;
  for (const candidate of extractMktgEnvelopeCandidates(agentText, BOILERPLATES_QUESTIONS_CONTRACT_ID)) {
    found = readBoilerplatesQuestions(candidate) ?? found;
  }
  return found;
}

/**
 * Validate the answers of an answers request: one to
 * `BOILERPLATES_MAX_QUESTIONS` entries, each a `{ key, text, origin }` with a
 * unique kebab-case id as its key, a substantive text (no skip, no TBD, no
 * empty) within the length cap, and a known origin; no unknown keys.
 */
export function validateBoilerplatesAnswers(answers: unknown): BoilerplatesValidationResult {
  if (!Array.isArray(answers)) {
    return { valid: false, errors: ['answers must be an array'] };
  }
  const errors: string[] = [];
  if (answers.length === 0 || answers.length > BOILERPLATES_MAX_QUESTIONS) {
    errors.push(`answers takes 1 to ${BOILERPLATES_MAX_QUESTIONS} entries`);
  }
  const seen = new Set<string>();
  answers.forEach((entry: unknown, index) => {
    const at = `answers[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const unknownKeys = Object.keys(entry).filter((key) => !['key', 'text', 'origin'].includes(key));
    if (unknownKeys.length > 0) {
      errors.push(`${at} has unknown keys: ${unknownKeys.join(', ')}`);
    }
    const key = entry['key'];
    if (typeof key !== 'string' || !isQuestionId(key)) {
      errors.push(`${at}.key must be the question’s kebab-case id`);
    } else if (seen.has(key)) {
      errors.push(`${at}.key repeats ${key}`);
    } else {
      seen.add(key);
    }
    const text = entry['text'];
    if (typeof text !== 'string' || !isFoundationMessageAnswerSubstantive(text)) {
      errors.push(`${at}.text must be an answer — not empty, not a skip, not a TBD`);
    } else if (text.length > BOILERPLATES_ANSWER_MAX_CHARS) {
      errors.push(`${at}.text must be at most ${BOILERPLATES_ANSWER_MAX_CHARS} characters`);
    }
    if (!(FOUNDATION_MESSAGE_ANSWER_ORIGINS as readonly string[]).includes(entry['origin'] as string)) {
      errors.push(`${at}.origin must be one of ${FOUNDATION_MESSAGE_ANSWER_ORIGINS.join(', ')}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * Render the answers turn (boilerplates-answers/v1) the agent parses back —
 * a mirror of its `renderAnswersTurn` (src/questions-turn.ts): the header,
 * then per answer `--- A <id> (<origin>) ---`, `ANSWER: follows`, the text,
 * `--- END A <id> ---`. Sent as a follow-up on the session that asked the
 * questions.
 */
export function renderBoilerplatesAnswersText(answers: MktgRunAnswer[]): string {
  const lines: string[] = [BOILERPLATES_ANSWERS_HEADER];
  for (const answer of answers) {
    lines.push(`--- A ${answer.key} (${answer.origin}) ---`, 'ANSWER: follows', guardBoilerplatesText(answer.text.trim()), `--- END A ${answer.key} ---`);
  }
  return lines.join('\n');
}

/**
 * The agent's end-of-run reply in one text the agent itself wrote (an agent
 * text turn out of `extractMktgAgentTexts`), when the text is one: it opens
 * as `BOILERPLATES_REFUSAL_OPENINGS` says and carries one of the
 * `BOILERPLATES_REFUSAL_CLAUSES` — the refusal of a run without a messaging
 * framework (§2b), or a run that ended without a validated result (§3).
 * Returns the reply trimmed, or null. Never hand it a tool result: only the
 * agent's own text counts.
 */
export function extractBoilerplatesRefusal(agentText: string): string | null {
  const text = agentText.trim();
  const opens = BOILERPLATES_REFUSAL_OPENINGS.some((opening) => text.startsWith(opening));
  return opens && BOILERPLATES_REFUSAL_CLAUSES.some((clause) => text.includes(clause)) ? text : null;
}

// ---------------------------------------------------------------------------
// Envelope gates (the JSON Schema, transcribed)
// ---------------------------------------------------------------------------

/** Word count as the agent counts it: whitespace-separated tokens of the trimmed text. */
export function countBoilerplatesWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** The text `content_sha256` hashes: the content as JSON, as the agent serialized it (key order preserved by parse / stringify). */
export function boilerplatesContentJson(content: unknown): string {
  return JSON.stringify(content);
}

/** Schema errors of a content object: exactly `{ bp }`, four `{ l, max, t }` entries with the contract's labels and limits, in order. */
export function findBoilerplatesContentErrors(content: unknown): string[] {
  if (!isRecord(content)) {
    return ['content must be an object'];
  }
  const errors: string[] = [];
  const allowed = new Set<string>(BOILERPLATES_CONTENT_KEYS);
  const extra = Object.keys(content).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    errors.push(`content has unknown keys: ${extra.join(', ')}`);
  }
  const bp = content['bp'];
  if (!Array.isArray(bp) || bp.length !== BOILERPLATES_LENGTHS.length) {
    errors.push(`content.bp must be an array of exactly ${BOILERPLATES_LENGTHS.length} entries`);
    return errors;
  }
  bp.forEach((entry: unknown, index) => {
    const at = `content.bp[${index}]`;
    const spec = BOILERPLATES_LENGTHS[index];
    if (!isRecord(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const unknownKeys = Object.keys(entry).filter((key) => !['l', 'max', 't'].includes(key));
    if (unknownKeys.length > 0) {
      errors.push(`${at} has unknown keys: ${unknownKeys.join(', ')}`);
    }
    if (entry['l'] !== spec.l || entry['max'] !== spec.max) {
      errors.push(`${at} must be { l: ${JSON.stringify(spec.l)}, max: ${spec.max} }`);
    }
    if (!isText(entry['t'])) {
      errors.push(`${at}.t must be a non-empty string`);
    }
  });
  return errors;
}

function reportErrors(report: unknown): string[] {
  if (!isRecord(report)) {
    return ['report must be an object'];
  }
  const errors: string[] = [];
  const extra = Object.keys(report).filter((key) => !['sources_read', 'sources_failed', 'gaps', 'notes'].includes(key));
  if (extra.length > 0) {
    errors.push(`report has unknown keys: ${extra.join(', ')}`);
  }
  if (!Array.isArray(report['sources_read']) || !report['sources_read'].every(isText)) {
    errors.push('report.sources_read must be an array of non-empty strings');
  }
  const failed = report['sources_failed'];
  if (
    !Array.isArray(failed) ||
    !failed.every((entry: unknown) => isRecord(entry) && Object.keys(entry).length === 2 && isText(entry['name']) && isText(entry['reason']))
  ) {
    errors.push('report.sources_failed must be an array of { name, reason }');
  }
  if (!Array.isArray(report['gaps']) || !report['gaps'].every(isText)) {
    errors.push('report.gaps must be an array of non-empty strings');
  }
  if (typeof report['notes'] !== 'string') {
    errors.push('report.notes must be a string');
  }
  return errors;
}

function checksErrors(checks: unknown): string[] {
  if (!isRecord(checks) || Object.keys(checks).some((key) => !['word_counts', 'findings'].includes(key))) {
    return ['checks must be { word_counts, findings }'];
  }
  const errors: string[] = [];
  const counts = checks['word_counts'];
  if (
    !Array.isArray(counts) ||
    counts.length !== BOILERPLATES_LENGTHS.length ||
    !counts.every((count: unknown) => typeof count === 'number' && Number.isInteger(count) && count >= 0)
  ) {
    errors.push(`checks.word_counts must be ${BOILERPLATES_LENGTHS.length} non-negative integers`);
  }
  if (!Array.isArray(checks['findings']) || !checks['findings'].every((finding: unknown) => typeof finding === 'string')) {
    errors.push('checks.findings must be an array of strings');
  }
  return errors;
}

function inputsRecordErrors(record: unknown): string[] {
  if (!isRecord(record)) {
    return ['inputs_record must be an object'];
  }
  const errors: string[] = [];
  if (typeof record['date_read'] !== 'string' || !BOILERPLATES_ISO_DATE_REGEX.test(record['date_read'])) {
    errors.push('inputs_record.date_read must be YYYY-MM-DD');
  }
  const website = record['website'];
  if (website !== null && !(isRecord(website) && isText(website['url']) && typeof website['read'] === 'boolean')) {
    errors.push('inputs_record.website must be null or { url, read }');
  }
  for (const key of ['notes_given', 'framework_supplied']) {
    if (typeof record[key] !== 'boolean') {
      errors.push(`inputs_record.${key} must be a boolean`);
    }
  }
  if (record['domain'] !== null && typeof record['domain'] !== 'string') {
    errors.push('inputs_record.domain must be null or a string');
  }
  for (const key of ['lfx_records', 'questions_asked', 'answers', 'web_searches', 'fetched']) {
    if (!Array.isArray(record[key])) {
      errors.push(`inputs_record.${key} must be an array`);
    }
  }
  return errors;
}

function revisionErrors(revision: unknown): string[] {
  if (revision === null) {
    return [];
  }
  if (!isRecord(revision)) {
    return ['revision must be null or an object'];
  }
  const errors: string[] = [];
  if (revision['mode'] !== 'redraft' && revision['mode'] !== 'check') {
    errors.push('revision.mode must be redraft or check');
  }
  if (!Number.isInteger(revision['prior_version']) || (revision['prior_version'] as number) < 1) {
    errors.push('revision.prior_version must be an integer >= 1');
  }
  const comments = revision['comments'];
  if (
    !Array.isArray(comments) ||
    !comments.every(
      (comment: unknown) =>
        isRecord(comment) &&
        Number.isInteger(comment['number']) &&
        (comment['number'] as number) >= 1 &&
        isText(comment['field']) &&
        isText(comment['comment']) &&
        isText(comment['resolution'])
    )
  ) {
    errors.push('revision.comments must be an array of { number, field, comment, resolution }');
  }
  return errors;
}

function provenanceErrors(envelope: UnknownRecord): string[] {
  const errors: string[] = [];
  const intake = envelope['intake'];
  if (!isRecord(intake) || intake['mode'] !== 'form' || !isTimestamp(intake['completed_at'])) {
    errors.push('intake must be { mode: "form", completed_at: <ISO timestamp> }');
  }
  const capabilities = envelope['capabilities'];
  if (!isRecord(capabilities) || typeof capabilities['web_fetch'] !== 'boolean' || typeof capabilities['lfx_mcp'] !== 'boolean') {
    errors.push('capabilities must be { web_fetch: boolean, lfx_mcp: boolean }');
  }
  if (!isTimestamp(envelope['generated_at'])) {
    errors.push('generated_at must be an ISO timestamp');
  }
  const agent = envelope['agent'];
  if (
    !isRecord(agent) ||
    agent['identifier'] !== BOILERPLATES_AGENT_IDENTIFIER ||
    typeof agent['agent_version'] !== 'string' ||
    !BOILERPLATES_AGENT_VERSION_REGEX.test(agent['agent_version']) ||
    typeof agent['prompt_manifest_sha256'] !== 'string' ||
    !BOILERPLATES_SHA256_REGEX.test(agent['prompt_manifest_sha256'])
  ) {
    errors.push(`agent must be { identifier: "${BOILERPLATES_AGENT_IDENTIFIER}", agent_version: x.y.z, prompt_manifest_sha256 }`);
  }
  return errors;
}

/**
 * Validate a candidate envelope against boilerplates-output/v1: the
 * discriminators, the slug, the version and mode, the content, the report,
 * the checks, the inputs record, the revision and the provenance. Hash
 * equality is the caller's job — see the module note.
 */
export function validateBoilerplatesEnvelope(candidate: unknown): BoilerplatesValidationResult {
  if (!isRecord(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }
  const envelope = candidate;
  const errors: string[] = [];

  if (envelope['contract'] !== BOILERPLATES_CONTRACT_ID) {
    // Reject unknown contract majors outright — never interpret them.
    errors.push(`contract must be "${BOILERPLATES_CONTRACT_ID}" (got ${JSON.stringify(envelope['contract'] ?? null)})`);
  }
  if (envelope['kind'] !== BOILERPLATES_KIND) {
    errors.push(`kind must be "${BOILERPLATES_KIND}"`);
  }
  if (typeof envelope['project'] !== 'string' || !BOILERPLATES_PROJECT_SLUG_REGEX.test(envelope['project'])) {
    errors.push('project must be a lowercase kebab-case slug');
  }
  if (!isText(envelope['project_name'])) {
    errors.push('project_name must be a non-empty string');
  }
  if (!Number.isInteger(envelope['version']) || (envelope['version'] as number) < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (!(BOILERPLATES_MODES as readonly string[]).includes(envelope['mode'] as string)) {
    errors.push(`mode must be one of ${BOILERPLATES_MODES.join(', ')}`);
  }
  if (typeof envelope['content_sha256'] !== 'string' || !BOILERPLATES_SHA256_REGEX.test(envelope['content_sha256'])) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }
  errors.push(...findBoilerplatesContentErrors(envelope['content']));
  errors.push(...reportErrors(envelope['report']));
  errors.push(...checksErrors(envelope['checks']));
  errors.push(...inputsRecordErrors(envelope['inputs_record']));
  errors.push(...revisionErrors(envelope['revision']));
  errors.push(...provenanceErrors(envelope));

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// The asset: what the run page and the Documents area render
// ---------------------------------------------------------------------------

/** The run's asset out of a validated envelope: what the run page shows and the stored version keeps. */
export function boilerplatesAsset(envelope: BoilerplatesEnvelope): MktgBoilerplatesAsset {
  return { kind: 'boilerplates', content: envelope.content, report: envelope.report, checks: envelope.checks, mode: envelope.mode };
}

/** The boilerplates of a stored revision: its JSON text parsed and shape-checked, or null when it is not the boilerplates. */
export function readBoilerplatesContent(text: string): BoilerplatesContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return findBoilerplatesContentErrors(parsed).length === 0 ? (parsed as BoilerplatesContent) : null;
}

/**
 * The run's asset out of a stored revision: the JSON text as the content and
 * the sidecar's report, checks and mode; null when the text is not the
 * boilerplates. A sidecar without a readable report or checks (never written
 * by this BFF, but a hand-copied record could lack them) reads as an empty
 * report and word counts recounted from the text.
 */
export function boilerplatesAssetOfRevision(text: string, sidecar: Record<string, unknown> | null): MktgBoilerplatesAsset | null {
  const content = readBoilerplatesContent(text);
  if (!content) {
    return null;
  }
  const report = sidecar?.['report'];
  const checks = sidecar?.['checks'];
  const mode = sidecar?.['mode'];
  return {
    kind: 'boilerplates',
    content,
    report: reportErrors(report).length === 0 ? (report as BoilerplatesReport) : { sources_read: [], sources_failed: [], gaps: [], notes: '' },
    checks:
      checksErrors(checks).length === 0
        ? (checks as BoilerplatesChecks)
        : { word_counts: content.bp.map((entry) => countBoilerplatesWords(entry.t)), findings: [] },
    mode: (BOILERPLATES_MODES as readonly string[]).includes(mode as string) ? (mode as BoilerplatesMode) : 'draft',
  };
}

/**
 * The four lengths as the Boilerplates view renders them: the label, what
 * the length carries, the text, its word count (the agent's own count when
 * the checks carry it, else recounted) against its limit, and whether it
 * is over that limit (a hand edit a check returned as given, or a length a
 * redraft kept as stored).
 */
export function boilerplatesLengthRows(asset: MktgBoilerplatesAsset): BoilerplatesLengthRow[] {
  return asset.content.bp.map((entry, index) => {
    const words = asset.checks.word_counts[index] ?? countBoilerplatesWords(entry.t);
    const over = words > entry.max;
    return {
      index,
      label: entry.l,
      hint: BOILERPLATES_LENGTH_HINTS[index] ?? '',
      text: entry.t,
      words,
      max: entry.max,
      over,
      countLabel: `${words} / ${entry.max} words`,
    };
  });
}
