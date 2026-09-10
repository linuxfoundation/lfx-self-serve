// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { parseContentDispositionFilename } from './file.utils';

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
