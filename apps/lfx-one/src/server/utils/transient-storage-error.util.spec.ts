// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { classifyTransientStorageError } from './transient-storage-error.util';

describe('classifyTransientStorageError', () => {
  it.each([0, 408, 429, 500, 503, 599])('accepts transient repository statusCode %s', (status) => {
    expect(classifyTransientStorageError({ statusCode: status })).toEqual({ transient: true, status, code: 'http' });
  });
  it.each(['TimeoutError', 'RequestTimeout'])('recognizes raw Smithy %s without an HTTP status', (name) => {
    expect(classifyTransientStorageError({ name, $metadata: {} })).toEqual({ transient: true, status: 0, code: 'timeout' });
  });
  it.each(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])(
    'recognizes transport code %s',
    (code) => {
      expect(classifyTransientStorageError({ code })).toEqual({ transient: true, status: 0, code: 'network' });
    }
  );
  it('recognizes nested transport causes but never softens an explicit authorization status', () => {
    expect(classifyTransientStorageError({ cause: { code: 'UND_ERR_SOCKET' } }).transient).toBe(true);
    expect(classifyTransientStorageError({ statusCode: 403, cause: { code: 'ECONNRESET' } })).toEqual({ transient: false, status: 403, code: 'http' });
    expect(classifyTransientStorageError({ statusCode: 0, $metadata: { httpStatusCode: 401 } }).transient).toBe(false);
  });
  it.each([undefined, null, 'private message', { code: 'EACCES' }, { statusCode: 'private message', code: 'private code' }])(
    'does not infer retryability from unclassified input',
    (error) => {
      expect(classifyTransientStorageError(error)).toEqual({ transient: false, status: 0, code: 'unknown' });
    }
  );
  it('emits only numeric status and fixed category codes, not raw names, codes or messages', () => {
    const result = classifyTransientStorageError({ message: 'private message', code: 'UND_ERR_private-marker', $metadata: { httpStatusCode: 503 } });
    expect(result).toEqual({ transient: true, status: 503, code: 'http' });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
