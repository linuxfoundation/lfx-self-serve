// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_ACTIVITY_DONE_STATUSES, MKTG_RUN_ACTIVITY_FAILED_STATUSES } from './mktg-run-activity.constants';

/** Public event lists may expose current root task status without a runtime_done event. */
export const MKTG_ONE_OFF_TERMINAL_TASK_STATUSES: readonly string[] = [...MKTG_RUN_ACTIVITY_DONE_STATUSES, ...MKTG_RUN_ACTIVITY_FAILED_STATUSES, 'ENDED'];

/** Bounded final agent reply when a one-off session ends without its result envelope. */
export const MKTG_ONE_OFF_FAILURE_MESSAGE_MAX_CHARS = 600;
export const MKTG_ONE_OFF_STOPPED_MESSAGE = 'The agent stopped before producing a result.';
