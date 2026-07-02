// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { US_STATES } from '../constants/states.constants';

/**
 * Type for US state values
 */
export type USState = (typeof US_STATES)[number]['value'];
