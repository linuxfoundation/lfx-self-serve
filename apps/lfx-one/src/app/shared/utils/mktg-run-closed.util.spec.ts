// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { MKTG_RUN_ACTIVE, MKTG_RUN_ANSWERED, MKTG_RUN_CLOSED } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { isMktgRunClosedError } from './mktg-run-closed.util';

describe('isMktgRunClosedError', () => {
  it.each([
    [new HttpErrorResponse({ status: 409, error: { code: MKTG_RUN_CLOSED } }), true],
    [new HttpErrorResponse({ status: 409, error: { code: MKTG_RUN_ACTIVE } }), false],
    [new HttpErrorResponse({ status: 409, error: { code: MKTG_RUN_ANSWERED } }), false],
    [new HttpErrorResponse({ status: 409 }), false],
    [new HttpErrorResponse({ status: 403, error: { code: MKTG_RUN_CLOSED } }), false],
    [new Error(MKTG_RUN_CLOSED), false],
    [{ status: 409, error: { code: MKTG_RUN_CLOSED } }, false],
  ])('reads only a 409 with the closed code as a closed run (%#)', (error, closed) => {
    expect(isMktgRunClosedError(error)).toBe(closed);
  });
});
