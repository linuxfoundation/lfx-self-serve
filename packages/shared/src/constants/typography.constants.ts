// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX typography system for consistent font styling across the application
 * @description Complete typography scale including font families, sizes, weights, and line heights
 * @readonly
 * @example
 * // Use in Tailwind configuration
 * import { lfxTypography } from '@lfx-one/shared';
 *
 * // Access typography scale
 * const headingSize = lfxTypography.scale.h1.size; // '1.25rem'
 *
 * // Use in components
 * const MyComponent = () => (
 *   <h1 className={lfxTypography.patterns.heading}>Title</h1>
 * );
 */
export const lfxTypography = {
  /**
   * Font family definitions for different text contexts
   */
  fontFamily: {
    /** Primary sans-serif font for UI and body text */
    sans: "'Inter', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    /** Display font for headings (currently Inter) */
    display: "'Inter', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    /** Monospace font for code and technical content */
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },

  /**
   * Font weight values for consistent typography
   */
  fontWeight: {
    /** Normal weight - 400 */
    normal: 400,
    /** Medium weight - 500 */
    medium: 500,
    /** Semibold weight - 600 */
    semibold: 600,
  },

  /**
   * Line height values for consistent vertical rhythm
   */
  lineHeight: {
    /** Normal line height - 1.5 (150%) */
    normal: 1.5,
    /** Relaxed line height - 1.75 (175%) */
    relaxed: 1.75,
  },

  /**
   * Typography scale for HTML elements
   * Defines font size, weight, and line height for each element type
   */
  scale: {
    /** H1 heading - 20px / text-xl / semibold */
    h1: {
      size: '1.25rem',
      weight: 600,
      lineHeight: 1.5,
    },
    /** H2 heading - 18px / text-lg / normal */
    h2: {
      size: '1.125rem',
      weight: 400,
      lineHeight: 1.5,
    },
    /** H3 heading - 16px / text-base / normal */
    h3: {
      size: '1rem',
      weight: 400,
      lineHeight: 1.5,
    },
    /** H4 heading - 14px / text-sm / normal */
    h4: {
      size: '0.875rem',
      weight: 400,
      lineHeight: 1.5,
    },
    /** H5 heading - 14px / text-sm / normal */
    h5: {
      size: '0.875rem',
      weight: 400,
      lineHeight: 1.5,
    },
    /** H6 heading - 14px / text-sm / normal */
    h6: {
      size: '0.875rem',
      weight: 400,
      lineHeight: 1.5,
    },
    /** Paragraph - 16px / text-base / normal */
    p: {
      size: '1rem',
      weight: 400,
      lineHeight: 1.5,
    },
    /** Label - 16px / text-base / medium */
    label: {
      size: '1rem',
      weight: 500,
      lineHeight: 1.5,
    },
    /** Button - 14px / text-sm / medium */
    button: {
      size: '0.875rem',
      weight: 500,
      lineHeight: 1.5,
    },
    /** Input field - 14px / text-sm / normal */
    input: {
      size: '0.875rem',
      weight: 400,
      lineHeight: 1.5,
    },
  },

  /**
   * Reusable typography patterns as Tailwind utility class strings
   * Use these for consistent styling across components
   */
  patterns: {
    /** Heading pattern - semibold with normal line height */
    heading: 'font-semibold leading-normal',
    /** Body text pattern - normal weight with normal line height */
    body: 'font-normal leading-normal',
    /** Label pattern - medium weight with normal line height */
    label: 'font-medium leading-normal',
    /** Small text pattern - normal weight with normal line height */
    small: 'text-sm font-normal leading-normal',
    /** Emphasized text - medium weight */
    emphasized: 'font-medium',
  },
};
