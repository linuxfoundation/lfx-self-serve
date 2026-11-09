// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googleAdGroupNameKey,
  googleAdGroupNamePart,
  googleDemandGenAdGroupName,
  googleDemandGenAdGroupsRefusal,
} from './campaign-google-demand-gen-ad-groups.utils';

/** A video ad campaign-service accepts. */
const VIDEO = {
  youtubeVideoIds: ['dQw4w9WgXcQ'],
  logoImages: ['https://cdn.example/logo.png'],
  headlines: ['Join us'],
  longHeadlines: ['Four days of cloud native talks'],
  descriptions: ['Register today'],
  businessName: 'Acme',
};

const IMAGE = { headlines: ['Join us'] };

describe('googleAdGroupNamePart', () => {
  it('makes "|" and control characters spaces, collapses whitespace and trims, as sanitizeNamePart does', () => {
    expect(googleAdGroupNamePart('  Retargeting | EU\u0000 \u0085 list\t ')).toBe('Retargeting EU list');
    expect(googleAdGroupNamePart(' | \u0001 ')).toBe('');
  });
});

describe('googleAdGroupNameKey', () => {
  it('folds case one code point at a time, keeping dotted and dotless i apart as Go does', () => {
    expect(googleAdGroupNameKey('Retargeting')).toBe(googleAdGroupNameKey('RETARGETING'));
    expect(googleAdGroupNameKey('\u212a')).toBe(googleAdGroupNameKey('k'));
    expect(googleAdGroupNameKey('ΟΔΟΣ')).toBe(googleAdGroupNameKey('οδος'));
    expect(googleAdGroupNameKey('\u0131')).not.toBe(googleAdGroupNameKey('i'));
    expect(googleAdGroupNameKey('\u0130')).not.toBe(googleAdGroupNameKey('i'));
  });
});

describe('googleDemandGenAdGroupName', () => {
  it('composes "<event> - Display | <name>", trimming the event and sanitizing the name', () => {
    expect(googleDemandGenAdGroupName('  KubeCon NA ', ' Retargeting|EU ')).toBe('KubeCon NA - Display | Retargeting EU');
  });
});

describe('googleDemandGenAdGroupsRefusal', () => {
  it('accepts two named groups, one image ad and one video ad', () => {
    expect(
      googleDemandGenAdGroupsRefusal('KubeCon NA', [
        { name: 'Retargeting', creative: IMAGE },
        { name: 'Prospecting', videoCreative: VIDEO },
      ])
    ).toBeNull();
  });

  it('accepts five groups and a full name of exactly 255 characters', () => {
    const groups = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, creative: IMAGE }));
    expect(googleDemandGenAdGroupsRefusal('KubeCon', groups)).toBeNull();
    const event = 'E'.repeat(255 - ' - Display | x'.length);
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'x', creative: IMAGE }])).toBeNull();
  });

  it.each([
    ['a non-list', { name: 'a' }, 'must be a list'],
    ['six groups', ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, creative: IMAGE })), 'at most 5 ad groups, and 6 are set'],
    ['a blank name', [{ name: ' | ', creative: IMAGE }], 'ad group 1 needs a name'],
    ['a name that is not a string', [{ name: 7, creative: IMAGE }], 'ad group 1 needs a name'],
    ['an entry that is not an object', ['Retargeting'], 'ad group 1 needs a name'],
    [
      'two names equal ignoring case',
      [
        { name: 'Retargeting', creative: IMAGE },
        { name: ' retargeting ', creative: IMAGE },
      ],
      'ad group 2 has the same name as ad group 1',
    ],
    ['an image ad and a video ad together', [{ name: 'a', creative: IMAGE, videoCreative: VIDEO }], 'has an image ad and a video ad'],
    ['no ad', [{ name: 'a', creative: {} }], 'ad group 1 has no ad'],
    [
      'a video ad that fails its own rules',
      [{ name: 'a', videoCreative: { ...VIDEO, logoImages: [] } }],
      'ad group 1: The Demand Gen video ad needs exactly one logo',
    ],
  ])('refuses %s', (_label, groups, fragment) => {
    expect(googleDemandGenAdGroupsRefusal('KubeCon NA', groups)).toContain(fragment);
  });

  it('refuses a full name one character past 255', () => {
    const event = 'E'.repeat(255 - ' - Display | x'.length);
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'xy', creative: IMAGE }])).toContain('is 256 characters');
  });

  it("holds a video group's full name to 244, so its video ad's name fits 255, and an image group's to 255", () => {
    const event = 'E'.repeat(255 - ' - Display | x'.length - ' - Video ad'.length);
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'x', videoCreative: VIDEO }])).toBeNull();
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'xy', videoCreative: VIDEO }])).toBe(
      'Demand Gen ad group 1\'s video ad is named after the ad group, then " - Video ad", which makes 256 characters, over Google\'s limit of 255. Shorten its name or the event name.'
    );
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'xy', creative: IMAGE }])).toBeNull();
  });

  it('judges an image ad only through the caller-supplied judge', () => {
    const groups = [{ name: 'a', creative: IMAGE }];
    expect(googleDemandGenAdGroupsRefusal('KubeCon', groups)).toBeNull();
    expect(googleDemandGenAdGroupsRefusal('KubeCon', groups, () => 'the image ad needs a business name.')).toBe(
      'Demand Gen ad group 1: the image ad needs a business name.'
    );
  });

  it('never echoes a group name', () => {
    const secret = 'https://u:secret@x.example/v';
    const refusal = googleDemandGenAdGroupsRefusal('KubeCon', [
      { name: secret, creative: IMAGE },
      { name: secret.toUpperCase(), creative: IMAGE },
    ]);
    expect(refusal).not.toContain('secret');
    expect(refusal).not.toContain('SECRET');
  });
});
