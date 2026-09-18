// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256.utils';

/**
 * A hand-written digest is only worth anything if it agrees with every other SHA-256, so this is
 * checked two ways: against the published vectors, and differentially against Node's own
 * implementation. `node:crypto` is imported HERE and not in the util, because the util also runs in
 * the browser — the test does not have that constraint.
 */
describe('sha256Hex', () => {
  it.each([
    ['empty string', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'the two-block NIST vector',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the published vector for %s', (_label, input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('agrees with node:crypto across the block boundary', () => {
    // 55, 56 and 64 bytes are where padding decisions change: 56 is the first length that forces a
    // second block, and 64 is an exact block. An implementation that pads only single-block inputs
    // passes 'abc' and fails here.
    for (let length = 0; length <= 130; length++) {
      const input = 'a'.repeat(length);
      expect(sha256Hex(input), `length ${length}`).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });

  it('encodes non-BMP characters the same way node does', () => {
    // A `charCodeAt` loop would split the surrogate pair and produce a digest nothing else agrees
    // with. Auth0 subjects are ASCII, but this util is now shared and the next caller may not be.
    const input = 'user 😀 café 日本語';

    expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
  });

  it('returns 64 lowercase hex characters, zero-padded', () => {
    // The leading word of this input's digest starts with a zero nibble, which a `toString(16)`
    // without padding would silently drop, shortening the whole string by one character.
    expect(sha256Hex('a'.repeat(1000))).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls', () => {
    // The only property the storage-key caller actually depends on.
    expect(sha256Hex('auth0|abc123')).toBe(sha256Hex('auth0|abc123'));
  });
});
