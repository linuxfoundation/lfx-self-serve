// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_READABLE_SOURCE } from '../constants/mktg-readable-source.constants';
import { mktgReadableSourceName, mktgReadableSourceText } from './mktg-readable-source.utils';

describe('mktgReadableSourceName', () => {
  it('names the LFX record, the site’s pages by address, and its stylesheet chunks as stylesheets', () => {
    expect(mktgReadableSourceName('LFX record: Project One (project-one)')).toBe('The LFX project record');
    expect(mktgReadableSourceName('https://www.one.example.org/brand?utm=x')).toBe('one.example.org/brand');
    expect(mktgReadableSourceName('https://one.example.org/_next/static/chunks/a.css')).toBe('one.example.org stylesheets');
    expect(mktgReadableSourceName('https://one.example.org/styles/site.css')).toBe('one.example.org stylesheets');
  });

  it('never prints a file URL: an archive is the logo package the site links, an image or a hashed file a logo image', () => {
    expect(mktgReadableSourceName('https://cdn.example-cms.io/files/4o10fa7h/production/648471a723a16523e4a2bb9269e093a1ecd3d8e2.zip')).toBe(
      MKTG_READABLE_SOURCE.linkedPackage
    );
    expect(mktgReadableSourceName('https://cdn.example-cms.io/images/4o10fa7h/production/16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg')).toBe(
      MKTG_READABLE_SOURCE.linkedImage
    );
    expect(mktgReadableSourceName('https://one.example.org/assets/logo.png')).toBe(MKTG_READABLE_SOURCE.linkedImage);
    expect(mktgReadableSourceName('https://cdn.example-cms.io/files/4o10fa7h/production/648471a723a16523e4a2bb9269e093a1ecd3d8e2')).toBe(
      MKTG_READABLE_SOURCE.linkedFile
    );
    // A brand guide's PDF is a page a reader can find: its address.
    expect(mktgReadableSourceName('https://one.example.org/brand.pdf')).toBe('one.example.org/brand.pdf');
  });

  it('never prints a bare file name: the uploaded files, one or many, hashed or not', () => {
    expect(mktgReadableSourceName('logo.svg')).toBe('the uploaded logo files');
    expect(mktgReadableSourceName('logo-reversed.svg', 'one')).toBe('an uploaded logo file');
    expect(mktgReadableSourceName('16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg')).toBe('the uploaded logo files');
    expect(mktgReadableSourceName('brand-package.zip')).toBe('the uploaded logo package');
    expect(mktgReadableSourceName('  The requester’s answer  ')).toBe('The requester’s answer');
  });
});

describe('mktgReadableSourceText', () => {
  it('rewrites every URL and file name inside a sentence of the record, and leaves the rest of the sentence as recorded', () => {
    expect(
      mktgReadableSourceText(
        'The header logo (16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg) is a bitmap; https://cdn.example-cms.io/files/4o10fa7h/production/648471a723a16523e4a2bb9269e093a1ecd3d8e2.zip was not read.'
      )
    ).toBe('The header logo (a logo image linked from the site) is a bitmap; the logo package linked from the site was not read.');
    expect(mktgReadableSourceText('https://one.example.org/assets/logo.svg was not read as an SVG')).toBe(
      'a logo image linked from the site was not read as an SVG'
    );
    expect(mktgReadableSourceText('Upload the symbol file (symbol.svg) on its own.')).toBe('Upload the symbol file (an uploaded logo file) on its own.');
    expect(mktgReadableSourceText('See one.example.org/brand (https://one.example.org/brand).')).toBe('See one.example.org/brand (one.example.org/brand).');
    expect(mktgReadableSourceText('Montserrat is confirmed on Google Fonts.')).toBe('Montserrat is confirmed on Google Fonts.');
  });
});
