// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SLIDES_EXPORT_API_PATH } from './mktg-slides-export.constants';

export const MKTG_FAMILY_EXPORT_API_PATH = `${MKTG_SLIDES_EXPORT_API_PATH}/family`;
export const MKTG_FAMILY_EXPORT_SCHEMA = 'mktg-family-slides-export/v1';
/** Asset formats supported by the deployed exporter, not an agent catalog. */
export const MKTG_FAMILY_EXPORT_KINDS = {
  'foundation-message': 'framework',
  'brand-kit': 'kit',
  boilerplates: 'boilerplates',
  faq: 'faq',
} as const;
export const MKTG_FAMILY_PRINT_BODY_CLASS = 'lfx-print-family';
export const MKTG_FAMILY_PRINT_ONLY_CLASS = 'lfx-family-print-only';
export const MKTG_FAMILY_SLIDES_NOTE = 'Google Slides: framework, brand kit, boilerplates and FAQ (approved current).';
export const MKTG_FAMILY_PDF_NOTE = 'PDF: framework and brand kit; boilerplates and FAQ have no print layout yet.';
