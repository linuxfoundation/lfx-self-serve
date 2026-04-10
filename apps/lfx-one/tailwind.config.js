// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors, lfxFontSizes } from '@lfx-one/shared';
import PrimeUI from 'tailwindcss-primeui';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  safelist: [
    'bg-violet-400',
    'bg-blue-400',
    'bg-emerald-400',
    'bg-pink-300',
    // Meeting summary modal — dynamic section border/icon colors (applied via [ngClass])
    'border-l-blue-400',
    'border-l-emerald-400',
    'border-l-amber-400',
    'border-l-purple-400',
    'border-l-gray-300',
    'text-blue-500',
    'text-emerald-500',
    'text-amber-500',
    'text-purple-500',
    'text-gray-500',
  ],
  theme: {
    container: {
      center: true,
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1440px',
      },
    },
    extend: {
      colors: lfxColors,
      boxShadow: {
        md: '0px 1px 2px -1px rgba(0, 0, 0, 0.10), 0px 1px 3px 0px rgba(0, 0, 0, 0.10)',
      },
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
      fontWeight: {
        normal: 400,
        medium: 500,
        semibold: 600,
      },
      lineHeight: {
        normal: 1.5,
        relaxed: 1.75,
      },
    },
    fontSize: lfxFontSizes,
    fontFamily: {
      inter: ['Inter', 'sans-serif'],
      display: ['Roboto Slab', 'serif'],
      serif: ['Roboto Slab', 'serif'],
      mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
    },
  },
  plugins: [PrimeUI],
};
