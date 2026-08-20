// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure Message Foundation helpers (message-foundation-output/v1): intake
// answer validation (the agent form contract's conditional requirement),
// batch payload building, and envelope validation. The SHA-256 recompute is
// deliberately NOT here — hashing is environment-specific (node:crypto on
// the server) and the shared package stays platform-neutral; callers
// recompute the hash and compare against `envelope.content_sha256`.

import {
  FOUNDATION_MESSAGE_CONTRACT_ID,
  FOUNDATION_MESSAGE_DERIVATIVE_KEYS,
  FOUNDATION_MESSAGE_DISCOVERY_KEYS,
  FOUNDATION_MESSAGE_FORM_TYPE,
  FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX,
  FOUNDATION_MESSAGE_INTAKE_ANSWERS_MIN,
  FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX,
  FOUNDATION_MESSAGE_KIND,
  FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH,
  FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX,
  FOUNDATION_MESSAGE_REQUIRED_HEADINGS,
  FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK,
  FOUNDATION_MESSAGE_SHA256_REGEX,
} from '../constants/foundation-message.constants';
import { FoundationMessageEnvelope, FoundationMessageFormPayload, FoundationMessageValidationResult } from '../interfaces/foundation-message.interface';

/** The intake answer keys the generate endpoint accepts. */
const FORM_ANSWER_KEYS = new Set<string>(['project_name', 'github_url', 'brand_kit_markdown', ...FOUNDATION_MESSAGE_DISCOVERY_KEYS, 'gap_fill_notes']);

/**
 * Validate a generate-request answers record against the agent's form
 * contract: `project_name` and `github_url` always required; the five
 * discovery answers required exactly when no (non-blank) `brand_kit_markdown`
 * is provided (Paul's five brand-discovery questions apply);
 * `gap_fill_notes` optional; no unknown keys. Mirrors the zod `.check` in
 * marketing-os-agents agents/foundation-message-ts src/form.ts, with the BFF
 * hardening that a whitespace-only Brand Kit counts as absent.
 */
export function validateFoundationMessageIntakeAnswers(answers: unknown): FoundationMessageValidationResult {
  const errors: string[] = [];
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { valid: false, errors: ['answers must be an object keyed by intake field key'] };
  }
  const record = answers as Record<string, unknown>;

  for (const key of ['project_name', 'github_url']) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`answers.${key} is required and must be a non-empty string`);
    }
  }

  const brandKit = record['brand_kit_markdown'];
  if (brandKit !== undefined && typeof brandKit !== 'string') {
    errors.push('answers.brand_kit_markdown must be a string when provided');
  }
  const hasBrandKit = typeof brandKit === 'string' && !!brandKit.trim();

  for (const key of FOUNDATION_MESSAGE_DISCOVERY_KEYS) {
    const value = record[key];
    if (value !== undefined && typeof value !== 'string') {
      errors.push(`answers.${key} must be a string when provided`);
      continue;
    }
    if (!hasBrandKit && (typeof value !== 'string' || !value.trim())) {
      errors.push(`answers.${key} is required when no brand_kit_markdown is provided (Paul's five brand-discovery questions apply)`);
    }
  }

  const gapFill = record['gap_fill_notes'];
  if (gapFill !== undefined && typeof gapFill !== 'string') {
    errors.push('answers.gap_fill_notes must be a string when provided');
  }

  for (const key of Object.keys(record)) {
    if (!FORM_ANSWER_KEYS.has(key)) {
      errors.push(`answers.${key} is not an intake field key`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Options layered onto the answers when building the batch payload. */
export interface FoundationMessageFormPayloadOptions {
  /** README content fetched server-side; omitted from the payload when absent. */
  readmeMarkdown?: string;
  /** User feedback on the prior draft (regeneration). */
  feedback?: string;
  /** Version of the prior draft being revised; the agent finalizes as `priorVersion + 1`. */
  priorVersion?: number;
}

/**
 * Build the `message_foundation_intake_form` batch payload the BFF submits as
 * the Guild session's `agent_input`, from a VALIDATED answers record (run
 * `validateFoundationMessageIntakeAnswers` first). Answers pass through
 * trimmed but otherwise verbatim; blank optionals are omitted; discovery
 * answers are omitted when a Brand Kit is provided (the agent's renderer
 * ignores them in that branch).
 *
 * Versioning: the agent's form contract carries the "finalize as version
 * N+1" directive only inside the feedback block, so a revision without user
 * feedback (edit-inputs resubmit) gets the synthesized
 * `FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK` — otherwise a fresh session
 * would restart at version 1 and the result poll (which requires a version
 * strictly above the prior draft's) could never accept it.
 */
export function buildFoundationMessageFormPayload(
  answers: Record<string, string>,
  options: FoundationMessageFormPayloadOptions = {}
): FoundationMessageFormPayload {
  const trimmed = (key: string): string => (answers[key] ?? '').trim();

  const payload: FoundationMessageFormPayload = {
    type: FOUNDATION_MESSAGE_FORM_TYPE,
    project_name: trimmed('project_name'),
    github_url: trimmed('github_url'),
  };

  if (options.readmeMarkdown !== undefined && options.readmeMarkdown !== '') {
    payload.readme_markdown = options.readmeMarkdown;
  }

  const brandKit = trimmed('brand_kit_markdown');
  if (brandKit) {
    payload.brand_kit_markdown = brandKit;
  } else {
    for (const key of FOUNDATION_MESSAGE_DISCOVERY_KEYS) {
      payload[key] = trimmed(key);
    }
  }

  const gapFill = trimmed('gap_fill_notes');
  if (gapFill) {
    payload.gap_fill_notes = gapFill;
  }

  const priorVersion =
    typeof options.priorVersion === 'number' && Number.isInteger(options.priorVersion) && options.priorVersion >= 1 ? options.priorVersion : undefined;
  const feedback = options.feedback?.trim() || '';
  if (feedback || priorVersion !== undefined) {
    payload.feedback = feedback || FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK;
  }
  if (priorVersion !== undefined) {
    payload.prior_version = priorVersion;
  }

  return payload;
}

/**
 * Return the required headings missing from the document. Mirrors the
 * agent's own `missingHeadings` gate: each heading must start a line and be
 * followed by end-of-line or a qualifier boundary (whitespace, `(`, `:`,
 * `—`, `-`), so "## 1a. Word-Count Derivatives (when a Brand Kit exists)"
 * passes while "## 10. Next Stepsish" does not.
 */
export function findMissingFoundationMessageHeadings(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split(/\r?\n/);
  return FOUNDATION_MESSAGE_REQUIRED_HEADINGS.filter(
    (heading) => !lines.some((line) => line.startsWith(heading) && (line.length === heading.length || /^[\s(:—-]/.test(line.slice(heading.length))))
  );
}

/**
 * Validate a candidate Message Foundation envelope against the v1 contract's
 * schema gates, the 13-heading structural presence gate, and the derivative
 * presence gate. Hash equality is the caller's job — see module note. The
 * word-count locks themselves are the agent wrapper's deterministic gates;
 * the BFF re-checks shape and structure, not word counts.
 */
export function validateFoundationMessageEnvelope(candidate: unknown): FoundationMessageValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }

  const envelope = candidate as Partial<FoundationMessageEnvelope>;

  if (envelope.contract !== FOUNDATION_MESSAGE_CONTRACT_ID) {
    // Reject unknown contract majors outright — do not attempt to interpret them.
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
  if (typeof envelope.content_sha256 !== 'string' || !FOUNDATION_MESSAGE_SHA256_REGEX.test(envelope.content_sha256)) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }

  if (typeof envelope.document_markdown !== 'string' || envelope.document_markdown.length < FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH) {
    errors.push(`document_markdown must be a string of at least ${FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH} characters`);
  } else {
    const missing = findMissingFoundationMessageHeadings(envelope.document_markdown);
    if (missing.length > 0) {
      errors.push(`document_markdown is missing required headings: ${missing.join(' | ')}`);
    }
  }

  const derivatives: unknown = envelope.derivatives;
  if (typeof derivatives !== 'object' || derivatives === null) {
    errors.push('derivatives must be an object');
  } else {
    for (const key of FOUNDATION_MESSAGE_DERIVATIVE_KEYS) {
      const value = (derivatives as Record<string, unknown>)[key];
      if (typeof value !== 'string' || !value.trim()) {
        errors.push(`derivatives.${key} must be a non-empty string`);
      }
    }
  }

  const inputs = envelope.inputs;
  if (typeof inputs !== 'object' || inputs === null) {
    errors.push('inputs must be an object');
  } else {
    if (typeof inputs.brand_kit_provided !== 'boolean') {
      errors.push('inputs.brand_kit_provided must be a boolean');
    }
    if (
      inputs.brand_kit_sha256 !== undefined &&
      (typeof inputs.brand_kit_sha256 !== 'string' || !FOUNDATION_MESSAGE_SHA256_REGEX.test(inputs.brand_kit_sha256))
    ) {
      errors.push('inputs.brand_kit_sha256 must be 64 lowercase hex characters when present');
    }
  }

  const intake = envelope.intake;
  if (typeof intake !== 'object' || intake === null) {
    errors.push('intake must be an object');
  } else {
    if (intake.mode !== 'form' && intake.mode !== 'conversational') {
      errors.push('intake.mode must be "form" or "conversational"');
    }
    if (
      typeof intake.completed_at !== 'string' ||
      !FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX.test(intake.completed_at) ||
      Number.isNaN(new Date(intake.completed_at).getTime())
    ) {
      errors.push('intake.completed_at must be an ISO-8601 timestamp');
    }
    if (
      !Array.isArray(intake.answers) ||
      intake.answers.length < FOUNDATION_MESSAGE_INTAKE_ANSWERS_MIN ||
      intake.answers.length > FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX
    ) {
      errors.push(`intake.answers must contain ${FOUNDATION_MESSAGE_INTAKE_ANSWERS_MIN}-${FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX} entries`);
    } else {
      intake.answers.forEach((entry, index) => {
        const numberOk =
          typeof entry?.question_number === 'number' &&
          Number.isInteger(entry.question_number) &&
          entry.question_number >= 1 &&
          entry.question_number <= FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX;
        const textOk = typeof entry?.question === 'string' && entry.question.length > 0 && typeof entry?.answer === 'string' && entry.answer.length > 0;
        if (!numberOk || !textOk) {
          errors.push(`intake.answers[${index}] is malformed`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
