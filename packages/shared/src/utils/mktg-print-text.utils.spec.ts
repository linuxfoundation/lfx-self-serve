// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MKTG_PRINT_DOT } from '../constants/mktg-print.constants';
import { mktgPrintFigure, mktgPrintJoin } from './mktg-print-text.utils';

describe('the marketing prints’ joined lines', () => {
  it('joins the parts with the one middle dot, a plain space either side, the empty parts left out', () => {
    expect(MKTG_PRINT_DOT).toBe(' · ');
    expect(mktgPrintJoin(['Goal 1', '', 'Events'])).toBe('Goal 1 · Events');
    expect(mktgPrintJoin(['Maintainer', ''])).toBe('Maintainer');
    expect(mktgPrintJoin([' Maintainer ', '  '])).toBe('Maintainer');
    expect(mktgPrintJoin([])).toBe('');
  });

  it('prints a figure with thousands separators, and leaves a percentage, a year, a separated or a non-numeric one as stored', () => {
    expect(mktgPrintFigure('1000')).toBe('1,000');
    expect(mktgPrintFigure('$8000')).toBe('$8,000');
    expect(mktgPrintFigure('10000+')).toBe('10,000+');
    expect(mktgPrintFigure('1234567.5')).toBe('1,234,567.5');
    expect(mktgPrintFigure(' 290000 ')).toBe('290,000');
    expect(mktgPrintFigure('900')).toBe('900');
    expect(mktgPrintFigure('96%')).toBe('96%');
    expect(mktgPrintFigure('1000%')).toBe('1000%');
    expect(mktgPrintFigure('2026')).toBe('2026');
    expect(mktgPrintFigure('$2026')).toBe('$2,026');
    expect(mktgPrintFigure('12,000')).toBe('12,000');
    expect(mktgPrintFigure('1.2M')).toBe('1.2M');
    expect(mktgPrintFigure('No. 1')).toBe('No. 1');
    expect(mktgPrintFigure('')).toBe('');
  });
});
