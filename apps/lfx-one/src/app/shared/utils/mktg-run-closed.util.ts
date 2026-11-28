// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { MKTG_RUN_CLOSED } from '@lfx-one/shared/constants/mktg-run.constants';

/**
 * A result poll's final answer for a run the server closed (409 MKTG_RUN_CLOSED): discarded, or replaced by a newer
 * run. The run did not fail, and the same poll is not sent again. Any other 409 (an active run, an answered turn) is
 * not this.
 */
export function isMktgRunClosedError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409 && error.error?.code === MKTG_RUN_CLOSED;
}
