// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * T-shirt size options for profile forms and swag distribution.
 * Values mirror the v1 Salesforce picklist so v2→v1 sync round-trips cleanly.
 */
export const TSHIRT_SIZES = [
  { label: 'Fitted-Cut Small', value: 'Fitted-Cut Small' },
  { label: 'Fitted-Cut Medium', value: 'Fitted-Cut Medium' },
  { label: 'Fitted-Cut Large', value: 'Fitted-Cut Large' },
  { label: 'Fitted-Cut XL', value: 'Fitted-Cut XL' },
  { label: 'Fitted-Cut 2XL', value: 'Fitted-Cut 2XL' },
  { label: 'Straight-Cut Small', value: 'Straight-Cut Small' },
  { label: 'Straight-Cut Medium', value: 'Straight-Cut Medium' },
  { label: 'Straight-Cut Large', value: 'Straight-Cut Large' },
  { label: 'Straight-Cut XL', value: 'Straight-Cut XL' },
  { label: 'Straight-Cut 2XL', value: 'Straight-Cut 2XL' },
  { label: 'Straight-Cut 3XL', value: 'Straight-Cut 3XL' },
] as const;

/**
 * Type for T-shirt size values
 */
export type TShirtSize = (typeof TSHIRT_SIZES)[number]['value'];

/**
 * Coerce a stored t-shirt size into one of the current valid options.
 * Returns '' for nullish, empty, or unrecognised values — used to drop
 * legacy values when loading a stored profile, so the form never re-submits
 * a size that would fail validation.
 */
export function normalizeTShirtSize(value: string | null | undefined): TShirtSize | '' {
  if (!value) return '';
  const match = TSHIRT_SIZES.find((s) => s.value === value);
  return match ? match.value : '';
}
