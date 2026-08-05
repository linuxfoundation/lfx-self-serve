// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Brand Kit envelope validation + extraction helpers
// (brand-kit-output/v1, wi-brand-kit-bff-persist).
//
// The fixture is fully synthetic: a schema-valid envelope with all 12 required
// headings and a correct content_sha256 computed at test time. Never real data.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { BRAND_KIT_CONTRACT_ID, BRAND_KIT_REQUIRED_HEADINGS } from '../constants/brand-kit.constants';
import { BrandKitEnvelope } from '../interfaces/brand-kit.interface';
import { buildBrandKitObjectKey, extractBrandKitEnvelopeCandidates, findMissingBrandKitHeadings, validateBrandKitEnvelope } from './brand-kit.utils';

/** Build a structurally valid document containing every required heading, padded past the 1000-char floor. */
function buildDocument(): string {
  const filler = 'Synthetic fixture prose for the Brand Kit structural gate. '.repeat(4);
  const sections = ['# TestOrbit Brand Kit', '', '| Field | Value |', '| --- | --- |', '| Project | TestOrbit |', ''];
  for (const heading of BRAND_KIT_REQUIRED_HEADINGS) {
    sections.push(heading, '', filler, '');
  }
  return sections.join('\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function buildEnvelope(overrides: Partial<BrandKitEnvelope> = {}): BrandKitEnvelope {
  const document = buildDocument();
  return {
    contract: BRAND_KIT_CONTRACT_ID,
    kind: 'brand-kit',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    document_markdown: document,
    content_sha256: sha256(document),
    intake: {
      mode: 'form',
      completed_at: '2026-08-05T00:00:00Z',
      answers: Array.from({ length: 7 }, (_, i) => ({
        question_number: i + 1,
        question: `Synthetic question ${i + 1}?`,
        answer: `Synthetic answer ${i + 1}.`,
      })),
    },
    generated_at: '2026-08-05T00:00:01Z',
    agent: {
      identifier: 'linux-foundation~brand-kit',
      agent_version: '1.0.14',
      prompt_manifest_sha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

describe('validateBrandKitEnvelope', () => {
  it('accepts a fully valid envelope', () => {
    const result = validateBrandKitEnvelope(buildEnvelope());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown contract major', () => {
    const result = validateBrandKitEnvelope(buildEnvelope({ contract: 'brand-kit-output/v2' }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('contract');
  });

  it('rejects a non-object payload', () => {
    expect(validateBrandKitEnvelope('nope').valid).toBe(false);
    expect(validateBrandKitEnvelope(null).valid).toBe(false);
    expect(validateBrandKitEnvelope([buildEnvelope()]).valid).toBe(false);
  });

  it('rejects a document missing a required heading', () => {
    const doc = buildDocument().replace('## 5. Key Brand Strengths', '## 5. Renamed Section');
    const result = validateBrandKitEnvelope(buildEnvelope({ document_markdown: doc, content_sha256: sha256(doc) }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('## 5. Key Brand Strengths');
  });

  it('rejects out-of-order headings', () => {
    const doc = buildDocument();
    const reordered = doc
      .replace('## 2. Positioning', '## TMP')
      .replace('## 9. Channel Quick Reference', '## 2. Positioning')
      .replace('## TMP', '## 9. Channel Quick Reference');
    const result = validateBrandKitEnvelope(buildEnvelope({ document_markdown: reordered, content_sha256: sha256(reordered) }));
    expect(result.valid).toBe(false);
  });

  it('accepts headings with trailing qualifiers', () => {
    const doc = buildDocument().replace('## 8. Tagline Options', '## 8. Tagline Options (Starter Set)');
    const result = validateBrandKitEnvelope(buildEnvelope({ document_markdown: doc, content_sha256: sha256(doc) }));
    expect(result.valid).toBe(true);
  });

  it('rejects a malformed sha and a bad slug', () => {
    expect(validateBrandKitEnvelope(buildEnvelope({ content_sha256: 'XYZ' })).valid).toBe(false);
    expect(validateBrandKitEnvelope(buildEnvelope({ project: 'Bad_Slug' })).valid).toBe(false);
  });

  it('rejects a short document and wrong intake shapes', () => {
    expect(validateBrandKitEnvelope(buildEnvelope({ document_markdown: '## short' })).valid).toBe(false);
    const badIntake = buildEnvelope();
    badIntake.intake.answers = badIntake.intake.answers.slice(0, 6);
    expect(validateBrandKitEnvelope(badIntake).valid).toBe(false);
    const badMode = buildEnvelope();
    (badMode.intake as { mode: string }).mode = 'batch';
    expect(validateBrandKitEnvelope(badMode).valid).toBe(false);
  });

  it('rejects out-of-order or duplicated intake question numbers', () => {
    const dupes = buildEnvelope();
    dupes.intake.answers = dupes.intake.answers.map((a) => ({ ...a, question_number: 1 }));
    expect(validateBrandKitEnvelope(dupes).valid).toBe(false);
  });

  it('rejects non-ISO completed_at strings that Date() would accept', () => {
    const loose = buildEnvelope();
    loose.intake.completed_at = 'Aug 5 2026';
    expect(validateBrandKitEnvelope(loose).valid).toBe(false);
    const slash = buildEnvelope();
    slash.intake.completed_at = '08/05/2026';
    expect(validateBrandKitEnvelope(slash).valid).toBe(false);
  });
});

describe('findMissingBrandKitHeadings', () => {
  it('returns empty for a complete document and lists gaps otherwise', () => {
    expect(findMissingBrandKitHeadings(buildDocument())).toEqual([]);
    expect(findMissingBrandKitHeadings('# nothing here')).toHaveLength(BRAND_KIT_REQUIRED_HEADINGS.length);
  });
});

describe('buildBrandKitObjectKey', () => {
  it('derives the content-addressed key from validated fields', () => {
    const sha = sha256('doc');
    expect(buildBrandKitObjectKey('testorbit', sha)).toBe(`brand-kit/testorbit/${sha}.md`);
  });

  it('throws on unvalidated inputs (never client-supplied paths)', () => {
    expect(() => buildBrandKitObjectKey('../escape', 'a'.repeat(64))).toThrow();
    expect(() => buildBrandKitObjectKey('ok-slug', 'not-a-sha')).toThrow();
  });
});

describe('extractBrandKitEnvelopeCandidates', () => {
  it('extracts a direct JSON envelope', () => {
    const envelope = buildEnvelope();
    const found = extractBrandKitEnvelopeCandidates(JSON.stringify(envelope));
    expect(found).toHaveLength(1);
    expect(found[0].content_sha256).toBe(envelope.content_sha256);
  });

  it('extracts a tool-result envelope_json double-encoding (the A3 authoritative path)', () => {
    const envelope = buildEnvelope();
    const toolResult = JSON.stringify({ envelope_json: JSON.stringify(envelope) });
    const found = extractBrandKitEnvelopeCandidates(toolResult);
    expect(found).toHaveLength(1);
    expect(found[0].project).toBe('testorbit');
  });

  it('extracts an envelope embedded in a non-JSON stream body', () => {
    const envelope = buildEnvelope();
    const payload = `llm stream noise... tool_result: ${JSON.stringify(envelope)} ...trailing`;
    const found = extractBrandKitEnvelopeCandidates(payload);
    expect(found).toHaveLength(1);
  });

  it('extracts from nested wrapper shapes', () => {
    const envelope = buildEnvelope();
    const wrapped = JSON.stringify({ content: { type: 'text', data: JSON.stringify({ envelope_json: JSON.stringify(envelope) }) } });
    expect(extractBrandKitEnvelopeCandidates(wrapped)).toHaveLength(1);
  });

  it('returns empty when the discriminator is absent or malformed', () => {
    expect(extractBrandKitEnvelopeCandidates('no envelopes here')).toEqual([]);
    expect(extractBrandKitEnvelopeCandidates(`prose mentioning ${BRAND_KIT_CONTRACT_ID} without JSON`)).toEqual([]);
  });
});
