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
 * Converts arbitrary label text into a kebab-case, testid-safe slug (lowercase,
 * alphanumerics only, words joined by single hyphens).
 * @param text - The label text to slugify
 * @returns A kebab-case slug, e.g. "Meetings Attended" -> "meetings-attended"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
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

/**
 * Convert a hyphen- or space-separated string to Title Case.
 * Example: `toTitleCase('executive-director')` → `'Executive Director'`.
 */
export function toTitleCase(value: string): string {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Stable 0/1 parity for zebra-striping by row identity (not list position): positional
 * `index % 2` flips when a list filters and produces a `transition-colors` cross-fade on rows
 * the user didn't touch. Trade-off: adjacency isn't guaranteed alternating.
 */
export function stableKeyParity(key: string): 0 | 1 {
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return (sum & 1) as 0 | 1;
}

/** Best-effort split of a display name into [firstName, lastName]; `null` parts when nothing usable (e.g. an email used as the name). */
export function splitDisplayName(name: string | null): [string | null, string | null] {
  const trimmed = (name ?? '').trim();
  if (!trimmed || trimmed.includes('@')) {
    return [null, null];
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return [parts[0], null];
  }
  return [parts[0], parts.slice(1).join(' ')];
}
