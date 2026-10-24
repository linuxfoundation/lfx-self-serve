// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MyDocumentItem } from '../interfaces/my-document.interface';
import { compareDocumentsByRecency } from './document-sort.utils';

const doc = (overrides: Partial<MyDocumentItem>): MyDocumentItem => ({
  id: 'x',
  name: 'Doc',
  source: 'link',
  foundationName: '',
  groupOrMeetingName: '',
  groupOrMeetingUid: '',
  date: '',
  ...overrides,
});

describe('compareDocumentsByRecency', () => {
  it('lists folders first, alphabetically', () => {
    const rows = [
      doc({ id: 'd', name: 'A doc', date: '2026-10-01' }),
      doc({ id: 'f2', name: 'Zeta', isFolder: true }),
      doc({ id: 'f1', name: 'Alpha', isFolder: true }),
    ];

    expect(rows.sort(compareDocumentsByRecency).map((r) => r.id)).toEqual(['f1', 'f2', 'd']);
  });

  it('lists documents newest first', () => {
    const rows = [doc({ id: 'old', date: '2026-01-01' }), doc({ id: 'new', date: '2026-10-01' }), doc({ id: 'mid', date: '2026-05-01' })];

    expect(rows.sort(compareDocumentsByRecency).map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('lists undated documents after dated ones, including pre-epoch dates', () => {
    const rows = [doc({ id: 'none', date: '' }), doc({ id: 'ancient', date: '1960-01-01' }), doc({ id: 'recent', date: '2026-10-01' })];

    expect(rows.sort(compareDocumentsByRecency).map((r) => r.id)).toEqual(['recent', 'ancient', 'none']);
  });

  it('breaks date ties by name, then id', () => {
    const rows = [
      doc({ id: '2', name: 'B', date: '2026-10-01' }),
      doc({ id: '3', name: 'A', date: '2026-10-01' }),
      doc({ id: '1', name: 'A', date: '2026-10-01' }),
    ];

    expect(rows.sort(compareDocumentsByRecency).map((r) => r.id)).toEqual(['1', '3', '2']);
  });
});
