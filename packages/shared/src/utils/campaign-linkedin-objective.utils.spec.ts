// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInConfigNamesConversions, linkedInConversionRules, linkedInObjectiveRefusal } from './campaign-linkedin-objective.utils';

const O = 'linkedInConfig.objective';
const C = 'linkedInConfig.conversions';
const ids = (n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => String(from + i));
const manual = { strategy: 'manual', bidAmount: 4.5 };
const cfg = (rest: Record<string, unknown>): Record<string, unknown> => ({ eventName: 'KubeCon', ...rest });

describe('linkedInObjectiveRefusal', () => {
  it.each([
    ['no linkedInConfig', null],
    ['neither field', cfg({})],
    ['traffic, automatic', cfg({ objective: 'traffic' })],
    ['conversions, automatic, with a rule (the catalogue example)', cfg({ objective: 'conversions', conversions: ['104012'] })],
    ['conversions, manual, no rule', cfg({ objective: 'conversions', bidding: manual })],
    ['conversions without an objective', cfg({ conversions: ['104012', '107620'] })],
    ['20 distinct ids and duplicates up to 40', cfg({ conversions: [...ids(20), ...ids(20)] })],
    ['the largest int64 id', cfg({ conversions: ['9223372036854775807'] })],
  ])('accepts %s', (_label, raw) => {
    expect(linkedInObjectiveRefusal(raw, true)).toBeNull();
  });

  it.each([
    // Shape first, whatever the flag.
    ['conversions not a list', cfg({ conversions: '104012' }), false, C],
    ['an explicit null conversions', cfg({ conversions: null }), true, C],
    ['a numeric id', cfg({ conversions: [104012] }), true, C],
    ['an explicit null objective', cfg({ objective: null }), false, O],
    ['an empty objective', cfg({ objective: '' }), true, O],
    ['a numeric objective', cfg({ objective: 1 }), true, O],
    // Then the flag: refused, never dropped.
    ['conversions while off', cfg({ conversions: ['104012'] }), false, C],
    ['traffic while off', cfg({ objective: 'traffic' }), false, O],
    // Then campaign-service's rules.
    ['an empty list', cfg({ conversions: [] }), true, C],
    ['more than 40 entries', cfg({ conversions: Array(41).fill('1') }), true, C],
    ['21 distinct ids', cfg({ conversions: ids(21) }), true, C],
    ['a URN', cfg({ conversions: ['urn:lla:llaPartnerConversion:104012'] }), true, C],
    ['a leading zero', cfg({ conversions: ['0104012'] }), true, C],
    ['zero', cfg({ conversions: ['0'] }), true, C],
    ['past int64', cfg({ conversions: ['9223372036854775808'] }), true, C],
    ['a padded id', cfg({ conversions: [' 104012'] }), true, C],
    ['another casing', cfg({ objective: 'Conversions', conversions: ['1'] }), true, O],
    ['another goal', cfg({ objective: 'leads' }), true, O],
    ['traffic with a manual bid', cfg({ objective: 'traffic', bidding: manual }), true, O],
    ['conversions, automatic, no rule', cfg({ objective: 'conversions' }), true, O],
    ['conversions, explicit automatic, no rule', cfg({ objective: 'conversions', bidding: { strategy: 'automatic' } }), true, O],
  ])('refuses %s', (_label, raw, enabled, field) => {
    expect(linkedInObjectiveRefusal(raw, enabled)?.field).toBe(field);
  });

  it('never echoes a caller value', () => {
    for (const raw of [cfg({ conversions: ['urn:secret'] }), cfg({ conversions: ['secret'] }), cfg({ objective: 'secret' })]) {
      expect(linkedInObjectiveRefusal(raw, true)?.message).not.toContain('secret');
    }
  });
});

describe('linkedInConfigNamesConversions', () => {
  it.each([
    [cfg({ conversions: ['1'] }), true],
    [cfg({ conversions: null }), true],
    [cfg({ objective: 'conversions', bidding: manual }), false],
    [null, false],
  ])('%j → %s', (raw, expected) => {
    expect(linkedInConfigNamesConversions(raw)).toBe(expected);
  });
});

describe('linkedInConversionRules', () => {
  const rule = { id: '104012', urn: 'urn:lla:llaPartnerConversion:104012', name: ' Registration ', type: 'REGISTRATION', enabled: true };

  it.each([
    ['not a list', null, []],
    ['an enabled rule, name trimmed', [rule], [{ id: '104012', name: 'Registration', type: 'REGISTRATION' }]],
    ['a disabled rule', [{ ...rule, enabled: false }], []],
    [
      'an id a create refuses',
      [
        { ...rule, id: '0104012' },
        { ...rule, id: 'urn:lla:llaPartnerConversion:1' },
      ],
      [],
    ],
    ['a repeat', [rule, { ...rule, name: 'Again' }], [{ id: '104012', name: 'Registration', type: 'REGISTRATION' }]],
    ['a blank name and no type', [{ id: '7', name: ' ', enabled: true }, 'junk'], [{ id: '7', name: '7', type: '' }]],
  ])('%s', (_label, conversions, expected) => {
    expect(linkedInConversionRules(conversions)).toEqual(expected);
  });
});
