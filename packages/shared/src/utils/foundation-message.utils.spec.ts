// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  FOUNDATION_MESSAGE_DISCOVERY_KEYS,
  FOUNDATION_MESSAGE_DISCOVERY_QUESTIONS,
  FOUNDATION_MESSAGE_FORM_TYPE,
  FOUNDATION_MESSAGE_README_MAX_CHARS,
  FOUNDATION_MESSAGE_REQUIRED_HEADINGS,
  FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK,
} from '../constants/foundation-message.constants';
import {
  buildFoundationMessageFormPayload,
  findMissingFoundationMessageHeadings,
  renderFoundationMessageFormText,
  validateFoundationMessageEnvelope,
  validateFoundationMessageIntakeAnswers,
} from './foundation-message.utils';

/** Minimal valid answers for the discovery branch (no Brand Kit). */
const discoveryAnswers = (): Record<string, string> => ({
  project_name: 'Example Project',
  github_url: 'https://github.com/example/project',
  one_line_description: 'Does a thing',
  primary_audience: 'Platform engineers',
  voice_adjectives: 'clear, direct, warm',
  constraints: 'None',
  reference_brands: 'Kubernetes',
});

/** Minimal valid answers for the brand-kit branch. */
const brandKitAnswers = (): Record<string, string> => ({
  project_name: 'Example Project',
  github_url: 'https://github.com/example/project',
  brand_kit_markdown: '# Example Project Brand Kit\n\nVoice: clear.',
});

describe('validateFoundationMessageIntakeAnswers — the conditional-requirement contract', () => {
  it('accepts the discovery branch: base fields + all five discovery answers, no brand kit', () => {
    expect(validateFoundationMessageIntakeAnswers(discoveryAnswers())).toEqual({ valid: true, errors: [] });
  });

  it('accepts the brand-kit branch: discovery answers not required when brand_kit_markdown is provided', () => {
    expect(validateFoundationMessageIntakeAnswers(brandKitAnswers())).toEqual({ valid: true, errors: [] });
  });

  it('requires every discovery answer when no brand_kit_markdown is provided', () => {
    const answers: Record<string, string> = { project_name: 'X', github_url: 'https://github.com/x/y' };
    const result = validateFoundationMessageIntakeAnswers(answers);
    expect(result.valid).toBe(false);
    for (const key of FOUNDATION_MESSAGE_DISCOVERY_KEYS) {
      expect(result.errors.join(' ')).toContain(key);
    }
  });

  it('treats a whitespace-only brand_kit_markdown as absent — discovery answers stay required', () => {
    const answers = { project_name: 'X', github_url: 'https://github.com/x/y', brand_kit_markdown: '   ' };
    const result = validateFoundationMessageIntakeAnswers(answers);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('one_line_description'))).toBe(true);
  });

  it('always requires project_name and github_url', () => {
    const result = validateFoundationMessageIntakeAnswers({ brand_kit_markdown: '# Kit' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('project_name'))).toBe(true);
    expect(result.errors.some((error) => error.includes('github_url'))).toBe(true);
  });

  it('rejects unknown keys and non-object answers', () => {
    expect(validateFoundationMessageIntakeAnswers({ ...brandKitAnswers(), evil_key: 'x' }).valid).toBe(false);
    expect(validateFoundationMessageIntakeAnswers(null).valid).toBe(false);
    expect(validateFoundationMessageIntakeAnswers([]).valid).toBe(false);
  });

  it('accepts the optional gap_fill_notes but rejects a non-string one', () => {
    expect(validateFoundationMessageIntakeAnswers({ ...brandKitAnswers(), gap_fill_notes: 'Milestone: v2 launch' }).valid).toBe(true);
    expect(validateFoundationMessageIntakeAnswers({ ...brandKitAnswers(), gap_fill_notes: 42 }).valid).toBe(false);
  });
});

describe('buildFoundationMessageFormPayload — the message_foundation_intake_form contract', () => {
  it('builds the discovery-branch payload with the type discriminator and all five discovery answers', () => {
    const payload = buildFoundationMessageFormPayload(discoveryAnswers());
    expect(payload.type).toBe(FOUNDATION_MESSAGE_FORM_TYPE);
    expect(payload.project_name).toBe('Example Project');
    expect(payload.github_url).toBe('https://github.com/example/project');
    expect(payload.brand_kit_markdown).toBeUndefined();
    for (const key of FOUNDATION_MESSAGE_DISCOVERY_KEYS) {
      expect(payload[key]).toBe(discoveryAnswers()[key]);
    }
    // Blank optionals are OMITTED, never sent as empty strings — the agent's
    // renderer keys presence on `!== undefined`.
    expect(payload.gap_fill_notes).toBeUndefined();
    expect(payload.readme_markdown).toBeUndefined();
    expect(payload.feedback).toBeUndefined();
    expect(payload.prior_version).toBeUndefined();
  });

  it('builds the brand-kit-branch payload and omits the discovery keys entirely', () => {
    const payload = buildFoundationMessageFormPayload({ ...brandKitAnswers(), gap_fill_notes: 'Anchor to the v2 launch' });
    expect(payload.brand_kit_markdown).toBe(brandKitAnswers()['brand_kit_markdown']);
    for (const key of FOUNDATION_MESSAGE_DISCOVERY_KEYS) {
      expect(key in payload).toBe(false);
    }
    expect(payload.gap_fill_notes).toBe('Anchor to the v2 launch');
  });

  it('passes the server-fetched README through and never invents one', () => {
    expect(buildFoundationMessageFormPayload(brandKitAnswers(), { readmeMarkdown: '# Readme' }).readme_markdown).toBe('# Readme');
    expect(buildFoundationMessageFormPayload(brandKitAnswers(), {}).readme_markdown).toBeUndefined();
  });

  it('carries feedback + prior_version on a feedback regeneration', () => {
    const payload = buildFoundationMessageFormPayload(brandKitAnswers(), { feedback: 'Sharpen the pitch', priorVersion: 2 });
    expect(payload.feedback).toBe('Sharpen the pitch');
    expect(payload.prior_version).toBe(2);
  });

  it('synthesizes the revised-intake feedback on an edit-inputs resubmit so the v+1 directive still rides', () => {
    const payload = buildFoundationMessageFormPayload(brandKitAnswers(), { priorVersion: 1 });
    expect(payload.feedback).toBe(FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK);
    expect(payload.prior_version).toBe(1);
  });

  it('ignores an invalid priorVersion (0, negative, fractional) instead of sending a bad directive', () => {
    for (const priorVersion of [0, -1, 1.5]) {
      const payload = buildFoundationMessageFormPayload(brandKitAnswers(), { priorVersion });
      expect(payload.prior_version).toBeUndefined();
      expect(payload.feedback).toBeUndefined();
    }
  });
});

describe('renderFoundationMessageFormText — verbatim mirror of the agent renderFormMessage', () => {
  it('renders the brand-kit branch byte-identically to the agent renderer (preamble, Q/A pairs, fenced documents, feedback directive)', () => {
    const payload = buildFoundationMessageFormPayload(
      { ...brandKitAnswers(), gap_fill_notes: 'Anchor to the v2 launch' },
      { readmeMarkdown: '# Readme body', feedback: 'Sharpen the pitch', priorVersion: 2 }
    );

    // Expected text hand-transcribed from marketing-os-agents
    // agents/foundation-message-ts src/form.ts renderFormMessage — every
    // line, blank line, and fence must match so the agent's MODE RULES see
    // the exact message its own renderer would have produced.
    const expected = [
      'BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).',
      'The interview inputs were collected on a single LFX form and are provided',
      'below, paired with your Step 1 questions. Do NOT re-ask them; proceed',
      'directly to Step 2.',
      '',
      "Q1a. What's the name of the LF project?",
      'A1a. Example Project',
      '',
      "Q1b. What's the URL of the project's GitHub repo or README?",
      'A1b. https://github.com/example/project',
      '',
      'Q1c. Do you already have a `[Project Name] Brand Kit` I should use, and if so where is it?',
      'A1c. Yes — the full Brand Kit document is provided below (BRAND KIT DOCUMENT block).',
      '',
      '===== BEGIN BRAND KIT DOCUMENT =====',
      '# Example Project Brand Kit\n\nVoice: clear.',
      '===== END BRAND KIT DOCUMENT =====',
      '',
      "The project's GitHub README content (pre-fetched — you cannot fetch URLs):",
      '',
      '===== BEGIN GITHUB README =====',
      '# Readme body',
      '===== END GITHUB README =====',
      '',
      'GAP-FILL NOTES (covers your Step 1d question areas):',
      'Anchor to the v2 launch',
      '',
      'FEEDBACK on draft v2 — regenerate incorporating it and finalize as version 3:',
      'Sharpen the pitch',
      '',
    ].join('\n');

    expect(renderFoundationMessageFormText(payload)).toBe(expected);
  });

  it('renders the discovery branch with all five verbatim sub-questions and the no-README grounding lines', () => {
    const text = renderFoundationMessageFormText(buildFoundationMessageFormPayload(discoveryAnswers()));

    expect(text).toContain('A1c. No — brand-discovery answers provided instead:');
    FOUNDATION_MESSAGE_DISCOVERY_QUESTIONS.forEach((entry, i) => {
      expect(text).toContain(`Q1c.${i + 1}. ${entry.question}`);
      expect(text).toContain(`A1c.${i + 1}. ${discoveryAnswers()[entry.key]}`);
    });
    expect(text).toContain('No README content was provided. You cannot fetch URLs — ground README-');
    expect(text).not.toContain('===== BEGIN BRAND KIT DOCUMENT =====');
    // First-run submission: no feedback block at all.
    expect(text).not.toContain('FEEDBACK on draft');
  });
});

describe('validateFoundationMessageEnvelope — schema + structure gates', () => {
  const document = (): string => {
    const body = FOUNDATION_MESSAGE_REQUIRED_HEADINGS.map((heading) => `${heading}\n\nContent for the section goes here.`).join('\n\n');
    return `# Example Project Message Foundation\n\n${body}\n\n${'Padding to satisfy the minimum length gate. '.repeat(20)}`;
  };

  const validEnvelope = (): Record<string, unknown> => ({
    contract: 'message-foundation-output/v1',
    kind: 'message-foundation',
    project: 'example-project',
    project_name: 'Example Project',
    version: 1,
    document_markdown: document(),
    content_sha256: 'a'.repeat(64),
    derivatives: {
      summary_25: 'Short summary.',
      summary_50: 'Longer summary.',
      boilerplate: 'Boilerplate paragraph.',
      llms_txt: '# Example Project\nAbout.',
      elevator_pitch_headline: 'Example does the thing',
    },
    inputs: { brand_kit_provided: false },
    intake: {
      mode: 'form',
      completed_at: '2026-08-20T00:00:00Z',
      answers: [
        { question_number: 1, question: 'Q1a', answer: 'A1a' },
        { question_number: 2, question: 'Q1b', answer: 'A1b' },
      ],
    },
  });

  it('accepts a contract-shaped envelope with all 13 headings', () => {
    expect(validateFoundationMessageEnvelope(validEnvelope())).toEqual({ valid: true, errors: [] });
  });

  it('rejects unknown contract majors outright', () => {
    const result = validateFoundationMessageEnvelope({ ...validEnvelope(), contract: 'message-foundation-output/v2' });
    expect(result.valid).toBe(false);
  });

  it('flags a document missing any required heading', () => {
    const envelope = validEnvelope();
    envelope['document_markdown'] = (envelope['document_markdown'] as string).replace('## 6. Messaging Pillars', '## 6. Something Else');
    const result = validateFoundationMessageEnvelope(envelope);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('6. Messaging Pillars');
  });

  it('rejects an envelope missing any of the five derivatives', () => {
    const envelope = validEnvelope();
    envelope['derivatives'] = { ...(envelope['derivatives'] as Record<string, string>), llms_txt: '' };
    expect(validateFoundationMessageEnvelope(envelope).valid).toBe(false);
  });

  it('tolerates trailing heading qualifiers like the template’s own "(when a Brand Kit exists)"', () => {
    const withQualifier = document().replace('## 1a. Word-Count Derivatives', '## 1a. Word-Count Derivatives (when a Brand Kit exists)');
    expect(findMissingFoundationMessageHeadings(withQualifier)).toEqual([]);
    // A same-prefix but different heading does NOT satisfy the gate.
    expect(findMissingFoundationMessageHeadings(document().replace('## 10. Next Steps', '## 10. Next Stepsish'))).toEqual(['## 10. Next Steps']);
  });

  it('enforces the intake answers bounds (2–15)', () => {
    const envelope = validEnvelope();
    (envelope['intake'] as Record<string, unknown>)['answers'] = [{ question_number: 1, question: 'Q', answer: 'A' }];
    expect(validateFoundationMessageEnvelope(envelope).valid).toBe(false);
  });
});

describe('README size-cap constant sanity', () => {
  it('is large enough for real READMEs but bounded', () => {
    expect(FOUNDATION_MESSAGE_README_MAX_CHARS).toBeGreaterThanOrEqual(16384);
    expect(FOUNDATION_MESSAGE_README_MAX_CHARS).toBeLessThanOrEqual(1048576);
  });
});
