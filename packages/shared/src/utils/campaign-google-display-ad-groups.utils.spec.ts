// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { googleDisplayAdGroupName, googleDisplayAdGroupsRefusal } from './campaign-google-display-ad-groups.utils';

const AD = { headlines: ['Join us'] };

describe('googleDisplayAdGroupName', () => {
  it('composes "<event> - Display Network | <name>", sanitizing both parts as sanitizeNamePart does', () => {
    expect(googleDisplayAdGroupName(' KubeCon|NA\u0000 ', ' Retargeting|EU ')).toBe('KubeCon NA - Display Network | Retargeting EU');
  });
});

describe('googleDisplayAdGroupsRefusal', () => {
  it('accepts two named groups, and five', () => {
    expect(
      googleDisplayAdGroupsRefusal('KubeCon NA', [
        { name: 'Retargeting', creative: AD },
        { name: 'Prospecting', creative: AD },
      ])
    ).toBeNull();
    expect(
      googleDisplayAdGroupsRefusal(
        'KubeCon',
        ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, creative: AD }))
      )
    ).toBeNull();
  });

  it('accepts a full name of exactly 255 characters and refuses 256', () => {
    const event = 'E'.repeat(255 - ' - Display Network | x'.length);
    expect(googleDisplayAdGroupsRefusal(event, [{ name: 'x', creative: AD }])).toBeNull();
    expect(googleDisplayAdGroupsRefusal(event, [{ name: 'xy', creative: AD }])).toBe(
      'Display ad group 1\'s full name in Google Ads, the event name then " - Display Network | " and its name, is 256 characters, over Google\'s limit of 255. Shorten its name or the event name.'
    );
  });

  it.each([
    ['a non-list', { name: 'a' }, 'must be a list'],
    ['six groups', ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, creative: AD })), 'at most 5 ad groups, and 6 are set'],
    ['a blank name', [{ name: ' | ', creative: AD }], 'ad group 1 needs a name'],
    ['a name that is not a string', [{ name: 7, creative: AD }], 'ad group 1 needs a name'],
    ['an entry that is not an object', ['Retargeting'], 'ad group 1 needs a name'],
    [
      'two names equal ignoring case',
      [
        { name: 'Retargeting', creative: AD },
        { name: ' RETARGETING ', creative: AD },
      ],
      'ad group 2 has the same name as ad group 1',
    ],
    ['no ad', [{ name: 'a', creative: {} }], 'ad group 1 has no ad'],
    ['a missing ad', [{ name: 'a' }], 'ad group 1 has no ad'],
  ])('refuses %s', (_label, groups, fragment) => {
    expect(googleDisplayAdGroupsRefusal('KubeCon NA', groups)).toContain(fragment);
  });

  it('judges the ad only through the caller-supplied judge', () => {
    const groups = [{ name: 'a', creative: AD }];
    expect(googleDisplayAdGroupsRefusal('KubeCon', groups, () => 'the ad needs a business name.')).toBe('Display ad group 1: the ad needs a business name.');
  });

  it('never echoes a group name', () => {
    const secret = 'https://u:secret@x.example/v';
    const refusal = googleDisplayAdGroupsRefusal('KubeCon', [
      { name: secret, creative: AD },
      { name: secret.toUpperCase(), creative: AD },
    ]);
    expect(refusal).not.toContain('secret');
    expect(refusal).not.toContain('SECRET');
  });
});
