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
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const start = slug.startsWith('-') ? 1 : 0;
  const end = slug.endsWith('-') ? slug.length - 1 : slug.length;
  return slug.slice(start, end);
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

/**
 * Splits plain text (e.g. a textarea-submitted comment) into paragraphs on blank lines.
 * Two or more consecutive line breaks (lines containing only spaces/tabs count as blank)
 * separate paragraphs; single line breaks are preserved inside the paragraph for the
 * template to render (e.g. via `whitespace-pre-line`). Paragraphs are trimmed and empty
 * results dropped, so empty/whitespace-only input returns `[]`.
 * @param text - The raw plain-text input
 * @returns One entry per paragraph, in source order
 */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/(?:\r?\n[ \t]*){2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Count the Unicode code points in a string (like Go's `len([]rune(s))`), so an emoji or
 * non-BMP char counts once where `String.length` would count its two UTF-16 units.
 * @param value - The string to measure
 * @returns The number of Unicode code points
 */
export function codePointLength(value: string): number {
  // The string iterator (via spread) walks by code point, so a surrogate pair counts once.
  return [...value].length;
}

/**
 * Clip `next` to `max` code points by trimming only the region that changed vs `previous`, so a
 * mid-string insertion into a full field drops the excess input rather than unrelated trailing text.
 * @param previous - The last within-cap value (must itself be <= max code points)
 * @param next - The candidate value after an edit
 * @param max - The maximum allowed number of code points
 * @returns `next` unchanged when within the cap, otherwise clipped at the changed region to exactly `max`
 *
 * Known limitation: string-only prefix/suffix diffing can't distinguish a select-all replace from a
 * mid-selection replace, so an over-cap paste-over-selection that coincidentally shares a trailing (or
 * leading) code point with `previous` can displace one boundary code point. The result is still `<= max`
 * code points; a fully faithful fix needs the input's real selection range rather than a `(prev, next)` diff.
 */
export function capCodePointEdit(previous: string, next: string, max: number): string {
  const nextCP = [...next];
  if (nextCP.length <= max) return next;

  const prevCP = [...previous];
  // Common prefix, then common suffix (bounded so prefix and suffix never overlap in either string).
  let prefix = 0;
  while (prefix < prevCP.length && prefix < nextCP.length && prevCP[prefix] === nextCP[prefix]) prefix++;
  let suffix = 0;
  while (suffix < prevCP.length - prefix && suffix < nextCP.length - prefix && prevCP[prevCP.length - 1 - suffix] === nextCP[nextCP.length - 1 - suffix])
    suffix++;

  const allowedInsert = Math.max(0, max - prefix - suffix);
  const head = nextCP.slice(0, prefix);
  const inserted = nextCP.slice(prefix, prefix + allowedInsert);
  const tail = nextCP.slice(nextCP.length - suffix);
  return [...head, ...inserted, ...tail].join('');
}

/**
 * Truncate to at most `max` UTF-16 code units without leaving a lone surrogate behind.
 * @param value - The string to truncate
 * @param max - The maximum number of UTF-16 code units
 * @returns `value` unchanged when within the cap, `''` when `max` is not a positive number, otherwise
 * clipped to `max` units (or `max - 1` when the cut would land inside a surrogate pair)
 *
 * Deliberately measured in UTF-16 units rather than code points, unlike {@link codePointLength} and
 * {@link capCodePointEdit}. That matters where the truncated value is handed to `Validators.maxLength`
 * or a native `maxlength` attribute, both of which count UTF-16 units: truncating by code point would
 * let a string full of emoji pass a code-point cap and still fail the validator on the other side —
 * which, for the meeting composer's agenda, means an invalid form and a Save button that does nothing.
 * Callers whose value never reaches a form control (the AI prompt descriptors) get only the
 * lone-surrogate guarantee above, which is reason enough on its own.
 *
 * Surrogate pairs are the only unit kept whole — a cut can still split a ZWJ sequence or orphan a
 * combining mark. Honouring grapheme clusters would break parity with the UTF-16 counts these caps
 * exist to satisfy.
 */
export function truncateToUtf16Units(value: string, max: number): string {
  if (!(max > 0)) {
    return '';
  }

  if (value.length <= max) {
    return value;
  }

  // A high surrogate at the last kept position means the cut splits a pair; drop it rather than emit
  // an unpaired code unit.
  const lastKept = value.charCodeAt(max - 1);
  const splitsPair = lastKept >= 0xd800 && lastKept <= 0xdbff;

  return value.slice(0, splitsPair ? max - 1 : max);
}

/**
 * Joins labels the way a sentence does — `"A"`, `"A and B"`, `"A, B and C"` — for user-facing copy
 * that names a variable number of fields. A plain `join(' and ')` reads as a chant past two items
 * ("Meeting ID and Email address and First name"), and a plain `join(', ')` drops the conjunction the
 * last item needs.
 *
 * No Oxford comma, matching the rest of the app's copy.
 */
export function joinAsSentenceList(labels: readonly string[]): string {
  if (labels.length < 2) {
    return labels[0] ?? '';
  }

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
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
