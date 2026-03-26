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
 * Wraps a text string into multiple lines, breaking on word boundaries.
 * Used to produce multi-line Chart.js axis labels (which accept `string[]`).
 * @param text - The label text to wrap
 * @param maxWidth - Maximum character width per line
 * @returns Array of line strings
 */
export function wrapLabel(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
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
