// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors, lfxFontSizes } from '@lfx-one/shared';
import PrimeUI from 'tailwindcss-primeui';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  safelist: [
    // Meeting type border colors (used dynamically in dashboard-meeting-card)
    'border-purple-500',
    'border-purple-300',
    'border-blue-500',
    'border-blue-300',
    'border-red-500',
    'border-red-300',
    'border-green-500',
    'border-green-300',
    'border-amber-500',
    'border-amber-300',
    'border-gray-500',
    'border-gray-300',
    'border-gray-400',
    // Meeting type background colors
    'bg-purple-100',
    'bg-blue-100',
    'bg-red-100',
    'bg-green-100',
    'bg-amber-100',
    'bg-gray-100',
    // Meeting type text colors
    'text-purple-600',
    'text-purple-500',
    'text-blue-600',
    'text-blue-500',
    'text-red-600',
    'text-red-500',
    'text-green-600',
    'text-green-500',
    'text-amber-600',
    'text-amber-500',
    'text-gray-600',
    'text-gray-500',
    'text-gray-400',
    // Committee type colors
    'text-emerald-600',
    'text-emerald-500',
    'bg-emerald-100',
    'bg-emerald-300',
    'border-emerald-500',
    'border-emerald-300',
    'text-pink-600',
    'text-pink-500',
    'bg-pink-100',
    'bg-pink-300',
    'border-pink-500',
    'border-pink-300',
    'text-orange-600',
    'text-orange-500',
    'bg-orange-100',
    'bg-orange-300',
    'border-orange-500',
    'border-orange-300',
  ],
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
      sans: ['Open Sans', 'sans-serif'],
      inter: ['Inter', 'sans-serif'],
      display: ['Roboto Slab', 'serif'],
      serif: ['Roboto Slab', 'serif'],
    },
  },
  plugins: [PrimeUI],
};
