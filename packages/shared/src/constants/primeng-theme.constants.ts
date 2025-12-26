// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * PrimeNG DataTable theme configuration
 * @description Theme overrides for PrimeNG DataTable component
 */
export const lfxDataTableTheme = {
  headerCell: {
    background: 'transparent',
    color: '{text.muted.color}',
    padding: '0.75rem',
    borderColor: 'transparent',
    gap: '0.5rem',
  },
  columnTitle: {
    fontWeight: '500',
  },
  row: {
    background: 'transparent',
    hoverBackground: '{surface.50}',
    color: '{text.color}',
    hoverColor: '{text.color}',
  },
  bodyCell: {
    borderColor: 'transparent',
    padding: '0.75rem',
  },
  header: {
    background: 'transparent',
    borderColor: '{surface.200}',
    borderWidth: '0 0 1px 0',
    padding: '0',
  },
  footer: {
    background: 'transparent',
    borderColor: '{surface.200}',
    borderWidth: '1px 0 0 0',
    padding: '0.75rem',
  },
  paginatorTop: {
    borderColor: '{surface.200}',
    borderWidth: '0 0 1px 0',
  },
  paginatorBottom: {
    borderColor: '{surface.200}',
    borderWidth: '1px 0 0 0',
  },
  colorScheme: {
    light: {
      root: {
        borderColor: '{surface.200}',
      },
      row: {
        stripedBackground: '{surface.50}',
      },
      bodyCell: {
        selectedBorderColor: '{primary.100}',
      },
    },
    dark: {
      root: {
        borderColor: '{surface.700}',
      },
      row: {
        stripedBackground: '{surface.900}',
      },
      bodyCell: {
        selectedBorderColor: '{primary.800}',
      },
    },
  },
} as const;

/**
 * PrimeNG Card theme configuration
 * @description Theme overrides for PrimeNG Card component
 */
export const lfxCardTheme = {
  body: {
    padding: '0.875rem',
  },
} as const;
