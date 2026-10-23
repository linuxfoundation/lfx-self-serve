// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { ConflictError, MicroserviceError, ServiceValidationError } from '../errors';
import { isDefinitiveRedraftError, redraftWasNotAccepted } from './mktg-redraft-start.util';

describe('redraft non-acceptance evidence', () => {
  it.each([400, 401, 409, 501])('treats a definitive Guild HTTP %s with no session as failed, never transport uncertainty', (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Synthetic rejection', {}, 'guild', '/synthetic', 'guild_create_session');
    expect(redraftWasNotAccepted(error, false)).toBe(true);
    expect(redraftWasNotAccepted(error, true)).toBe(false);
  });
  it.each([500, 502, 503, 504])('keeps HTTP %s uncertain because Guild may already have accepted the request', (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Synthetic gateway failure', {}, 'guild', '/synthetic', 'guild_create_session');
    expect(redraftWasNotAccepted(error, false)).toBe(false);
  });
  it('preserves repository errors and known pre-request/no-session failures', () => {
    for (const error of [new ConflictError('Synthetic conflict', 'SYNTHETIC_CONFLICT'), ServiceValidationError.forField('input', 'Synthetic invalid')]) {
      expect(isDefinitiveRedraftError(error)).toBe(true);
      expect(redraftWasNotAccepted(error, false)).toBe(true);
    }
    for (const code of ['guild_not_configured', 'guild_invalid_response'])
      expect(redraftWasNotAccepted(new MicroserviceError('Synthetic', 502, code), false)).toBe(true);
    const originalError = new Error('Synthetic refused connection', { cause: { code: 'ECONNREFUSED' } });
    expect(redraftWasNotAccepted(new MicroserviceError('Synthetic', 502, 'guild_unreachable', { originalError }), false)).toBe(true);
  });
  it('never treats an unknown error or timeout as permission to resubmit', () => {
    for (const error of [new Error('Synthetic unknown'), new MicroserviceError('Synthetic timeout', 504, 'guild_timeout')])
      expect(redraftWasNotAccepted(error, false)).toBe(false);
  });
});
