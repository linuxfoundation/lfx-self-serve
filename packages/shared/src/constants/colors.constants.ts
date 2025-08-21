// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX brand color palette and design tokens
 * @description Complete color system including brand colors, semantic colors, and neutral tones
 * @readonly
 * @example
 * // Use in CSS-in-JS or styled components
 * const Button = styled.button`
 *   background-color: ${lfxColors.brand[500]};
 *   color: ${lfxColors.white};
 * `;
 */
export const lfxColors = {
  /** Transparent color value */
  transparent: 'transparent',
  /** Pure white (#ffffff) */
  white: '#ffffff',
  /** Pure black (#000000) */
  black: '#000000',

  /** Default text color */
  text: '#000000',
  /** Default background color */
  background: '#D7DEE8',

  /** LFX brand color scale - primary blue palette */
  brand: {
    /** Darkest brand color - for high contrast text */
    900: '#000816',
    /** Very dark brand color */
    800: '#002648',
    /** Dark brand color */
    700: '#004880',
    /** Medium-dark brand color */
    600: '#006DBE',
    /** Primary brand color - LFX blue */
    500: '#0094FF',
    /** Light brand color */
    400: '#54ABFF',
    /** Lighter brand color */
    300: '#83C1FF',
    /** Very light brand color */
    200: '#ADD6FF',
    /** Extra light brand color */
    100: '#D6EBFF',
    /** Lightest brand color - for backgrounds */
    50: '#EBF5FF',
  },

  /** Neutral gray scale for text, borders, and backgrounds */
  neutral: {
    /** Darkest neutral - for primary text */
    900: '#0F172A',
    /** Very dark neutral */
    800: '#0F172A',
    /** Dark neutral - for secondary text */
    700: '#334155',
    /** Medium-dark neutral */
    600: '#475569',
    /** Medium neutral - for placeholder text */
    500: '#64748B',
    /** Light neutral - for disabled text */
    400: '#94A3B8',
    /** Lighter neutral - for borders */
    300: '#CBD5E1',
    /** Very light neutral - for subtle borders */
    200: '#E2E8F0',
    /** Extra light neutral - for backgrounds */
    100: '#F1F5F9',
    /** Lightest neutral - for page backgrounds */
    50: '#F8FAFC',
  },

  /** Positive/success color scale - green palette */
  positive: {
    /** Darkest positive color */
    900: '#064E3B',
    /** Very dark positive color */
    800: '#065F46',
    /** Dark positive color */
    700: '#047857',
    /** Medium-dark positive color */
    600: '#059669',
    /** Primary positive color - for success states */
    500: '#10B981',
    /** Light positive color */
    400: '#34D399',
    /** Lighter positive color */
    300: '#6EE7B7',
    /** Very light positive color */
    200: '#A7F3D0',
    /** Extra light positive color */
    100: '#D1FAE5',
    /** Lightest positive color - for backgrounds */
    50: '#ECFDF5',
  },

  /** Negative/error color scale - red palette */
  negative: {
    /** Darkest negative color */
    900: '#7F1D1D',
    /** Very dark negative color */
    800: '#991B1B',
    /** Dark negative color */
    700: '#B91C1C',
    /** Medium-dark negative color */
    600: '#DC2626',
    /** Primary negative color - for error states */
    500: '#EF4444',
    /** Light negative color */
    400: '#F87171',
    /** Lighter negative color */
    300: '#FCA5A5',
    /** Very light negative color */
    200: '#FECACA',
    /** Extra light negative color */
    100: '#FEE2E2',
    /** Lightest negative color - for backgrounds */
    50: '#FEF2F2',
  },

  /** Warning/caution color scale - orange palette */
  warning: {
    /** Darkest warning color */
    900: '#78350F',
    /** Very dark warning color */
    800: '#92400E',
    /** Dark warning color */
    700: '#B45309',
    /** Medium-dark warning color */
    600: '#D97706',
    /** Primary warning color - for warning states */
    500: '#F59E0B',
    /** Light warning color */
    400: '#FBBF24',
    /** Lighter warning color */
    300: '#FCD34D',
    /** Very light warning color */
    200: '#FDE68A',
    /** Extra light warning color */
    100: '#FEF3C7',
    /** Lightest warning color - for backgrounds */
    50: '#FFFBEB',
  },

  /** Violet/purple color scale - for accent and highlights */
  violet: {
    /** Darkest violet color */
    900: '#4c1d95',
    /** Very dark violet color */
    800: '#5b21b6',
    /** Dark violet color */
    700: '#6d28d9',
    /** Medium-dark violet color */
    600: '#7c3aed',
    /** Primary violet color */
    500: '#8E51FF',
    /** Light violet color */
    400: '#a78bfa',
    /** Lighter violet color */
    300: '#c4b5fd',
    /** Very light violet color */
    200: '#ddd6fe',
    /** Extra light violet color */
    100: '#ede9fe',
    /** Lightest violet color - for backgrounds */
    50: '#f5f3ff',
  },
  /** Special yellow accent color */
  yellow: '#FFD6A7',
};
