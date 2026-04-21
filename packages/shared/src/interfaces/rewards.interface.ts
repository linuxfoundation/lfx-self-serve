// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Single source of truth for reward categories. The union type below is derived
// from this tuple, and `RewardPromotionGroups` keys off the union — adding a
// new category requires editing only this array.
export const REWARD_CATEGORIES = ['Event', 'Training', 'Certification'] as const;

export type RewardPromotionCategory = (typeof REWARD_CATEGORIES)[number];

export interface RewardPromotionProduct {
  ID?: string;
  Name?: string;
  LogoURL?: string;
}

/**
 * Raw promotion shape from user-service GET /v1/me/promotions.
 * The endpoint returns a paginated envelope; see `RewardPromotionsPage`.
 */
export interface RewardPromotionRaw {
  PromotionID?: string;
  Category?: RewardPromotionCategory | string;
  Description?: string;
  Discount?: number;
  DiscountType?: string;
  RequiredRewards?: number;
  RelativeExpiryInterval?: number;
  ExpiresAT?: string;
  Coupon?: string;
  Eligible?: boolean;
  Redeemed?: boolean;
  EligiblityComment?: string;
  LogoURL?: string;
  Products?: RewardPromotionProduct[];
  TIContentTypes?: string[];
  MaxRedemptions?: number;
  StartingAT?: string;
}

/**
 * Paginated envelope returned by user-service GET /v1/me/promotions.
 * `Metadata.TotalSize` is the source of truth for "are there more pages?";
 * `Offset` and `PageSize` echo the request parameters.
 */
export interface RewardPromotionsPage {
  Data?: RewardPromotionRaw[];
  Metadata?: {
    Offset?: number;
    PageSize?: number;
    TotalSize?: number;
  };
}

export interface RewardPromotion {
  id: string;
  uid: string;
  category: RewardPromotionCategory;
  title: string;
  discountLabel: string;
  redeemPoints: number;
  eligible: boolean;
  redeemed: boolean;
  coupon: string;
  expiresAt: string;
  relativeExpiryInterval: number;
  eligibilityComment: string;
  logo: string;
}

export interface RewardPromotionGroup {
  earned: RewardPromotion[];
  redeemable: RewardPromotion[];
}

export type RewardPromotionGroups = Record<RewardPromotionCategory, RewardPromotionGroup>;

export interface RewardCouponGenerationResponse {
  PromotionID: string;
  CouponCode: string;
}

export interface RewardsSummaryResponse {
  points: number;
  nextRewardPoints: number;
  pointsToNextReward: number;
  progressPercentage: number;
  programStartDate: string | null;
  programExpiryDate: string | null;
  groupedPromotions: RewardPromotionGroups;
  availableIncentives: RewardPromotion[];
  coupons: RewardPromotion[];
}

/**
 * Per-item display projection for the Available Incentives panel.
 * Pre-computed once per data refresh so the template performs no method calls.
 */
export interface DecoratedAvailableIncentive extends RewardPromotion {
  hasCouponCode: boolean;
  canClaim: boolean;
  statusLabel: string;
  statusColorClass: string;
  applicationHint: string;
  resolvedExpiryDate: string | null;
  isExpired: boolean;
}

/**
 * Per-item display projection for the My Coupons panel.
 * Pre-computed once per data refresh so the template performs no method calls.
 */
export interface DecoratedCoupon extends RewardPromotion {
  hasCouponCode: boolean;
  pointsShortfall: number;
  resolvedExpiryDate: string | null;
  isExpired: boolean;
  statusLabel: string;
  statusColorClass: string;
  description: string;
}

/**
 * Declarative state container for the rewards summary fetch.
 * `data` retains the previously loaded summary during refreshes so the UI
 * does not flash back to the skeleton on subsequent loads. Errors clear
 * `data` to surface the dedicated error view.
 */
export interface RewardsState {
  loading: boolean;
  error: string | null;
  data: RewardsSummaryResponse | null;
}
