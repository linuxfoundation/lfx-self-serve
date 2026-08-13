// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { formatFileSize } from './file.utils';

describe('formatFileSize', () => {
  it('renders bytes without a decimal', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('clamps sub-byte and non-finite values instead of picking a negative unit', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(0.5)).toBe('0 B');
    expect(formatFileSize(-1)).toBe('0 B');
    expect(formatFileSize(Number.NaN)).toBe('0 B');
  });

  it('switches unit at each 1024 boundary', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(1024 ** 3)).toBe('1 GB');
  });

  it('caps at GB rather than running off the unit list', () => {
    expect(formatFileSize(1024 ** 4)).toBe('1024 GB');
  });

  it('rounds to one decimal above bytes', () => {
    expect(formatFileSize(1_468_006)).toBe('1.4 MB');
  });
});
