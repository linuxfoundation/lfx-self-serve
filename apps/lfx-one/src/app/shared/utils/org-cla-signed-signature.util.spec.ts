// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_SIGNED_SIGNATURE_KEY } from '@lfx-one/shared/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stashSignedSignatureId, takeStashedSignedSignatureId } from './org-cla-signed-signature.util';

describe('the signed-signature stash', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('carries the signature across the trip', () => {
    stashSignedSignatureId('signature-uuid-1');

    expect(takeStashedSignedSignatureId()).toBe('signature-uuid-1');
  });

  // Single-use by construction rather than by the caller remembering to clean up. Left behind, it
  // would send the next ordinary visit to the list into a detail page nobody asked for.
  it('is spent by the read, so a second visit finds nothing', () => {
    stashSignedSignatureId('signature-uuid-1');
    takeStashedSignedSignatureId();

    expect(takeStashedSignedSignatureId()).toBe('');
    expect(sessionStorage.getItem(ORG_CLA_SIGNED_SIGNATURE_KEY)).toBeNull();
  });

  /**
   * Storage access throws outright where it is disabled or the origin is denied it — Safari's
   * private mode and a locked-down enterprise profile both do this.
   *
   * The write happens after EasyCLA has created the signature and the DocuSign envelope, and
   * before the hand-off dialog releases the signatory. An exception there strands them holding an
   * agreement that already exists, to save a convenience worth one click.
   */
  it('lets the hand-off continue when the browser refuses to store anything', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(() => stashSignedSignatureId('signature-uuid-1')).not.toThrow();
  });

  it('reads as no signature when the browser refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(takeStashedSignedSignatureId()).toBe('');
  });

  /**
   * A policy-denied `Window.sessionStorage` getter throws `SecurityError` from the getter itself,
   * not from `setItem`/`getItem`. `typeof sessionStorage` triggers that getter, so the probe has to
   * be inside the try. Otherwise the constructor read that both functions do would drag the whole
   * EasyCLA page down instead of falling back to the list.
   */
  it('lets the hand-off continue when the storage getter itself throws', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access denied by policy.', 'SecurityError');
      },
    });

    try {
      expect(() => stashSignedSignatureId('signature-uuid-1')).not.toThrow();
      expect(takeStashedSignedSignatureId()).toBe('');
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'sessionStorage', originalDescriptor);
      } else {
        delete (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage;
      }
    }
  });
});
