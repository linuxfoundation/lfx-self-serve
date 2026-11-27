// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SLIDES_EXPORT_API_PATH, MKTG_SLIDES_EXPORT_POLL } from './mktg-slides-export.constants';

export const MKTG_FAMILY_EXPORT_API_PATH = `${MKTG_SLIDES_EXPORT_API_PATH}/family`;
export const MKTG_FAMILY_EXPORT_SCHEMA = 'mktg-family-slides-export/v1';
/** A family export is already in flight: the start was refused before anything was read or sent to the exporter. */
export const MKTG_FAMILY_EXPORT_ACTIVE = 'MKTG_FAMILY_EXPORT_ACTIVE';
/** The family's one in-flight marker: BFF-only, in the private bucket. */
export const MKTG_FAMILY_EXPORT_MARKER_SCHEMA = 'mktg-family-export-active/v1';
/** Markers live under their own prefix: the export records' prefix holds immutable, content-addressed records only. */
export const MKTG_FAMILY_EXPORT_ACTIVE_KEY_PREFIX = 'slides-export-active';
/**
 * The longest a marker holds its family: the start's own work before the session exists (reading the approved
 * assets, drawing and publishing the logos) plus the export's whole poll deadline. No marker outlives it, whatever
 * happened to the server that wrote it, and a card that follows an export stops polling after it.
 */
export const MKTG_FAMILY_EXPORT_ACTIVE_TTL_MS = MKTG_SLIDES_EXPORT_POLL.timeoutMs + 2 * 60 * 1000;
/** Conditional writes a start tries before it answers that another start holds the family, naming nobody. */
export const MKTG_FAMILY_EXPORT_CLAIM_ATTEMPTS = 3;
/** Who is exporting, when the directory has no display name for them: never an email or a subject. */
export const MKTG_FAMILY_EXPORT_UNNAMED_STARTER = 'Another writer';
/** What a card says once the export it followed is over: its deck is the family's last export, or nothing was kept. */
export const MKTG_FAMILY_EXPORT_FOLLOWED_MESSAGES = {
  done: 'That export finished. Its deck is the last export below.',
  ended: 'That export did not finish, so there is no new deck. You can export again.',
} as const;
/** Asset formats supported by the deployed exporter, not an agent catalog. */
export const MKTG_FAMILY_EXPORT_KINDS = {
  'foundation-message': 'framework',
  'brand-kit': 'kit',
  boilerplates: 'boilerplates',
  faq: 'faq',
} as const;
export const MKTG_FAMILY_PRINT_BODY_CLASS = 'lfx-print-family';
export const MKTG_FAMILY_PRINT_ONLY_CLASS = 'lfx-family-print-only';
export const MKTG_FAMILY_EXPORT_HIGHLIGHT_MS = 1200;
export const MKTG_FAMILY_EXPORT_FORMAT_HINT = 'Choose a format: Download PDF or Export to Google Slides';
export const MKTG_FAMILY_APPROVAL_REQUIRED_MESSAGE = 'Available once the framework is approved: PDF and Slides use the approved current.';

export const MKTG_FAMILY_SLIDES_NOTE = 'Google Slides: framework, brand kit, boilerplates and FAQ (approved current).';
export const MKTG_FAMILY_PDF_NOTE = 'PDF: framework, brand kit, boilerplates and FAQ (approved current).';
