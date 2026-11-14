// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CHUNK_LOAD_IMPORT_MESSAGES } from '../constants/chunk-load.constants';
import { isChunkLoadError, isDeferredLoadError } from './chunk-load.utils';

describe('chunk-load failure recognition', () => {
  it.each(CHUNK_LOAD_IMPORT_MESSAGES)('recognizes %s in errors and strings', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
    expect(isChunkLoadError(message)).toBe(true);
  });

  it('recognizes named errors and known nested wrappers', () => {
    const error = Object.assign(new Error('Loading chunk failed'), { name: 'ChunkLoadError' });
    expect(isChunkLoadError({ cause: { rejection: { ngOriginalError: error } } })).toBe(true);
  });

  it('recognizes the Angular defer runtime code, not incidental message text', () => {
    expect(isDeferredLoadError(Object.assign(new Error('NG0750'), { code: -750 }))).toBe(true);
    expect(isDeferredLoadError({ cause: Object.assign(new Error('NG0750'), { code: -750 }) })).toBe(true);
    expect(isDeferredLoadError(new Error('A report mentioning NG0750'))).toBe(false);
    expect(isChunkLoadError(Object.assign(new Error('NG0750'), { code: -750 }))).toBe(false);
  });

  it('bounds cycles and excessively deep wrappers', () => {
    const error: Record<string, unknown> = {};
    error['cause'] = error;
    expect(isChunkLoadError(error)).toBe(false);
    let wrapped: unknown = new Error(CHUNK_LOAD_IMPORT_MESSAGES[0]);
    for (let index = 0; index < 20; index++) wrapped = { cause: wrapped };
    expect(isChunkLoadError(wrapped)).toBe(false);
  });

  it('does not throw on hostile error objects', () => {
    const error = new Proxy(
      {},
      {
        get: () => {
          throw new Error('inaccessible');
        },
      }
    );
    expect(isChunkLoadError(error)).toBe(false);
    expect(isDeferredLoadError(error)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
    expect(isChunkLoadError(new Error('ordinary application error'))).toBe(false);
  });
});
