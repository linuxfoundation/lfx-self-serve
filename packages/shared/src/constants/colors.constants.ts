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
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    300: '#CAD5E2',
    400: '#90A1B9',
    500: '#62748E',
    600: '#45556C',
    700: '#314158',
    800: '#1D293D',
    900: '#0F172B',
    950: '#030712',
  },

  /** Emerald color scale - success/positive states (from lfx-ui-core) */
  emerald: {
    50: '#ECFDF5',
    100: '#D0FAE5',
    200: '#A4F4CF',
    300: '#5EE9B5',
    400: '#00D492',
    500: '#00BC7D',
    600: '#009966',
    700: '#007A55',
    800: '#006045',
    900: '#004F3B',
    950: '#021912',
  },

  /** Red color scale - error/negative states (from lfx-ui-core) */
  red: {
    50: '#FEF2F2',
    100: '#FFE2E2',
    200: '#FFC9C9',
    300: '#FFA2A2',
    400: '#FF6467',
    500: '#FB2C36',
    600: '#E7000B',
    700: '#C10007',
    800: '#9F0712',
    900: '#82181A',
    950: '#2C0707',
  },

  /** Amber color scale - warning/caution states (from lfx-ui-core) */
  amber: {
    50: '#FFFBEB',
    100: '#FEF3C6',
    200: '#FEE685',
    300: '#FFD230',
    400: '#FFB900',
    500: '#FE9A00',
    600: '#E17100',
    700: '#BB4D00',
    800: '#973C00',
    900: '#7B3306',
    950: '#2E1B04',
  },

  /** Violet color scale - accent/highlights (from lfx-ui-core) */
  violet: {
    50: '#F5F3FF',
    100: '#EDE9FE',
    200: '#DDD6FF',
    300: '#C4B4FF',
    400: '#A684FF',
    500: '#8E51FF',
    600: '#7F22FE',
    700: '#7008E7',
    800: '#5D0EC0',
    900: '#4D179A',
    950: '#160C22',
  },
};
