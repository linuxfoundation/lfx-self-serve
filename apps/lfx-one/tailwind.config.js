// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import typography from '@tailwindcss/typography';
import { AVATAR_COLORS, DELTA_DIRECTION_TEXT_CLASS, GRID_COLS_CLASS, GRID_DIVIDER_CLASS, lfxColors, lfxFontSizes, ORG_MEETINGS_KPI_ICON_CLASS } from '@lfx-one/shared';
import PrimeUI from 'tailwindcss-primeui';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  safelist: [
    'bg-violet-400',
    'bg-blue-400',
    'bg-emerald-400',
    'bg-pink-300',
    // Person-avatar palette: built at runtime by avatarColorClass() from AVATAR_COLORS in
    // @lfx-one/shared (outside `content`), so it would be purged. Spread the source list to avoid drift.
    ...AVATAR_COLORS,
    // Stat card grid columns/dividers: `GRID_COLS_CLASS`/`GRID_DIVIDER_CLASS` are defined in
    // @lfx-one/shared (outside `content`), and their responsive/arbitrary utilities need to be
    // scanned directly since they never appear as literal strings inside `content`.
    ...Object.values(GRID_COLS_CLASS).flatMap((classes) => classes.split(' ')),
    ...Object.values(GRID_DIVIDER_CLASS).flatMap((classes) => classes.split(' ')),
    // Org Lens meetings — KPI card icon tints and delta text colors (ORG_MEETINGS_KPI_ICON_CLASS /
    // DELTA_DIRECTION_TEXT_CLASS in @lfx-one/shared, not scanned here)
    ...Object.values(ORG_MEETINGS_KPI_ICON_CLASS).flatMap((classes) => classes.split(' ')),
    ...Object.values(DELTA_DIRECTION_TEXT_CLASS),
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
    // Org Lens projects — influence band signal-strength bars (classes defined in @lfx-one/shared, not scanned here)
    'fill-emerald-500',
    'fill-blue-500',
    'fill-amber-500',
    'fill-red-500',
    'fill-gray-400',
    'fill-gray-200',
    // Lighter tints for the unfilled signal bars
    'fill-emerald-200',
    'fill-blue-200',
    'fill-amber-200',
    'fill-red-200',
    // Org Lens projects — influence trend text/badge colors (INFLUENCE_TREND_TEXT_CLASS / INFLUENCE_TREND_ARROW_BADGE_CLASS in @lfx-one/shared, not scanned here)
    'text-emerald-600',
    'text-red-600',
    'bg-emerald-100',
    'bg-red-100',
    'bg-gray-100',
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
      // `prose-lfx` typography preset for the docs portal (US5 / T046).
      // Maps every prose color slot to LFX brand tokens via `lfxColors` —
      // never raw hex. Used by the `prose prose-lfx` container in
      // DocsArticleComponent to render sanitized markdown HTML.
      typography: {
        lfx: {
          css: {
            '--tw-prose-body': lfxColors.gray[700],
            '--tw-prose-headings': lfxColors.gray[900],
            '--tw-prose-lead': lfxColors.gray[600],
            '--tw-prose-links': lfxColors.blue[600],
            '--tw-prose-bold': lfxColors.gray[900],
            '--tw-prose-counters': lfxColors.gray[500],
            '--tw-prose-bullets': lfxColors.gray[300],
            '--tw-prose-hr': lfxColors.gray[200],
            '--tw-prose-quotes': lfxColors.gray[700],
            '--tw-prose-quote-borders': lfxColors.gray[200],
            '--tw-prose-captions': lfxColors.gray[500],
            '--tw-prose-code': lfxColors.gray[800],
            '--tw-prose-pre-code': lfxColors.gray[100],
            '--tw-prose-pre-bg': lfxColors.gray[900],
            '--tw-prose-th-borders': lfxColors.gray[300],
            '--tw-prose-td-borders': lfxColors.gray[200],
            color: lfxColors.gray[700],
            maxWidth: 'none',
            a: {
              color: lfxColors.blue[600],
              fontWeight: '500',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              transitionProperty: 'color',
              transitionDuration: '150ms',
              '&:hover': {
                color: lfxColors.blue[700],
              },
            },
            'h1, h2, h3, h4, h5, h6': {
              fontFamily: ['Inter', 'sans-serif'],
              fontWeight: '700',
              color: lfxColors.gray[900],
              letterSpacing: '-0.01em',
            },
            h1: { fontSize: '2.25rem', lineHeight: '1.15', marginTop: '0', marginBottom: '1rem' },
            // Article sections (markdown `##`) render at h4 scale with a 32px top gap — the
            // semantic <h2> tag is kept (the article title is <h1>) but de-emphasized visually.
            h2: { fontSize: '1.125rem', lineHeight: '1.4', marginTop: '32px', marginBottom: '12px' },
            h3: { fontSize: '1.375rem', lineHeight: '1.3', marginTop: '1.5rem', marginBottom: '0.5rem' },
            h4: { fontSize: '1.125rem', lineHeight: '1.4', marginTop: '1.25rem', marginBottom: '0.5rem' },
            code: {
              backgroundColor: lfxColors.gray[100],
              color: lfxColors.gray[800],
              borderRadius: '0.25rem',
              padding: '0.15rem 0.35rem',
              fontWeight: '500',
              fontFamily: ['JetBrains Mono', 'ui-monospace', 'monospace'],
              fontSize: '0.875em',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: {
              backgroundColor: lfxColors.gray[900],
              color: lfxColors.gray[100],
              borderRadius: '0.5rem',
              padding: '1rem 1.25rem',
              overflowX: 'auto',
              fontFamily: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
            'pre code': {
              backgroundColor: 'transparent',
              color: 'inherit',
              padding: '0',
              fontWeight: 'inherit',
              fontSize: '0.875em',
            },
            blockquote: {
              borderLeftColor: lfxColors.blue[400],
              backgroundColor: lfxColors.blue[50],
              color: lfxColors.gray[700],
              fontStyle: 'normal',
              padding: '0.75rem 1rem',
              borderRadius: '0.375rem',
              fontWeight: '400',
            },
            'blockquote p:first-of-type::before': { content: '""' },
            'blockquote p:last-of-type::after': { content: '""' },
            table: {
              fontSize: '0.875rem',
              borderCollapse: 'collapse',
            },
            'thead th': {
              borderBottomColor: lfxColors.gray[300],
              color: lfxColors.gray[900],
            },
            'tbody td, tbody th': {
              borderBottomColor: lfxColors.gray[200],
            },
            hr: {
              borderColor: lfxColors.gray[200],
              marginTop: '2rem',
              marginBottom: '2rem',
            },
            img: {
              borderRadius: '0.5rem',
              marginTop: '1.5rem',
              marginBottom: '1.5rem',
            },
            figure: { marginTop: '1.5rem', marginBottom: '1.5rem' },
            'ul > li::marker': { color: lfxColors.gray[400] },
            'ol > li::marker': { color: lfxColors.gray[500] },
          },
        },
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
  plugins: [PrimeUI, typography],
};
