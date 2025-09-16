// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors, lfxFontSizes } from '@lfx-one/shared';
import PrimeUI from 'tailwindcss-primeui';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: lfxColors,
      keyframes: {
        'fade-in-up': {
          '0%': {
            opacity: '0',
            transform: 'translateY(1.5rem)', // Adjust this value for desired starting position
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 1s ease-out forwards', // Adjust duration and easing
      },
    },
    fontSize: lfxFontSizes,
    fontFamily: {
      sans: ['Open Sans', 'sans-serif'],
      display: ['Roboto Slab', 'serif'],
      serif: ['Roboto Slab', 'serif'],
    },
  },
  plugins: [PrimeUI],
};
