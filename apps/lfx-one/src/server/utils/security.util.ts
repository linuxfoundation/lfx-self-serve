// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { timingSafeEqual } from 'node:crypto';

/**
 * Security utility functions for cryptographic operations and secure comparisons
 */

/**
 * Performs a cryptographically secure constant-time string comparison to prevent timing attacks.
 *
 * This function uses Node.js's native crypto.timingSafeEqual which provides true constant-time
 * comparison at the native level, eliminating JavaScript engine and JIT optimization variance.
 *
 * The comparison runs over the UTF-8 bytes of both inputs directly; no digest is taken first, as
 * `timingSafeEqual` needs only equal-length buffers. Used for meeting passwords and for Marketing OS
 * session owner tokens (HMACs).
 *
 * The constant-time guarantee covers the native byte comparison of equal-length inputs only. On a
 * length mismatch the function returns false after comparing the caller's input against itself, so
 * no byte of `b` is compared; the string-to-buffer conversion and the branch are ordinary
 * JavaScript and make no timing promise about `b`'s length.
 *
 * @param a - First string to compare (e.g., user input)
 * @param b - Second string to compare (e.g., stored secret)
 * @returns true if strings are equal, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = constantTimeEquals(userPassword, storedPassword);
 * ```
 *
 * @security
 * - Compares equal-length inputs with Node.js's native `crypto.timingSafeEqual`, whose time does
 *   not depend on where the first differing byte is
 * - On a length mismatch, compares no byte of `b`
 */
export function constantTimeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  // Handle null/undefined cases - return false if either is null/undefined
  if (a == null || b == null) {
    return false;
  }

  // Convert to strings if not already (defensive programming)
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');

  // timingSafeEqual requires equal lengths. On a mismatch, still run it (against the caller's own
  // input) so a wrong-length guess costs the same as a wrong guess of the right length.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }

  // Use Node.js's native constant-time comparison
  // This is implemented in native code and provides true timing-attack resistance
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validates that a password matches the expected value using cryptographically secure constant-time comparison.
 *
 * This is a convenience wrapper around constantTimeEquals specifically for password validation.
 * Uses Node.js's native timing-safe primitives to provide true security guarantees.
 *
 * @param providedPassword - The password provided by the user
 * @param expectedPassword - The expected password value
 * @returns true if passwords match, false otherwise
 */
export function validatePassword(providedPassword: string | null | undefined, expectedPassword: string | null | undefined): boolean {
  return constantTimeEquals(providedPassword, expectedPassword);
}
