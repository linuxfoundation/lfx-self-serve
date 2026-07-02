// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Reward tier step size. Doubles as:
 * - the upstream `/me/promotions` page size when paginating, and
 * - the points granularity for the "next reward" threshold calculation.
 */
export const REWARD_STEP_SIZE = 500;

// Single source of truth for reward categories. The `RewardPromotionCategory`
// union in rewards.interface.ts is derived from this tuple, and
// `RewardPromotionGroups` keys off that union — adding a new category requires
// editing only this array.
export const REWARD_CATEGORIES = ['Event', 'Training', 'Certification'] as const;
