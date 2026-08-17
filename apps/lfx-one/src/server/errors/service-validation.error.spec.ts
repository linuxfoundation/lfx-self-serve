// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

// Relative rather than `@lfx-one/shared/constants` for the reason `meeting.controller.spec.ts:40`
// gives: the barrel pulls in the enums module graph, and this file needs one string.
import { VALIDATION_FAILED_MESSAGE_PREFIX } from '../../../../../packages/shared/src/constants/validation.constants';
import { ServiceValidationError } from './service-validation.error';

describe('ServiceValidationError — the `Validation failed` wire contract', () => {
  // `getHttpErrorDetail` sniffs this prefix to decide the top-level message names a wire key and the
  // readable reason lives in `errors[]`. Reword either side without the other and every affected toast
  // silently starts showing "Validation failed for invitee_email" — these two assertions are what makes
  // that fail loudly instead.
  it('prefixes a self-built message with the string the frontend matches on', () => {
    expect(new ServiceValidationError([]).message).toBe(VALIDATION_FAILED_MESSAGE_PREFIX);
    expect(ServiceValidationError.forField('invitee_email', 'Email address is required').message).toBe(`${VALIDATION_FAILED_MESSAGE_PREFIX} for invitee_email`);
  });

  // The other half of the rule: a caller-supplied message is written for a person, carries no prefix,
  // and so wins over the field array on the client.
  it('leaves a caller-supplied message unprefixed', () => {
    const error = ServiceValidationError.fromFieldErrors({ email: 'Email address is required' }, 'Email address is required.');

    expect(error.message).toBe('Email address is required.');
    expect(error.toResponse()['errors']).toEqual([{ field: 'email', message: 'Email address is required', code: 'FIELD_VALIDATION_ERROR' }]);
  });
});
