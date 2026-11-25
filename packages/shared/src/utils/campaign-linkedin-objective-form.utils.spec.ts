// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_MESSAGE,
  LINKEDIN_CONVERSIONS_FAILED_MESSAGE,
  LINKEDIN_CONVERSIONS_LOADING_MESSAGE,
  LINKEDIN_CONVERSIONS_OWNER_MESSAGE,
  LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE,
} from '../constants/campaign.constants';
import type { LinkedInConversionsState, LinkedInObjectiveDraft } from '../interfaces/campaign.interface';
import {
  emptyLinkedInObjectiveDraft,
  linkedInCanAddConversion,
  linkedInConversionChoices,
  linkedInConversionPicks,
  linkedInConversionsFailure,
  linkedInConversionsMessage,
  linkedInObjectiveChoice,
  linkedInObjectiveCreateRefusal,
  linkedInObjectiveDraftWithConversions,
  linkedInObjectiveFieldsForCreate,
  linkedInObjectiveShown,
} from './campaign-linkedin-objective-form.utils';

const OWNER = 'tlf|';
const draft = (over: Partial<LinkedInObjectiveDraft> = {}): LinkedInObjectiveDraft => ({ ...emptyLinkedInObjectiveDraft(), ...over });
const rules = (picked: string[] = [], owner = OWNER): Partial<LinkedInObjectiveDraft> => ({
  conversions: picked,
  conversionsOwner: picked.length ? owner : null,
});
const manual = { strategy: 'manual' as const, bidAmount: 4.5 };
const loaded: LinkedInConversionsState = {
  status: 'loaded',
  conversions: [
    { id: '104012', name: 'Registration', type: 'REGISTRATION' },
    { id: '107620', name: 'Download', type: 'DOWNLOAD' },
  ],
  failure: null,
};

describe('linkedInObjectiveShown', () => {
  it.each([
    ['offered', draft(), true, true],
    ['withdrawn with a choice held', draft({ objective: 'traffic' }), false, true],
    ['withdrawn with nothing chosen', draft(), false, false],
  ])('%s', (_label, value, available, expected) => {
    expect(linkedInObjectiveShown(value, available)).toBe(expected);
  });
});

describe('linkedInObjectiveChoice', () => {
  it.each([
    ['traffic', 'traffic'],
    ['conversions', 'conversions'],
    ['', null],
    ['Traffic', null],
    [null, null],
  ])('reads %j as %j', (value, expected) => {
    expect(linkedInObjectiveChoice(value)).toBe(expected);
  });
});

describe('linkedInObjectiveFieldsForCreate', () => {
  it.each([
    ['no objective (the default: what every create sent before)', draft(rules(['104012'])), true, {}],
    ['the capability off', draft({ objective: 'traffic' }), false, {}],
    ['traffic', draft({ objective: 'traffic', ...rules(['104012']) }), true, { objective: 'traffic' }],
    ['conversions with no rule', draft({ objective: 'conversions' }), true, { objective: 'conversions' }],
    ['conversions with rules', draft({ objective: 'conversions', ...rules(['104012']) }), true, { objective: 'conversions', conversions: ['104012'] }],
  ])('%s', (_label, value, available, expected) => {
    expect(linkedInObjectiveFieldsForCreate(value, available)).toEqual(expected);
  });
});

describe('linkedInObjectiveDraftWithConversions', () => {
  it.each([
    ['the first rule takes the owner', draft(), ['1'], { conversions: ['1'], conversionsOwner: OWNER }],
    ['a rule beside others keeps their owner', draft(rules(['1'], 'lf|9')), ['1', '2'], { conversions: ['1', '2'], conversionsOwner: 'lf|9' }],
    ['the last rule removed clears the owner', draft(rules(['1'], 'lf|9')), [], { conversions: [], conversionsOwner: null }],
  ])('%s', (_label, value, picked, expected) => {
    expect(linkedInObjectiveDraftWithConversions(value, picked, OWNER)).toMatchObject(expected);
  });
});

describe('linkedInObjectiveCreateRefusal', () => {
  const AUTO_NEEDS_RULE =
    'LinkedIn Ads: Website conversions on automatic bidding needs a conversion rule. Pick one, or choose manual bidding or the traffic objective.';
  it.each([
    ['no objective, even while off or with rules of another owner', draft(rules(['1'], 'x|')), false, undefined, null],
    [
      'a choice the deployment no longer offers',
      draft({ objective: 'traffic' }),
      false,
      undefined,
      'LinkedIn Ads: the campaign objective is not available right now. Choose "Set by bidding" as the objective.',
    ],
    ['traffic, automatic', draft({ objective: 'traffic' }), true, undefined, null],
    [
      'traffic with a manual bid',
      draft({ objective: 'traffic' }),
      true,
      manual,
      'LinkedIn Ads: The traffic objective takes automatic bidding only. Choose the conversions objective for a manual bid.',
    ],
    ['conversions, automatic, no rule', draft({ objective: 'conversions' }), true, undefined, AUTO_NEEDS_RULE],
    ['conversions, manual, no rule', draft({ objective: 'conversions' }), true, manual, null],
    ['conversions with a rule', draft({ objective: 'conversions', ...rules(['104012']) }), true, undefined, null],
    [
      'rules of another owner',
      draft({ objective: 'conversions', ...rules(['104012'], 'lf|9') }),
      true,
      undefined,
      `LinkedIn Ads: ${LINKEDIN_CONVERSIONS_OWNER_MESSAGE}`,
    ],
    ['traffic beside unsent rules of another owner', draft({ objective: 'traffic', ...rules(['104012'], 'lf|9') }), true, undefined, null],
    ['a malformed rule id', draft({ objective: 'conversions', ...rules(['0x']) }), true, undefined, expect.stringContaining('positive whole number')],
  ])('%s', (_label, value, available, bidding, expected) => {
    expect(linkedInObjectiveCreateRefusal({ draft: value, available, owner: OWNER, bidding })).toEqual(expected);
  });
});

describe('the conversion rule picker', () => {
  it.each([
    [403, undefined, { status: 'restricted', failure: LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE }],
    [503, LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_CODE, { status: 'unavailable', failure: LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_MESSAGE }],
    [503, undefined, { status: 'unavailable', failure: LINKEDIN_CONVERSIONS_FAILED_MESSAGE }],
    [0, undefined, { status: 'unavailable', failure: LINKEDIN_CONVERSIONS_FAILED_MESSAGE }],
  ])('reads a %s failure (code %s) as %j', (status, code, expected) => {
    expect(linkedInConversionsFailure(status, code)).toMatchObject(expected);
  });

  it('offers the rules not picked, and names a pick the read does not list by its id', () => {
    expect(linkedInConversionChoices(loaded, ['104012']).map((rule) => rule.id)).toEqual(['107620']);
    expect(linkedInConversionPicks(loaded, ['104012', '999'])).toEqual([
      { id: '104012', name: 'Registration' },
      { id: '999', name: '999' },
    ]);
  });

  it.each([
    ['loading', { status: 'loading', conversions: [], failure: null } as LinkedInConversionsState, 0, LINKEDIN_CONVERSIONS_LOADING_MESSAGE],
    ['restricted', linkedInConversionsFailure(403, undefined), 0, LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE],
    ['no rules', { ...loaded, conversions: [] }, 0, expect.stringContaining('No enabled conversion rules')],
    ['every rule picked', loaded, 0, 'Every conversion rule on this ad account is picked.'],
    ['rules to offer', loaded, 1, null],
  ])('says %s', (_label, state, choiceCount, expected) => {
    expect(linkedInConversionsMessage(state, choiceCount)).toEqual(expected);
  });

  it.each([
    [19, true],
    [20, false],
  ])('may add a rule beside %i: %s', (count, expected) => {
    expect(linkedInCanAddConversion(draft({ conversions: Array.from({ length: count }, (_, i) => String(i + 1)) }))).toBe(expected);
  });
});
