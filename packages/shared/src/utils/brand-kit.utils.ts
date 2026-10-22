// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure Brand Kit helpers (brand-kit-output/v2 and the questions/answers
// turns): request validation, the draft form payload and its rendering into
// the one text message the agent receives, the questions block the agent
// sends back, the answers turn LFX One renders, envelope validation, and the
// pure pieces of the kit view (the book's pages, the logo images, the font
// stack). The SHA-256 recompute is deliberately NOT here — hashing is
// environment-specific (node:crypto on the server) and the shared package
// stays platform-neutral; callers recompute the hash and compare against
// `envelope.content_sha256`.

import {
  BRAND_KIT_AGENT_IDENTIFIER,
  BRAND_KIT_APPROVAL_REQUIRED_MESSAGE,
  BRAND_KIT_ANSWER_KEYS,
  BRAND_KIT_ANSWER_MAX_CHARS,
  BRAND_KIT_ANSWERS_HEADER,
  BRAND_KIT_ATTRIBUTE_COUNT,
  BRAND_KIT_BOOK_PAGES,
  BRAND_KIT_CHAPTER_COUNTS,
  BRAND_KIT_CHAPTERS,
  BRAND_KIT_CONTRACT_ID,
  BRAND_KIT_CONTRAST_GRADES,
  BRAND_KIT_DEFAULT_WEIGHTS,
  BRAND_KIT_DRAFT_HEADER,
  BRAND_KIT_FIELD_KEYS,
  BRAND_KIT_FORM_LINES,
  BRAND_KIT_FORM_TYPE,
  BRAND_KIT_FOUND_IN_KINDS,
  BRAND_KIT_FRAMEWORK_ANSWER_KEY,
  BRAND_KIT_FRAMEWORK_VOICE_FIELDS,
  BRAND_KIT_GOOGLE_FONTS_CSS_URL,
  BRAND_KIT_HEX_REGEX,
  BRAND_KIT_HTTP_URL_REGEX,
  BRAND_KIT_ISO_TIMESTAMP_REGEX,
  BRAND_KIT_KIND,
  BRAND_KIT_LOGO_FILE_NAME_REGEX,
  BRAND_KIT_LOGO_SLOTS,
  BRAND_KIT_MAX_LOGO_FILE_CHARS,
  BRAND_KIT_FRAMEWORK_TEXT_FIELD_STATUSES,
  BRAND_KIT_MAX_LOGO_FILES,
  BRAND_KIT_MAX_FRAMEWORK_CHARS,
  BRAND_KIT_MAX_LOGO_PAYLOAD_CHARS,
  BRAND_KIT_MIN_DOCUMENT_LENGTH,
  BRAND_KIT_MODES,
  BRAND_KIT_OPAQUE_FILE_STEM_REGEX,
  BRAND_KIT_PALETTE_MAX,
  BRAND_KIT_PALETTE_MIN,
  BRAND_KIT_PROJECT_SLUG_REGEX,
  BRAND_KIT_QUESTIONS_CONTRACT_ID,
  BRAND_KIT_REFUSAL_CLAUSE,
  BRAND_KIT_REFUSAL_OPENINGS,
  BRAND_KIT_REQUIRED_HEADINGS,
  BRAND_KIT_SHA256_REGEX,
  BRAND_KIT_TYPE_STEPS,
} from '../constants/brand-kit.constants';
import {
  FOUNDATION_MESSAGE_ANSWER_ORIGINS,
  FOUNDATION_MESSAGE_NONE_ANSWER,
  FOUNDATION_MESSAGE_NON_ANSWER_REGEX,
} from '../constants/foundation-message.constants';
import { MKTG_ARTIFACT_SPECS } from '../constants/mktg-artifact.constants';
import {
  BrandKitBookPage,
  BrandKitChapters,
  BrandKitEnvelope,
  BrandKitFormInputs,
  BrandKitFormPayload,
  BrandKitLogoFile,
  BrandKitLogoFileKind,
  BrandKitLogoImage,
  BrandKitLogoRef,
  BrandKitQuestion,
  BrandKitReport,
  BrandKitRevision,
  BrandKitTokens,
  BrandKitValidationResult,
} from '../interfaces/brand-kit.interface';
import { MktgRunAnswer, MktgRunQuestion } from '../interfaces/mktg-run.interface';
import { buildMktgArtifactObjectKey } from './mktg-artifact.utils';
import { extractMktgEnvelopeCandidates } from './mktg-envelope.utils';

const ONE_LINE = /^[^\r\n]+$/;
const FORM_ANSWER_KEYS = new Set<string>([...Object.values(BRAND_KIT_FIELD_KEYS), BRAND_KIT_FRAMEWORK_ANSWER_KEY]);
const LOGO_FILE_KEYS = ['name', 'text', 'base64', 'url'];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && BRAND_KIT_HEX_REGEX.test(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && BRAND_KIT_ISO_TIMESTAMP_REGEX.test(value) && !Number.isNaN(new Date(value).getTime());
}

function isTextList(value: unknown, length?: number): value is string[] {
  return Array.isArray(value) && (length === undefined || value.length === length) && value.every(isText);
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/** The kind of a logo file by its extension — the agent's `kindOfName`, mirrored so the rendered KIND line matches. */
export function brandKitLogoFileKind(name: string): BrandKitLogoFileKind {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === 'svg') {
    return 'svg';
  }
  if (extension === 'png') {
    return 'png';
  }
  if (extension === 'zip') {
    return 'zip';
  }
  return 'other';
}

/** The URL an optional answer names, or null for a blank answer or "none". */
export function brandKitOptionalUrl(answer: string | undefined): string | null {
  const trimmed = (answer ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === FOUNDATION_MESSAGE_NONE_ANSWER) {
    return null;
  }
  return trimmed;
}

/**
 * Validate a generate-request answers record: `project_name` required and one
 * line; `website_url` required, an http(s) URL (the agent reads the site);
 * `brand_page_url` optional — blank, "none", or an http(s) URL; `notes`
 * optional free text; the messaging framework
 * (`BRAND_KIT_FRAMEWORK_ANSWER_KEY`) required — browser-attached JSON from
 * the approved-current attach path, at most `BRAND_KIT_MAX_FRAMEWORK_CHARS` characters, a
 * JSON object the agent reads an umbrella message or a brand line from
 * ({@link parseBrandKitFramework}); no unknown keys. There are no questions
 * on this form: the agent inspects the artwork, reads the site, takes the
 * voice from the framework, and asks only the gaps. This validator checks
 * content shape, not the supplied framework's store approval.
 */
export function validateBrandKitIntakeAnswers(answers: unknown): BrandKitValidationResult {
  if (!isRecord(answers)) {
    return { valid: false, errors: ['answers must be an object keyed by intake field key'] };
  }
  const errors: string[] = [];

  const projectName = answers[BRAND_KIT_FIELD_KEYS.projectName];
  if (typeof projectName !== 'string' || !projectName.trim() || !ONE_LINE.test(projectName.trim())) {
    errors.push(`answers.${BRAND_KIT_FIELD_KEYS.projectName} is required and must be one line`);
  }

  const website = answers[BRAND_KIT_FIELD_KEYS.websiteUrl];
  if (typeof website !== 'string' || !BRAND_KIT_HTTP_URL_REGEX.test(website.trim())) {
    errors.push(`answers.${BRAND_KIT_FIELD_KEYS.websiteUrl} is required and must be an http(s) URL`);
  }

  const brandPage = answers[BRAND_KIT_FIELD_KEYS.brandPageUrl];
  if (brandPage !== undefined) {
    if (typeof brandPage !== 'string') {
      errors.push(`answers.${BRAND_KIT_FIELD_KEYS.brandPageUrl} must be a string when provided`);
    } else {
      const url = brandKitOptionalUrl(brandPage);
      if (url !== null && !BRAND_KIT_HTTP_URL_REGEX.test(url)) {
        errors.push(`answers.${BRAND_KIT_FIELD_KEYS.brandPageUrl} must be an http(s) URL or "none"`);
      }
    }
  }

  const notes = answers[BRAND_KIT_FIELD_KEYS.notes];
  if (notes !== undefined && typeof notes !== 'string') {
    errors.push(`answers.${BRAND_KIT_FIELD_KEYS.notes} must be a string when provided`);
  }

  // The messaging framework is required: the Voice chapter comes from it,
  // and the kit is never drafted from the site instead. A revision
  // the agent could read no voice from is refused here, not marked
  // provisional by the agent later.
  const framework = answers[BRAND_KIT_FRAMEWORK_ANSWER_KEY];
  if (typeof framework !== 'string' || !framework.trim()) {
    errors.push(`answers.${BRAND_KIT_FRAMEWORK_ANSWER_KEY}: ${BRAND_KIT_APPROVAL_REQUIRED_MESSAGE}`);
  } else if (framework.length > BRAND_KIT_MAX_FRAMEWORK_CHARS) {
    errors.push(`answers.${BRAND_KIT_FRAMEWORK_ANSWER_KEY} must be at most ${BRAND_KIT_MAX_FRAMEWORK_CHARS} characters`);
  } else if (parseBrandKitFramework(framework) === null) {
    errors.push(
      `answers.${BRAND_KIT_FRAMEWORK_ANSWER_KEY} must be a JSON object carrying the framework's umbrella message or brand line (mh.umbrella / mh.line, mf.positioning / mf.tagline, or the sidecar's ${BRAND_KIT_FRAMEWORK_VOICE_FIELDS.umbrella} / ${BRAND_KIT_FRAMEWORK_VOICE_FIELDS.line})`
    );
  }

  for (const key of Object.keys(answers)) {
    if (!FORM_ANSWER_KEYS.has(key)) {
      errors.push(`answers.${key} is not an intake field key`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a generate request's logo files: at most `BRAND_KIT_MAX_LOGO_FILES`,
 * each with a one-line file name (unique — the name is the reference the
 * kit uses) and exactly one of SVG text, base64 bytes (each within the
 * agent's per-file cap) or an http(s) link; all of them within the one
 * request body the BFF takes.
 */
export function validateBrandKitLogoFiles(files: unknown): BrandKitValidationResult {
  if (files === undefined) {
    return { valid: true, errors: [] };
  }
  if (!Array.isArray(files)) {
    return { valid: false, errors: ['logoFiles must be an array when provided'] };
  }
  const errors: string[] = [];
  if (files.length > BRAND_KIT_MAX_LOGO_FILES) {
    errors.push(`logoFiles takes at most ${BRAND_KIT_MAX_LOGO_FILES} files`);
  }
  const names = new Set<string>();
  let payloadChars = 0;
  files.forEach((entry: unknown, index) => {
    const at = `logoFiles[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const unknownKeys = Object.keys(entry).filter((key) => !LOGO_FILE_KEYS.includes(key));
    if (unknownKeys.length > 0) {
      errors.push(`${at} has unknown keys: ${unknownKeys.join(', ')}`);
    }
    const name = entry['name'];
    if (typeof name !== 'string' || !name.trim() || !BRAND_KIT_LOGO_FILE_NAME_REGEX.test(name.trim())) {
      errors.push(`${at}.name must be the file name, one line, without path separators`);
    } else if (names.has(name.trim())) {
      errors.push(`${at}.name repeats ${name.trim()} — each file name once`);
    } else {
      names.add(name.trim());
    }
    const contents = (['text', 'base64', 'url'] as const).filter((key) => entry[key] !== undefined);
    if (contents.length !== 1) {
      errors.push(`${at} needs exactly one of text, base64 or url`);
    }
    for (const key of ['text', 'base64'] as const) {
      const value = entry[key];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== 'string' || !value) {
        errors.push(`${at}.${key} must be a non-empty string`);
      } else if (value.length > BRAND_KIT_MAX_LOGO_FILE_CHARS) {
        errors.push(`${at}.${key} is over ${BRAND_KIT_MAX_LOGO_FILE_CHARS.toLocaleString('en-US')} characters — give the file as a link instead`);
      } else {
        payloadChars += value.length;
      }
    }
    const url = entry['url'];
    if (url !== undefined && (typeof url !== 'string' || !BRAND_KIT_HTTP_URL_REGEX.test(url.trim()))) {
      errors.push(`${at}.url must be an http(s) URL`);
    }
  });
  if (payloadChars > BRAND_KIT_MAX_LOGO_PAYLOAD_CHARS) {
    errors.push(`logoFiles together are over ${BRAND_KIT_MAX_LOGO_PAYLOAD_CHARS.toLocaleString('en-US')} characters — give the biggest files as links`);
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// The draft form and its rendering (mirror of the agent's src/form.ts)
// ---------------------------------------------------------------------------

/**
 * Build the `brand_kit_intake_form` payload from a VALIDATED answers record.
 * The project name and links pass through trimmed but otherwise verbatim; a
 * "none" or blank brand page is omitted, as are blank notes.
 */
export function buildBrandKitFormPayload(answers: Record<string, string>, inputs: BrandKitFormInputs = {}): BrandKitFormPayload {
  const payload: BrandKitFormPayload = {
    type: BRAND_KIT_FORM_TYPE,
    project_name: (answers[BRAND_KIT_FIELD_KEYS.projectName] ?? '').trim(),
    website_url: (answers[BRAND_KIT_FIELD_KEYS.websiteUrl] ?? '').trim(),
  };
  if (inputs.runDate) {
    payload.run_date = inputs.runDate;
  }
  if (inputs.projectUid) {
    payload.project_uid = inputs.projectUid;
  }
  const brandPage = brandKitOptionalUrl(answers[BRAND_KIT_FIELD_KEYS.brandPageUrl]);
  if (brandPage !== null) {
    payload.brand_page_url = brandPage;
  }
  if (inputs.logoFiles && inputs.logoFiles.length > 0) {
    payload.logo_files = inputs.logoFiles.map((file) => ({ ...file, name: file.name.trim() }));
  }
  const notes = (answers[BRAND_KIT_FIELD_KEYS.notes] ?? '').trim();
  if (notes) {
    payload.notes = notes;
  }
  // The browser-attached framework JSON in the shape the agent reads voice
  // from. The attach path selects approved current; this builder parses the
  // supplied JSON, not its approval state.
  const framework = parseBrandKitFramework(answers[BRAND_KIT_FRAMEWORK_ANSWER_KEY] ?? '');
  if (framework !== null) {
    payload.messaging_framework = framework;
  }
  return payload;
}

/**
 * The framework JSON supplied by the run page's approved-current attachment,
 * parsed back and put in the shape the agent's
 * form takes ({@link brandKitFrameworkOfRevision}). Null when the text is
 * not a JSON object (an array, a scalar, or not JSON at all) or when no
 * voice can be read from it.
 */
export function parseBrandKitFramework(text: string): Record<string, unknown> | null {
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? brandKitFrameworkOfRevision(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * The framework the agent reads, from a stored messaging framework revision.
 * The agent's `voiceOfFramework` takes the umbrella message from
 * `mh.umbrella` (else `mf.positioning`) and the brand line from `mh.line`
 * (else `mf.tagline`), so:
 *
 * - a framework already in that shape (`{mf, icp, mh, nums}`), or a
 *   `messaging-framework-output/v1` envelope wrapping it as `content`,
 *   passes as the framework itself (the envelope unwrapped);
 * - a Messaging Document revision (`messaging-document-output/v1`, the
 *   `fields` sidecar keyed by `md.*`) becomes `{mf, mh}` from its
 *   `md.positioning` and `md.tagline` values (a field only when its status
 *   is `approved` or `draft` — a `tbd` field holds the "Needs input"
 *   placeholder), each set on both keys the agent reads, as the
 *   framework's own rule has them equal;
 * - anything the agent could read no voice from is null — never sent, since
 *   the agent would then draft the voice from the site.
 */
export function brandKitFrameworkOfRevision(revision: Record<string, unknown>): Record<string, unknown> | null {
  if (statesVoice(revision)) {
    return revision;
  }
  const content = revision['content'];
  if (isRecord(content) && statesVoice(content)) {
    return content;
  }
  const fields = revision['fields'];
  if (!isRecord(fields)) {
    return null;
  }
  const umbrella = sidecarFieldText(fields[BRAND_KIT_FRAMEWORK_VOICE_FIELDS.umbrella]);
  const line = sidecarFieldText(fields[BRAND_KIT_FRAMEWORK_VOICE_FIELDS.line]);
  if (umbrella === null && line === null) {
    return null;
  }
  const mf: Record<string, string> = {};
  const mh: Record<string, string> = {};
  if (umbrella !== null) {
    mf['positioning'] = umbrella;
    mh['umbrella'] = umbrella;
  }
  if (line !== null) {
    mf['tagline'] = line;
    mh['line'] = line;
  }
  return { mf, mh };
}

/** The umbrella message and brand line a framework states, exactly as the agent reads them (its `voiceOfFramework`): mh first, then mf; nulls otherwise. */
export function brandKitVoiceOfFramework(framework: Record<string, unknown>): { umbrella: string | null; line: string | null } {
  const mh = isRecord(framework['mh']) ? framework['mh'] : null;
  const mf = isRecord(framework['mf']) ? framework['mf'] : null;
  return {
    umbrella: trimmedText(mh?.['umbrella']) ?? trimmedText(mf?.['positioning']),
    line: trimmedText(mh?.['line']) ?? trimmedText(mf?.['tagline']),
  };
}

/** Whether the agent would read an umbrella message or a brand line from this object. */
function statesVoice(framework: Record<string, unknown>): boolean {
  const voice = brandKitVoiceOfFramework(framework);
  return voice.umbrella !== null || voice.line !== null;
}

/**
 * A sidecar field's string value, trimmed, when the field states text: its
 * status is `approved` or `draft`. Null for a `tbd` field (its value is the
 * "Needs input" placeholder, never the project's voice), a field without a
 * known status, a list field, a blank or anything else.
 */
function sidecarFieldText(field: unknown): string | null {
  if (!isRecord(field) || !BRAND_KIT_FRAMEWORK_TEXT_FIELD_STATUSES.has(field['status'])) {
    return null;
  }
  return trimmedText(field['value']);
}

function trimmedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Embedded third-party text must not be able to forge a marker line: a line
 * that would start like one ("--- ", "===== ") gets one leading space. Only
 * such lines change; everything else passes byte for byte (the agent's
 * `guardText`).
 */
export function guardBrandKitText(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('--- ') || line.startsWith('===== ') ? ` ${line}` : line))
    .join('\n');
}

/** The LOGO FILES block of the rendered form (the agent's `renderLogoFiles`). */
function renderBrandKitLogoFiles(files: BrandKitLogoFile[]): string[] {
  const lines: string[] = [files.length === 0 ? BRAND_KIT_FORM_LINES.logosNone : `LOGO FILES: ${files.length} ${BRAND_KIT_FORM_LINES.logosUploadedSuffix}`];
  files.forEach((file, index) => {
    const n = index + 1;
    lines.push(`--- LOGO FILE ${n}: ${file.name} ---`);
    lines.push(`KIND: ${brandKitLogoFileKind(file.name)}`);
    lines.push(`URL: ${file.url ?? BRAND_KIT_FORM_LINES.none}`);
    if (file.text !== undefined) {
      lines.push(BRAND_KIT_FORM_LINES.fileText, guardBrandKitText(file.text));
    } else if (file.base64 !== undefined) {
      lines.push(BRAND_KIT_FORM_LINES.fileBytes, file.base64.replace(/\s+/g, ''));
    } else {
      lines.push(BRAND_KIT_FORM_LINES.fileUrl);
    }
    lines.push(`--- END LOGO FILE ${n} ---`);
  });
  return lines;
}

/**
 * Render the draft form into the one text message the agent receives — a
 * mirror of the agent's own `renderDraft` (marketing-os-agents
 * `agents/brand-kit/src/form.ts`), byte-identical for the same payload;
 * brand-kit.utils.spec.ts pins renderings produced by that renderer. The
 * marker lines are load-bearing: the agent's finalize tool parses the
 * project name, the uid, the URLs, the notes, the framework and the logo
 * files back from them (`parseFormMessage`), so any drift makes every run
 * fail. The BFF renders because Guild coerces a structured `agent_input` to
 * JSON text before the agent's preprocess runs.
 */
export function renderBrandKitFormText(payload: BrandKitFormPayload, now: Date = new Date()): string {
  const runDate = payload.run_date ?? now.toISOString().slice(0, 10);
  const lines: string[] = [
    BRAND_KIT_DRAFT_HEADER,
    `PROJECT NAME: ${payload.project_name}`,
    `RUN DATE: ${runDate}`,
    `LFX PROJECT UID: ${payload.project_uid ?? BRAND_KIT_FORM_LINES.uidNotSupplied}`,
    `WEBSITE: ${payload.website_url}`,
    `BRAND PAGE: ${payload.brand_page_url ?? BRAND_KIT_FORM_LINES.none}`,
  ];
  if (payload.notes === undefined) {
    lines.push(BRAND_KIT_FORM_LINES.notesNone);
  } else {
    lines.push(BRAND_KIT_FORM_LINES.notesFollow, guardBrandKitText(payload.notes), BRAND_KIT_FORM_LINES.notesEnd);
  }
  lines.push('');
  if (payload.messaging_framework === undefined) {
    lines.push(BRAND_KIT_FORM_LINES.frameworkNone);
  } else {
    lines.push(
      BRAND_KIT_FORM_LINES.frameworkSupplied,
      BRAND_KIT_FORM_LINES.frameworkStart,
      guardBrandKitText(JSON.stringify(payload.messaging_framework, null, 2)),
      BRAND_KIT_FORM_LINES.frameworkEnd
    );
  }
  lines.push('');
  lines.push(...renderBrandKitLogoFiles(payload.logo_files ?? []));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The questions turn (brand-kit-questions/v1) and the answers turn
// (brand-kit-answers/v1)
// ---------------------------------------------------------------------------

/**
 * The agent's questions block as the run shell takes it, or null when the
 * candidate is not one: the contract id and a `questions` list of one to four
 * entries, each one of the four gap keys (once), with a label and a question.
 * `why`, `suggested_answer` and `basis` are read leniently (absent is empty):
 * a question without a suggestion is one the requester answers from scratch.
 */
export function readBrandKitQuestions(candidate: unknown): MktgRunQuestion[] | null {
  if (!isRecord(candidate) || candidate['contract'] !== BRAND_KIT_QUESTIONS_CONTRACT_ID || !Array.isArray(candidate['questions'])) {
    return null;
  }
  const entries = candidate['questions'] as unknown[];
  if (entries.length === 0 || entries.length > BRAND_KIT_ANSWER_KEYS.length) {
    return null;
  }
  const questions: MktgRunQuestion[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) {
      return null;
    }
    const question = entry as Partial<BrandKitQuestion>;
    const key = typeof question.key === 'string' ? question.key.trim() : '';
    const label = typeof question.label === 'string' ? question.label.trim() : '';
    const text = typeof question.question === 'string' ? question.question.trim() : '';
    if (!(BRAND_KIT_ANSWER_KEYS as readonly string[]).includes(key) || seen.has(key) || !label || !text) {
      return null;
    }
    seen.add(key);
    const basis = typeof question.basis === 'string' ? question.basis.trim() : '';
    questions.push({
      key,
      label,
      question: text,
      why: typeof question.why === 'string' ? question.why.trim() : '',
      suggestedAnswer: typeof question.suggested_answer === 'string' ? question.suggested_answer.trim() : '',
      basis: basis ? [basis] : [],
    });
  }
  return questions;
}

/**
 * The agent's refusal reply in one text the agent itself wrote (an agent
 * text turn out of `extractMktgAgentTexts`), when the text is one: it opens
 * as `BRAND_KIT_REFUSAL_OPENINGS` says and carries the "not started" clause
 * (brand-kit 2.1.0, brand-kit-output.md §2d). Returns the reply trimmed, or
 * null. Never hand it a tool result: only the agent's own text counts.
 */
export function extractBrandKitRefusal(agentText: string): string | null {
  const text = agentText.trim();
  const opens = BRAND_KIT_REFUSAL_OPENINGS.some((opening) => text.startsWith(opening));
  return opens && text.includes(BRAND_KIT_REFUSAL_CLAUSE) ? text : null;
}

/**
 * The questions block in one text the agent itself wrote (an agent text turn
 * out of `extractMktgAgentTexts`), when it carries one: the latest valid
 * block wins. Never hand it a whole event payload or a tool result: a page
 * the agent fetched could carry a block too, and only the agent's own text
 * counts.
 */
export function extractBrandKitQuestions(agentText: string): MktgRunQuestion[] | null {
  let found: MktgRunQuestion[] | null = null;
  for (const candidate of extractMktgEnvelopeCandidates(agentText, BRAND_KIT_QUESTIONS_CONTRACT_ID)) {
    found = readBrandKitQuestions(candidate) ?? found;
  }
  return found;
}

/**
 * A stable id for a questions block — FNV-1a over its JSON, as eight hex
 * digits. Platform-neutral: it tells one block from another so the run shell
 * never re-asks a block it already answered.
 */
export function brandKitQuestionsId(questions: MktgRunQuestion[]): string {
  const text = JSON.stringify(questions);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Validate the answers of an answers request: one to four entries, each a
 * `{ key, text, origin }` with one of the four gap keys (once), a substantive
 * text (no skip, no TBD, no empty) within the length cap, and a known origin;
 * no unknown keys.
 */
export function validateBrandKitAnswers(answers: unknown): BrandKitValidationResult {
  if (!Array.isArray(answers)) {
    return { valid: false, errors: ['answers must be an array'] };
  }
  const errors: string[] = [];
  if (answers.length === 0 || answers.length > BRAND_KIT_ANSWER_KEYS.length) {
    errors.push(`answers takes 1 to ${BRAND_KIT_ANSWER_KEYS.length} entries`);
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
    if (typeof key !== 'string' || !(BRAND_KIT_ANSWER_KEYS as readonly string[]).includes(key)) {
      errors.push(`${at}.key must be one of ${BRAND_KIT_ANSWER_KEYS.join(', ')}`);
    } else if (seen.has(key)) {
      errors.push(`${at}.key repeats ${key}`);
    } else {
      seen.add(key);
    }
    const text = entry['text'];
    if (typeof text !== 'string' || !text.trim() || FOUNDATION_MESSAGE_NON_ANSWER_REGEX.test(text.trim())) {
      errors.push(`${at}.text must be an answer — not empty, not a skip, not a TBD`);
    } else if (text.length > BRAND_KIT_ANSWER_MAX_CHARS) {
      errors.push(`${at}.text must be at most ${BRAND_KIT_ANSWER_MAX_CHARS} characters`);
    }
    if (!(FOUNDATION_MESSAGE_ANSWER_ORIGINS as readonly string[]).includes(entry['origin'] as string)) {
      errors.push(`${at}.origin must be one of ${FOUNDATION_MESSAGE_ANSWER_ORIGINS.join(', ')}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * Render the answers turn (brand-kit-answers/v1) the agent parses back — a
 * mirror of its `renderAnswersTurn`: the header, then per answer
 * `--- A <key> (<origin>) ---`, `ANSWER: follows`, the text, `--- END A <key> ---`.
 * Sent as a follow-up on the session that asked the questions.
 */
export function renderBrandKitAnswersText(answers: MktgRunAnswer[]): string {
  const lines: string[] = [BRAND_KIT_ANSWERS_HEADER];
  for (const answer of answers) {
    lines.push(`--- A ${answer.key} (${answer.origin}) ---`, 'ANSWER: follows', guardBrandKitText(answer.text.trim()), `--- END A ${answer.key} ---`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Envelope gates (contract §1 and §3)
// ---------------------------------------------------------------------------

/** Index of the line a required heading starts: the heading itself, or the heading followed by a qualifier. */
function headingLineIndex(lines: string[], heading: string): number {
  return lines.findIndex((raw) => {
    const line = raw.trimEnd();
    return line.startsWith(heading) && (line.length === heading.length || /^[\s(:—-]/.test(line.slice(heading.length)));
  });
}

/** The required headings missing from the document. */
export function findMissingBrandKitHeadings(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split(/\r?\n/);
  return BRAND_KIT_REQUIRED_HEADINGS.filter((heading) => headingLineIndex(lines, heading) < 0);
}

/** Required headings that appear out of the contract's order. */
export function findBrandKitHeadingOrderViolations(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split(/\r?\n/);
  const violations: string[] = [];
  let cursor = -1;
  for (const heading of BRAND_KIT_REQUIRED_HEADINGS) {
    const index = headingLineIndex(lines, heading);
    if (index < 0) {
      continue;
    }
    if (index <= cursor) {
      violations.push(`'${heading}' is out of the contract's order`);
    } else {
      cursor = index;
    }
  }
  return violations;
}

/** The document gates: length, the title line and the required headings in order. */
function documentErrors(documentMarkdown: unknown): string[] {
  if (typeof documentMarkdown !== 'string' || documentMarkdown.length < BRAND_KIT_MIN_DOCUMENT_LENGTH) {
    return [`document_markdown must be a string of at least ${BRAND_KIT_MIN_DOCUMENT_LENGTH} characters`];
  }
  const errors: string[] = [];
  const first = documentMarkdown.split(/\r?\n/).find((line) => line.trim() !== '');
  if (first === undefined || !/^# \S.* Brand Kit\s*$/.test(first)) {
    errors.push('document_markdown must open with the title "# [Project Name] Brand Kit"');
  }
  const missing = findMissingBrandKitHeadings(documentMarkdown);
  if (missing.length > 0) {
    errors.push(`document_markdown is missing required headings: ${missing.join(' | ')}`);
  }
  errors.push(...findBrandKitHeadingOrderViolations(documentMarkdown).map((violation) => `document_markdown: ${violation}`));
  return errors;
}

/** The kit tokens' shape (the skill's `kit`). */
export function findBrandKitTokenErrors(kit: unknown): string[] {
  if (!isRecord(kit)) {
    return ['kit must be an object'];
  }
  const errors: string[] = [];
  const colors = kit['colors'];
  const colorOk = (entry: unknown): boolean => Array.isArray(entry) && entry.length === 3 && isText(entry[0]) && isHex(entry[1]) && isText(entry[2]);
  if (!Array.isArray(colors) || colors.length < BRAND_KIT_PALETTE_MIN || colors.length > BRAND_KIT_PALETTE_MAX || !colors.every(colorOk)) {
    errors.push(`kit.colors must be ${BRAND_KIT_PALETTE_MIN} to ${BRAND_KIT_PALETTE_MAX} [name, #RRGGBB, role] entries`);
  }
  if (!isText(kit['font'])) {
    errors.push('kit.font must be a non-empty string');
  }
  if (typeof kit['fontNote'] !== 'string') {
    errors.push('kit.fontNote must be a string');
  }
  const attrs = kit['attrs'];
  const attrOk = (entry: unknown): boolean => Array.isArray(entry) && entry.length === 2 && isText(entry[0]) && isText(entry[1]);
  if (!Array.isArray(attrs) || attrs.length !== BRAND_KIT_ATTRIBUTE_COUNT || !attrs.every(attrOk)) {
    errors.push(`kit.attrs must be exactly ${BRAND_KIT_ATTRIBUTE_COUNT} [attribute, line] entries`);
  }
  for (const key of ['dark', 'accent', 'spark'] as const) {
    if (!isHex(kit[key])) {
      errors.push(`kit.${key} must be a #RRGGBB colour`);
    }
  }
  if (!isText(kit['word'])) {
    errors.push('kit.word must be a non-empty string');
  }
  return errors;
}

function logoChapterErrors(logo: unknown): string[] {
  if (!isRecord(logo)) {
    return ['chapters.logo must be an object'];
  }
  const errors: string[] = [];
  const files = logo['files'];
  const refOk = (value: unknown): boolean =>
    value === null || (isRecord(value) && isText(value['ref']) && (value['svg'] === null || typeof value['svg'] === 'string'));
  if (!isRecord(files) || !BRAND_KIT_LOGO_SLOTS.every((slot) => slot in files && refOk(files[slot]))) {
    errors.push(`chapters.logo.files must carry ${BRAND_KIT_LOGO_SLOTS.join(', ')}, each { ref, svg } or null`);
  }
  if (logo['symbol_viewbox'] !== null && typeof logo['symbol_viewbox'] !== 'string') {
    errors.push('chapters.logo.symbol_viewbox must be a string or null');
  }
  if (typeof logo['placeholder'] !== 'boolean') {
    errors.push('chapters.logo.placeholder must be a boolean');
  }
  for (const key of ['system', 'clear_space', 'symbol'] as const) {
    if (!isText(logo[key])) {
      errors.push(`chapters.logo.${key} must be a non-empty string`);
    }
  }
  const colorways = logo['colorways'];
  const colorwayOk = (entry: unknown): boolean => isRecord(entry) && isText(entry['name']) && isText(entry['ground']) && isText(entry['logo']);
  if (!Array.isArray(colorways) || colorways.length !== BRAND_KIT_CHAPTER_COUNTS.colorways || !colorways.every(colorwayOk)) {
    errors.push(`chapters.logo.colorways must be exactly ${BRAND_KIT_CHAPTER_COUNTS.colorways} { name, ground, logo } entries`);
  }
  const size = logo['minimum_size'];
  if (!isRecord(size) || !isInteger(size['screen_px']) || !isInteger(size['print_mm']) || !isInteger(size['symbol_px']) || !isText(size['rule'])) {
    errors.push('chapters.logo.minimum_size must carry screen_px, print_mm, symbol_px and rule');
  }
  if (!isTextList(logo['partnership'], BRAND_KIT_CHAPTER_COUNTS.partnership)) {
    errors.push(`chapters.logo.partnership must be exactly ${BRAND_KIT_CHAPTER_COUNTS.partnership} rules`);
  }
  if (!isTextList(logo['watchouts'], BRAND_KIT_CHAPTER_COUNTS.watchouts)) {
    errors.push(`chapters.logo.watchouts must be exactly ${BRAND_KIT_CHAPTER_COUNTS.watchouts} entries`);
  }
  return errors;
}

function colorChapterErrors(color: unknown): string[] {
  if (!isRecord(color)) {
    return ['chapters.color must be an object'];
  }
  const errors: string[] = [];
  if (!isText(color['summary'])) {
    errors.push('chapters.color.summary must be a non-empty string');
  }
  const palette = color['palette'];
  const rgbOk = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every((n) => isInteger(n) && n >= 0 && n <= 255);
  const foundInOk = (value: unknown): boolean =>
    isRecord(value) && (BRAND_KIT_FOUND_IN_KINDS as readonly string[]).includes(value['kind'] as string) && isText(value['source']);
  const entryOk = (entry: unknown): boolean =>
    isRecord(entry) && isText(entry['name']) && isHex(entry['hex']) && rgbOk(entry['rgb']) && isText(entry['role']) && foundInOk(entry['found_in']);
  if (!Array.isArray(palette) || palette.length < BRAND_KIT_PALETTE_MIN || palette.length > BRAND_KIT_PALETTE_MAX || !palette.every(entryOk)) {
    errors.push(`chapters.color.palette must be ${BRAND_KIT_PALETTE_MIN} to ${BRAND_KIT_PALETTE_MAX} sourced entries`);
  }
  const proportion = color['proportion'];
  const rowOk = (entry: unknown): boolean => isRecord(entry) && isText(entry['name']) && isHex(entry['hex']) && isInteger(entry['share']);
  if (!Array.isArray(proportion) || proportion.length < BRAND_KIT_PALETTE_MIN || proportion.length > BRAND_KIT_PALETTE_MAX || !proportion.every(rowOk)) {
    errors.push('chapters.color.proportion must be one { name, hex, share } row per colour');
  }
  const contrast = color['contrast'];
  const pairOk = (entry: unknown): boolean =>
    isRecord(entry) &&
    isText(entry['foreground']) &&
    isText(entry['background']) &&
    typeof entry['ratio'] === 'number' &&
    entry['ratio'] >= 1 &&
    (BRAND_KIT_CONTRAST_GRADES as readonly string[]).includes(entry['grade'] as string);
  if (!isRecord(contrast) || !isText(contrast['rule']) || !Array.isArray(contrast['pairs']) || !contrast['pairs'].every(pairOk)) {
    errors.push('chapters.color.contrast must carry a rule and graded pairs');
  }
  return errors;
}

function typeChapterErrors(type: unknown): string[] {
  if (!isRecord(type)) {
    return ['chapters.type must be an object'];
  }
  const errors: string[] = [];
  for (const key of ['family', 'source', 'summary'] as const) {
    if (!isText(type[key])) {
      errors.push(`chapters.type.${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(type['weights']) || !type['weights'].every((weight) => isInteger(weight) && weight >= 100 && weight <= 900)) {
    errors.push('chapters.type.weights must be CSS weights');
  }
  if (typeof type['google_fonts'] !== 'boolean') {
    errors.push('chapters.type.google_fonts must be a boolean');
  }
  if (type['fallback'] !== null && typeof type['fallback'] !== 'string') {
    errors.push('chapters.type.fallback must be a string or null');
  }
  if (typeof type['note'] !== 'string') {
    errors.push('chapters.type.note must be a string');
  }
  const scale = type['scale'];
  const stepOk = (entry: unknown): boolean =>
    isRecord(entry) &&
    (BRAND_KIT_TYPE_STEPS as readonly string[]).includes(entry['step'] as string) &&
    isText(entry['label']) &&
    isInteger(entry['weight']) &&
    isInteger(entry['size']) &&
    isInteger(entry['line_height']) &&
    typeof entry['caps'] === 'boolean';
  if (!Array.isArray(scale) || scale.length !== BRAND_KIT_CHAPTER_COUNTS.typeScale || !scale.every(stepOk)) {
    errors.push(`chapters.type.scale must be the ${BRAND_KIT_CHAPTER_COUNTS.typeScale} steps`);
  }
  if (!isTextList(type['rules'], BRAND_KIT_CHAPTER_COUNTS.typeRules)) {
    errors.push(`chapters.type.rules must be exactly ${BRAND_KIT_CHAPTER_COUNTS.typeRules} rules`);
  }
  return errors;
}

function visualChapterErrors(visual: unknown): string[] {
  if (!isRecord(visual)) {
    return ['chapters.visual must be an object'];
  }
  const errors: string[] = [];
  const icons = visual['icons'];
  if (!isRecord(icons) || !isTextList(icons['rules'], BRAND_KIT_CHAPTER_COUNTS.iconRules) || !isText(icons['recommended'])) {
    errors.push(`chapters.visual.icons must carry ${BRAND_KIT_CHAPTER_COUNTS.iconRules} rules and the recommended set`);
  }
  const imagery = visual['imagery'];
  if (!isRecord(imagery) || !isText(imagery['rule']) || !isTextList(imagery['avoid'], BRAND_KIT_CHAPTER_COUNTS.imageryAvoid)) {
    errors.push(`chapters.visual.imagery must carry the rule and ${BRAND_KIT_CHAPTER_COUNTS.imageryAvoid} things to avoid`);
  }
  return errors;
}

function usageChapterErrors(usage: unknown): string[] {
  if (!isRecord(usage)) {
    return ['chapters.usage must be an object'];
  }
  const errors: string[] = [];
  if (!isText(usage['summary'])) {
    errors.push('chapters.usage.summary must be a non-empty string');
  }
  const examples = usage['examples'];
  const exampleOk = (entry: unknown): boolean => isRecord(entry) && isText(entry['name']) && isText(entry['format']) && isText(entry['ground']);
  if (!Array.isArray(examples) || examples.length !== BRAND_KIT_CHAPTER_COUNTS.usageExamples || !examples.every(exampleOk)) {
    errors.push(`chapters.usage.examples must be exactly ${BRAND_KIT_CHAPTER_COUNTS.usageExamples} { name, format, ground } entries`);
  }
  return errors;
}

function voiceChapterErrors(voice: unknown): string[] {
  if (!isRecord(voice)) {
    return ['chapters.voice must be an object'];
  }
  const errors: string[] = [];
  for (const key of ['umbrella', 'line', 'source', 'note'] as const) {
    if (!isText(voice[key])) {
      errors.push(`chapters.voice.${key} must be a non-empty string`);
    }
  }
  const attributes = voice['attributes'];
  const attributeOk = (entry: unknown): boolean => isRecord(entry) && isText(entry['name']) && isText(entry['line']);
  if (!Array.isArray(attributes) || attributes.length !== BRAND_KIT_ATTRIBUTE_COUNT || !attributes.every(attributeOk)) {
    errors.push(`chapters.voice.attributes must be exactly ${BRAND_KIT_ATTRIBUTE_COUNT} { name, line } entries`);
  }
  return errors;
}

/** The six chapters' shape — every fixed list at its exact length, every colour a hex, every provenance a known kind. */
export function findBrandKitChapterErrors(chapters: unknown): string[] {
  if (!isRecord(chapters)) {
    return ['chapters must be an object'];
  }
  return [
    ...logoChapterErrors(chapters['logo']),
    ...colorChapterErrors(chapters['color']),
    ...typeChapterErrors(chapters['type']),
    ...visualChapterErrors(chapters['visual']),
    ...usageChapterErrors(chapters['usage']),
    ...voiceChapterErrors(chapters['voice']),
  ];
}

/** The report's shape. */
export function findBrandKitReportErrors(report: unknown): string[] {
  if (!isRecord(report)) {
    return ['report must be an object'];
  }
  const errors: string[] = [];
  if (!isTextList(report['sources_read'])) {
    errors.push('report.sources_read must be a list of strings');
  }
  const failedOk = (entry: unknown): boolean => isRecord(entry) && isText(entry['name']) && isText(entry['reason']);
  if (!Array.isArray(report['sources_failed']) || !report['sources_failed'].every(failedOk)) {
    errors.push('report.sources_failed must be a list of { name, reason }');
  }
  if (!isTextList(report['gaps'])) {
    errors.push('report.gaps must be a list of strings');
  }
  if (typeof report['notes'] !== 'string') {
    errors.push('report.notes must be a string');
  }
  return errors;
}

/** The inputs record's required fields (the record is open for additive growth, so only these are gated). */
function inputsErrors(inputs: unknown): string[] {
  if (!isRecord(inputs)) {
    return ['inputs must be an object'];
  }
  const errors: string[] = [];
  for (const key of ['website_url', 'brand_page_url'] as const) {
    if (inputs[key] !== null && typeof inputs[key] !== 'string') {
      errors.push(`inputs.${key} must be a string or null`);
    }
  }
  if (typeof inputs['framework_supplied'] !== 'boolean') {
    errors.push('inputs.framework_supplied must be a boolean');
  }
  for (const key of ['logo_files', 'questions_asked', 'answers', 'web_searches', 'fetched', 'lfx_records'] as const) {
    if (!Array.isArray(inputs[key])) {
      errors.push(`inputs.${key} must be a list`);
    }
  }
  return errors;
}

/** The provenance gates: intake, revision, check, capabilities, timestamps and the producer. */
function provenanceErrors(envelope: Partial<BrandKitEnvelope>): string[] {
  const errors: string[] = [];
  if (!isRecord(envelope.intake) || envelope.intake.mode !== 'form' || !isTimestamp(envelope.intake.completed_at)) {
    errors.push('intake must be { mode: "form", completed_at }');
  }
  const revision = envelope.revision;
  if (revision !== null && (!isRecord(revision) || !isInteger(revision['prior_version']) || !Array.isArray(revision['comments']))) {
    errors.push('revision must be { prior_version, comments } or null');
  }
  const check = envelope.check;
  if (check !== null && (!isRecord(check) || !isTextList(check['fixes']) || !isTextList(check['issues']))) {
    errors.push('check must be { fixes, issues } or null');
  }
  const capabilities = envelope.capabilities;
  if (!isRecord(capabilities) || typeof capabilities['web_fetch'] !== 'boolean' || typeof capabilities['lfx_mcp'] !== 'boolean') {
    errors.push('capabilities must carry web_fetch and lfx_mcp');
  }
  if (!isTimestamp(envelope.generated_at)) {
    errors.push('generated_at must be an ISO-8601 timestamp');
  }
  const agent = envelope.agent;
  if (
    !isRecord(agent) ||
    agent['identifier'] !== BRAND_KIT_AGENT_IDENTIFIER ||
    !/^\d+\.\d+\.\d+$/.test(String(agent['agent_version'] ?? '')) ||
    !BRAND_KIT_SHA256_REGEX.test(String(agent['prompt_manifest_sha256'] ?? ''))
  ) {
    errors.push(`agent must name ${BRAND_KIT_AGENT_IDENTIFIER}, its semver version and its manifest sha`);
  }
  return errors;
}

/**
 * Validate a candidate Brand Kit envelope against the v2 contract: the schema
 * gates, the document's title and seven headings in order, the kit tokens,
 * the six chapters, the report, the inputs record and the provenance. Hash
 * equality is the caller's job — see the module note.
 */
export function validateBrandKitEnvelope(candidate: unknown): BrandKitValidationResult {
  if (!isRecord(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }
  const envelope = candidate as Partial<BrandKitEnvelope>;
  const errors: string[] = [];

  if (envelope.contract !== BRAND_KIT_CONTRACT_ID) {
    // Reject unknown contract majors outright — never interpret them.
    errors.push(`contract must be "${BRAND_KIT_CONTRACT_ID}" (got ${JSON.stringify(envelope.contract ?? null)})`);
  }
  if (envelope.kind !== BRAND_KIT_KIND) {
    errors.push(`kind must be "${BRAND_KIT_KIND}"`);
  }
  if (typeof envelope.project !== 'string' || !BRAND_KIT_PROJECT_SLUG_REGEX.test(envelope.project)) {
    errors.push('project must be a lowercase kebab-case slug');
  }
  if (typeof envelope.project_name !== 'string' || !envelope.project_name.trim()) {
    errors.push('project_name must be a non-empty string');
  }
  if (!isInteger(envelope.version) || envelope.version < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (!(BRAND_KIT_MODES as readonly string[]).includes(envelope.mode as string)) {
    errors.push(`mode must be one of ${BRAND_KIT_MODES.join(', ')}`);
  }
  if (typeof envelope.content_sha256 !== 'string' || !BRAND_KIT_SHA256_REGEX.test(envelope.content_sha256)) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }

  errors.push(...documentErrors(envelope.document_markdown));
  errors.push(...findBrandKitTokenErrors(envelope.kit));
  errors.push(...findBrandKitChapterErrors(envelope.chapters));
  errors.push(...findBrandKitReportErrors(envelope.report));
  errors.push(...inputsErrors(envelope.inputs));
  errors.push(...provenanceErrors(envelope));

  return { valid: errors.length === 0, errors };
}

/**
 * Derive the content-addressed Brand Kit object key from validated fields only
 * (contract §3.5): a thin binding of the shared {@link buildMktgArtifactObjectKey}
 * to this agent's artifact spec. `projectPartition` is the SERVER-RESOLVED LFX
 * project uid — never `envelope.project`.
 */
export function buildBrandKitObjectKey(projectPartition: string, contentSha256: string): string {
  return buildMktgArtifactObjectKey(MKTG_ARTIFACT_SPECS['brand-kit'], projectPartition, contentSha256);
}

// ---------------------------------------------------------------------------
// The kit of a revision: what the page renders
// ---------------------------------------------------------------------------

/** The kit the page renders, from a VALIDATED envelope. */
export function brandKitRevisionOf(envelope: BrandKitEnvelope): BrandKitRevision {
  return {
    projectName: envelope.project_name,
    project: envelope.project,
    version: envelope.version,
    mode: envelope.mode,
    kit: envelope.kit,
    chapters: envelope.chapters,
    report: envelope.report,
    websiteUrl: typeof envelope.inputs.website_url === 'string' ? envelope.inputs.website_url : null,
    generatedAt: envelope.generated_at,
    agentVersion: envelope.agent.agent_version,
  };
}

/**
 * The kit of a stored revision, read back from its sidecar (the envelope
 * minus the Markdown, as the document store keeps it), or null when the
 * sidecar is not a v2 Brand Kit envelope — a revision stored by the earlier
 * agent, whose document was Markdown alone, renders as Markdown.
 */
export function readBrandKitRevision(sidecar: unknown): BrandKitRevision | null {
  if (!isRecord(sidecar) || sidecar['contract'] !== BRAND_KIT_CONTRACT_ID) {
    return null;
  }
  const errors = [
    ...findBrandKitTokenErrors(sidecar['kit']),
    ...findBrandKitChapterErrors(sidecar['chapters']),
    ...findBrandKitReportErrors(sidecar['report']),
  ];
  if (errors.length > 0 || !isText(sidecar['project_name']) || !isInteger(sidecar['version'])) {
    return null;
  }
  const inputs = isRecord(sidecar['inputs']) ? sidecar['inputs'] : {};
  const agent = isRecord(sidecar['agent']) ? sidecar['agent'] : {};
  return {
    projectName: sidecar['project_name'] as string,
    project: typeof sidecar['project'] === 'string' ? sidecar['project'] : '',
    version: sidecar['version'] as number,
    mode: (BRAND_KIT_MODES as readonly string[]).includes(sidecar['mode'] as string) ? (sidecar['mode'] as BrandKitRevision['mode']) : 'draft',
    kit: sidecar['kit'] as BrandKitTokens,
    chapters: sidecar['chapters'] as BrandKitChapters,
    report: sidecar['report'] as BrandKitReport,
    websiteUrl: typeof inputs['website_url'] === 'string' ? inputs['website_url'] : null,
    generatedAt: typeof sidecar['generated_at'] === 'string' ? sidecar['generated_at'] : '',
    agentVersion: typeof agent['agent_version'] === 'string' ? agent['agent_version'] : '',
  };
}

// ---------------------------------------------------------------------------
// The book: pure pieces of the kit view
// ---------------------------------------------------------------------------

/** The book's 16 pages in order: the cover, the contents, then the chapter pages and the back cover. */
export function brandKitBookPages(): BrandKitBookPage[] {
  const heads = new Map<string, string>(BRAND_KIT_CHAPTERS.map((chapter) => [chapter.id, `${chapter.number} ${chapter.title}`]));
  return [
    { id: 'cover', number: 1, chapterHead: '', title: 'Cover' },
    { id: 'contents', number: 2, chapterHead: 'Contents', title: "What's inside" },
    ...BRAND_KIT_BOOK_PAGES.map((page, index) => ({
      id: page.id,
      number: index + 3,
      chapterHead: page.chapter ? (heads.get(page.chapter) ?? '') : '',
      title: page.title,
    })),
  ];
}

/** A page number as the book prints it: two digits. */
export function brandKitPageNumber(number: number): string {
  return String(number).padStart(2, '0');
}

/** An SVG as an `<img>` source: a data URL. An image never runs the SVG's scripts, which is why the view draws logos this way and never inlines them. */
export function brandKitSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The SVG with its root viewBox replaced (the symbol cropped out of the primary lockup), or unchanged when the root carries none. */
export function brandKitSvgWithViewBox(svg: string, viewBox: string): string {
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) {
    return svg;
  }
  const safeViewBox = viewBox.replace(/["<>]/g, '').trim();
  const tag = /\sviewBox\s*=\s*"[^"]*"/i.test(root[0])
    ? root[0].replace(/\sviewBox\s*=\s*"[^"]*"/i, ` viewBox="${safeViewBox}"`)
    : root[0].replace(/<svg\b/i, `<svg viewBox="${safeViewBox}"`);
  // A width/height on the root would keep the crop from filling its box.
  const sized = tag.replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, '');
  return svg.slice(0, root.index) + sized + svg.slice(root.index + root[0].length);
}

/**
 * A logo file as a reader knows it: the last segment of its reference (a file
 * name, `<zip>/<entry>`, or the URL of an SVG the agent fetched — query and
 * fragment dropped), percent-decoded. Null when that name is an opaque,
 * hash-like one (a CDN's upload id, say) that would tell the reader nothing,
 * or when there is no name at all. Never returns a URL.
 */
export function brandKitLogoFileName(ref: string): string | null {
  const path = ref.trim().split(/[?#]/)[0];
  const segment =
    path
      .split('/')
      .filter((part) => part !== '' && !/^[a-z][a-z0-9+.-]*:$/i.test(part))
      .pop() ?? '';
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // A malformed escape: the segment as it is.
  }
  name = name.trim();
  // A bare host (the URL had no path) is not a file name.
  if (name === '' || (path.includes('://') && path.split('/').filter((part) => part !== '').length <= 2)) {
    return null;
  }
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]\d+x\d+$/i, '');
  return BRAND_KIT_OPAQUE_FILE_STEM_REGEX.test(stem) ? null : name;
}

/** A logo as a page draws it, or null without a file. */
export function brandKitLogoImage(ref: BrandKitLogoRef | null): BrandKitLogoImage | null {
  if (!ref) {
    return null;
  }
  return { ref: ref.ref, name: brandKitLogoFileName(ref.ref) ?? 'the logo you supplied', src: ref.svg ? brandKitSvgDataUrl(ref.svg) : null };
}

/** The symbol as a page draws it: the symbol file, else the primary lockup cropped to the symbol's viewBox, else null. */
export function brandKitSymbolImage(files: BrandKitChapters['logo']['files'], symbolViewBox: string | null): BrandKitLogoImage | null {
  if (files.symbol) {
    return brandKitLogoImage(files.symbol);
  }
  const primary = brandKitLogoImage(files.primary);
  if (primary && files.primary?.svg && symbolViewBox) {
    return { ...primary, src: brandKitSvgDataUrl(brandKitSvgWithViewBox(files.primary.svg, symbolViewBox)) };
  }
  return null;
}

/** The host of the site the kit was read from, as the cover prints it (`jupyterfoundation.org`), or ''. */
export function brandKitWebsiteHost(websiteUrl: string | null): string {
  if (!websiteUrl) {
    return '';
  }
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The weights the typography page shows: the kit's, else the usual five. */
export function brandKitWeights(weights: number[]): number[] {
  const known = [...new Set(weights.filter((weight) => Number.isInteger(weight) && weight >= 100 && weight <= 900))].sort((a, b) => a - b);
  return known.length > 0 ? known : [...BRAND_KIT_DEFAULT_WEIGHTS];
}

/** The Google Fonts stylesheet URL for the typeface and its weights, or null when the kit says the family is not on Google Fonts. */
export function brandKitGoogleFontsUrl(family: string, weights: number[], googleFonts: boolean): string | null {
  const name = family.trim();
  if (!googleFonts || !name) {
    return null;
  }
  const axis = brandKitWeights(weights).join(';');
  return `${BRAND_KIT_GOOGLE_FONTS_CSS_URL}?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${axis}&display=swap`;
}

/** The CSS font stack the book sets: the family, the site's fallback when it names one, then a generic. */
export function brandKitFontStack(family: string, fallback: string | null): string {
  const quote = (name: string): string => `'${name.replace(/'/g, '').trim()}'`;
  const stack = [quote(family)];
  if (fallback && fallback.trim()) {
    stack.push(quote(fallback));
  }
  stack.push('sans-serif');
  return stack.join(', ');
}

/** The month and year the cover prints (`October 2026`), from the kit's timestamp; '' when it has none. */
export function brandKitMonthYear(generatedAt: string): string {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The text with `[Project]` replaced by the project name. */
export function brandKitForProject(text: string, projectName: string): string {
  return text.replaceAll('[Project]', projectName);
}
