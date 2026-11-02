// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { DocumentDisplayNamePipe } from './document-display-name.pipe';

const doc = (overrides: Partial<MyDocumentItem>): MyDocumentItem => ({
  id: 'x',
  name: 'Weekly Sync',
  source: 'recording',
  foundationName: '',
  groupOrMeetingName: '',
  groupOrMeetingUid: '',
  date: '2026-10-14T12:00:00Z',
  ...overrides,
});

describe('DocumentDisplayNamePipe', () => {
  const pipe = TestBed.runInInjectionContext(() => new DocumentDisplayNamePipe());

  it.each(['recording', 'transcript', 'summary'] as const)('prepends the meeting date to a %s name', (source) => {
    expect(pipe.transform(doc({ source }))).toBe('Oct 14, 2026 – Weekly Sync');
  });

  it('keeps the name of documents that are not named after their meeting', () => {
    expect(pipe.transform(doc({ source: 'link' }))).toBe('Weekly Sync');
    expect(pipe.transform(doc({ source: 'file' }))).toBe('Weekly Sync');
    expect(pipe.transform(doc({ source: 'mailing_list' }))).toBe('Weekly Sync');
  });

  it('keeps the name of folders and of rows without a valid date', () => {
    expect(pipe.transform(doc({ isFolder: true }))).toBe('Weekly Sync');
    expect(pipe.transform(doc({ date: '' }))).toBe('Weekly Sync');
    expect(pipe.transform(doc({ date: 'not a date' }))).toBe('Weekly Sync');
  });

  it('formats the date with the app locale, like the Date column', () => {
    registerLocaleData(localeDe);
    TestBed.configureTestingModule({ providers: [{ provide: LOCALE_ID, useValue: 'de' }] });
    const germanPipe = TestBed.runInInjectionContext(() => new DocumentDisplayNamePipe());

    const name = germanPipe.transform(doc({}));

    expect(name).toContain('Okt');
    expect(name).not.toBe(pipe.transform(doc({})));
    expect(name.endsWith('– Weekly Sync')).toBe(true);
  });
});
