// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GoogleAdsConversionActionOption } from '../interfaces/campaign.interface';

/**
 * The Implement tab's conversion-action picker (#4991) over the free-text `googleConversionActions`
 * value, which stays the one thing the request is built from: one id or resource name per line. The
 * picker reads that text to show what is picked and writes it back, so a create sends exactly the
 * lines the box would hold had the operator typed them.
 */

/**
 * The listed actions the text names — by `id` or `resourceName`, one trimmed line each — in list
 * order.
 */
export function googlePickedConversionActionIds(text: string, actions: readonly GoogleAdsConversionActionOption[]): string[] {
  const lines = new Set(conversionActionLines(text));
  return actions.filter((action) => lines.has(action.id) || lines.has(action.resourceName)).map((action) => action.id);
}

/**
 * The text after the picker changes to `pickedIds`: the picked actions first, in list order, each
 * keeping the line it already had (so a typed resource name is not respelled as an id) or written as
 * its `id`; then every other line, trimmed, including ids the list does not hold. Blank lines are
 * dropped. The request trims each line and drops blanks the same way, so nothing it would send changes.
 */
export function googleConversionActionsTextWithPicked(text: string, pickedIds: readonly string[], actions: readonly GoogleAdsConversionActionOption[]): string {
  const lines = conversionActionLines(text);
  const picked = new Set(pickedIds);
  const listed = actions
    .filter((action) => picked.has(action.id))
    .map((action) => lines.find((line) => line === action.id || line === action.resourceName) ?? action.id);
  const isListed = (line: string): boolean => actions.some((action) => line === action.id || line === action.resourceName);
  return [...listed, ...lines.filter((line) => !isListed(line))].join('\n');
}

/** What the picker shows for one action: its name, its category in words, and whether it is primary. */
export function googleConversionActionLabel(action: GoogleAdsConversionActionOption): string {
  const category = action.category.toLowerCase().replace(/_/g, ' ');
  const words = category === '' ? '' : ` · ${category.charAt(0).toUpperCase()}${category.slice(1)}`;
  return `${action.name}${words}${action.primaryForGoal ? ' · Primary' : ''}`;
}

function conversionActionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
