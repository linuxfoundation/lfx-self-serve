// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { findMktgDocumentStatus } from './mktg-document.utils';

describe('findMktgDocumentStatus — the review label read from the document', () => {
  it('reads the status line above the Review Sheet table', () => {
    const doc = '# Example Brand Kit\n\n## Review Sheet\n\nStatus: Draft — pre-filled\n9 of 14 fields from your documents; 3 asked.\n\n| # | Field |';
    expect(findMktgDocumentStatus(doc)).toBe('Draft — pre-filled');
  });

  it('reads the status cell of the cover details table', () => {
    const doc =
      '| Project | Example |\n| Document | Brand Kit |\n| Status | Draft — from your documents |\n| Repository | https://github.com/example/project |';
    expect(findMktgDocumentStatus(doc)).toBe('Draft — from your documents');
  });

  it('keeps the reviewer and date of an ED-reviewed label and drops trailing punctuation', () => {
    expect(findMktgDocumentStatus('**Status:** ED-reviewed — Jane Doe, 2026-10-12.')).toBe('ED-reviewed — Jane Doe, 2026-10-12');
  });

  it('accepts a decorated standalone label line', () => {
    expect(findMktgDocumentStatus('> **Draft — from your answers**')).toBe('Draft — from your answers');
  });

  it('accepts the classic "Draft v1 — for review" and the template’s upper-case docx variant', () => {
    expect(findMktgDocumentStatus('Status: Draft v1 — for review')).toBe('Draft v1 — for review');
    expect(findMktgDocumentStatus('Status: DRAFT — pre-filled, awaiting ED review')).toBe('DRAFT — pre-filled, awaiting ED review');
  });

  it('stops at a separator so the field tally never rides along', () => {
    expect(findMktgDocumentStatus('Status: Draft — pre-filled · 31 of 38 fields from your documents')).toBe('Draft — pre-filled');
    expect(findMktgDocumentStatus('Status: Draft — pre-filled | 31 of 38 fields')).toBe('Draft — pre-filled');
  });

  it('tolerates a spaced hyphen or an en dash as the separator', () => {
    expect(findMktgDocumentStatus('Status: Draft - pre-filled')).toBe('Draft - pre-filled');
    expect(findMktgDocumentStatus('Status: ED-reviewed – Jane Doe, 2026-10-12')).toBe('ED-reviewed – Jane Doe, 2026-10-12');
  });

  it('ignores a mid-sentence "draft —" in prose', () => {
    expect(findMktgDocumentStatus('This first draft — pre-filled from the LFX record — still needs the tagline lock.')).toBe('');
  });

  it('returns the first label when the document states the status more than once', () => {
    const doc = '| Status | Draft — pre-filled |\n\n## Review Sheet\n\nStatus: Draft — pre-filled\n\nLater: ED-reviewed — Someone, 2026-01-01';
    expect(findMktgDocumentStatus(doc)).toBe('Draft — pre-filled');
  });

  it('returns an empty string for a document with no status', () => {
    expect(findMktgDocumentStatus('')).toBe('');
    expect(findMktgDocumentStatus('# Example Brand Kit\n\n## 1. Project Definition\n\nProse.')).toBe('');
  });
});
