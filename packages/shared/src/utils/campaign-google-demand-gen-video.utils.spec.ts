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
    ['a logo URL over http', { ...VALID, logoImages: ['http://cdn.example/logo.png'] }, 'well-formed https image URL'],
    ['a logo URL with no host', { ...VALID, logoImages: ['https:///logo.png'] }, 'well-formed https image URL'],
    ['a logo URL whose authority is only credentials', { ...VALID, logoImages: ['https://user@/logo.png'] }, 'well-formed https image URL'],
    ['an opaque https logo', { ...VALID, logoImages: ['https:cdn.example/logo.png'] }, 'well-formed https image URL'],
    ['a logo stored-image ref with a blank id', { ...VALID, logoImages: [{ imageAssetId: '  ' }] }, 'well-formed https image URL'],
    ['a logo URL whose port is not digits', { ...VALID, logoImages: ['https://cdn.example:abc/logo.png'] }, 'well-formed https image URL'],
    ['a logo URL with a bad escape in the path', { ...VALID, logoImages: ['https://cdn.example/%ZZ.png'] }, 'well-formed https image URL'],
    ['a logo URL with a bad escape in the fragment', { ...VALID, logoImages: ['https://cdn.example/logo.png#%G1'] }, 'well-formed https image URL'],
    ['a logo URL with a control character', { ...VALID, logoImages: ['https://cdn.example/lo\u0001go.png'] }, 'well-formed https image URL'],
    ['a logo URL with a space in the host', { ...VALID, logoImages: ['https://cdn example/logo.png'] }, 'well-formed https image URL'],
    ['a logo URL with an ASCII escape in the host', { ...VALID, logoImages: ['https://cdn%2Eexample/logo.png'] }, 'well-formed https image URL'],
    ['a logo URL with a bad byte in the userinfo', { ...VALID, logoImages: ['https://us"er@cdn.example/logo.png'] }, 'well-formed https image URL'],
    ['a logo URL with an unclosed IPv6 host', { ...VALID, logoImages: ['https://[::1/logo.png'] }, 'well-formed https image URL'],
    [
      'descriptions that are one line once Go decodes the lone surrogates',
      { ...VALID, descriptions: ['Register\ud800', 'Register\ud801'] },
      'description 2 repeats an earlier one',
    ],
    ['headlines that differ only in a lone surrogate', { ...VALID, headlines: ['Join\udc00', 'join\udfff'] }, 'headline 2 repeats an earlier one'],
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

  it('accepts what Go url.Parse accepts: an empty port, a non-ASCII host, a semicolon or bad escape in the query, a control character in the fragment', () => {
    for (const logo of [
      'https://cdn.example:/logo.png',
      'https://bücher.example/logo.png',
      'https://cdn.example/logo.png?v=1;x=%ZZ',
      'https://cdn.example/logo.png#a\u0001',
      'https://user:pa;ss@cdn.example/logo.png',
      'https://[2001:db8::1]:443/logo.png',
      'https://cdn.example/%E2%82%AC.png',
    ]) {
      expect(googleDemandGenVideoCreativeRefusal({ ...VALID, logoImages: [logo] })).toBeNull();
    }
  });

  it('keeps two lines that stay distinct after Go decodes them: a well-formed surrogate pair is kept', () => {
    expect(googleDemandGenVideoCreativeRefusal({ ...VALID, descriptions: ['Register 😀', 'Register'] })).toBeNull();
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
