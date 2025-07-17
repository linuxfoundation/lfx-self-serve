import PrimeUI from 'tailwindcss-primeui';
import { lfxColors, lfxFontSizes } from '@lfx-pcc/shared';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: lfxColors,
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
