// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX color palette synced with @linuxfoundation/lfx-ui-core primitives
 * @description Complete color system using Tailwind naming conventions
 * @readonly
 */
export const lfxColors = {
  /** Transparent color value */
  transparent: 'transparent',
  /** Pure white (#FFFFFF) */
  white: '#FFFFFF',
  /** Pure black (#000000) */
  black: '#000000',

  /** Blue color scale - primary/brand color (from lfx-ui-core) */
  blue: {
    50: '#F8FBFF',
    100: '#ECF4FF',
    200: '#D9E9FF',
    300: '#B8D9FF',
    400: '#85C2FF',
    500: '#009AFF',
    600: '#0082D9',
    700: '#0061A3',
    800: '#00426F',
    900: '#002741',
    950: '#001321',
  },

  /** Gray color scale - neutral tones (from lfx-ui-core) */
  gray: {
    50: '#F9FAFB',
    100: '#EBEDF0',
    200: '#DEE1E6',
    300: '#C8CCD4',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
    950: '#030712',
  },

  /** Emerald color scale - success/positive states (from lfx-ui-core) */
  emerald: {
    50: '#F7FCFA',
    100: '#EBFAF4',
    200: '#D7F4E9',
    300: '#B0EBDA',
    400: '#70DEC3',
    500: '#10BC8A',
    600: '#0EA175',
    700: '#0B7B59',
    800: '#085440',
    900: '#053227',
    950: '#021912',
  },

  /** Red color scale - error/negative states (from lfx-ui-core) */
  red: {
    50: '#FFFAFA',
    100: '#FEF0F0',
    200: '#FCDADA',
    300: '#FAB7B7',
    400: '#F68E8E',
    500: '#EF4444',
    600: '#D13939',
    700: '#A82E2E',
    800: '#7C2424',
    900: '#4B1919',
    950: '#2C0707',
  },

  /** Amber color scale - warning/caution states (from lfx-ui-core) */
  amber: {
    50: '#FFFCF8',
    100: '#FFF5E8',
    200: '#FEEACB',
    300: '#FDD594',
    400: '#FBB65A',
    500: '#F89E22',
    600: '#DB851C',
    700: '#AD6816',
    800: '#834F10',
    900: '#4D2F09',
    950: '#2E1B04',
  },

  /** Violet color scale - accent/highlights (from lfx-ui-core) */
  violet: {
    50: '#FDFAFF',
    100: '#F9F0FF',
    200: '#F1E3FF',
    300: '#E2CCFF',
    400: '#CCA7FF',
    500: '#9B5CF7',
    600: '#834AD4',
    700: '#6438A3',
    800: '#472672',
    900: '#2C1845',
    950: '#160C22',
  },
};
