// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * T-shirt size options for profile forms and swag distribution
 */
export const TSHIRT_SIZES = [
  { label: 'Extra Small', value: 'XS' },
  { label: 'Small', value: 'S' },
  { label: 'Medium', value: 'M' },
  { label: 'Large', value: 'L' },
  { label: 'Extra Large', value: 'XL' },
  { label: 'XXL', value: 'XXL' },
  { label: 'XXXL', value: 'XXXL' },
] as const;

/**
 * Type for T-shirt size values
 */
export type TShirtSize = (typeof TSHIRT_SIZES)[number]['value'];
