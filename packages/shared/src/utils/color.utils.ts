// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Validates hex color string format
 * @param hex - Hex color string (e.g., "#FFFFFF" or "#FFF")
 * @returns True if valid hex color format
 */
export function isValidHexColor(hex: string): boolean {
  // Match 3-digit or 6-digit hex color with # prefix
  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexRegex.test(hex);
}

/**
 * Converts hex color to rgba format with validation
 * @param hex - Hex color string (e.g., "#FFFFFF" or "#FFF")
 * @param alpha - Alpha/opacity value (0-1)
 * @returns RGBA color string
 * @throws Error if hex format is invalid or alpha is out of range
 *
 * @example
 * ```ts
 * hexToRgba('#FF0000', 0.5) // Returns 'rgba(255, 0, 0, 0.5)'
 * hexToRgba('#F00', 1) // Returns 'rgba(255, 0, 0, 1)'
 * ```
 */
export function hexToRgba(hex: string, alpha: number): string {
  // Validate hex format
  if (!isValidHexColor(hex)) {
    throw new Error(`Invalid hex color format: ${hex}.`);
  }

  // Validate alpha range
  if (alpha < 0 || alpha > 1) {
    throw new Error(`Alpha value must be between 0 and 1, got: ${alpha}`);
  }

  // Remove # prefix
  let hexValue = hex.slice(1);

  // Convert 3-digit hex to 6-digit
  if (hexValue.length === 3) {
    hexValue = hexValue
      .split('')
      .map((char) => char + char)
      .join('');
  }

  // Parse RGB values
  const r = parseInt(hexValue.slice(0, 2), 16);
  const g = parseInt(hexValue.slice(2, 4), 16);
  const b = parseInt(hexValue.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
