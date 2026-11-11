// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googleAdGroupNameKey,
  googleAdGroupNamePart,
  googleDemandGenAdGroupName,
  googleDemandGenAdGroupsRefusal,
  googleDemandGenAdNameKey,
  googleDemandGenAdsRefusal,
  googleDemandGenSingleAdGroupName,
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

describe('googleDemandGenSingleAdGroupName', () => {
  it('composes "<event> - Display", trimming the event as demandGenAdGroupName does', () => {
    expect(googleDemandGenSingleAdGroupName('  KubeCon NA ')).toBe('KubeCon NA - Display');
  });
});

describe('googleDemandGenAdNameKey', () => {
  it("lowers one code point at a time as Go's strings.ToLower does, dotted I included", () => {
    expect(googleDemandGenAdNameKey('Teaser')).toBe(googleDemandGenAdNameKey('TEASER'));
    expect(googleDemandGenAdNameKey('\u0130')).toBe('i');
    expect(googleDemandGenAdNameKey('ΟΔΟΣ')).toBe('οδοσ');
  });
});

describe('googleDemandGenAdsRefusal', () => {
  const OWNER = 'the Demand Gen ad group';
  const GROUP = 'KubeCon NA - Display';

  it('accepts five named ads, image and video mixed', () => {
    const ads = ['a', 'b', 'c', 'd', 'e'].map((name, i) => (i % 2 ? { name, videoCreative: VIDEO } : { name, creative: IMAGE }));
    expect(googleDemandGenAdsRefusal(OWNER, GROUP, ads)).toBeNull();
  });

  it.each([
    ['a non-list', { name: 'a' }, 'The ads of the Demand Gen ad group must be a list.'],
    [
      'six ads',
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, creative: IMAGE })),
      'The Demand Gen ad group takes at most 5 ads, and 6 are set. Remove 1 and create again.',
    ],
    ['a blank name', [{ name: ' | ', creative: IMAGE }], 'Ad 1 of the Demand Gen ad group needs a name. Each ad in an ad group needs its own name.'],
    ['a name that is not a string', [{ name: 7, creative: IMAGE }], 'Ad 1 of the Demand Gen ad group needs a name.'],
    [
      'two names equal ignoring case',
      [
        { name: 'Teaser', creative: IMAGE },
        { name: ' TEASER ', videoCreative: VIDEO },
      ],
      'Ad 2 of the Demand Gen ad group has the same name as ad 1',
    ],
    [
      'an image and a video creative together',
      [{ name: 'a', creative: IMAGE, videoCreative: VIDEO }],
      'Ad 1 of the Demand Gen ad group has an image ad and a video ad',
    ],
    ['no creative', [{ name: 'a', creative: {} }], 'Ad 1 of the Demand Gen ad group has no creative.'],
    [
      'a video ad that fails its own rules',
      [{ name: 'a', videoCreative: { ...VIDEO, logoImages: [] } }],
      'Ad 1 of the Demand Gen ad group: The Demand Gen video ad needs exactly one logo',
    ],
  ])('refuses %s', (_label, ads, fragment) => {
    expect(googleDemandGenAdsRefusal(OWNER, GROUP, ads)).toContain(fragment);
  });

  it("holds a video ad's name, the group's then \" - \" and its own, to 255, and leaves an image ad's alone", () => {
    const name = 'x'.repeat(255 - GROUP.length - ' - '.length);
    expect(googleDemandGenAdsRefusal(OWNER, GROUP, [{ name, videoCreative: VIDEO }])).toBeNull();
    expect(googleDemandGenAdsRefusal(OWNER, GROUP, [{ name: `${name}y`, videoCreative: VIDEO }])).toBe(
      'Ad 1 of the Demand Gen ad group is a video ad, named after the ad group, then " - " and its name, which makes 256 characters, over Google\'s limit of 255. Shorten its name or the event name.'
    );
    expect(googleDemandGenAdsRefusal(OWNER, GROUP, [{ name: `${name}y`, creative: IMAGE }])).toBeNull();
  });

  it('judges an image ad through the caller-supplied judge and never echoes an ad name', () => {
    expect(googleDemandGenAdsRefusal(OWNER, GROUP, [{ name: 'a', creative: IMAGE }], () => 'the image ad needs a business name.')).toBe(
      'Ad 1 of the Demand Gen ad group: the image ad needs a business name.'
    );
    const secret = 'https://u:secret@x.example/v';
    const refusal = googleDemandGenAdsRefusal(OWNER, GROUP, [
      { name: secret, creative: IMAGE },
      { name: secret.toUpperCase(), creative: IMAGE },
    ]);
    expect(refusal).not.toContain('secret');
    expect(refusal).not.toContain('SECRET');
  });
});

describe('googleDemandGenAdGroupsRefusal with ads', () => {
  const TWO = [
    { name: 'Teaser', videoCreative: VIDEO },
    { name: 'Recap', videoCreative: VIDEO },
  ];

  it('judges a group with ads by its ads, not by the single video ad name rule', () => {
    expect(googleDemandGenAdGroupsRefusal('KubeCon NA', [{ name: 'Retargeting', ads: TWO }])).toBeNull();
    expect(googleDemandGenAdGroupsRefusal('KubeCon NA', [{ name: 'Retargeting', ads: [TWO[0], TWO[0]] }])).toContain(
      'Ad 2 of Demand Gen ad group 1 has the same name as ad 1'
    );
  });

  it('reads an empty ads list as absent, as upstream does', () => {
    expect(googleDemandGenAdGroupsRefusal('KubeCon NA', [{ name: 'a', creative: IMAGE, ads: [] }])).toBeNull();
    expect(googleDemandGenAdGroupsRefusal('KubeCon NA', [{ name: 'a', ads: [] }])).toContain('ad group 1 has no ad');
  });

  it.each([
    ['ads beside a creative', [{ name: 'a', creative: IMAGE, ads: TWO }], 'Demand Gen ad group 1 has its own ad beside its list of ads'],
    ['ads that are not a list', [{ name: 'a', ads: { name: 'x' } }], 'The ads of Demand Gen ad group 1 must be a list.'],
  ])('refuses %s', (_label, groups, fragment) => {
    expect(googleDemandGenAdGroupsRefusal('KubeCon NA', groups)).toContain(fragment);
  });

  it("holds a group's video ad name, the group's full name then \" - \" and the ad's, to 255", () => {
    const event = 'E'.repeat(255 - ' - Display | g - a'.length);
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'g', ads: [{ name: 'a', videoCreative: VIDEO }] }])).toBeNull();
    expect(googleDemandGenAdGroupsRefusal(event, [{ name: 'g', ads: [{ name: 'ab', videoCreative: VIDEO }] }])).toContain('which makes 256 characters');
  });
});
