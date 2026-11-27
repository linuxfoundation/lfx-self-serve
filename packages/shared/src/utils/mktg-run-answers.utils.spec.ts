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
  {
    name: 'aeo-geo',
    valid: (text: string) => isAeoGeoSubmittedAnswers([{ id: 'audience', text, origin: 'requester' }]),
    empty: () => isAeoGeoSubmittedAnswers([]),
    max: 10_000,
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

describe('question-scoped none policy', () => {
  it('exports the plain transport message and one stable id per agent: LinkedIn avoid, AEO/GEO exclude', () => {
    expect(MKTG_ANSWERS_INCOMPLETE_MESSAGE).toBe('Every question needs an answer before the agent can continue.');
    expect(MKTG_NONE_ALLOWED_QUESTION_IDS).toEqual({ 'linkedin-post': ['avoid'], 'aeo-geo': ['exclude'] });
  });
  it.each(['none', 'None', ' NONE '])('accepts literal %j only for LinkedIn avoid and AEO/GEO exclude', (text) => {
    expect(validLinkedinAnswers([{ key: 'avoid', text, origin: 'requester' }])).toBe(true);
    expect(validLinkedinAnswers([{ key: 'role', text, origin: 'requester' }])).toBe(false);
    expect(isAeoGeoSubmittedAnswers([{ id: 'exclude', text, origin: 'requester' }])).toBe(true);
    // Each agent's id is its own: LinkedIn's avoid is no exemption in an audit, and the rest of a turn still has to say something.
    expect(isAeoGeoSubmittedAnswers([{ id: 'avoid', text, origin: 'requester' }])).toBe(false);
    expect(
      isAeoGeoSubmittedAnswers([
        { id: 'exclude', text, origin: 'requester' },
        { id: 'audience', text, origin: 'requester' },
      ])
    ).toBe(false);
    expect(
      isAeoGeoSubmittedAnswers([
        { id: 'audience', text: 'Platform engineers.', origin: 'edited' },
        { id: 'exclude', text, origin: 'requester' },
      ])
    ).toBe(true);
  });
  it.each(['', ' ', 'skip', 'TBD', 'n/a', '-', '?', 'none.'])('does not widen the exemption to %j', (text) => {
    expect(mktgAnswerProblem(text, { allowNone: true })).toBe(MKTG_ANSWERS_INCOMPLETE_MESSAGE);
    expect(validLinkedinAnswers([{ key: 'avoid', text, origin: 'requester' }])).toBe(false);
    expect(isAeoGeoSubmittedAnswers([{ id: 'exclude', text, origin: 'requester' }])).toBe(false);
  });
  it('does not let none bypass the length caps', () => {
    expect(validLinkedinAnswers([{ key: 'avoid', text: ' '.repeat(4000) + 'None', origin: 'requester' }])).toBe(false);
    expect(isAeoGeoSubmittedAnswers([{ id: 'exclude', text: ' '.repeat(10_000) + 'None', origin: 'requester' }])).toBe(false);
  });
});
