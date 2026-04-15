// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TagSeverity } from '../interfaces/components.interface';
import { MyDocumentSource } from '../interfaces/my-document.interface';

/** Label constant for the documents feature — follows the existing COMMITTEE_LABEL, MAILING_LIST_LABEL pattern. */
export const DOCUMENT_LABEL = { singular: 'Document', plural: 'Documents' };

/** Tag configuration for each My Documents source type. */
export const MY_DOCUMENT_SOURCE_TAGS: Record<MyDocumentSource, { value: string; severity: TagSeverity; icon: string; iconClass: string }> = {
  link: { value: 'Link', severity: 'success', icon: 'fa-light fa-link', iconClass: 'text-gray-400' },
  meeting: { value: 'Meeting', severity: 'danger', icon: 'fa-light fa-calendar', iconClass: 'text-gray-400' },
  file: { value: 'File', severity: 'info', icon: 'fa-light fa-file', iconClass: 'text-gray-400' },
  recording: { value: 'Meeting', severity: 'danger', icon: 'fa-solid fa-circle-play', iconClass: 'text-red-500' },
  transcript: { value: 'Meeting', severity: 'secondary', icon: 'fa-light fa-file-lines', iconClass: 'text-gray-400' },
  summary: { value: 'Meeting', severity: 'secondary', icon: 'fa-light fa-list-check', iconClass: 'text-gray-400' },
  mailing_list: { value: 'Mailing List', severity: 'warn', icon: 'fa-light fa-envelope', iconClass: 'text-gray-400' },
};
