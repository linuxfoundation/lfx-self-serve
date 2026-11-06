// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { googleDemandGenVideoCreativeRefusal, googleDemandGenVideoIdsRefusal } from './campaign-google-demand-gen-video.utils';

/** A video ad campaign-service accepts: one of everything required, at the widths Google allows. */
const VALID = {
  youtubeVideoIds: ['dQw4w9WgXcQ'],
  logoImages: [{ imageAssetId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }],
  headlines: ['h'.repeat(40)],
  longHeadlines: ['l'.repeat(90)],
  descriptions: ['d'.repeat(90)],
  businessName: 'b'.repeat(25),
  callToAction: 'SIGN_UP',
};

describe('googleDemandGenVideoIdsRefusal', () => {
  it('accepts bare ids of letters, digits, "-" and "_", skipping blanks', () => {
    expect(googleDemandGenVideoIdsRefusal(['dQw4w9WgXcQ', ' a-b_C9 ', ''])).toBeNull();
  });

  it.each([
    ['a watch URL', ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'], 'is a link'],
    ['a share link', ['youtu.be/dQw4w9WgXcQ'], 'is a link'],
    ['a character outside the id alphabet', ['dQw4w9WgX.Q'], 'not a YouTube video ID'],
    ['an exact repeat', ['abc', 'abc'], 'YouTube video 2 repeats an earlier one'],
    ['nothing at all', ['  '], 'at least one'],
    ['six ids', ['a', 'b', 'c', 'd', 'e', 'f'], 'at most 5'],
  ])('refuses %s', (_label, ids, fragment) => {
    expect(googleDemandGenVideoIdsRefusal(ids)).toContain(fragment);
  });

  it('treats ids differing only in case as different videos, as upstream does', () => {
    expect(googleDemandGenVideoIdsRefusal(['abc', 'ABC'])).toBeNull();
  });
});

describe('googleDemandGenVideoCreativeRefusal', () => {
  it('accepts a complete ad at every width limit, and with no call to action', () => {
    expect(googleDemandGenVideoCreativeRefusal(VALID)).toBeNull();
    expect(googleDemandGenVideoCreativeRefusal({ ...VALID, callToAction: undefined })).toBeNull();
  });

  it.each([
    ['a non-object', [], 'must be an object'],
    ['no logo', { ...VALID, logoImages: [] }, 'exactly one logo'],
    ['two logos', { ...VALID, logoImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] }, 'exactly one logo'],
    ['a headline one past 40', { ...VALID, headlines: ['h'.repeat(41)] }, 'longer than the 40'],
    ['a CJK headline that is 42 wide in 21 characters', { ...VALID, headlines: ['日'.repeat(21)] }, 'longer than the 40'],
    ['six headlines', { ...VALID, headlines: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'at most 5 headlines'],
    ['a repeat that differs only in case', { ...VALID, descriptions: ['Register', 'register'] }, 'description 2 repeats an earlier one'],
    ['a logo URL over http', { ...VALID, logoImages: ['http://cdn.example/logo.png'] }, 'must be an https image URL'],
    ['a logo URL with no host', { ...VALID, logoImages: ['https:///logo.png'] }, 'must be an https image URL'],
    ['a logo URL whose authority is only credentials', { ...VALID, logoImages: ['https://user@/logo.png'] }, 'must be an https image URL'],
    ['an opaque https logo', { ...VALID, logoImages: ['https:cdn.example/logo.png'] }, 'must be an https image URL'],
    ['a logo stored-image ref with a blank id', { ...VALID, logoImages: [{ imageAssetId: '  ' }] }, 'must be an https image URL'],
    ['no long headline', { ...VALID, longHeadlines: ['  '] }, 'at least 1 long headline'],
    ['a long headline one past 90', { ...VALID, longHeadlines: ['l'.repeat(91)] }, 'longer than the 90'],
    ['no description', { ...VALID, descriptions: [] }, 'at least 1 description'],
    ['no business name', { ...VALID, businessName: ' ' }, 'needs a business name'],
    ['a business name one past 25', { ...VALID, businessName: 'b'.repeat(26) }, 'longer than the 25'],
    ['a call to action Google refused in the probe', { ...VALID, callToAction: 'REGISTER' }, 'not one Google Ads takes'],
    ['a watch URL among the videos', { ...VALID, youtubeVideoIds: ['https://youtu.be/dQw4w9WgXcQ'] }, 'is a link'],
  ])('refuses %s', (_label, creative, fragment) => {
    expect(googleDemandGenVideoCreativeRefusal(creative)).toContain(fragment);
  });

  it('accepts an https logo URL with a host, scheme in any case, and a stored library image', () => {
    expect(googleDemandGenVideoCreativeRefusal({ ...VALID, logoImages: ['https://cdn.example/logo.png'] })).toBeNull();
    expect(googleDemandGenVideoCreativeRefusal({ ...VALID, logoImages: ['HTTPS://cdn.example:8443/logo.png'] })).toBeNull();
    expect(googleDemandGenVideoCreativeRefusal({ ...VALID, logoImages: [{ imageAssetId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }] })).toBeNull();
  });

  it('never echoes what was pasted: a link with credentials is named by its position', () => {
    const secret = 'https://u:secret@x.example/v';
    const cases = [
      { ...VALID, youtubeVideoIds: ['dQw4w9WgXcQ', secret] },
      { ...VALID, youtubeVideoIds: ['secret token'] },
      { ...VALID, youtubeVideoIds: ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'] },
      { ...VALID, logoImages: [`http${secret.slice(5)}`] },
      { ...VALID, headlines: [`${secret} ${'h'.repeat(40)}`] },
      { ...VALID, descriptions: [secret, secret.toUpperCase()] },
      { ...VALID, businessName: `${secret}${'b'.repeat(25)}` },
      { ...VALID, callToAction: secret },
    ];
    for (const creative of cases) {
      const refusal = googleDemandGenVideoCreativeRefusal(creative) ?? '';
      expect(refusal).not.toBe('');
      expect(refusal).not.toContain('secret');
      expect(refusal).not.toContain('://');
    }
    expect(googleDemandGenVideoIdsRefusal(['dQw4w9WgXcQ', secret])).toContain('YouTube video 2 is a link');
  });

  it('judges the videos first, as upstream does, so a bad id is named before a missing logo', () => {
    expect(googleDemandGenVideoCreativeRefusal({ ...VALID, youtubeVideoIds: ['bad id'], logoImages: [] })).toContain('not a YouTube video ID');
  });
});
