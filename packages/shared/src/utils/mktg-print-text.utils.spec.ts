// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { FRAMEWORK_PORTRAIT_SEP, MKTG_PRINT_DOT } from '../constants/mktg-print.constants';
import { mktgPrintFigure, mktgPrintJoin } from './mktg-print-text.utils';

describe('the marketing prints’ joined lines', () => {
  it('joins the parts with the one middle dot, a plain space either side, the empty parts left out', () => {
    expect(MKTG_PRINT_DOT).toBe(' · ');
    expect(mktgPrintJoin(['Goal 1', '', 'Events'])).toBe('Goal 1 · Events');
    // The framework book's dot: the room of a space and a thin space each side, with no break before the dot (the editor's S-b and
    // S-b2 reads): a line may break only at its trailing space, so the dot ends a line and never starts one.
    expect(FRAMEWORK_PORTRAIT_SEP).toBe('\u00a0\u202f·\u202f ');
    expect(mktgPrintJoin(['Goal 1', '', 'Events'], FRAMEWORK_PORTRAIT_SEP)).toBe('Goal 1\u00a0\u202f·\u202f Events');
    expect(FRAMEWORK_PORTRAIT_SEP.indexOf(' ')).toBe(FRAMEWORK_PORTRAIT_SEP.length - 1);
    expect(mktgPrintJoin(['Maintainer', ''])).toBe('Maintainer');
    expect(mktgPrintJoin([' Maintainer ', '  '])).toBe('Maintainer');
    expect(mktgPrintJoin([])).toBe('');
  });

  it('prints a figure with thousands separators, and leaves a percentage, a separated or a non-numeric one as stored; a year only under a year label', () => {
    expect(mktgPrintFigure('1000')).toBe('1,000');
    expect(mktgPrintFigure('$8000')).toBe('$8,000');
    expect(mktgPrintFigure('10000+')).toBe('10,000+');
    expect(mktgPrintFigure('1234567.5')).toBe('1,234,567.5');
    expect(mktgPrintFigure(' 290000 ')).toBe('290,000');
    expect(mktgPrintFigure('900')).toBe('900');
    expect(mktgPrintFigure('96%')).toBe('96%');
    expect(mktgPrintFigure('1000%')).toBe('1000%');
    // A bare 1900–2099 integer is a year only when its label names a calendar year (`Founded`, `Since`, `Year founded`, `Est.`
    // as the first word or the whole label); a count of 2,000 is separated (editor S1), and so is a count whose label merely
    // mentions a year or a start (`downloads per year`, `members added since launch`).
    expect(mktgPrintFigure('2000', 'founded')).toBe('2000');
    expect(mktgPrintFigure('2000', 'Founded in')).toBe('2000');
    expect(mktgPrintFigure('2000', 'year founded')).toBe('2000');
    expect(mktgPrintFigure('2000', 'Year established')).toBe('2000');
    expect(mktgPrintFigure('2015', 'since')).toBe('2015');
    expect(mktgPrintFigure('2015', 'Est.')).toBe('2015');
    expect(mktgPrintFigure('1999', ' Since open source began ')).toBe('1999');
    expect(mktgPrintFigure('2026')).toBe('2,026');
    expect(mktgPrintFigure('2000', 'research groups run the toolchain')).toBe('2,000');
    expect(mktgPrintFigure('2000', 'downloads per year')).toBe('2,000');
    expect(mktgPrintFigure('1200', 'members added since launch')).toBe('1,200');
    expect(mktgPrintFigure('2026', 'the year the foundation was founded')).toBe('2,026');
    expect(mktgPrintFigure('2024', 'audits published every year since')).toBe('2,024');
    expect(mktgPrintFigure('2000', 'yearly founders')).toBe('2,000');
    expect(mktgPrintFigure('$2026', 'Founded')).toBe('$2,026');
    expect(mktgPrintFigure('2026+', 'Founded')).toBe('2,026+');
    expect(mktgPrintFigure('12,000')).toBe('12,000');
    expect(mktgPrintFigure('1.2M')).toBe('1.2M');
    expect(mktgPrintFigure('No. 1')).toBe('No. 1');
    expect(mktgPrintFigure('')).toBe('');
  });
});
