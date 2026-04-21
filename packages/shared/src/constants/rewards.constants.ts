// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Reward tier step size. Doubles as:
 * - the upstream `/me/promotions` page size when paginating, and
 * - the points granularity for the "next reward" threshold calculation.
 */
export const REWARD_STEP_SIZE = 500;
