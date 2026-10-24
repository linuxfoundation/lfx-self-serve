// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_COMMENT_MAX_CHARS } from './mktg-document-comments.constants';

/** Leaves room for the full revision ID and role in bounded CR request IDs. */
export const MKTG_SIGN_OFF_NONCE_REGEX = /^[A-Za-z0-9_-]{1,36}$/;
export const MKTG_SIGN_OFF_NOTE_MAX_CHARS = MKTG_DOCUMENT_COMMENT_MAX_CHARS;
/** Never evict a released nonce to make an old HTTP retry look fresh; exhaustion requires operator follow-up. */
export const MKTG_SIGN_OFF_RELEASED_NONCE_LIMIT = 32;
