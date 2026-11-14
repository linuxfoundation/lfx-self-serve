// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_DRIVE_SHARING_HINT, MKTG_INTAKE_LINK_ADVICE } from '../constants/mktg-intake-link-advice.constants';
import { describeMktgLinkAdvice, mktgLinkWarnings, normalizeMktgLink } from './mktg-link-advice.utils';

describe('Marketing intake link advice', () => {
  it('uses the operator-approved LF-wide sharing copy without promising public access', () => {
    expect(MKTG_DRIVE_SHARING_HINT).toBe('Share Google Drive files with everyone at the Linux Foundation so Marketing OS can use them.');
    expect(MKTG_INTAKE_LINK_ADVICE.drivePrivate).toBe('Share it with everyone at the Linux Foundation, or paste its text.');
    expect(MKTG_INTAKE_LINK_ADVICE.driveFolder).toBe(
      "Marketing OS can't open Google Drive folders. Link each file instead, shared with everyone at the Linux Foundation."
    );
  });
  it.each(['/drive/folders/synthetic', '/drive/u/2/folders/synthetic'])('recognizes Drive folder %s', (path) => {
    const url = `https://drive.google.com${path}`;
    expect(describeMktgLinkAdvice(url)).toBe('drive-folder');
    expect(mktgLinkWarnings({ url })['url']).toBe(MKTG_INTAKE_LINK_ADVICE.driveFolder);
  });
  it.each([
    'https://drive.google.com/file/d/synthetic/view',
    'https://drive.google.com/open?id=synthetic',
    ...['document', 'presentation', 'spreadsheets'].map((kind) => `https://docs.google.com/${kind}/u/2/d/synthetic/edit`),
    ...['document', 'presentation', 'spreadsheets'].map((kind) => `https://docs.google.com/${kind}/d/synthetic/edit`),
  ])('advises on potentially private %s', (url) => {
    expect(describeMktgLinkAdvice(url)).toBe('drive-private');
    expect(mktgLinkWarnings({ url })['url']).toBe(MKTG_INTAKE_LINK_ADVICE.drivePrivate);
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
      mktgLinkWarnings({
        first: 'https://project.example/Doc',
        duplicate: 'https://PROJECT.example/Doc/?usp=sharing#x',
        lower: 'https://project.example/doc',
        version: 'https://project.example/Doc?version=2',
        blank: '',
        invalid: 'none',
      })
    ).toEqual({ first: '', duplicate: MKTG_INTAKE_LINK_ADVICE.duplicate, lower: '', version: '', blank: '', invalid: '' });
  });
  it('warns only on later field/line occurrences and accepts earlier document slots', () => {
    expect(mktgLinkWarnings({ first: 'https://project.example/a', list: 'https://project.example/b\nhttps://PROJECT.example/a/#x' })).toEqual({
      first: '',
      list: MKTG_INTAKE_LINK_ADVICE.duplicate,
    });
    expect(mktgLinkWarnings({ pending: 'https://project.example/a/' }, ['https://project.example/a'])['pending']).toBe(MKTG_INTAKE_LINK_ADVICE.duplicate);
    expect(mktgLinkWarnings({ url: 'https://drive.google.com/drive/folders/synthetic' })['url']).toBe(MKTG_INTAKE_LINK_ADVICE.driveFolder);
  });
});
