// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LFX_DOCUMENT_TITLE_BRAND, LFX_DOCUMENT_TITLE_DOCS_BRAND, LFX_DOCUMENT_TITLE_SEPARATOR } from '../constants/document-title.constants';

/**
 * Formats a page name into the document title shown in tabs, history, and analytics.
 *
 * Already-branded values (the profile/docs `setTitle` callers, or a route that opted into the
 * full string) are returned unchanged so we never produce `Page · LFX · LFX`.
 */
export function formatLfxDocumentTitle(page: string | null | undefined): string {
  const trimmed = page?.trim() ?? '';
  if (!trimmed || trimmed === LFX_DOCUMENT_TITLE_BRAND) {
    return LFX_DOCUMENT_TITLE_BRAND;
  }
  if (trimmed === LFX_DOCUMENT_TITLE_DOCS_BRAND) {
    return trimmed;
  }
  if (trimmed.endsWith(`${LFX_DOCUMENT_TITLE_SEPARATOR}${LFX_DOCUMENT_TITLE_BRAND}`)) {
    return trimmed;
  }
  if (trimmed.endsWith(`${LFX_DOCUMENT_TITLE_SEPARATOR}${LFX_DOCUMENT_TITLE_DOCS_BRAND}`)) {
    return trimmed;
  }
  return `${trimmed}${LFX_DOCUMENT_TITLE_SEPARATOR}${LFX_DOCUMENT_TITLE_BRAND}`;
}
