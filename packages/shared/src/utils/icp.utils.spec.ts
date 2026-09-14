// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  ICP_DIMENSION_FIELDS,
  ICP_FORM_TYPE,
  ICP_GAP_FILL_QUESTIONS,
  ICP_KEY_PREFIX,
  ICP_PERSONA_FIELDS,
  ICP_Q_GITHUB_URL,
  ICP_Q_PROJECT_NAME,
  ICP_Q_SIBLING_DOCS,
  ICP_REQUIRED_HEADINGS,
  ICP_REQUIRED_SUBHEADINGS,
  ICP_REVISED_INTAKE_FEEDBACK,
} from '../constants/icp.constants';
import { IcpEnvelope, IcpStructure } from '../interfaces/icp.interface';
import {
  buildIcpFormPayload,
  buildIcpObjectKey,
  extractIcpEnvelopeCandidates,
  findIcpStructureViolations,
  findMissingIcpHeadings,
  renderIcpFormText,
  validateIcpEnvelope,
  validateIcpIntakeAnswers,
} from './icp.utils';

/** Minimal valid answers: the three the agent's form contract requires. */
const requiredAnswers = (): Record<string, string> => ({
  project_name: 'Example Project',
  github_url: 'https://github.com/example/project',
  business_outcome: 'Membership growth',
});

const structure = (): IcpStructure => ({
  icps: [
    { label: 'Cloud-native platform vendors', personas: ['Platform Architect', 'VP of Engineering'] },
    { label: 'Enterprise adopters', personas: ['Head of Infrastructure', 'Staff SRE'] },
  ],
  fit_warmth_attributes: ['Kubernetes footprint', 'Active contributor headcount', 'Existing LF membership', 'Public adoption signal'],
  disqualifiers: 'confirmed',
});

/**
 * A document that satisfies every deterministic gate: the ten level-2
 * headings, the four section-1 subheadings, both Velocity Engine field sets,
 * and every structure value verbatim.
 */
const document = (spine: IcpStructure = structure()): string => {
  const verbatim = [...spine.icps.map((icp) => icp.label), ...spine.icps.flatMap((icp) => icp.personas), ...spine.fit_warmth_attributes];
  const lines = [
    ...ICP_REQUIRED_HEADINGS.flatMap((heading, index) => (index === 2 ? [heading, ...ICP_REQUIRED_SUBHEADINGS] : [heading])),
    ...ICP_DIMENSION_FIELDS.map((field) => `- ${field}: covered`),
    ...ICP_PERSONA_FIELDS.map((field) => `- ${field}: covered`),
    ...verbatim.map((value) => `- ${value}`),
  ];
  // The contract's 1000-character floor — padded with real prose lines so the
  // fixture never passes the length gate on filler the gates would reject.
  while (lines.join('\n').length < 1200) {
    lines.push('This section documents the segment rationale in the projects own words.');
  }
  return lines.join('\n');
};

const envelope = (overrides: Partial<IcpEnvelope> = {}): Record<string, unknown> => {
  const spine = (overrides.structure as IcpStructure) ?? structure();
  const documentMarkdown = (overrides.document_markdown as string) ?? document(spine);
  return {
    contract: 'icp-output/v1',
    kind: 'icp',
    project: 'example-project',
    project_name: 'Example Project',
    version: 1,
    document_markdown: documentMarkdown,
    // The hash is the CALLER's gate (node:crypto lives outside this package),
    // so the validator only checks its shape; the server recomputes it.
    content_sha256: 'a'.repeat(64),
    business_outcome: 'Membership growth',
    structure: spine,
    inputs: { brand_kit_provided: false, message_foundation_provided: false, live_membership_data_provided: false },
    intake: {
      mode: 'form',
      completed_at: '2026-09-10T12:00:00Z',
      answers: [
        { question_number: 1, question: ICP_Q_PROJECT_NAME, answer: 'Example Project' },
        { question_number: 2, question: ICP_Q_GITHUB_URL, answer: 'https://github.com/example/project' },
        { question_number: 4, question: ICP_GAP_FILL_QUESTIONS[0].question, answer: 'Membership growth' },
      ],
    },
    generated_at: '2026-09-10T12:00:00Z',
    agent: { identifier: 'linux-foundation~icp', agent_version: '1.0.2', prompt_manifest_sha256: 'b'.repeat(64) },
    ...overrides,
  };
};

describe('validateIcpIntakeAnswers — the agent form contract', () => {
  it('accepts the three required answers alone', () => {
    expect(validateIcpIntakeAnswers(requiredAnswers())).toEqual({ valid: true, errors: [] });
  });

  it('requires project_name, github_url and the never-skip business_outcome', () => {
    const result = validateIcpIntakeAnswers({});
    expect(result.valid).toBe(false);
    for (const key of ['project_name', 'github_url', 'business_outcome']) {
      expect(result.errors.some((error) => error.includes(key))).toBe(true);
    }
  });

  it('accepts the optional gap-fill answers and the auto-attached sibling documents', () => {
    const answers = {
      ...requiredAnswers(),
      competitive_landscape: 'Vendor A, Vendor B',
      disqualifiers: 'Single-developer hobby projects',
      trigger_events: 'A platform re-architecture',
      known_member_orgs: 'Acme, Globex',
      brand_kit_markdown: '# Example Project Brand Kit',
      message_foundation_markdown: '# Example Project Message Foundation',
    };
    expect(validateIcpIntakeAnswers(answers)).toEqual({ valid: true, errors: [] });
  });

  it('rejects keys that are not intake fields', () => {
    const result = validateIcpIntakeAnswers({ ...requiredAnswers(), rogue_key: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('rogue_key'))).toBe(true);
  });

  it('rejects caller-supplied lfx_membership_data — the flow has no trusted producer for it', () => {
    const result = validateIcpIntakeAnswers({ ...requiredAnswers(), lfx_membership_data: 'Acme Corp is a Platinum member' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('lfx_membership_data'))).toBe(true);
  });

  it('rejects a non-object answers payload', () => {
    expect(validateIcpIntakeAnswers(null).valid).toBe(false);
    expect(validateIcpIntakeAnswers(['a']).valid).toBe(false);
  });
});

describe('buildIcpFormPayload', () => {
  it('builds the typed payload from the required answers only', () => {
    expect(buildIcpFormPayload(requiredAnswers())).toEqual({
      type: ICP_FORM_TYPE,
      project_name: 'Example Project',
      github_url: 'https://github.com/example/project',
      business_outcome: 'Membership growth',
    });
  });

  it('omits blank optional answers so the agent takes its documented "not provided" branch', () => {
    const payload = buildIcpFormPayload({ ...requiredAnswers(), competitive_landscape: '   ', brand_kit_markdown: '' });
    expect(payload.competitive_landscape).toBeUndefined();
    expect(payload.brand_kit_markdown).toBeUndefined();
  });

  it('passes the sibling documents through verbatim, not trimmed', () => {
    const brandKit = '\n# Example Project Brand Kit\n';
    const payload = buildIcpFormPayload({ ...requiredAnswers(), brand_kit_markdown: brandKit });
    expect(payload.brand_kit_markdown).toBe(brandKit);
  });

  it('carries the README when the BFF fetched one', () => {
    expect(buildIcpFormPayload(requiredAnswers(), { readmeMarkdown: '# README' }).readme_markdown).toBe('# README');
    expect(buildIcpFormPayload(requiredAnswers(), { readmeMarkdown: '' }).readme_markdown).toBeUndefined();
  });

  it('synthesizes feedback for an edit-inputs resubmit so the agent still versions to N+1', () => {
    const payload = buildIcpFormPayload(requiredAnswers(), { priorVersion: 2 });
    expect(payload.prior_version).toBe(2);
    expect(payload.feedback).toBe(ICP_REVISED_INTAKE_FEEDBACK);
  });

  it('keeps the user feedback when one was given', () => {
    const payload = buildIcpFormPayload(requiredAnswers(), { priorVersion: 1, feedback: '  sharpen persona two  ' });
    expect(payload.feedback).toBe('sharpen persona two');
  });

  it('ignores a prior version that is not a positive integer', () => {
    const payload = buildIcpFormPayload(requiredAnswers(), { priorVersion: 0 });
    expect(payload.prior_version).toBeUndefined();
    expect(payload.feedback).toBeUndefined();
  });
});

describe('renderIcpFormText — verbatim mirror of the agent renderer', () => {
  it('pairs every answer with the agent’s exact question wording', () => {
    const text = renderIcpFormText(buildIcpFormPayload(requiredAnswers()));
    expect(text).toContain(`Q1a. ${ICP_Q_PROJECT_NAME}`);
    expect(text).toContain(`Q1b. ${ICP_Q_GITHUB_URL}`);
    expect(text).toContain(`Q1c. ${ICP_Q_SIBLING_DOCS}`);
    expect(text).toContain(`Q1d.1. ${ICP_GAP_FILL_QUESTIONS[0].question}`);
    expect(text).toContain('A1d.1. Membership growth');
  });

  it('states plainly that neither sibling document exists when none was attached', () => {
    const text = renderIcpFormText(buildIcpFormPayload(requiredAnswers()));
    expect(text).toContain('A1c. No — neither document exists yet for this project.');
    expect(text).not.toContain('BEGIN BRAND KIT DOCUMENT');
  });

  it('fences both sibling documents and pluralizes the answer when both are attached', () => {
    const payload = buildIcpFormPayload({
      ...requiredAnswers(),
      brand_kit_markdown: '# Kit',
      message_foundation_markdown: '# Foundation',
    });
    const text = renderIcpFormText(payload);
    expect(text).toContain('A1c. Yes — the full Brand Kit and Message Foundation documents are provided below.');
    expect(text).toContain('===== BEGIN BRAND KIT DOCUMENT =====');
    expect(text).toContain('===== BEGIN MESSAGE FOUNDATION DOCUMENT =====');
  });

  it('names the unanswered gap-fill questions instead of letting the agent ask them interactively', () => {
    const text = renderIcpFormText(buildIcpFormPayload(requiredAnswers()));
    expect(text).toContain('Gap-fill questions 1d.2, 1d.3, 1d.4, 1d.5 were not answered on the form. Do NOT ask them');
  });

  it('tells the agent it has no README when the fetch produced nothing', () => {
    const text = renderIcpFormText(buildIcpFormPayload(requiredAnswers()));
    expect(text).toContain('No README content was provided.');
  });

  it('never invents a member roster when no live membership data was supplied', () => {
    const text = renderIcpFormText(buildIcpFormPayload(requiredAnswers()));
    expect(text).toContain('No live member/adopter data was provided');
    expect(text).toContain('Never invent a roster.');
  });

  it('emits the version directive on a regeneration', () => {
    const text = renderIcpFormText(buildIcpFormPayload(requiredAnswers(), { priorVersion: 2, feedback: 'more proof points' }));
    expect(text).toContain('FEEDBACK on draft v2 — regenerate incorporating it and finalize as version 3:');
    expect(text).toContain('more proof points');
  });
});

describe('findMissingIcpHeadings — structural gate S1', () => {
  it('passes a document carrying every heading and subheading', () => {
    expect(findMissingIcpHeadings(document())).toEqual([]);
  });

  it('tolerates the template’s own trailing qualifiers', () => {
    const qualified = document().replace('## 2. ICP Definitions', '## 2. ICP Definitions (Organization-Level)');
    expect(findMissingIcpHeadings(qualified)).toEqual([]);
  });

  it('reports a heading that is only a prefix of a longer word', () => {
    const broken = document().replace('## 6. Validation & Review', '## 6. Validation & Reviewers');
    expect(findMissingIcpHeadings(broken)).toContain('## 6. Validation & Review');
  });

  it('reports a missing section-1 subheading', () => {
    const broken = document().replace('### 1.4 Current Member/Adopter Segments', '### 1.4 Members');
    expect(findMissingIcpHeadings(broken)).toContain('### 1.4 Current Member/Adopter Segments');
  });
});

describe('findIcpStructureViolations — gates G1-G6', () => {
  it('passes the reference structure', () => {
    expect(findIcpStructureViolations(structure(), document())).toEqual([]);
  });

  it('G1 rejects an ICP with too few personas', () => {
    const spine = structure();
    spine.icps[0].personas = ['Platform Architect'];
    expect(findIcpStructureViolations(spine, document(spine)).some((violation) => violation.startsWith('G1'))).toBe(true);
  });

  it('G2 rejects a fit/warmth set outside the 4-6 band', () => {
    const spine = structure();
    spine.fit_warmth_attributes = ['Only one'];
    expect(findIcpStructureViolations(spine, document(spine)).some((violation) => violation.startsWith('G2'))).toBe(true);
  });

  it('G3 rejects a persona title that is not verbatim in the document', () => {
    const spine = structure();
    const violations = findIcpStructureViolations(spine, document(spine).replace('- Staff SRE', '- Site Reliability Engineer'));
    expect(violations.some((violation) => violation.startsWith('G3') && violation.includes('Staff SRE'))).toBe(true);
  });

  it('G4 rejects a persona title repeated across ICPs', () => {
    const spine = structure();
    spine.icps[1].personas = ['Platform Architect', 'Staff SRE'];
    expect(findIcpStructureViolations(spine, document(spine)).some((violation) => violation.startsWith('G4'))).toBe(true);
  });

  it('G5 rejects a document missing a Velocity Engine field name', () => {
    const spine = structure();
    const violations = findIcpStructureViolations(spine, document(spine).replace('- Trusted Sources: covered', '- Sources: covered'));
    expect(violations.some((violation) => violation.startsWith('G5') && violation.includes('Trusted Sources'))).toBe(true);
  });

  it('G6 requires an inferred disqualifier set to be labelled as such in the document', () => {
    const spine = { ...structure(), disqualifiers: 'inferred_draft' as const };
    expect(findIcpStructureViolations(spine, document(spine)).some((violation) => violation.startsWith('G6'))).toBe(true);
    expect(findIcpStructureViolations(spine, `${document(spine)}\nThese are an inferred draft pending PL confirmation.`)).toEqual([]);
  });
});

describe('validateIcpEnvelope', () => {
  it('accepts a contract-conformant envelope', () => {
    expect(validateIcpEnvelope(envelope())).toEqual({ valid: true, errors: [] });
  });

  it('rejects an unknown contract major outright', () => {
    const result = validateIcpEnvelope(envelope({ contract: 'icp-output/v2' } as Partial<IcpEnvelope>));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('contract must be'))).toBe(true);
  });

  it('rejects a sibling contract’s envelope', () => {
    const result = validateIcpEnvelope(envelope({ contract: 'brand-kit-output/v1', kind: 'brand-kit' } as Partial<IcpEnvelope>));
    expect(result.valid).toBe(false);
  });

  it('rejects a document below the contract length floor', () => {
    const result = validateIcpEnvelope(envelope({ document_markdown: '## Cover' } as Partial<IcpEnvelope>));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('at least'))).toBe(true);
  });

  it('rejects a malformed structure spine without also reporting band violations', () => {
    const result = validateIcpEnvelope(envelope({ document_markdown: document(), structure: { icps: 'nope' } as unknown as IcpStructure }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.startsWith('G1'))).toBe(false);
  });

  it('requires the business outcome the ICP was optimized toward', () => {
    const result = validateIcpEnvelope(envelope({ business_outcome: '  ' } as Partial<IcpEnvelope>));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('business_outcome'))).toBe(true);
  });

  it('requires the input-provenance booleans', () => {
    const result = validateIcpEnvelope(envelope({ inputs: { brand_kit_provided: true } as never }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('message_foundation_provided'))).toBe(true);
  });

  it('rejects a malformed input sha', () => {
    const result = validateIcpEnvelope(
      envelope({ inputs: { brand_kit_provided: true, brand_kit_sha256: 'nope', message_foundation_provided: false, live_membership_data_provided: false } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('brand_kit_sha256'))).toBe(true);
  });

  it('enforces the 3-8 intake answer band', () => {
    const result = validateIcpEnvelope(
      envelope({ intake: { mode: 'form', completed_at: '2026-09-10T12:00:00Z', answers: [{ question_number: 1, question: 'q', answer: 'a' }] } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('intake.answers'))).toBe(true);
  });

  it('rejects a non-object candidate', () => {
    expect(validateIcpEnvelope('{}').valid).toBe(false);
    expect(validateIcpEnvelope([]).valid).toBe(false);
  });
});

describe('buildIcpObjectKey', () => {
  it('namespaces the ICP prefix inside the shared marketing artifacts bucket', () => {
    expect(buildIcpObjectKey('proj-uid-1', 'c'.repeat(64))).toBe(`${ICP_KEY_PREFIX}/proj-uid-1/${'c'.repeat(64)}.md`);
  });

  it('refuses a partition that is not one safe key segment', () => {
    expect(() => buildIcpObjectKey('../other', 'c'.repeat(64))).toThrow();
    expect(() => buildIcpObjectKey('proj-uid-1', 'not-a-sha')).toThrow();
  });
});

describe('extractIcpEnvelopeCandidates', () => {
  it('unwraps the finalize tool result’s double-encoded envelope', () => {
    const payload = JSON.stringify({ content: [{ envelope_json: JSON.stringify(envelope()) }] });
    const candidates = extractIcpEnvelopeCandidates(payload);
    expect(candidates).toHaveLength(1);
    expect(validateIcpEnvelope(candidates[0]).valid).toBe(true);
  });

  it('ignores payloads carrying no ICP contract discriminator', () => {
    expect(extractIcpEnvelopeCandidates(JSON.stringify({ contract: 'brand-kit-output/v1' }))).toEqual([]);
  });
});
