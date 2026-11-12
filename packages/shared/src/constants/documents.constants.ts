// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TagSeverity } from '../interfaces/components.interface';
import { MyDocumentSource } from '../interfaces/my-document.interface';
import { DocumentKind, DocumentKindTag, ProjectDocumentType } from '../interfaces/project.interface';

/** Label constant for the documents feature — follows the existing COMMITTEE_LABEL, MAILING_LIST_LABEL pattern. */
export const DOCUMENT_LABEL = { singular: 'Document', plural: 'Documents' };

/** Group and project document types a writer can delete from the Documents tab. */
export const DOCUMENT_DELETE_TYPES: readonly ProjectDocumentType[] = ['file', 'link', 'folder'];

/**
 * Group document types a writer can delete. Folders are left out for now: the committee service's folder delete only
 * rejects a folder holding links, and the BFF can't see a just-uploaded file through the query index, so a folder with a
 * file in it could be deleted. Add 'folder' back (use DOCUMENT_DELETE_TYPES) once a committee service release with
 * linuxfoundation/lfx-v2-committee-service#277, which rejects a folder holding documents, is deployed.
 */
export const COMMITTEE_DOCUMENT_DELETE_TYPES: readonly ProjectDocumentType[] = ['file', 'link'];

/** Upstream path segment each group/project document type lives under (`/committees/{id}/folders/{uid}`, `/projects/{id}/documents/{uid}`). */
export const DOCUMENT_UPSTREAM_PATH_SEGMENTS: Record<ProjectDocumentType, string> = {
  folder: 'folders',
  link: 'links',
  file: 'documents',
};

/** Shown instead of deleting a folder that still holds links or files; shared so the UI and the BFF say the same thing. */
export const DOCUMENT_FOLDER_NOT_EMPTY_MESSAGE = 'This folder still has documents in it. Delete or move them before deleting the folder.';

/**
 * Source types that are grouped under the "Meeting" filter option.
 * File attachments, recordings, transcripts, and summaries are all
 * produced by meetings and should match when filtering by 'meeting'.
 */
export const MEETING_GROUP_SOURCES: MyDocumentSource[] = ['file', 'recording', 'transcript', 'summary'];

/** Sources whose name is the meeting's own (e.g. "Recording", the meeting topic), so every occurrence reads the same without its date. */
export const MEETING_DATED_NAME_SOURCES: MyDocumentSource[] = ['recording', 'transcript', 'summary'];

/** Tag configuration for each My Documents source type. */
export const MY_DOCUMENT_SOURCE_TAGS: Record<MyDocumentSource, { value: string; severity: TagSeverity; icon: string; iconClass: string }> = {
  link: { value: 'Link', severity: 'success', icon: 'fa-light fa-link', iconClass: 'text-gray-400' },
  file: { value: 'File', severity: 'info', icon: 'fa-light fa-file', iconClass: 'text-gray-400' },
  committee: { value: 'Group', severity: 'info', icon: 'fa-light fa-users', iconClass: 'text-gray-400' },
  meeting: { value: 'Meeting', severity: 'secondary', icon: 'fa-light fa-calendar', iconClass: 'text-gray-400' },
  recording: { value: 'Meeting', severity: 'secondary', icon: 'fa-light fa-video', iconClass: 'text-gray-400' },
  transcript: { value: 'Meeting', severity: 'secondary', icon: 'fa-light fa-file-lines', iconClass: 'text-gray-400' },
  summary: { value: 'Meeting', severity: 'secondary', icon: 'fa-light fa-list-check', iconClass: 'text-gray-400' },
  mailing_list: { value: 'Mailing List', severity: 'warn', icon: 'fa-light fa-envelope', iconClass: 'text-gray-400' },
  project: { value: 'Project', severity: 'accent', icon: 'fa-light fa-folder', iconClass: 'text-gray-400' },
};

/** Sources that already say what the document is, for rows that don't carry an explicit `documentKind`. */
export const DOCUMENT_KIND_BY_SOURCE: Partial<Record<MyDocumentSource, DocumentKind>> = {
  file: 'file',
  link: 'link',
  recording: 'recording',
  transcript: 'transcript',
  summary: 'summary',
};

/**
 * Label bubble and name-column icon, keyed by what the document is. Folders are not a kind: they keep
 * their own amber folder icon, so a file or link inside a folder shows its own icon, not a folder.
 * The file icon here is the generic fallback; the pipe swaps in a MIME-specific one (PDF, Word, ...).
 */
export const DOCUMENT_KIND_TAGS: Record<DocumentKind, DocumentKindTag> = {
  file: { value: 'File', severity: 'info', icon: 'fa-light fa-file' },
  link: { value: 'Link', severity: 'success', icon: 'fa-light fa-link' },
  recording: { value: 'Recording', severity: 'secondary', icon: 'fa-light fa-video' },
  transcript: { value: 'Transcript', severity: 'secondary', icon: 'fa-light fa-file-lines' },
  summary: { value: 'Summary', severity: 'secondary', icon: 'fa-light fa-list-check' },
};
