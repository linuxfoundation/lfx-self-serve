// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_ANSWERS_INCOMPLETE_MESSAGE, MKTG_NONE_ALLOWED_QUESTION_IDS } from '../constants/mktg-run.constants';
import { validateFoundationMessageAnswers } from './foundation-message.utils';
import { validateBrandKitAnswers } from './brand-kit.utils';
import { validateBoilerplatesAnswers } from './boilerplates.utils';
import { validateFaqAnswers } from './faq.utils';
import { validLinkedinAnswers } from './linkedin-post-run.utils';
import { isAeoGeoSubmittedAnswers } from './aeo-geo.utils';
import { mktgAnswerProblem } from './mktg-run-answers.utils';

const answer = (text: string) => [{ key: 'voice', text, origin: 'requester' }];
const validators = [
  {
    name: 'framework',
    valid: (text: string) => validateFoundationMessageAnswers(answer(text)).valid,
    empty: () => validateFoundationMessageAnswers([]).valid,
    max: 4000,
  },
  { name: 'brand-kit', valid: (text: string) => validateBrandKitAnswers(answer(text)).valid, empty: () => validateBrandKitAnswers([]).valid, max: 4000 },
  {
    name: 'boilerplates',
    valid: (text: string) => validateBoilerplatesAnswers(answer(text)).valid,
    empty: () => validateBoilerplatesAnswers([]).valid,
    max: 4000,
  },
  { name: 'faq', valid: (text: string) => validateFaqAnswers(answer(text)).valid, empty: () => validateFaqAnswers([]).valid, max: 4000 },
  {
    name: 'linkedin',
    valid: (text: string) => validLinkedinAnswers([{ key: 'role', text, origin: 'requester' }]),
    empty: () => validLinkedinAnswers([]),
    max: 4000,
  },
];

describe.each(validators)('$name substantive answers', ({ valid, empty, max }) => {
  it.each(['', '   ', 'skip', 'TBD', 'n/a', '-', '?', 'none', ' None '])('refuses non-answer %j', (text) => {
    expect(valid(text)).toBe(false);
  });
  it('refuses an empty answers array', () => expect(empty()).toBe(false));
  it('preserves the answer length boundary', () => {
    expect(valid('x'.repeat(max))).toBe(true);
    expect(valid('x'.repeat(max + 1))).toBe(false);
  });
  it('accepts a substantive answer', () => expect(valid('Use synthetic project facts.')).toBe(true));
});

describe('AEO/GEO HTTP temporary compatibility policy', () => {
  it.each(['', '   '])('refuses empty text %j', (text) => expect(isAeoGeoSubmittedAnswers([{ id: 'audience', text, origin: 'requester' }])).toBe(false));
  it.each(['none', 'skip', 'TBD', 'n/a', '-', '?'])('retains explicit non-empty compatibility for %j', (text) =>
    expect(isAeoGeoSubmittedAnswers([{ id: 'exclude', text, origin: 'requester' }])).toBe(true)
  );
  it('still rejects empty arrays and oversized answers', () => {
    expect(isAeoGeoSubmittedAnswers([])).toBe(false);
    expect(isAeoGeoSubmittedAnswers([{ id: 'audience', text: 'x'.repeat(10001), origin: 'requester' }])).toBe(false);
  });
});

describe('question-scoped none policy', () => {
  it('exports the plain transport message and only the stable LinkedIn avoid id', () => {
    expect(MKTG_ANSWERS_INCOMPLETE_MESSAGE).toBe('Every question needs an answer before the agent can continue.');
    expect(MKTG_NONE_ALLOWED_QUESTION_IDS).toEqual(['avoid']);
  });
  it.each(['none', 'None', ' NONE '])('accepts literal %j only for LinkedIn avoid', (text) => {
    expect(validLinkedinAnswers([{ key: 'avoid', text, origin: 'requester' }])).toBe(true);
    expect(validLinkedinAnswers([{ key: 'role', text, origin: 'requester' }])).toBe(false);
    // AEO/GEO retains its explicitly ruled legacy opt-in until question ids are stable.
    expect(isAeoGeoSubmittedAnswers([{ id: 'exclude', text, origin: 'requester' }])).toBe(true);
    expect(isAeoGeoSubmittedAnswers([{ id: 'avoid', text, origin: 'requester' }])).toBe(true);
  });
  it.each(['', ' ', 'skip', 'TBD', 'n/a', '-', '?', 'none.'])('does not widen the exemption to %j', (text) => {
    expect(mktgAnswerProblem(text, { allowNone: true })).toBe(MKTG_ANSWERS_INCOMPLETE_MESSAGE);
    expect(validLinkedinAnswers([{ key: 'avoid', text, origin: 'requester' }])).toBe(false);
  });
  it('does not let none bypass the LinkedIn length cap', () => {
    expect(validLinkedinAnswers([{ key: 'avoid', text: ' '.repeat(4000) + 'None', origin: 'requester' }])).toBe(false);
  });
});
