// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure ICP & Target Markets helpers (icp-output/v1): intake answer validation
// (the agent form contract's required/optional split), batch payload building
// and rendering, and envelope validation including the contract's structure
// gates. The SHA-256 recompute is deliberately NOT here — hashing is
// environment-specific (node:crypto on the server) and the shared package
// stays platform-neutral; callers recompute the hash and compare against
// `envelope.content_sha256`.

import {
  ICP_CONTRACT_ID,
  ICP_DIMENSION_FIELDS,
  ICP_DISQUALIFIER_STATES,
  ICP_FIT_WARMTH_BAND,
  ICP_FORM_PREAMBLE_LINES,
  ICP_FORM_TYPE,
  ICP_GAP_FILL_KEYS,
  ICP_GAP_FILL_QUESTIONS,
  ICP_ICPS_BAND,
  ICP_INFERRED_DRAFT_LABEL,
  ICP_INTAKE_ANSWERS_MAX,
  ICP_INTAKE_ANSWERS_MIN,
  ICP_ISO_TIMESTAMP_REGEX,
  ICP_KEY_PREFIX,
  ICP_KIND,
  ICP_MAX_DOCUMENT_BYTES,
  ICP_MIN_DOCUMENT_LENGTH,
  ICP_PERSONA_FIELDS,
  ICP_PERSONAS_PER_ICP_BAND,
  ICP_PROJECT_SLUG_REGEX,
  ICP_PROJECT_UID_REGEX,
  ICP_Q_GITHUB_URL,
  ICP_Q_PROJECT_NAME,
  ICP_Q_SIBLING_DOCS,
  ICP_REQUIRED_GAP_FILL_KEY,
  ICP_REQUIRED_HEADINGS,
  ICP_REQUIRED_SUBHEADINGS,
  ICP_REVISED_INTAKE_FEEDBACK,
  ICP_SHA256_REGEX,
} from '../constants/icp.constants';
import { IcpEnvelope, IcpFormPayload, IcpFormPayloadOptions, IcpStructure, IcpValidationResult } from '../interfaces/icp.interface';
import { extractMktgEnvelopeCandidates } from './mktg-envelope.utils';

/**
 * Answer keys the generate endpoint accepts (intake fields + auto-attached
 * documents). `lfx_membership_data` is deliberately NOT here even though the
 * agent's schema and `IcpFormPayload` carry it: the renderer presents it to
 * the agent as real records already pulled from LFX, and this flow has no
 * server-side producer for it yet, so accepting it from the request would
 * let a caller pass arbitrary text off as authoritative membership data. It
 * is rejected as an unknown key until the BFF supplies it from a trusted
 * source.
 */
const FORM_ANSWER_KEYS = new Set<string>(['project_name', 'github_url', 'brand_kit_markdown', 'message_foundation_markdown', ...ICP_GAP_FILL_KEYS]);

/** Answer keys the agent's form contract requires. */
const REQUIRED_ANSWER_KEYS = ['project_name', 'github_url', ICP_REQUIRED_GAP_FILL_KEY];

/**
 * Validate a generate-request answers record against the agent's form
 * contract: `project_name`, `github_url` and `business_outcome` (Paul's
 * never-skip Q1d.1) are required; everything else — the sibling documents
 * and the other four gap-fill answers — is optional; no unknown keys. Mirrors
 * `formInputSchema` in marketing-os-agents agents/icp-ts src/form.ts minus
 * `lfx_membership_data` (see `FORM_ANSWER_KEYS`).
 */
export function validateIcpIntakeAnswers(answers: unknown): IcpValidationResult {
  const errors: string[] = [];
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { valid: false, errors: ['answers must be an object keyed by intake field key'] };
  }
  const record = answers as Record<string, unknown>;

  for (const key of REQUIRED_ANSWER_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`answers.${key} is required and must be a non-empty string`);
    }
  }

  for (const key of Object.keys(record)) {
    if (!FORM_ANSWER_KEYS.has(key)) {
      errors.push(`answers.${key} is not an intake field key`);
      continue;
    }
    if (REQUIRED_ANSWER_KEYS.includes(key)) {
      continue;
    }
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      errors.push(`answers.${key} must be a string when provided`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build the `icp_intake_form` batch payload the BFF submits as the Guild
 * session's `agent_input`, from a VALIDATED answers record (run
 * `validateIcpIntakeAnswers` first). Answers pass through trimmed but
 * otherwise verbatim; blank optionals are omitted, which is what puts the
 * agent on Paul's "proceed and flag lower-confidence" branch instead of
 * handing it an empty answer to treat as substance.
 *
 * Versioning: the agent's form contract carries the "finalize as version N+1"
 * directive only inside the feedback block, so a revision without user
 * feedback (edit-inputs resubmit) gets the synthesized
 * `ICP_REVISED_INTAKE_FEEDBACK` — otherwise a fresh session would restart at
 * version 1 and the result poll (which requires a version strictly above the
 * prior draft's) could never accept it.
 */
export function buildIcpFormPayload(answers: Record<string, string>, options: IcpFormPayloadOptions = {}): IcpFormPayload {
  const trimmed = (key: string): string => (answers[key] ?? '').trim();

  const payload: IcpFormPayload = {
    type: ICP_FORM_TYPE,
    project_name: trimmed('project_name'),
    github_url: trimmed('github_url'),
    business_outcome: trimmed(ICP_REQUIRED_GAP_FILL_KEY),
  };

  if (options.readmeMarkdown !== undefined && options.readmeMarkdown !== '') {
    payload.readme_markdown = options.readmeMarkdown;
  }

  // The sibling documents are pass-through documents, not typed answers:
  // they are NOT trimmed away to nothing by a stray leading newline, but a
  // blank one is omitted so the agent takes the honest "no such document"
  // branch. `lfx_membership_data` is not read from the answers at all — it
  // has no trusted producer in this flow (see `FORM_ANSWER_KEYS`).
  for (const key of ['brand_kit_markdown', 'message_foundation_markdown'] as const) {
    const value = answers[key] ?? '';
    if (value.trim()) {
      payload[key] = value;
    }
  }

  for (const key of ICP_GAP_FILL_KEYS) {
    if (key === ICP_REQUIRED_GAP_FILL_KEY) {
      continue;
    }
    const value = trimmed(key);
    if (value) {
      payload[key] = value;
    }
  }

  const priorVersion =
    typeof options.priorVersion === 'number' && Number.isInteger(options.priorVersion) && options.priorVersion >= 1 ? options.priorVersion : undefined;
  const feedback = options.feedback?.trim() || '';
  if (feedback || priorVersion !== undefined) {
    payload.feedback = feedback || ICP_REVISED_INTAKE_FEEDBACK;
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
 * `agents/icp-ts` src/form.ts), producing byte-identical text for the same
 * payload.
 *
 * Why the BFF renders instead of sending the typed payload as the Guild
 * session's structured `agent_input`: live-smoked 2026-08-20 on the Message
 * Foundation — Guild accepts a structured `agent_input` (201) but coerces it
 * to `{type: 'text', text: JSON.stringify(payload)}` BEFORE the agent's zod
 * preprocess runs, so the model receives raw JSON and the batch MODE RULES
 * never trigger. Rendering here restores the known-good text transport with
 * the exact message the agent would have rendered itself.
 */
export function renderIcpFormText(input: IcpFormPayload): string {
  const lines: string[] = [
    ...ICP_FORM_PREAMBLE_LINES,
    '',
    `Q1a. ${ICP_Q_PROJECT_NAME}`,
    `A1a. ${input.project_name}`,
    '',
    `Q1b. ${ICP_Q_GITHUB_URL}`,
    `A1b. ${input.github_url}`,
    '',
    `Q1c. ${ICP_Q_SIBLING_DOCS}`,
  ];

  const have: string[] = [];
  if (input.brand_kit_markdown !== undefined) {
    have.push('Brand Kit');
  }
  if (input.message_foundation_markdown !== undefined) {
    have.push('Message Foundation');
  }
  if (have.length > 0) {
    lines.push(`A1c. Yes — the full ${have.join(' and ')} document${have.length > 1 ? 's are' : ' is'} provided below.`, '');
  } else {
    lines.push(
      'A1c. No — neither document exists yet for this project. Say so plainly per',
      'your scope-boundary rule, proceed on the answers below and the README,',
      'and flag every affected section as lower-confidence.',
      ''
    );
  }
  if (input.brand_kit_markdown !== undefined) {
    lines.push('===== BEGIN BRAND KIT DOCUMENT =====', input.brand_kit_markdown, '===== END BRAND KIT DOCUMENT =====', '');
  }
  if (input.message_foundation_markdown !== undefined) {
    lines.push('===== BEGIN MESSAGE FOUNDATION DOCUMENT =====', input.message_foundation_markdown, '===== END MESSAGE FOUNDATION DOCUMENT =====', '');
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
      'dependent sections only in the answers and documents above, marking gaps',
      'TBD per your instructions.',
      ''
    );
  }

  if (input.lfx_membership_data !== undefined) {
    lines.push(
      'LIVE MEMBERSHIP DATA (already pulled by the caller — this IS the live-data',
      'path of your Step 0; ground section 1.4 and the enterprise firmographics in',
      'these real records):',
      '',
      '===== BEGIN LFX MEMBERSHIP DATA =====',
      input.lfx_membership_data,
      '===== END LFX MEMBERSHIP DATA =====',
      ''
    );
  } else {
    lines.push(
      'No live member/adopter data was provided and you have no LFX platform',
      'tools — template section 1.4 stays in the document and carries the TBD',
      'wording your template specifies. Never invent a roster.',
      ''
    );
  }

  ICP_GAP_FILL_QUESTIONS.forEach((entry, i) => {
    const answer = input[entry.key];
    if (answer === undefined || answer === '') {
      return;
    }
    lines.push(`Q1d.${i + 1}. ${entry.question}`);
    lines.push(`A1d.${i + 1}. ${answer}`);
    lines.push('');
  });
  const unanswered = ICP_GAP_FILL_QUESTIONS.map((entry, i) => [entry.key, i] as const).filter(([key]) => input[key] === undefined || input[key] === '');
  if (unanswered.length > 0) {
    lines.push(
      `Gap-fill questions ${unanswered.map(([, i]) => `1d.${i + 1}`).join(', ')} were not answered on the form. Do NOT ask them`,
      'interactively — apply your grounding rule: infer only what the README,',
      'Brand Kit and Message Foundation support (labelled as an inferred draft',
      'where your instructions require it), and write TBD otherwise.',
      ''
    );
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
 * Return the required headings missing from the document (contract gate S1).
 * Mirrors the agent's own `missingHeadings`: each heading must start a line
 * and be followed by end-of-line or a qualifier boundary (whitespace, `(`,
 * `:`, `—`, `-`), so "## 2. ICP Definitions (Organization-Level)" passes
 * while "## 6. Validation & Reviewers" does not.
 */
export function findMissingIcpHeadings(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split(/\r?\n/);
  return [...ICP_REQUIRED_HEADINGS, ...ICP_REQUIRED_SUBHEADINGS].filter(
    (heading) => !lines.some((line) => line.startsWith(heading) && (line.length === heading.length || /^[\s(:—-]/.test(line.slice(heading.length))))
  );
}

/**
 * Structure gates G1–G6 (contract §1a), re-run BFF-side over the envelope's
 * own `structure` spine. Returns human-readable violations (empty = pass),
 * mirroring the agent wrapper's `structureViolations`:
 *
 * - G1 — 1–2 ICPs, each with 2–3 personas;
 * - G2 — 4–6 fit/warmth attributes;
 * - G3 — every label / persona title / attribute appears verbatim inside
 *   `document_markdown` (the document is the single source);
 * - G4 — ICP labels unique, persona titles unique across all ICPs;
 * - G5 — the 5 Velocity Engine ICP dimension names and the 12 persona field
 *   names each appear in the document;
 * - G6 — an unconfirmed disqualifier set is labelled an "inferred draft".
 *
 * These are the wrapper's own deterministic gates, so an envelope that really
 * came from the finalize tool always passes them. Re-running them is what
 * makes that provenance checkable: the envelope scanner reads EVERY event
 * payload, so a shape-compatible draft the model printed mid-run must not be
 * surfaced to the user as a gate-passing ICP document.
 */
export function findIcpStructureViolations(structure: IcpStructure, documentMarkdown: string): string[] {
  const violations: string[] = [];

  if (structure.icps.length < ICP_ICPS_BAND.min || structure.icps.length > ICP_ICPS_BAND.max) {
    violations.push(`G1: structure.icps has ${structure.icps.length} entries — the contract allows ${ICP_ICPS_BAND.min}-${ICP_ICPS_BAND.max}`);
  }
  for (const icp of structure.icps) {
    if (icp.personas.length < ICP_PERSONAS_PER_ICP_BAND.min || icp.personas.length > ICP_PERSONAS_PER_ICP_BAND.max) {
      violations.push(
        `G1: ICP ${JSON.stringify(icp.label)} has ${icp.personas.length} personas — the contract requires ${ICP_PERSONAS_PER_ICP_BAND.min}-${ICP_PERSONAS_PER_ICP_BAND.max}`
      );
    }
  }

  const attributes = structure.fit_warmth_attributes;
  if (attributes.length < ICP_FIT_WARMTH_BAND.min || attributes.length > ICP_FIT_WARMTH_BAND.max) {
    violations.push(
      `G2: structure.fit_warmth_attributes has ${attributes.length} entries — the contract requires ${ICP_FIT_WARMTH_BAND.min}-${ICP_FIT_WARMTH_BAND.max}`
    );
  }

  // G3 is skipped when the document itself failed its own gates — the missing
  // document is already the reported error.
  if (documentMarkdown) {
    const verbatim: { kind: string; value: string }[] = [
      ...structure.icps.map((icp) => ({ kind: 'ICP label', value: icp.label })),
      ...structure.icps.flatMap((icp) => icp.personas.map((persona) => ({ kind: 'persona title', value: persona }))),
      ...attributes.map((attribute) => ({ kind: 'fit/warmth attribute', value: attribute })),
    ];
    for (const entry of verbatim) {
      if (!documentMarkdown.includes(entry.value)) {
        violations.push(`G3: ${entry.kind} ${JSON.stringify(entry.value)} does not appear verbatim inside document_markdown`);
      }
    }
  }

  const icpLabels = structure.icps.map((icp) => icp.label);
  if (new Set(icpLabels).size !== icpLabels.length) {
    violations.push('G4: ICP labels must be unique');
  }
  const personaTitles = structure.icps.flatMap((icp) => icp.personas);
  if (new Set(personaTitles).size !== personaTitles.length) {
    violations.push('G4: persona titles must be unique across all ICPs');
  }

  const haystack = documentMarkdown.toLowerCase();
  const missingFields = [...ICP_DIMENSION_FIELDS, ...ICP_PERSONA_FIELDS].filter((field) => !haystack.includes(field.toLowerCase()));
  if (missingFields.length > 0) {
    violations.push(`G5: document_markdown is missing Velocity Engine field names: ${missingFields.join('; ')}`);
  }

  if (structure.disqualifiers === 'inferred_draft' && !haystack.includes(ICP_INFERRED_DRAFT_LABEL)) {
    violations.push(`G6: disqualifiers are an inferred draft, so document_markdown must label them explicitly as an "${ICP_INFERRED_DRAFT_LABEL}"`);
  }

  return violations;
}

/**
 * Validate a candidate ICP envelope against the v1 contract's schema gates,
 * the structural heading presence gate (S1) and the structure gates (G1–G6).
 * Hash equality is the caller's job — see module note.
 */
export function validateIcpEnvelope(candidate: unknown): IcpValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }

  const envelope = candidate as Partial<IcpEnvelope>;

  if (envelope.contract !== ICP_CONTRACT_ID) {
    // Reject unknown contract majors outright — do not attempt to interpret them.
    errors.push(`contract must be "${ICP_CONTRACT_ID}" (got ${JSON.stringify(envelope.contract ?? null)})`);
  }
  if (envelope.kind !== ICP_KIND) {
    errors.push(`kind must be "${ICP_KIND}"`);
  }
  if (typeof envelope.project !== 'string' || !ICP_PROJECT_SLUG_REGEX.test(envelope.project)) {
    errors.push('project must be a lowercase kebab-case slug');
  }
  if (typeof envelope.project_name !== 'string' || !envelope.project_name.trim()) {
    errors.push('project_name must be a non-empty string');
  }
  if (typeof envelope.version !== 'number' || !Number.isInteger(envelope.version) || envelope.version < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (typeof envelope.content_sha256 !== 'string' || !ICP_SHA256_REGEX.test(envelope.content_sha256)) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }
  if (typeof envelope.business_outcome !== 'string' || !envelope.business_outcome.trim()) {
    errors.push('business_outcome must be a non-empty string');
  }

  const documentMarkdown = typeof envelope.document_markdown === 'string' ? envelope.document_markdown : '';
  if (!documentMarkdown || documentMarkdown.length < ICP_MIN_DOCUMENT_LENGTH) {
    errors.push(`document_markdown must be a string of at least ${ICP_MIN_DOCUMENT_LENGTH} characters`);
  } else {
    const missing = findMissingIcpHeadings(documentMarkdown);
    if (missing.length > 0) {
      errors.push(`document_markdown is missing required headings: ${missing.join(' | ')}`);
    }
    if (getUtf8ByteLength(documentMarkdown) > ICP_MAX_DOCUMENT_BYTES) {
      errors.push(`document_markdown exceeds the ${ICP_MAX_DOCUMENT_BYTES}-byte object size cap`);
    }
  }

  errors.push(...validateStructure(envelope.structure, documentMarkdown));
  errors.push(...validateInputs(envelope.inputs));
  errors.push(...validateIntake(envelope.intake));

  return { valid: errors.length === 0, errors };
}

/** Content-addressed object key for a validated ICP document, namespaced by the ICP prefix. */
export function buildIcpObjectKey(projectPartition: string, contentSha256: string): string {
  if (!ICP_PROJECT_UID_REGEX.test(projectPartition) || !ICP_SHA256_REGEX.test(contentSha256)) {
    throw new Error('buildIcpObjectKey requires an already-validated project partition and content_sha256');
  }
  return `${ICP_KEY_PREFIX}/${projectPartition}/${contentSha256}.md`;
}

/**
 * Extract candidate ICP envelopes from an arbitrary text payload. The
 * authoritative envelope is the `finalize_icp_document` TOOL RESULT
 * (`{ envelope_json: "..." }`) riding inside session event bodies; candidates
 * are UNVALIDATED and must be passed through `validateIcpEnvelope`. The
 * scanner itself is the shared, contract-agnostic
 * `extractMktgEnvelopeCandidates` (mktg-envelope.utils.ts).
 */
export function extractIcpEnvelopeCandidates(payload: string): unknown[] {
  return extractMktgEnvelopeCandidates(payload, ICP_CONTRACT_ID);
}

/** Schema + structure gates for the envelope's `structure` spine. */
function validateStructure(structure: unknown, documentMarkdown: string): string[] {
  if (typeof structure !== 'object' || structure === null || Array.isArray(structure)) {
    return ['structure must be an object'];
  }
  const candidate = structure as Partial<IcpStructure>;
  const errors: string[] = [];

  const icpsValid =
    Array.isArray(candidate.icps) &&
    candidate.icps.every(
      (icp) =>
        !!icp &&
        typeof icp.label === 'string' &&
        !!icp.label.trim() &&
        Array.isArray(icp.personas) &&
        icp.personas.every((persona) => typeof persona === 'string' && !!persona.trim())
    );
  if (!icpsValid) {
    errors.push('structure.icps must be an array of { label, personas[] } with non-empty strings');
  }

  const attributesValid =
    Array.isArray(candidate.fit_warmth_attributes) && candidate.fit_warmth_attributes.every((entry) => typeof entry === 'string' && !!entry.trim());
  if (!attributesValid) {
    errors.push('structure.fit_warmth_attributes must be an array of non-empty strings');
  }

  const disqualifiersValid = ICP_DISQUALIFIER_STATES.includes(candidate.disqualifiers as (typeof ICP_DISQUALIFIER_STATES)[number]);
  if (!disqualifiersValid) {
    errors.push(`structure.disqualifiers must be one of: ${ICP_DISQUALIFIER_STATES.join(', ')}`);
  }

  // The gates below index into the spine, so they only run once its shape is
  // known-good — otherwise a malformed structure would report a confusing
  // band violation on top of the shape error that actually caused it.
  if (icpsValid && attributesValid && disqualifiersValid) {
    errors.push(...findIcpStructureViolations(candidate as IcpStructure, documentMarkdown));
  }

  return errors;
}

/** Schema gates for the envelope's `inputs` provenance record. */
function validateInputs(inputs: unknown): string[] {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
    return ['inputs must be an object'];
  }
  const record = inputs as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of ['brand_kit_provided', 'message_foundation_provided', 'live_membership_data_provided']) {
    if (typeof record[key] !== 'boolean') {
      errors.push(`inputs.${key} must be a boolean`);
    }
  }
  for (const key of ['brand_kit_sha256', 'message_foundation_sha256', 'live_membership_data_sha256']) {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'string' || !ICP_SHA256_REGEX.test(value))) {
      errors.push(`inputs.${key} must be 64 lowercase hex characters when present`);
    }
  }
  return errors;
}

/** Schema gates for the envelope's verbatim intake log. */
function validateIntake(intake: unknown): string[] {
  if (typeof intake !== 'object' || intake === null || Array.isArray(intake)) {
    return ['intake must be an object'];
  }
  const record = intake as Partial<IcpEnvelope['intake']>;
  const errors: string[] = [];

  if (record.mode !== 'form' && record.mode !== 'conversational') {
    errors.push('intake.mode must be "form" or "conversational"');
  }
  if (typeof record.completed_at !== 'string' || !ICP_ISO_TIMESTAMP_REGEX.test(record.completed_at) || Number.isNaN(new Date(record.completed_at).getTime())) {
    errors.push('intake.completed_at must be an ISO-8601 timestamp');
  }
  if (!Array.isArray(record.answers) || record.answers.length < ICP_INTAKE_ANSWERS_MIN || record.answers.length > ICP_INTAKE_ANSWERS_MAX) {
    errors.push(`intake.answers must contain ${ICP_INTAKE_ANSWERS_MIN}-${ICP_INTAKE_ANSWERS_MAX} entries`);
    return errors;
  }
  record.answers.forEach((entry, index) => {
    const numberOk =
      typeof entry?.question_number === 'number' &&
      Number.isInteger(entry.question_number) &&
      entry.question_number >= 1 &&
      entry.question_number <= ICP_INTAKE_ANSWERS_MAX;
    const textOk = typeof entry?.question === 'string' && entry.question.length > 0 && typeof entry?.answer === 'string' && entry.answer.length > 0;
    if (!numberOk || !textOk) {
      errors.push(`intake.answers[${index}] is malformed`);
    }
  });
  return errors;
}

/** UTF-8 byte length without assuming Buffer (browser-safe). */
function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
