// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_SIGNED_SIGNATURE_KEY } from '@lfx-one/shared/constants';

/**
 * The signature a corporate signing session created, carried across the DocuSign round trip so the
 * signatory returns to the agreement they signed rather than to the list (#1983).
 *
 * `sessionStorage` because nothing lighter survives the trip: the return is a cross-site
 * navigation, so neither an in-memory value nor a history entry's state comes back with it. Scoped
 * to the tab that made the request, which is the tab the signatory returns in.
 *
 * SSR-safe: both functions no-op when `sessionStorage` is unavailable, as the sibling
 * `clearPendingProfileSave` does.
 *
 * Best-effort in both directions, because the whole feature is a convenience and the caller is
 * not. Access throws outright in a browser where storage is disabled or the origin is denied it —
 * Safari's private mode and a locked-down enterprise profile both do this — and the write happens
 * *after* EasyCLA has created the signature and the DocuSign envelope. An exception there would
 * strand the signatory in the hand-off dialog holding an agreement that already exists. Losing the
 * landing costs them one click from the list.
 */
export function stashSignedSignatureId(signatureId: string): void {
  if (typeof sessionStorage === 'undefined') return;

  try {
    sessionStorage.setItem(ORG_CLA_SIGNED_SIGNATURE_KEY, signatureId);
  } catch {
    // Deliberately silent: there is no recovery and nothing for the signatory to do about it.
  }
}

/**
 * Reads the stashed signature and clears it in the same breath.
 *
 * Single-use by construction rather than by the caller remembering to clean up. A signature id
 * left behind is a pointer to a named organization's agreement that outlives the trip it was for,
 * and it would send the *next* visit to the list into a detail page nobody asked for.
 */
export function takeStashedSignedSignatureId(): string {
  if (typeof sessionStorage === 'undefined') return '';

  try {
    const signatureId = sessionStorage.getItem(ORG_CLA_SIGNED_SIGNATURE_KEY) ?? '';
    sessionStorage.removeItem(ORG_CLA_SIGNED_SIGNATURE_KEY);
    return signatureId.trim();
  } catch {
    // Nothing was readable, so there is nothing to spend and nowhere to land: the ordinary list.
    return '';
  }
}
