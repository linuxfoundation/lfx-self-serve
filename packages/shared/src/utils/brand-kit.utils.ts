// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure Brand Kit envelope validation + extraction helpers (brand-kit-output/v1).
// The SHA-256 recompute is deliberately NOT here: hashing is environment-specific
// (node:crypto on the server) and the shared package stays platform-neutral.
// Callers recompute the hash and compare against `envelope.content_sha256`.

import {
  BRAND_KIT_CONTRACT_ID,
  BRAND_KIT_EXTRACTION_MAX_DEPTH,
  BRAND_KIT_INTAKE_ANSWER_COUNT,
  BRAND_KIT_ISO_TIMESTAMP_REGEX,
  BRAND_KIT_KEY_PREFIX,
  BRAND_KIT_KIND,
  BRAND_KIT_MAX_DOCUMENT_BYTES,
  BRAND_KIT_MIN_DOCUMENT_LENGTH,
  BRAND_KIT_PROJECT_SLUG_REGEX,
  BRAND_KIT_REQUIRED_HEADINGS,
  BRAND_KIT_SHA256_REGEX,
} from '../constants/brand-kit.constants';
import { BrandKitEnvelope, BrandKitValidationResult } from '../interfaces/brand-kit.interface';

/**
 * Validate a candidate Brand Kit envelope against the v1 contract's schema
 * gates and the 12-heading structural presence gate (contract §1 + §3 steps
 * 1, 3, 4). Hash equality (step 2) is the caller's job — see module note.
 */
export function validateBrandKitEnvelope(candidate: unknown): BrandKitValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }

  const envelope = candidate as Partial<BrandKitEnvelope>;

  if (envelope.contract !== BRAND_KIT_CONTRACT_ID) {
    // Reject unknown contract majors outright — do not attempt to interpret them.
    errors.push(`contract must be "${BRAND_KIT_CONTRACT_ID}" (got ${JSON.stringify(envelope.contract ?? null)})`);
  }
  if (envelope.kind !== BRAND_KIT_KIND) {
    errors.push(`kind must be "${BRAND_KIT_KIND}"`);
  }
  if (typeof envelope.project !== 'string' || !BRAND_KIT_PROJECT_SLUG_REGEX.test(envelope.project)) {
    errors.push('project must be a lowercase kebab-case slug');
  }
  if (typeof envelope.version !== 'number' || !Number.isInteger(envelope.version) || envelope.version < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (typeof envelope.content_sha256 !== 'string' || !BRAND_KIT_SHA256_REGEX.test(envelope.content_sha256)) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }

  if (typeof envelope.document_markdown !== 'string' || envelope.document_markdown.length < BRAND_KIT_MIN_DOCUMENT_LENGTH) {
    errors.push(`document_markdown must be a string of at least ${BRAND_KIT_MIN_DOCUMENT_LENGTH} characters`);
  } else {
    const missing = findMissingBrandKitHeadings(envelope.document_markdown);
    if (missing.length > 0) {
      errors.push(`document_markdown is missing required headings (in order): ${missing.join(' | ')}`);
    }
    if (getUtf8ByteLength(envelope.document_markdown) > BRAND_KIT_MAX_DOCUMENT_BYTES) {
      errors.push(`document_markdown exceeds the ${BRAND_KIT_MAX_DOCUMENT_BYTES}-byte object size cap`);
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
      !BRAND_KIT_ISO_TIMESTAMP_REGEX.test(intake.completed_at) ||
      Number.isNaN(new Date(intake.completed_at).getTime())
    ) {
      errors.push('intake.completed_at must be an ISO-8601 timestamp');
    }
    if (!Array.isArray(intake.answers) || intake.answers.length !== BRAND_KIT_INTAKE_ANSWER_COUNT) {
      errors.push(`intake.answers must contain exactly ${BRAND_KIT_INTAKE_ANSWER_COUNT} entries`);
    } else {
      intake.answers.forEach((entry, index) => {
        // Contract: exactly 7 entries in Paul's fixed question order — the
        // position field must match its index, closing duplicate/reordered logs.
        const positionOk = entry?.question_number === index + 1;
        const textOk = typeof entry?.question === 'string' && entry.question.length > 0 && typeof entry?.answer === 'string' && entry.answer.length > 0;
        if (!positionOk || !textOk) {
          errors.push(`intake.answers[${index}] is malformed`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Return the required headings missing from the document, enforcing order:
 * each heading must appear (at the start of a line, prefix match) after the
 * previous one. A heading found out of order counts as missing.
 */
export function findMissingBrandKitHeadings(documentMarkdown: string): string[] {
  const lines = documentMarkdown.split('\n').map((line) => line.trimEnd());
  const missing: string[] = [];
  let cursor = 0;

  for (const heading of BRAND_KIT_REQUIRED_HEADINGS) {
    let found = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (lines[i].startsWith(heading)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      missing.push(heading);
    } else {
      cursor = found + 1;
    }
  }

  return missing;
}

/** Derive the content-addressed object key from validated fields only (contract §3.5). */
export function buildBrandKitObjectKey(project: string, contentSha256: string): string {
  if (!BRAND_KIT_PROJECT_SLUG_REGEX.test(project) || !BRAND_KIT_SHA256_REGEX.test(contentSha256)) {
    throw new Error('buildBrandKitObjectKey requires already-validated project and content_sha256 values');
  }
  return `${BRAND_KIT_KEY_PREFIX}/${project}/${contentSha256}.md`;
}

/**
 * Extract candidate Brand Kit envelopes from an arbitrary text payload.
 *
 * Per the live-smoke A3 verdict, the authoritative envelope is the
 * `finalize_brand_kit` TOOL RESULT (`{ envelope_json: "..." }`) riding inside
 * session event bodies — the `__submit__`-ed text may be prose or abridged.
 * This helper therefore scans the payload for JSON objects that carry the
 * contract discriminator, handling both direct envelopes and the
 * `envelope_json` double-encoding, and returns every parse that succeeds.
 * The caller validates each candidate and picks the last valid one.
 */
export function extractBrandKitEnvelopeCandidates(payload: string): BrandKitEnvelope[] {
  if (!payload || !payload.includes(BRAND_KIT_CONTRACT_ID)) {
    return [];
  }

  const candidates: BrandKitEnvelope[] = [];

  const consider = (value: unknown, depth: number): void => {
    if (depth > BRAND_KIT_EXTRACTION_MAX_DEPTH) {
      // Guard against pathological deeply-nested payloads; real Guild event
      // wrappers are only a few levels deep.
      return;
    }
    if (typeof value === 'string') {
      // envelope_json double-encoding: a string that itself parses to an envelope.
      if (value.includes(BRAND_KIT_CONTRACT_ID)) {
        try {
          consider(JSON.parse(value), depth + 1);
        } catch {
          // Not valid JSON — scan it for embedded objects instead.
          candidates.push(...scanForEnvelopeObjects(value));
        }
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (record['contract'] === BRAND_KIT_CONTRACT_ID) {
      candidates.push(record as unknown as BrandKitEnvelope);
      return;
    }
    if (typeof record['envelope_json'] === 'string') {
      consider(record['envelope_json'], depth + 1);
      return;
    }
    // Recurse into wrapper shapes ({content: ...}, {data: ...}, arrays) — full
    // depth up to the cap; only branches that can contain the contract id are
    // followed (string branches are pre-filtered by the includes() check).
    for (const child of Object.values(record)) {
      if (child && (typeof child === 'object' || (typeof child === 'string' && child.includes(BRAND_KIT_CONTRACT_ID)))) {
        consider(child, depth + 1);
      }
    }
  };

  try {
    consider(JSON.parse(payload), 0);
  } catch {
    candidates.push(...scanForEnvelopeObjects(payload));
  }

  return candidates;
}

/**
 * Scan free text for balanced `{...}` JSON objects containing the contract id
 * and parse each. Used when the payload is not itself valid JSON (e.g. an LLM
 * stream body with an embedded tool result).
 */
function scanForEnvelopeObjects(text: string): BrandKitEnvelope[] {
  const found: BrandKitEnvelope[] = [];
  let searchFrom = 0;

  for (;;) {
    const marker = text.indexOf(BRAND_KIT_CONTRACT_ID, searchFrom);
    if (marker === -1) {
      break;
    }
    // Walk back to the opening brace of the object containing the marker.
    const start = text.lastIndexOf('{', marker);
    if (start === -1) {
      searchFrom = marker + 1;
      continue;
    }
    const objectText = readBalancedObject(text, start);
    if (objectText) {
      try {
        const parsed = JSON.parse(objectText) as Record<string, unknown>;
        if (parsed['contract'] === BRAND_KIT_CONTRACT_ID) {
          found.push(parsed as unknown as BrandKitEnvelope);
        }
      } catch {
        // Malformed fragment — keep scanning.
      }
    }
    searchFrom = marker + BRAND_KIT_CONTRACT_ID.length;
  }

  return found;
}

/** Read a balanced JSON object starting at `start` (must be `{`), string-aware. */
function readBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/** UTF-8 byte length without assuming Buffer (browser-safe). */
function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
