// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { formatLfxDocumentTitle } from './document-title.utils';

describe('formatLfxDocumentTitle', () => {
  it('returns the brand when the page name is missing', () => {
    expect(formatLfxDocumentTitle(undefined)).toBe('LFX');
    expect(formatLfxDocumentTitle(null)).toBe('LFX');
    expect(formatLfxDocumentTitle('')).toBe('LFX');
    expect(formatLfxDocumentTitle('   ')).toBe('LFX');
  });

  it('returns the brand unchanged when the page is already the brand', () => {
    expect(formatLfxDocumentTitle('LFX')).toBe('LFX');
  });

  it('appends the brand to a plain page name', () => {
    expect(formatLfxDocumentTitle('My Meetings')).toBe('My Meetings · LFX');
    expect(formatLfxDocumentTitle(' Kubernetes ')).toBe('Kubernetes · LFX');
  });

  it('does not double-suffix an already branded app title', () => {
    expect(formatLfxDocumentTitle('Kubernetes · LFX')).toBe('Kubernetes · LFX');
  });

  it('leaves the docs portal brand and article titles alone', () => {
    expect(formatLfxDocumentTitle('LFX Documentation')).toBe('LFX Documentation');
    expect(formatLfxDocumentTitle('Getting Started · LFX Documentation')).toBe('Getting Started · LFX Documentation');
  });
});
