// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { sourceUrlValidator } from './source-url.validator';

describe('sourceUrlValidator', () => {
  // ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
  const validate = (value: string, options?: { list?: boolean; none?: boolean }): Record<string, unknown> | null =>
    sourceUrlValidator(options)({ value } as AbstractControl);

  it('takes blank, "none" or one https:// link, and refuses anything else', () => {
    expect(validate('')).toBeNull();
    expect(validate('  None ')).toBeNull();
    expect(validate('https://search.example.org/about')).toBeNull();
    expect(validate('http://search.example.org')).toEqual({ sourceUrl: { reason: 'unrecognized' } });
    expect(validate('search.example.org')).toEqual({ sourceUrl: { reason: 'unrecognized' } });
    // `new URL` would repair this one; the BFF reads it as typed and refuses it, so the form must too.
    expect(validate('https:search.example.org')).toEqual({ sourceUrl: { reason: 'unrecognized' } });
    expect(validate('https://a.example.org https://b.example.org')).toEqual({ sourceUrl: { reason: 'unrecognized' } });
  });

  it('refuses "none" when told to (a required source has to be a real page), still taking blank and a link', () => {
    expect(validate('none', { none: false })).toEqual({ sourceUrl: { reason: 'unrecognized' } });
    expect(validate('', { none: false })).toBeNull();
    expect(validate('https://search.example.org', { none: false })).toBeNull();
  });

  it('takes one https:// link per line as a list, blank lines ignored, and refuses "none" or a bad line there', () => {
    expect(validate('', { list: true })).toBeNull();
    expect(validate('https://a.example.org\n\n  https://b.example.org/x  \n', { list: true })).toBeNull();
    expect(validate('https://a.example.org\nnot a link', { list: true })).toEqual({ sourceUrl: { reason: 'unrecognized' } });
    expect(validate('none', { list: true })).toEqual({ sourceUrl: { reason: 'unrecognized' } });
  });
});
