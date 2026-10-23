// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Existing private artifact purpose; namespaced separately from immutable revisions. */
export const MKTG_DOCUMENT_COMMENTS_PREFIX = 'document-comments';
export const MKTG_DOCUMENT_COMMENTS_SCHEMA = 'mktg-document-comments/v1';
/** Agent form-schema limits, not a new agent catalog or ordering. */
export const MKTG_DOCUMENT_COMMENT_LIMITS = { 'foundation-message': 30, 'brand-kit': 30, boilerplates: 20 } as const;
export const MKTG_DOCUMENT_COMMENT_MAX_CHARS = 4000;
export const MKTG_DOCUMENT_COMMENT_STATUSES = ['open', 'sent', 'resolved'] as const;
export const MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES = ['reserved', 'started', 'completed', 'failed', 'uncertain'] as const;
export const MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS = ['field', 'passage'] as const;
export const MKTG_DOCUMENT_COMMENT_ANCHOR_MAX_CHARS = 512;
export const MKTG_DOCUMENT_COMMENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
/** Only dotted properties and canonical nonnegative array indexes; never arbitrary JS. */
export const MKTG_DOCUMENT_COMMENT_PATH_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(?:(?:\.[a-zA-Z][a-zA-Z0-9_]*)|(?:\[(?:0|[1-9][0-9]*)\]))*$/;
export const MKTG_DOCUMENT_COMMENT_PATH_PART_REGEX = /[a-zA-Z][a-zA-Z0-9_]*|[0-9]+/g;
export const MKTG_DOCUMENT_COMMENT_UNSAFE_PARTS = ['__proto__', 'prototype', 'constructor'] as const;
export const MKTG_DOCUMENT_COMMENT_ROOTS = {
  'foundation-message': ['mf', 'icp', 'mh', 'nums'],
  'brand-kit': ['kit', 'chapters'],
  boilerplates: ['bp'],
} as const;
export const MKTG_BOILERPLATES_COMMENT_FIELD_REGEX = /^bp(?:\[[0-3]\](?:\.t)?)?$/;
