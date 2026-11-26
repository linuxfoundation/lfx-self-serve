// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_DOCUMENT_LIMITS } from '../constants/campaign.constants';
import type {
  CreativeAssetLibraryState,
  LinkedInCampaignCreateRequest,
  LinkedInDocumentDraft,
  LinkedInDocumentPdfOption,
  LinkedInDocumentView,
} from '../interfaces/campaign.interface';
import { linkedInDocumentRefusal } from './campaign-linkedin-document.utils';
import { linkedInCreativeTextLength } from './campaign-linkedin.utils';

/**
 * The Implement tab's LinkedIn document ad rules (linuxfoundation/lfx-v2-campaign-service#665): the editor's view, the PDF
 * it may pick from the brief's library, the request a document create sends, and why Create waits. The same rules the
 * create route holds a request to (`linkedInDocumentRefusal`), so Create is held rather than refused.
 */

/** A document with nothing picked or typed. */
export function emptyLinkedInDocumentDraft(): LinkedInDocumentDraft {
  return { assetId: '', assetBriefId: '', title: '', introText: '' };
}

/** A stored PDF's label: the library's order and the checksum's start, since campaign-service records no file name. */
function pdfLabel(position: number, checksum: string, byteSize: number): string {
  const kb = Math.max(1, Math.round(byteSize / 1024));
  return `PDF ${position} (${checksum.slice(0, 8)}, ${kb.toLocaleString('en-US')} KB)`;
}

/**
 * The PDFs the picker offers: every PDF stored for the brief, and a held PDF the library does not list kept by id. While
 * a PDF is held, a first "No PDF" option (value `''`) clears it: the select does not re-emit the value it holds, so
 * without it a PDF held for another brief could not be picked again when it is the only one.
 */
export function linkedInDocumentPdfOptions(library: CreativeAssetLibraryState, held: string): LinkedInDocumentPdfOption[] {
  const documents = library.documents ?? [];
  const options = documents.map((document, index) => ({ value: document.id, label: pdfLabel(index + 1, document.checksum, document.byteSize) }));
  if (held !== '' && !documents.some((document) => document.id === held)) options.unshift({ value: held, label: `Stored PDF ${held.slice(0, 8)}` });
  if (held !== '') options.unshift({ value: '', label: 'No PDF (choose again)' });
  return options;
}

/** Why the picker offers nothing, or `''`. The library is not read (`idle`) while the brief is unsaved. */
function pdfNote(library: CreativeAssetLibraryState): string {
  switch (library.status) {
    case 'idle':
      return 'Save the brief to pick or upload its PDF.';
    case 'loading':
      return "Loading the brief's PDFs…";
    case 'error':
      return "Couldn't load the brief's PDFs. Upload the PDF again, or reload the page.";
    case 'ready':
      return (library.documents ?? []).length === 0 ? 'No PDF is stored for this brief yet. Upload one to pick it.' : '';
  }
}

/**
 * What is wrong with the picked PDF, or `''`. Judged against the library only once it was read, and against the brief
 * only while its id is known: the tab has none while a save runs, which is no evidence of another brief.
 */
function assetProblem(draft: LinkedInDocumentDraft, library: CreativeAssetLibraryState, briefId: string): string {
  if (draft.assetId === '' || briefId === '') return '';
  if (draft.assetBriefId !== briefId) return "Stored for a different brief. Choose a PDF from this brief's library.";
  if (library.status !== 'ready') return '';
  return (library.documents ?? []).some((document) => document.id === draft.assetId) ? '' : "No longer in the brief's library. Choose another PDF.";
}

/** The document editor's view: its counters, the error or hint under each field, and the PDF picker. */
export function linkedInDocumentView(draft: LinkedInDocumentDraft, library: CreativeAssetLibraryState, briefId: string): LinkedInDocumentView {
  const { title, introText, recommendedIntroText } = LINKEDIN_DOCUMENT_LIMITS;
  const titleLength = linkedInCreativeTextLength(draft.title);
  const introLength = linkedInCreativeTextLength(draft.introText);
  let introError = '';
  let introHint = '';
  if (introLength > introText) introError = `Keep the intro text to ${introText} characters.`;
  else if (introLength > recommendedIntroText)
    introHint = `LinkedIn recommends about ${recommendedIntroText} characters, so the intro reads in full in the feed.`;
  return {
    titleLength,
    titleError: titleLength > title ? `Keep the title to ${title} characters.` : '',
    introLength,
    introError,
    introHint,
    assetProblem: assetProblem(draft, library, briefId),
    pdfNote: pdfNote(library),
    pdfOptions: linkedInDocumentPdfOptions(library, draft.assetId),
  };
}

/**
 * The request fields a document create sends: the format, the PDF (only one picked for the open brief), the title and
 * the intro text, and no variants.
 */
export function linkedInDocumentFieldsForCreate(
  draft: LinkedInDocumentDraft,
  briefId: string
): Pick<LinkedInCampaignCreateRequest, 'format' | 'documentAssetId' | 'documentTitle' | 'documentIntroText' | 'variants'> {
  return {
    format: 'document',
    documentAssetId: draft.assetBriefId === briefId ? draft.assetId : '',
    documentTitle: draft.title,
    documentIntroText: draft.introText,
    variants: [],
  };
}

/**
 * Why a document create waits, or `null`: no brief id (the PDF is the saved brief's), then a picked PDF that cannot be
 * used (the message is under the picker), then the request the tab would send, with its objective and bidding, checked by
 * `linkedInDocumentRefusal` as the create route will. A save in flight is the caller's to hold first.
 */
export function linkedInDocumentCreateRefusal(
  draft: LinkedInDocumentDraft,
  library: CreativeAssetLibraryState,
  briefId: string,
  sent: { objective?: string | null; bidding?: unknown }
): string | null {
  if (briefId === '') return 'LinkedIn Ads: save the brief, so the document ad can use its PDF.';
  if (assetProblem(draft, library, briefId) !== '') return 'LinkedIn Ads: choose another PDF for the document ad.';
  const request: Record<string, unknown> = { ...linkedInDocumentFieldsForCreate(draft, briefId) };
  if (sent.objective !== undefined && sent.objective !== null) request['objective'] = sent.objective;
  if (sent.bidding !== undefined) request['bidding'] = sent.bidding;
  const refused = linkedInDocumentRefusal(request, true);
  return refused === null ? null : `LinkedIn Ads: ${refused.message}`;
}

/**
 * The warning a gated (lead generation) document shows, or `''` (decision 2026-11-25). LinkedIn needs at least one free
 * preview page before the form, so a one-page PDF cannot be gated; pages cannot be counted reliably here, so this warns
 * and never holds Create.
 */
export function linkedInDocumentGatedWarning(gated: boolean): string {
  return gated
    ? 'A gated document shows its first pages free and asks for the form to read on, so a one-page PDF cannot be gated. Use a PDF of at least two pages.'
    : '';
}

/** A draft's stored document, with every field as text, or `undefined`: a draft is replayed from stored JSON whose inner shape is not validated. */
export function linkedInDocumentDraftFromStored(stored: unknown): LinkedInDocumentDraft | undefined {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const record = stored as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  return { assetId: text(record['assetId']), assetBriefId: text(record['assetBriefId']), title: text(record['title']), introText: text(record['introText']) };
}
