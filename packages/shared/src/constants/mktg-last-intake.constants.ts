// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const MKTG_RUN_NEW_MODE = 'new' as const;
/** Clear creator/revision selectors when entering an explicitly new intake. */
export const MKTG_RUN_RESUME_QUERY_CLEAR = { questions: null, generation: null, revision: null, run: null } as const;
export const MKTG_LAST_INTAKE_API = '/api/mktg-agents/intakes';
export const MKTG_LAST_INTAKE_PREFIX = 'document-last-intake';
export const MKTG_LAST_INTAKE_SCHEMA = 'mktg-last-intake/v1';
export const MKTG_LAST_INTAKE_MAX_BYTES = 128 * 1024;
export const MKTG_LAST_INTAKE_RETENTION_DAYS = 30;
