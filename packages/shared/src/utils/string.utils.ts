// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Validates if a string is a valid UUID (v1-v5 format)
 * @param value - The string to validate
 * @returns true if the string is a valid UUID, false otherwise
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Parse a value to integer, handling both string and number inputs.
 * Useful for v1 meetings which return numeric fields as strings.
 * @param value - The value to parse (string or number)
 * @returns The parsed integer, or undefined if the value is undefined, null, or cannot be parsed
 */
export function parseToInt(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}
