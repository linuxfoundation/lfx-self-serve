// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { formatFileSize, parseContentDispositionFilename } from './file.utils';

describe('parseContentDispositionFilename', () => {
  it('reads the quoted ASCII fallback form', () => {
    expect(parseContentDispositionFilename('attachment; filename="certificate.pdf"')).toBe('certificate.pdf');
  });

  it('reads the RFC 5987 filename* form, percent-decoded', () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''certificate-of-attendance-%C3%A9v%C3%A9nement.pdf")).toBe(
      'certificate-of-attendance-événement.pdf'
    );
  });

  it('prefers filename* over the quoted fallback when both are present', () => {
    const header = 'attachment; filename="certificate.pdf"; filename*=UTF-8\'\'certificate-of-attendance.pdf';
    expect(parseContentDispositionFilename(header)).toBe('certificate-of-attendance.pdf');
  });

  it('falls back to the quoted form when filename* is malformed percent-encoding', () => {
    const header = 'attachment; filename="certificate.pdf"; filename*=UTF-8\'\'%E0%A4%A';
    expect(parseContentDispositionFilename(header)).toBe('certificate.pdf');
  });

  it('reads an unquoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename=certificate.pdf')).toBe('certificate.pdf');
  });

  it.each([[null], [undefined], ['']])('returns null for %p', (header) => {
    expect(parseContentDispositionFilename(header)).toBeNull();
  });

  it('returns null when the header has no filename', () => {
    expect(parseContentDispositionFilename('attachment')).toBeNull();
  });
});

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
