// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ObjectStoreFailureClassification } from '@lfx-one/shared/interfaces';

/** Normalize raw Smithy, transport and repository errors without reflecting provider text into diagnostics. */
export function classifyTransientStorageError(error: unknown): ObjectStoreFailureClassification {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const metadata = value['$metadata'];
  const providerStatus = metadata && typeof metadata === 'object' && 'httpStatusCode' in metadata ? metadata.httpStatusCode : undefined;
  const candidate = providerStatus ?? value['statusCode'] ?? value['status'];
  if (typeof candidate === 'number' && Number.isInteger(candidate) && (candidate === 0 || (candidate >= 100 && candidate <= 599))) {
    return { transient: candidate === 0 || candidate >= 500 || candidate === 408 || candidate === 429, status: candidate, code: 'http' };
  }
  const cause = value['cause'] && typeof value['cause'] === 'object' ? (value['cause'] as Record<string, unknown>) : {};
  if ([value['name'], cause['name']].some((name) => name === 'TimeoutError' || name === 'RequestTimeout'))
    return { transient: true, status: 0, code: 'timeout' };
  const network = [value['code'], cause['code']].some((code) => {
    if (typeof code !== 'string') return false;
    if (code.startsWith('UND_ERR_')) return true;
    switch (code) {
      case 'ETIMEDOUT':
      case 'ECONNRESET':
      case 'ECONNREFUSED':
      case 'EAI_AGAIN':
      case 'EPIPE':
      case 'ENOTFOUND':
      case 'ECONNABORTED':
        return true;
      default:
        return false;
    }
  });
  return { transient: network, status: 0, code: network ? 'network' : 'unknown' };
}
