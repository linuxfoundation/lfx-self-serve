// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NullifyEmptyStrings } from '../interfaces/object.interface';

/**
 * Recursively replaces empty / whitespace-only strings with `null` throughout a
 * value. Useful when sending payloads to APIs that reject `""` on validated
 * fields but accept `null`. Non-string primitives, arrays, and plain objects are
 * walked; non-plain objects (Date, Map, Set, class instances, etc.) are returned
 * unchanged so their prototype is preserved. The original value is not mutated.
 *
 * @param value - The value to sanitize (object, array, or primitive)
 * @returns A new value with empty strings replaced by `null`
 */
export function nullifyEmptyStrings<T>(value: T): NullifyEmptyStrings<T> {
  if (value === null || value === undefined) return value as NullifyEmptyStrings<T>;
  if (typeof value === 'string') {
    const nullIfBlank = value.trim() === '' ? null : value;
    return nullIfBlank as NullifyEmptyStrings<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => nullifyEmptyStrings(item)) as NullifyEmptyStrings<T>;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value as NullifyEmptyStrings<T>;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Use defineProperty to bypass setters (e.g. __proto__) and prevent prototype pollution
      // when keys come from untrusted sources like JSON.parse.
      Object.defineProperty(result, key, {
        value: nullifyEmptyStrings(val),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return result as NullifyEmptyStrings<T>;
  }
  return value as NullifyEmptyStrings<T>;
}
