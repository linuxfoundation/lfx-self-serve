// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac } from 'node:crypto';

import { constantTimeEquals } from './security.util';

// Stateless owner tokens for Marketing OS sessions (LFXAI-97). A token binds
// what a caller may act on to the user it was issued to: a chat session's id,
// so only its creator can post follow-up messages (history reads stay open to
// any Marketing-permitted user), or a purpose-prefixed binding string that
// names more than the session (Export to Google Slides binds the session to
// the project, document and exact revision it exports, so a poll cannot file
// the deck under another revision). The token is HMAC-SHA256(`${userId}:${binding}`)
// — no server-side storage, so it survives restarts and works across multiple
// SSR pods. Reuses the app session secret (PCC_AUTH0_SECRET) rather than
// introducing a new one.

/** Signing key — the app session secret (same default as the auth config). */
function signingSecret(): string {
  return process.env['PCC_AUTH0_SECRET'] || 'sufficiently-long-string';
}

/**
 * Create an opaque owner token binding `binding` — a Guild session id, or a
 * purpose-prefixed string that includes one — to `userId`. Returned to the
 * browser on session creation and replayed on follow-up.
 */
export function createSessionOwnerToken(userId: string, binding: string): string {
  return createHmac('sha256', signingSecret()).update(`${userId}:${binding}`).digest('hex');
}

/**
 * Verify that the token was issued to `userId` for `binding` (the same value
 * the token was created with). Recomputes the token and compares in constant
 * time. Returns false on any missing input or mismatch — a different user
 * can't produce a matching token without the signing secret.
 */
export function verifySessionOwnerToken(token: string | null | undefined, userId: string, binding: string): boolean {
  if (!token) {
    return false;
  }
  return constantTimeEquals(token, createSessionOwnerToken(userId, binding));
}
