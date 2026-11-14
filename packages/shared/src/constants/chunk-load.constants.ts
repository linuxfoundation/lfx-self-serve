// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const CHUNK_LOAD_RELOAD_STORAGE_KEY = 'lfx-chunk-reload-at';
export const CHUNK_LOAD_RELOAD_WINDOW_MS = 60_000;
export const CHUNK_LOAD_RELOAD_WATCHDOG_MS = 5_000;
export const CHUNK_LOAD_ERROR_CHAIN_LIMIT = 8;
export const CHUNK_LOAD_IMPORT_MESSAGES = [
  'Importing a module script failed',
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
] as const;
