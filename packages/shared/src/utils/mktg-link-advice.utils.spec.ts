// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { describeMktgLinkAdvice, findDuplicateLinks, mktgLinkWarnings, normalizeMktgLink } from './mktg-link-advice.utils';

describe('Marketing intake link advice', () => {
  it.each(['/drive/folders/synthetic', '/drive/u/2/folders/synthetic'])('recognizes Drive folder %s', (path) => {
    expect(describeMktgLinkAdvice(`https://drive.google.com${path}`)).toBe('drive-folder');
  });
  it.each([
    'https://drive.google.com/file/d/synthetic/view',
    'https://drive.google.com/open?id=synthetic',
    ...['document', 'presentation', 'spreadsheets'].map((kind) => `https://docs.google.com/${kind}/u/2/d/synthetic/edit`),
    ...['document', 'presentation', 'spreadsheets'].map((kind) => `https://docs.google.com/${kind}/d/synthetic/edit`),
  ])('advises on potentially private %s', (url) => {
    expect(describeMktgLinkAdvice(url)).toBe('drive-private');
  });
  it.each([
    '',
    'none',
    'not a URL',
    'https://docs.google.com.example/document/d/synthetic/edit',
    'https://project.example/doc',
    'https://drive.google.com/open',
    'https://docs.google.com/presentation/u/2/d/synthetic/export/pdf',
    ...['export?format=pdf', 'pub', 'pubhtml'].map((action) => `https://docs.google.com/document/d/synthetic/${action}`),
  ])('does not warn about %s', (url) => {
    expect(describeMktgLinkAdvice(url)).toBeNull();
  });
  it('normalizes decoration, not path case or meaningful query parameters', () => {
    expect(normalizeMktgLink(' https://PROJECT.example/Doc/?usp=sharing#heading ')).toBe('https://project.example/Doc');
    expect(
      findDuplicateLinks([
        'https://project.example/Doc',
        'https://PROJECT.example/Doc/?usp=sharing#x',
        'https://project.example/doc',
        'https://project.example/Doc?version=2',
        '',
        'none',
      ])
    ).toEqual(new Set(['https://project.example/Doc']));
  });
  it('warns only on later field/line occurrences and accepts earlier document slots', () => {
    expect(mktgLinkWarnings({ first: 'https://project.example/a', list: 'https://project.example/b\nhttps://PROJECT.example/a/#x' })).toEqual({
      first: '',
      list: 'This link is already added above.',
    });
    expect(mktgLinkWarnings({ pending: 'https://project.example/a/' }, ['https://project.example/a'])['pending']).toBe('This link is already added above.');
    expect(mktgLinkWarnings({ url: 'https://drive.google.com/drive/folders/synthetic' })['url']).toBe(
      "We can't open private Google Drive links or folders. Share the document publicly, or paste its text."
    );
  });
});
