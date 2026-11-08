// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_READABLE_SOURCE } from '../constants/mktg-readable-source.constants';
import { mktgReadableSourceName, mktgReadableSourceText } from './mktg-readable-source.utils';

describe('mktgReadableSourceName', () => {
  it('names the LFX record, the site’s pages by address, and its stylesheet chunks as stylesheets', () => {
    expect(mktgReadableSourceName('LFX record: Project One (project-one)')).toBe('The LFX project record');
    // A site's root is a page a reader can find, not a file: its host.
    expect(mktgReadableSourceName('https://aaif.example/')).toBe('aaif.example');
    expect(mktgReadableSourceName('https://www.aaif.example')).toBe('aaif.example');
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

  it('reads past the record’s provenance kind (`site_css: …`, `brand_page: …`, `logo: …`) to the source itself', () => {
    expect(mktgReadableSourceName('brand_page: https://one.example.org/brand')).toBe('one.example.org/brand');
    expect(mktgReadableSourceName('site_css: https://one.example.org/_next/static/chunks/a1b2c3.css')).toBe('one.example.org stylesheets');
    expect(mktgReadableSourceName('logo: https://one.example.org/img/logo.svg')).toBe(MKTG_READABLE_SOURCE.linkedImage);
    expect(mktgReadableSourceName('logo: logo.svg', 'one')).toBe(MKTG_READABLE_SOURCE.uploadedFile);
    expect(mktgReadableSourceName('logo: brand-package.zip/logos/mark.svg')).toBe(MKTG_READABLE_SOURCE.uploadedPackage);
    // A kind with nothing a reader could look up keeps its word; a URL's own scheme is not a kind.
    expect(mktgReadableSourceName('page')).toBe('page');
    expect(mktgReadableSourceName('https://one.example.org/brand')).toBe('one.example.org/brand');
    // Only the kit's provenance kinds are read past: the record's own "Note:" is kept (rv3 F9).
    expect(mktgReadableSourceName('Note: the requester said so')).toBe('Note: the requester said so');
  });

  it('reads a file extension on the pathname only: a .ai site is a site, a .ai file a file (rv2, the TLD)', () => {
    expect(mktgReadableSourceName('https://agntcy.ai')).toBe('agntcy.ai');
    expect(mktgReadableSourceName('https://agntcy.ai/')).toBe('agntcy.ai');
    expect(mktgReadableSourceName('https://agntcy.ai/brand/logo.ai')).toBe(MKTG_READABLE_SOURCE.linkedImage);
    expect(mktgReadableSourceName('https://agntcy.ai/brand/kit.zip')).toBe(MKTG_READABLE_SOURCE.linkedPackage);
    // A bare host-shaped token is not an upload; a file the record wrote as one is.
    expect(mktgReadableSourceName('agentic.ai')).toBe('agentic.ai');
    expect(mktgReadableSourceName('logo_v2.ai', 'one')).toBe(MKTG_READABLE_SOURCE.uploadedFile);
    expect(mktgReadableSourceName('16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5.ai', 'one')).toBe(MKTG_READABLE_SOURCE.uploadedFile);
  });
});

describe('mktgReadableSourceText', () => {
  it('rewrites every URL and file name inside a sentence of the record, and leaves the rest of the sentence as recorded', () => {
    expect(
      mktgReadableSourceText(
        'The header logo (16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg) is a bitmap; https://cdn.example-cms.io/files/4o10fa7h/production/648471a723a16523e4a2bb9269e093a1ecd3d8e2.zip was not read.'
      )
    ).toBe('The header logo is a bitmap; the logo package linked from the site was not read.');
    expect(mktgReadableSourceText('https://one.example.org/assets/logo.svg was not read as an SVG')).toBe(
      'a logo image linked from the site was not read as an SVG'
    );
    expect(mktgReadableSourceText('Upload the symbol file (symbol.svg) on its own.')).toBe('Upload the symbol file on its own.');
    expect(mktgReadableSourceText('See one.example.org/brand (https://one.example.org/brand).')).toBe('See one.example.org/brand (one.example.org/brand).');
    expect(mktgReadableSourceText('Montserrat is confirmed on Google Fonts.')).toBe('Montserrat is confirmed on Google Fonts.');
  });

  it('keeps the sentence’s own punctuation after a rewritten address, and never prints the hashed path it followed', () => {
    const hashed = 'https://cdn.example-cms.io/images/4o10fa7h/production/16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg';
    expect(mktgReadableSourceText(`Could not read ${hashed}.`)).toBe('Could not read a logo image linked from the site.');
    expect(mktgReadableSourceText(`Read https://one.example.org/brand, then https://one.example.org/; both answered.`)).toBe(
      'Read one.example.org/brand, then one.example.org; both answered.'
    );
    expect(mktgReadableSourceText('Is https://one.example.org/brand.pdf the guide?')).toBe('Is one.example.org/brand.pdf the guide?');
    expect(mktgReadableSourceText('A bare https:// is not an address; neither is (https://!!).')).toBe(
      'A bare https:// is not an address; neither is (https://!!).'
    );
  });

  it('rewrites a file name the sentence ends on (a full stop after the extension), and still reads a name that goes on past a dot', () => {
    expect(mktgReadableSourceText('Could not read logo.svg.')).toBe('Could not read an uploaded logo file.');
    expect(mktgReadableSourceText('Could not read logo.svg, then logo.png.')).toBe('Could not read an uploaded logo file, then an uploaded logo file.');
    expect(mktgReadableSourceText('The file logo.svg.bak was skipped.')).toBe('The file logo.svg.bak was skipped.');
    expect(mktgReadableSourceText('Read archive.zip.')).toBe('Read the uploaded logo package.');
  });

  it('reads a hostile run record in linear time: many addresses, many marks, many query signs', () => {
    const started = performance.now();
    const addresses = mktgReadableSourceText('http://'.repeat(2000));
    const marks = mktgReadableSourceText(`http://${'!'.repeat(10000)}`);
    const signs = mktgReadableSourceName(`https://one.example.org/${'#'.repeat(10000)}\n#`);
    expect(performance.now() - started).toBeLessThan(250);
    // One address, as recorded: its scheme read off and its trailing slash dropped, as any page's address is.
    expect(addresses).toBe(`${'http://'.repeat(1998)}http:/`);
    expect(marks).toBe(`http://${'!'.repeat(10000)}`);
    expect(signs).toBe('one.example.org');
  });

  it('drops a parenthetical left holding only a source’s words, the sentence already naming the thing', () => {
    expect(mktgReadableSourceText('The header links a logo image (16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg) and no SVG.')).toBe(
      'The header links a logo image and no SVG.'
    );
    // A parenthetical with its own words stays.
    expect(mktgReadableSourceText('The header logo (16dd7d8270b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5-838x203.svg, a bitmap) is small.')).toBe(
      'The header logo (a logo image linked from the site, a bitmap) is small.'
    );
    // Only a parenthetical the rewrite produced is dropped: one the record wrote in words stays (rv3 F10).
    expect(mktgReadableSourceText('Read the guide (The LFX project record) first.')).toBe('Read the guide (The LFX project record) first.');
    expect(mktgReadableSourceText('A logo from the site (the uploaded logo files) was used.')).toBe('A logo from the site (the uploaded logo files) was used.');
    // A parenthetical around a page URL keeps the address: it is not only a source's words.
    expect(mktgReadableSourceText('See the brand page (https://one.example.org/brand) for the rest.')).toBe(
      'See the brand page (one.example.org/brand) for the rest.'
    );
    expect(mktgReadableSourceText('The site (https://one.example.org/img/logo.svg) links it.')).toBe('The site links it.');
  });

  it('leaves a host-shaped token in prose as written: a .ai site is not an uploaded file', () => {
    expect(mktgReadableSourceText('The colors were read on agentic.ai and on https://agntcy.ai.')).toBe('The colors were read on agentic.ai and on agntcy.ai.');
    expect(mktgReadableSourceText('Could not open logo_v2.ai.')).toBe('Could not open an uploaded logo file.');
  });
});
