// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CreativeAssetLibraryState, LinkedInDocumentDraft } from '../interfaces/campaign.interface';
import {
  emptyLinkedInDocumentDraft,
  linkedInDocumentCreateRefusal,
  linkedInDocumentDraftFromStored,
  linkedInDocumentFieldsForCreate,
  linkedInDocumentGatedWarning,
  linkedInDocumentPdfOptions,
  linkedInDocumentView,
  linkedInStoredDocumentRows,
} from './campaign-linkedin-document-form.utils';

const PDF = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const OTHER = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
const ready = (ids: string[] = [PDF]): CreativeAssetLibraryState => ({
  status: 'ready',
  assets: [],
  documents: ids.map((id) => ({ id, byteSize: 2048, checksum: `${id.slice(0, 8)}ffff` })),
});
const draft = (fields: Partial<LinkedInDocumentDraft> = {}): LinkedInDocumentDraft => ({
  assetId: PDF,
  assetBriefId: 'b-1',
  title: 'Sponsor prospectus',
  introText: 'Sponsor the conference',
  ...fields,
});

describe('linkedInStoredDocumentRows', () => {
  const stored = [
    { id: PDF, byteSize: 10, checksum: 'aaaaaaaaff' },
    { id: OTHER, byteSize: 20, checksum: 'bbbbbbbbff' },
  ];
  const used = 'Used by the LinkedIn document ad on this tab. Remove it from the ad to delete it.';
  const waiting = 'Wait for the uploads to finish.';
  it.each([
    ['neither in use', [], false, '', [false, false], ['', '']],
    ['the first in use by the document ad', [PDF], false, '', [true, false], [used, '']],
    ['an upload running', [], true, '', [true, true], [waiting, waiting]],
    ['the second being deleted', [], false, OTHER, [true, true], ['', 'Deleting…']],
  ])('%s', (_label, inUse, uploading, deletingId, disabled, notes) => {
    const rows = linkedInStoredDocumentRows(stored, inUse, uploading, deletingId);
    expect(rows.map((row) => row.label)).toEqual(['PDF 1 (aaaaaaaa)', 'PDF 2 (bbbbbbbb)']);
    expect(rows.map((row) => row.deleteDisabled)).toEqual(disabled);
    expect(rows.map((row) => row.note)).toEqual(notes);
    expect(rows.map((row) => row.inUse)).toEqual(stored.map((document) => inUse.includes(document.id)));
  });
});

describe('linkedInDocumentPdfOptions', () => {
  it('offers every stored PDF, labelled by order, checksum and size', () => {
    expect(linkedInDocumentPdfOptions(ready([PDF, OTHER]), '')).toEqual([
      { value: PDF, label: 'PDF 1 (3f2b8c1e, 2 KB)' },
      { value: OTHER, label: 'PDF 2 (9a7b1c2d, 2 KB)' },
    ]);
  });

  // The select does not re-emit the value it holds, so a held PDF the library does not list could never be replaced.
  it('keeps a held PDF the library does not list, after a clear option', () => {
    expect(linkedInDocumentPdfOptions(ready([]), OTHER).map((option) => option.value)).toEqual(['', OTHER]);
    expect(linkedInDocumentPdfOptions(ready([PDF]), PDF).map((option) => option.value)).toEqual(['', PDF]);
  });

  // A PDF whose delete is running is not offered, so it cannot be picked for a create that would name it once gone.
  it.each([
    ['no delete running', '', '', [PDF, OTHER]],
    ['the other PDF being deleted', '', OTHER, [PDF]],
    ['an asset not listed being deleted', '', 'v-1', [PDF, OTHER]],
    ['the held PDF being deleted, kept by id so it can be cleared', PDF, PDF, ['', PDF, OTHER]],
  ])('offers PDFs with %s', (_label, held, deletingId, values) => {
    expect(linkedInDocumentPdfOptions(ready([PDF, OTHER]), held, deletingId).map((option) => option.value)).toEqual(values);
  });
});

describe('linkedInDocumentView', () => {
  it.each([
    ['a 150-character intro, with no hint', 'i'.repeat(150), '', ''],
    ['a 151-character intro, with the soft hint', 'i'.repeat(151), '', 'LinkedIn recommends about 150 characters'],
    ['a 600-character intro, with the soft hint and no error', 'i'.repeat(600), '', 'LinkedIn recommends about 150 characters'],
    ['a 601-character intro, with the error and no hint', 'i'.repeat(601), 'Keep the intro text to 600 characters.', ''],
  ])('judges %s', (_name, introText, error, hint) => {
    const view = linkedInDocumentView(draft({ introText }), ready(), 'b-1');
    expect(view.introError).toBe(error);
    if (hint === '') expect(view.introHint).toBe('');
    else expect(view.introHint).toContain(hint);
  });

  it('counts the title after normalization, and names one over 70', () => {
    expect(linkedInDocumentView(draft({ title: 't'.repeat(70) }), ready(), 'b-1')).toMatchObject({ titleLength: 70, titleError: '' });
    expect(linkedInDocumentView(draft({ title: 't'.repeat(71) }), ready(), 'b-1').titleError).toBe('Keep the title to 70 characters.');
  });

  it.each([
    ['a PDF of this brief', draft(), ready(), 'b-1', ''],
    ['a PDF of another brief', draft({ assetBriefId: 'b-0' }), ready(), 'b-1', 'Stored for a different brief'],
    ['a PDF no longer stored', draft({ assetId: OTHER }), ready(), 'b-1', 'No longer in the brief'],
    // The tab has no brief id while a save runs: no evidence of another brief.
    ['a PDF while the brief saves', draft({ assetBriefId: 'b-0' }), ready(), '', ''],
    // A library still loading or that failed is never read as "missing".
    ['a PDF while the library loads', draft({ assetId: OTHER }), { status: 'loading', assets: [] } as CreativeAssetLibraryState, 'b-1', ''],
  ])('names the problem of %s', (_name, document, library, briefId, problem) => {
    const view = linkedInDocumentView(document, library, briefId);
    if (problem === '') expect(view.assetProblem).toBe('');
    else expect(view.assetProblem).toContain(problem);
  });

  it.each([
    [{ status: 'idle', assets: [] }, 'Save the brief'],
    [{ status: 'loading', assets: [] }, 'Loading'],
    [{ status: 'error', assets: [] }, "Couldn't load"],
    [{ status: 'ready', assets: [], documents: [] }, 'No PDF is stored'],
  ])('explains a %o library', (library, note) => {
    expect(linkedInDocumentView(emptyLinkedInDocumentDraft(), library as CreativeAssetLibraryState, 'b-1').pdfNote).toContain(note);
  });
});

describe('linkedInDocumentFieldsForCreate', () => {
  it('sends the format, PDF, title and intro with no variants', () => {
    expect(linkedInDocumentFieldsForCreate(draft(), 'b-1')).toEqual({
      format: 'document',
      documentAssetId: PDF,
      documentTitle: 'Sponsor prospectus',
      documentIntroText: 'Sponsor the conference',
      variants: [],
    });
  });

  it('sends no PDF picked for another brief', () => {
    expect(linkedInDocumentFieldsForCreate(draft({ assetBriefId: 'b-0' }), 'b-1').documentAssetId).toBe('');
  });
});

describe('linkedInDocumentCreateRefusal', () => {
  it.each([
    ['an engagement document', draft(), {}, 'b-1', null],
    ['a gated document', draft(), { objective: 'lead_generation' }, 'b-1', null],
    ['an unsaved brief', draft(), {}, '', 'save the brief'],
    ['no PDF picked', draft({ assetId: '', assetBriefId: '' }), {}, 'b-1', 'Choose the PDF'],
    ['a PDF of another brief', draft({ assetBriefId: 'b-0' }), {}, 'b-1', 'choose another PDF'],
    ['a blank title', draft({ title: ' ' }), {}, 'b-1', 'Enter the document title'],
    ['the website visits objective', draft(), { objective: 'traffic' }, 'b-1', 'no website visits or conversions'],
    ['a manual bid', draft(), { bidding: { strategy: 'manual', bidAmount: 5 } }, 'b-1', 'automatic bidding only'],
  ])('judges %s', (_name, document, sent, briefId, expected) => {
    const refusal = linkedInDocumentCreateRefusal(document, ready(), briefId, sent);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });

  // Create waits while the picked PDF's delete runs: the create would name a PDF about to be gone.
  it.each([
    ['the picked PDF being deleted', PDF, 'is being deleted'],
    ['another asset being deleted', OTHER, null],
    ['no delete running', '', null],
  ])('judges %s', (_name, deletingId, expected) => {
    const refusal = linkedInDocumentCreateRefusal(draft(), ready([PDF, OTHER]), 'b-1', {}, deletingId);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('linkedInDocumentGatedWarning', () => {
  it('warns a gated document about one-page PDFs, and says nothing otherwise', () => {
    expect(linkedInDocumentGatedWarning(true)).toContain('one-page PDF cannot be gated');
    expect(linkedInDocumentGatedWarning(false)).toBe('');
  });
});

describe('linkedInDocumentDraftFromStored', () => {
  it.each([
    [
      { assetId: PDF, assetBriefId: 'b-1', title: 'T', introText: 'I' },
      { assetId: PDF, assetBriefId: 'b-1', title: 'T', introText: 'I' },
    ],
    [
      { assetId: 7, title: null },
      { assetId: '', assetBriefId: '', title: '', introText: '' },
    ],
    [null, undefined],
    [[draft()], undefined],
  ])('restores %o as %o', (stored, expected) => {
    expect(linkedInDocumentDraftFromStored(stored)).toEqual(expected);
  });
});
