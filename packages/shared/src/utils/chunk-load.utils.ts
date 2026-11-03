// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CHUNK_LOAD_ERROR_CHAIN_LIMIT, CHUNK_LOAD_IMPORT_MESSAGES } from '../constants/chunk-load.constants';

/** Recognize browser import failures, including bounded, cycle-safe error wrappers. */
export function isChunkLoadError(error: unknown): boolean {
  return matchesErrorChain(error, (candidate) => {
    if (typeof candidate === 'string') {
      return CHUNK_LOAD_IMPORT_MESSAGES.some((message) => candidate.includes(message));
    }
    if (!candidate || typeof candidate !== 'object') return false;
    const record = candidate as Record<string, unknown>;
    if (record['name'] === 'ChunkLoadError') return true;
    const message = record['message'];
    return typeof message === 'string' && CHUNK_LOAD_IMPORT_MESSAGES.some((pattern) => message.includes(pattern));
  });
}

/** NG0750 discards the original dependency error: prompt, but do not assume a network failure. */
export function isDeferredLoadError(error: unknown): boolean {
  return matchesErrorChain(error, (candidate) => candidate instanceof Error && (candidate as unknown as Record<string, unknown>)['code'] === -750);
}

function matchesErrorChain(error: unknown, matches: (candidate: unknown) => boolean): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let index = 0; index < pending.length && index < CHUNK_LOAD_ERROR_CHAIN_LIMIT; index++) {
    const candidate = pending[index];
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      if (matches(candidate)) return true;
      if (candidate && typeof candidate === 'object') {
        const record = candidate as Record<string, unknown>;
        for (const key of ['cause', 'rejection', 'ngOriginalError']) {
          if (pending.length >= CHUNK_LOAD_ERROR_CHAIN_LIMIT) break;
          if (record[key] !== undefined) pending.push(record[key]);
        }
      }
    } catch {
      // Error handling must survive hostile getters or proxies without recursively throwing.
      continue;
    }
  }
  return false;
}
