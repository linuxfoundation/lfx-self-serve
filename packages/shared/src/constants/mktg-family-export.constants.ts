// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_PRINT_TITLE } from './mktg-print.constants';
import { BOILERPLATES_INTAKE, BRAND_KIT_INTAKE, FAQ_INTAKE } from './mktg-run.constants';
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
/** The parts' names on the family cover's versions line (the appendix spec §4: `Messaging Framework v3 · Brand Kit V1.0 · …`), by agent key: the documents' names from the catalog, the framework's from its print title (the spec's casing). */
export const MKTG_FAMILY_EXPORT_VERSION_LABELS: Record<keyof typeof MKTG_FAMILY_EXPORT_KINDS, string> = {
  'foundation-message': FOUNDATION_MESSAGE_PRINT_TITLE,
  'brand-kit': BRAND_KIT_INTAKE.documentName,
  boilerplates: BOILERPLATES_INTAKE.documentName,
  faq: FAQ_INTAKE.documentName,
};
export const MKTG_FAMILY_PRINT_BODY_CLASS = 'lfx-print-family';
export const MKTG_FAMILY_PRINT_ONLY_CLASS = 'lfx-family-print-only';
export const MKTG_FAMILY_EXPORT_HIGHLIGHT_MS = 1200;
export const MKTG_FAMILY_EXPORT_FORMAT_HINT = 'Choose a format: Download PDF or Export to Google Slides';
export const MKTG_FAMILY_APPROVAL_REQUIRED_MESSAGE = 'Available once the framework is approved: PDF and Slides use the approved current.';

export const MKTG_FAMILY_SLIDES_NOTE = 'Google Slides: framework, brand kit, boilerplates and FAQ (approved current).';
export const MKTG_FAMILY_PDF_NOTE = 'PDF: framework, brand kit, boilerplates and FAQ (approved current).';
