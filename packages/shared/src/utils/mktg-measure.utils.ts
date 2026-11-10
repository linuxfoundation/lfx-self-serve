// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The one format for a measure on a Marketing OS printed page: the figure, a
 * space, the unit (`32 px`, `10 mm`). The record's own prose is brought to
 * it too, so a page never reads "12px" beside "32 px".
 */

/** A measure as the pages print it: `32 px`, `10 mm`. */
export function mktgPortraitMeasure(value: number | string, unit: 'px' | 'mm' | 'pt'): string {
  return `${value} ${unit}`;
}

/** A record's prose with its measures in the pages' one format: "below 12px" → "below 12 px", "10MM" → "10 mm". */
export function mktgPortraitMeasuresInText(text: string): string {
  return text.replace(/(\d)\s*(px|mm|pt)\b/gi, (_match, digit: string, unit: string) => `${digit} ${unit.toLowerCase()}`);
}
