// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generic Marketing OS envelope-candidate extraction, parameterized by the
// contract discriminator. Factored out of the Brand Kit session-consumer
// (brand-kit.utils.ts) so every agent contract (brand-kit-output/v1,
// message-foundation-output/v1, …) shares one battle-tested scanner instead
// of drifting copies. Platform-neutral: no hashing here (see brand-kit.utils
// module note) — callers recompute the sha and validate the schema.

import { MKTG_ENVELOPE_EXTRACTION_MAX_DEPTH } from '../constants/mktg-run.constants';

/**
 * Extract candidate contract envelopes from an arbitrary text payload.
 *
 * Per the live-smoke A3 verdict, the authoritative envelope is the finalize
 * TOOL RESULT (`{ envelope_json: "..." }`) riding inside session event bodies
 * — the `__submit__`-ed text may be prose or abridged. This helper therefore
 * scans the payload for JSON objects that carry the contract discriminator,
 * handling both direct envelopes and the `envelope_json` double-encoding, and
 * returns every parse that succeeds. Candidates are returned as `unknown` —
 * they carry the discriminator but are otherwise UNVALIDATED; callers must
 * pass each through the contract's validator before trusting it.
 */
export function extractMktgEnvelopeCandidates(payload: string, contractId: string): unknown[] {
  if (!payload || !contractId || !payload.includes(contractId)) {
    return [];
  }

  const candidates: unknown[] = [];

  const consider = (value: unknown, depth: number): void => {
    if (depth > MKTG_ENVELOPE_EXTRACTION_MAX_DEPTH) {
      // Guard against pathological deeply-nested payloads; real Guild event
      // wrappers are only a few levels deep.
      return;
    }
    if (typeof value === 'string') {
      // envelope_json double-encoding: a string that itself parses to an envelope.
      if (value.includes(contractId)) {
        try {
          consider(JSON.parse(value), depth + 1);
        } catch {
          // Not valid JSON — scan it for embedded objects instead.
          candidates.push(...scanForEnvelopeObjects(value, contractId));
        }
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (record['contract'] === contractId) {
      candidates.push(record);
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
      if (child && (typeof child === 'object' || (typeof child === 'string' && child.includes(contractId)))) {
        consider(child, depth + 1);
      }
    }
  };

  try {
    consider(JSON.parse(payload), 0);
  } catch {
    candidates.push(...scanForEnvelopeObjects(payload, contractId));
  }

  return candidates;
}

/**
 * Scan free text for balanced `{...}` JSON objects containing the contract id
 * and parse each. Used when the payload is not itself valid JSON (e.g. an LLM
 * stream body with an embedded tool result).
 */
function scanForEnvelopeObjects(text: string, contractId: string): unknown[] {
  const found: unknown[] = [];
  let searchFrom = 0;

  for (;;) {
    const marker = text.indexOf(contractId, searchFrom);
    if (marker === -1) {
      break;
    }
    // Walk back to the opening brace of the object containing the marker. The
    // marker may sit inside a direct envelope OR inside an `envelope_json`
    // string value — walk outward brace by brace until a parse succeeds.
    let start = text.lastIndexOf('{', marker);
    let matched = false;
    while (start !== -1 && !matched) {
      const objectText = readBalancedObject(text, start);
      if (objectText) {
        try {
          const parsed = JSON.parse(objectText) as Record<string, unknown>;
          if (parsed['contract'] === contractId) {
            found.push(parsed);
            matched = true;
            break;
          }
          if (typeof parsed['envelope_json'] === 'string' && parsed['envelope_json'].includes(contractId)) {
            // The authoritative tool-result wrapper embedded in free text:
            // unwrap the double-encoded envelope.
            try {
              const inner = JSON.parse(parsed['envelope_json']) as Record<string, unknown>;
              if (inner['contract'] === contractId) {
                found.push(inner);
                matched = true;
                break;
              }
            } catch {
              // Malformed inner JSON — fall through to walk further out.
            }
          }
        } catch {
          // Malformed fragment — walk further out.
        }
      }
      start = start > 0 ? text.lastIndexOf('{', start - 1) : -1;
    }
    searchFrom = marker + contractId.length;
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
