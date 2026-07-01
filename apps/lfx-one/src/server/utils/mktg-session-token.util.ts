// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac } from 'node:crypto';

import { constantTimeEquals } from './security.util';

// Stateless owner tokens for Marketing OS chat sessions (LFXAI-97). A token binds
// a Guild session to the user who created it, so only that user can post
// follow-up messages (history reads stay open to any Marketing-permitted user).
// The token is HMAC-SHA256(`${userId}:${sessionId}`) — no server-side storage, so
// it survives restarts and works across multiple SSR pods. Reuses the app session
// secret (PCC_AUTH0_SECRET) rather than introducing a new one.

/** Signing key — the app session secret (same default as the auth config). */
function signingSecret(): string {
  return process.env['PCC_AUTH0_SECRET'] || 'sufficiently-long-string';
}

/**
 * Create an opaque owner token binding `sessionId` to its creator `userId`.
 * Returned to the browser on session creation and replayed on follow-up.
 */
export function createSessionOwnerToken(userId: string, sessionId: string): string {
  return createHmac('sha256', signingSecret()).update(`${userId}:${sessionId}`).digest('hex');
}

/**
 * Verify that `userId` is the creator of `sessionId`. Recomputes the token and
 * compares in constant time. Returns false on any missing input or mismatch —
 * a different user can't produce a matching token without the signing secret.
 */
export function verifySessionOwnerToken(token: string | null | undefined, userId: string, sessionId: string): boolean {
  if (!token) {
    return false;
  }
  return constantTimeEquals(token, createSessionOwnerToken(userId, sessionId));
}
