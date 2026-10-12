// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure helpers over a Marketing OS agent's generated document (the Markdown
// inside every envelope's `document_markdown`), shared by the run shell and
// anything else that reads a stored document.

import { MKTG_DOCUMENT_STATUS_LABEL_REGEX, MKTG_DOCUMENT_STATUS_LEAD_REGEX } from '../constants/mktg-run.constants';

/**
 * The document's review status, as Paul's agents write it on the cover and
 * above the Review Sheet table: the first status label found, scanning line
 * by line (`Draft — pre-filled`, `Draft — from your documents`,
 * `ED-reviewed — Jane Doe, 2026-10-12`, …), with trailing punctuation and
 * surrounding whitespace removed. Empty when the document carries none — the
 * caller then shows nothing rather than a status the document never stated.
 *
 * A line counts only when the text before the label is Markdown decoration
 * or names the status (`Status: …`, `| Status | … |`), so a mid-sentence
 * "draft — " in prose never reads as the document's status.
 */
export function findMktgDocumentStatus(documentMarkdown: string): string {
  for (const line of documentMarkdown.split(/\r?\n/)) {
    const match = MKTG_DOCUMENT_STATUS_LABEL_REGEX.exec(line);
    if (!match) {
      continue;
    }
    if (!MKTG_DOCUMENT_STATUS_LEAD_REGEX.test(line.slice(0, match.index))) {
      continue;
    }
    return match[1]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\s.,;:]+$/, '');
  }
  return '';
}
