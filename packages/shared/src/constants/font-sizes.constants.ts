// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX typography scale for consistent font sizing across the application
 * @description Standard font size tokens that map to rem values for responsive design
 * @readonly
 * @example
 * // Use in CSS-in-JS or Tailwind configuration
 * const textSize = lfxFontSizes.lg; // '1.125rem'
 *
 * // In styled components
 * const Heading = styled.h1`
 *   font-size: ${lfxFontSizes['2xl']};
 * `;
 */
export const lfxFontSizes = {
  /** Extra extra small text (10px) - for fine print, captions */
  '2xs': '0.625rem',
  /** Extra small text (12px) - for labels, small UI text */
  xs: '0.75rem',
  /** Small text (14px) - for secondary text, descriptions */
  sm: '0.875rem',
  /** Base text size (16px) - default body text size */
  base: '1rem',
  /** Large text (18px) - for emphasized text */
  lg: '1.125rem',
  /** Extra large text (20px) - for large body text */
  xl: '1.25rem',
  /** 2x large text (24px) - for small headings */
  '2xl': '1.5rem',
  /** 3x large text (32px) - for medium headings */
  '3xl': '2rem',
  /** 4x large text (40px) - for large headings */
  '4xl': '2.5rem',
};
