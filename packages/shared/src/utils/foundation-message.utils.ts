// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure Message Foundation helpers (message-foundation-output/v1): intake
// answer validation (the agent form contract's conditional requirement),
// batch payload building, and envelope validation. The SHA-256 recompute is
// deliberately NOT here — hashing is environment-specific (node:crypto on
// the server) and the shared package stays platform-neutral; callers
// recompute the hash and compare against `envelope.content_sha256`.

import {
  FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND,
  FOUNDATION_MESSAGE_CONTRACT_ID,
  FOUNDATION_MESSAGE_DERIVATIVE_KEYS,
  FOUNDATION_MESSAGE_DERIVATIVE_WORD_CAPS,
  FOUNDATION_MESSAGE_DISCOVERY_KEYS,
  FOUNDATION_MESSAGE_DISCOVERY_QUESTIONS,
  FOUNDATION_MESSAGE_FORM_PREAMBLE_LINES,
  FOUNDATION_MESSAGE_FORM_TYPE,
  FOUNDATION_MESSAGE_INTAKE_ANSWERS_MAX,
  FOUNDATION_MESSAGE_INTAKE_ANSWERS_MIN,
  FOUNDATION_MESSAGE_ISO_TIMESTAMP_REGEX,
  FOUNDATION_MESSAGE_KIND,
  FOUNDATION_MESSAGE_MIN_DOCUMENT_LENGTH,
  FOUNDATION_MESSAGE_PROJECT_SLUG_REGEX,
  FOUNDATION_MESSAGE_Q_BRAND_KIT,
  FOUNDATION_MESSAGE_Q_GITHUB_URL,
  FOUNDATION_MESSAGE_Q_PROJECT_NAME,
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
      errors.push(`answers.${key} is required when no brand_kit_markdown is provided`);
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
 * Render a built form payload into the structured first user message the
 * agent's MODE RULES wrapper section tells the model to expect — a VERBATIM
 * mirror of the agent's own `renderFormMessage` (marketing-os-agents
 * `agents/foundation-message-ts` src/form.ts), producing byte-identical text
 * for the same payload.
 *
 * Why the BFF renders instead of sending the typed payload as the Guild
 * session's structured `agent_input`: live-smoked 2026-08-20 — Guild accepts
 * a structured `agent_input` (201) but coerces it to
 * `{type: 'text', text: JSON.stringify(payload)}` BEFORE the agent's zod
 * preprocess runs, so the model receives raw JSON and the batch MODE RULES
 * never trigger. Rendering here restores the known-good text transport (the
 * shipped brand-kit pattern) with the exact message the agent would have
 * rendered itself.
 */
export function renderFoundationMessageFormText(input: FoundationMessageFormPayload): string {
  const lines: string[] = [
    ...FOUNDATION_MESSAGE_FORM_PREAMBLE_LINES,
    '',
    `Q1a. ${FOUNDATION_MESSAGE_Q_PROJECT_NAME}`,
    `A1a. ${input.project_name}`,
    '',
    `Q1b. ${FOUNDATION_MESSAGE_Q_GITHUB_URL}`,
    `A1b. ${input.github_url}`,
    '',
    `Q1c. ${FOUNDATION_MESSAGE_Q_BRAND_KIT}`,
  ];
  if (input.brand_kit_markdown !== undefined) {
    lines.push(
      'A1c. Yes — the full Brand Kit document is provided below (BRAND KIT DOCUMENT block).',
      '',
      '===== BEGIN BRAND KIT DOCUMENT =====',
      input.brand_kit_markdown,
      '===== END BRAND KIT DOCUMENT =====',
      ''
    );
  } else {
    lines.push('A1c. No — brand-discovery answers provided instead:', '');
    FOUNDATION_MESSAGE_DISCOVERY_QUESTIONS.forEach((entry, i) => {
      lines.push(`Q1c.${i + 1}. ${entry.question}`);
      lines.push(`A1c.${i + 1}. ${input[entry.key] ?? ''}`);
      lines.push('');
    });
  }
  if (input.readme_markdown !== undefined) {
    lines.push(
      "The project's GitHub README content (pre-fetched — you cannot fetch URLs):",
      '',
      '===== BEGIN GITHUB README =====',
      input.readme_markdown,
      '===== END GITHUB README =====',
      ''
    );
  } else {
    lines.push(
      'No README content was provided. You cannot fetch URLs — ground README-',
      'dependent sections only in the answers above, marking gaps TBD per your',
      'instructions.',
      ''
    );
  }
  if (input.gap_fill_notes !== undefined) {
    lines.push('GAP-FILL NOTES (covers your Step 1d question areas):', input.gap_fill_notes, '');
  }
  if (input.feedback !== undefined) {
    const nextVersion = (input.prior_version ?? 1) + 1;
    lines.push(`FEEDBACK on draft v${input.prior_version ?? 1} — regenerate incorporating it and finalize as version ${nextVersion}:`);
    lines.push(input.feedback);
    lines.push('');
  }
  return lines.join('\n');
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
 * Contract §1a normative word count: a word is a whitespace-delimited token
 * containing at least one Unicode letter or digit, so bare punctuation (an
 * em-dash on its own) does not count. Reproduces the agent wrapper's
 * `countWords` exactly — the two must agree or a legitimate envelope could
 * fail the BFF's re-check.
 */
export function countFoundationMessageWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Derivative gates G1–G3 (contract §1a), re-run BFF-side over the derivative
 * values that passed the presence gate. Returns human-readable violations
 * (empty = pass), mirroring the agent wrapper's `derivativeViolations`:
 *
 * - G1 hard word caps (25 / 50 / 10);
 * - G2 sanity bands — boilerplate 50-250 words, `llms_txt` opening with an
 *   `# ` H1 line;
 * - G3 every derivative appears verbatim inside `document_markdown`, so the
 *   hash-verified document stays the single source for the copy chips.
 *
 * These are the wrapper's own deterministic gates, so an envelope that really
 * came from the finalize tool always passes them. Re-running them is what
 * makes that provenance checkable: the envelope scanner reads EVERY event
 * payload, so a shape-compatible draft the model printed mid-run must not be
 * surfaced as a "word-count-locked" derivative. G3 is skipped when the
 * document itself failed its own gates — the missing document is already the
 * reported error.
 */
export function findFoundationMessageDerivativeViolations(derivatives: Record<string, string>, documentMarkdown: string): string[] {
  const violations: string[] = [];

  for (const [key, cap] of Object.entries(FOUNDATION_MESSAGE_DERIVATIVE_WORD_CAPS)) {
    const value = derivatives[key];
    if (value === undefined) {
      continue;
    }
    const words = countFoundationMessageWords(value);
    if (words > cap) {
      violations.push(`derivatives.${key} is ${words} words — the contract's hard cap is ${cap}`);
    }
  }

  const boilerplate = derivatives['boilerplate'];
  if (boilerplate !== undefined) {
    const words = countFoundationMessageWords(boilerplate);
    if (words < FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.min || words > FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.max) {
      violations.push(
        `derivatives.boilerplate is ${words} words — the contract expects ${FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.min}-${FOUNDATION_MESSAGE_BOILERPLATE_WORD_BAND.max}`
      );
    }
  }

  const llmsTxt = derivatives['llms_txt'];
  if (llmsTxt !== undefined) {
    const firstLine = llmsTxt.split(/\r?\n/).find((line) => line.trim() !== '');
    if (firstLine === undefined || !firstLine.trimStart().startsWith('# ')) {
      violations.push("derivatives.llms_txt must start with an '# ' H1 line (llms.txt convention)");
    }
  }

  if (documentMarkdown) {
    for (const key of FOUNDATION_MESSAGE_DERIVATIVE_KEYS) {
      const value = derivatives[key];
      if (value !== undefined && !documentMarkdown.includes(value)) {
        violations.push(`derivatives.${key} does not appear verbatim inside document_markdown`);
      }
    }
  }

  return violations;
}

/**
 * Validate a candidate Message Foundation envelope against the v1 contract's
 * schema gates, the 13-heading structural presence gate, and the derivative
 * gates (presence + the §1a word-count locks G1-G3). Hash equality is the
 * caller's job — see module note.
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
    const present: Record<string, string> = {};
    for (const key of FOUNDATION_MESSAGE_DERIVATIVE_KEYS) {
      const value = (derivatives as Record<string, unknown>)[key];
      if (typeof value !== 'string' || !value.trim()) {
        errors.push(`derivatives.${key} must be a non-empty string`);
        continue;
      }
      present[key] = value;
    }
    // The §1a locks are re-checked here, not taken on trust: "word-count-locked"
    // is what the result surface promises the user about these chips.
    const documentMarkdown = typeof envelope.document_markdown === 'string' ? envelope.document_markdown : '';
    errors.push(...findFoundationMessageDerivativeViolations(present, documentMarkdown));
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
