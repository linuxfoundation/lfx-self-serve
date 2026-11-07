// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MKTG_PRINT_DOT } from '../constants/mktg-print.constants';
import { mktgPrintJoin } from './mktg-print-text.utils';

describe('the marketing prints’ joined lines', () => {
  it('joins the parts with the one middle dot, a plain space either side, the empty parts left out', () => {
    expect(MKTG_PRINT_DOT).toBe(' · ');
    expect(mktgPrintJoin(['Goal 1', '', 'Events'])).toBe('Goal 1 · Events');
    expect(mktgPrintJoin(['Maintainer', ''])).toBe('Maintainer');
    expect(mktgPrintJoin([' Maintainer ', '  '])).toBe('Maintainer');
    expect(mktgPrintJoin([])).toBe('');
  });
});
