// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DocumentKind, ProjectDocument, ProjectDocumentSource } from '../interfaces/project.interface';

/**
 * Resolves what a project-lens document is, for the label next to its name.
 *
 * Folders get no label. Recordings, transcripts and summaries are named by their source. Everything
 * else is a file or link: the server's `document_kind` wins (meeting attachments and mailing list
 * artifacts are always typed 'link' upstream), otherwise the document's own `type` decides.
 */
export function resolveProjectDocumentKind(doc: ProjectDocument, source: ProjectDocumentSource): DocumentKind | undefined {
  if (doc.type === 'folder') return undefined;
  if (source === 'recording' || source === 'transcript' || source === 'summary') return source;
  return doc.document_kind ?? (doc.type === 'file' ? 'file' : 'link');
}
