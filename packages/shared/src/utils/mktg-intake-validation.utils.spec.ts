// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ICP_INTAKE_DOCUMENT_MAX_CHARS, MKTG_INTAKE_ANSWER_LIMITS } from '../constants/mktg-intake.constants';
import { validateIcpIntakeAnswers } from './icp.utils';
import { validateMktgIntakeAnswerLengths } from './mktg-intake-validation.utils';

const requiredAnswers = {
  project_name: 'Example Project',
  github_url: 'https://github.com/example/project',
  business_outcome: 'Membership growth',
};

describe('validateMktgIntakeAnswerLengths', () => {
  it('accepts an exact limit and leaves missing/invalid field types to the owning validator', () => {
    expect(validateMktgIntakeAnswerLengths({ name: 'abcd', optional: undefined, invalid: 42 }, { name: 4, optional: 4, invalid: 4 })).toEqual([]);
  });

  it('rejects submitted whitespace padding instead of measuring only trimmed content', () => {
    expect(validateMktgIntakeAnswerLengths({ name: '  a  ' }, { name: 4 })).toEqual(['answers.name must be at most 4 characters']);
  });

  it('reports each oversized field with its own limit', () => {
    expect(validateMktgIntakeAnswerLengths({ name: 'abc', document: '123456' }, { name: 2, document: 5 })).toEqual([
      'answers.name must be at most 2 characters',
      'answers.document must be at most 5 characters',
    ]);
  });
});

describe('ICP intake size regression', () => {
  it.each(['project_name', 'business_outcome', 'competitive_landscape'])('rejects the formerly accepted million-character %s', (key) => {
    const result = validateIcpIntakeAnswers({ ...requiredAnswers, [key]: 'x'.repeat(1_000_000) });
    expect(result).toEqual({ valid: false, errors: [expect.stringContaining(`answers.${key} must be at most`)] });
  });

  it.each(['brand_kit_markdown', 'message_foundation_markdown'])('preserves a whole %s at its larger document limit', (key) => {
    expect(validateIcpIntakeAnswers({ ...requiredAnswers, [key]: 'x'.repeat(ICP_INTAKE_DOCUMENT_MAX_CHARS) })).toEqual({ valid: true, errors: [] });
    expect(validateIcpIntakeAnswers({ ...requiredAnswers, [key]: 'x'.repeat(ICP_INTAKE_DOCUMENT_MAX_CHARS + 1) })).toEqual({
      valid: false,
      errors: [`answers.${key} must be at most ${ICP_INTAKE_DOCUMENT_MAX_CHARS} characters`],
    });
  });

  it('gives every required and optional ICP intake key a budget', () => {
    expect(Object.keys(MKTG_INTAKE_ANSWER_LIMITS.icp).sort()).toEqual(
      [
        'project_name',
        'github_url',
        'business_outcome',
        'competitive_landscape',
        'disqualifiers',
        'trigger_events',
        'known_member_orgs',
        'brand_kit_markdown',
        'message_foundation_markdown',
      ].sort()
    );
  });
});
