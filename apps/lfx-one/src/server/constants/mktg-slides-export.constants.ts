// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The Drive folder a new Google Slides deck is created in when the
 * environment names none: the Marketing OS folder, which holds the LF 2025
 * template. LFX One stores no per-project folder yet. Server-side only: the
 * browser never names the folder.
 */
export const MKTG_SLIDES_EXPORT_DEFAULT_FOLDER_ID = '1rH6qCSXSb_GEQ5-N1-IEosGjy2y8GcoH';

/**
 * The environment variable that names another folder, so a non-production
 * environment can keep its test decks out of the folder marketing works
 * from. The slides-export agent's Google account must be able to write
 * there.
 */
export const MKTG_SLIDES_EXPORT_FOLDER_ID_ENV = 'MKTG_SLIDES_EXPORT_FOLDER_ID';
