// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecoratedAvailableIncentive, DecoratedCoupon, RewardPromotion } from '../interfaces/rewards.interface';

export const EMPTY_REWARD_PROMOTIONS: readonly RewardPromotion[] = Object.freeze([] as RewardPromotion[]);

export interface ResolvePromotionExpiryOptions {
  skipIfPointsRequired?: boolean;
}

export function resolvePromotionExpiryDate(
  promotion: RewardPromotion,
  programStartDate: string | null,
  options: ResolvePromotionExpiryOptions = {}
): string | null {
  if (options.skipIfPointsRequired && promotion.redeemPoints > 0 && !promotion.coupon) {
    return null;
  }

  if (promotion.expiresAt) {
    const explicitExpiry = new Date(promotion.expiresAt);
    if (!Number.isNaN(explicitExpiry.getTime())) {
      return promotion.expiresAt;
    }
  }
  if (!promotion.coupon || promotion.relativeExpiryInterval <= 0) return null;
  if (!programStartDate) return null;

  const date = new Date(programStartDate);
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + promotion.relativeExpiryInterval);
  return date.toISOString();
}

// ─── Available Incentive decoration ──────────────────────────────────────────

function getIncentiveStatusLabel(p: RewardPromotion, hasCouponCode: boolean, canClaim: boolean, isExpired: boolean): string {
  if (isExpired) return 'Expired';
  if (hasCouponCode) return 'Available';
  if (canClaim) return 'Ready to claim';
  if (p.eligible) return 'Available';
  return 'Pending';
}

function getIncentiveStatusColorClass(p: RewardPromotion, hasCouponCode: boolean, canClaim: boolean, isExpired: boolean): string {
  if (isExpired) return 'bg-gray-100 text-gray-500';
  if (canClaim) return 'bg-green-100 text-green-700';
  if (hasCouponCode || p.eligible) return 'bg-white text-blue-700 border border-blue-300';
  return 'bg-amber-100 text-amber-700';
}

function getIncentiveApplicationHint(p: RewardPromotion, hasCouponCode: boolean, canClaim: boolean, isExpired: boolean): string {
  if (isExpired) {
    return 'This incentive has expired and can no longer be used.';
  }

  if (hasCouponCode) {
    return 'Copy this code and paste it at checkout on the LF Training & Certification platform.';
  }

  if (canClaim) {
    return 'Claim your coupon code and use it at checkout on the LF Training & Certification platform.';
  }

  if (p.eligible) {
    return 'Applied automatically when you register or check out on the LF Training & Certification platform.';
  }

  return 'Will activate automatically once eligibility requirements are met. No action needed from you.';
}

export function decorateAvailableIncentives(
  incentives: readonly RewardPromotion[],
  programStartDate: string | null,
  now: number = Date.now()
): DecoratedAvailableIncentive[] {
  const decorated = incentives.map((p) => {
    const hasCouponCode = p.coupon.length > 0;
    const canClaim = p.eligible && !hasCouponCode && !p.redeemed && p.id.length > 0;
    const resolvedExpiryDate = resolvePromotionExpiryDate(p, programStartDate);
    const expiryTime = resolvedExpiryDate ? new Date(resolvedExpiryDate).getTime() : Number.NaN;
    const isExpired = !Number.isNaN(expiryTime) && expiryTime < now;

    return {
      ...p,
      hasCouponCode,
      canClaim,
      statusLabel: getIncentiveStatusLabel(p, hasCouponCode, canClaim, isExpired),
      statusColorClass: getIncentiveStatusColorClass(p, hasCouponCode, canClaim, isExpired),
      applicationHint: getIncentiveApplicationHint(p, hasCouponCode, canClaim, isExpired),
      resolvedExpiryDate,
      isExpired,
    };
  });

  return decorated.sort((a, b) => {
    if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
    return compareByExpiryDate(a.resolvedExpiryDate, b.resolvedExpiryDate, a.isExpired);
  });
}

// ─── Coupon decoration ───────────────────────────────────────────────────────

function getCouponStatusLabel(p: RewardPromotion, isExpired: boolean, hasPointsShortfall: boolean): string {
  if (p.redeemed) return 'Redeemed';
  if (isExpired) return 'Expired';
  if (p.coupon) return 'Available';
  // Upstream may flag a coupon `eligible: true` while the user is still short
  // on points; in that case the redeem button is disabled, so the badge must
  // not advertise "Ready to redeem".
  if (p.eligible && !hasPointsShortfall) return 'Ready to redeem';
  return 'Locked';
}

function getCouponStatusColorClass(p: RewardPromotion, isExpired: boolean, hasPointsShortfall: boolean): string {
  if (p.redeemed) return 'bg-gray-100 text-gray-700';
  if (isExpired) return 'bg-gray-100 text-gray-500';
  if (p.coupon) return 'bg-white text-blue-700 border border-blue-300';
  if (p.eligible && !hasPointsShortfall) return 'bg-green-100 text-green-700';
  return 'bg-amber-100 text-amber-700';
}

function getCouponDescription(p: RewardPromotion, isExpired: boolean): string {
  if (isExpired) return 'This coupon has expired and can no longer be used.';
  if (p.eligibilityComment) return p.eligibilityComment;
  if (p.coupon) return 'Use this coupon during checkout on eligible training and certification purchases.';
  return `${p.redeemPoints} points required to unlock this coupon.`;
}

function getCouponSortRank(p: DecoratedCoupon): number {
  // Precedence must match getCouponStatusLabel/getCouponStatusColorClass:
  // a redeemed-but-expired coupon is labeled "Redeemed", so it must sort
  // into the Redeemed bucket (not the Expired bucket).
  if (p.redeemed) return 3;
  if (p.isExpired) return 4;
  if (p.coupon) return 1;
  if (p.eligible) return 0;
  return 2;
}

export function decorateCoupons(
  coupons: readonly RewardPromotion[],
  rewardPoints: number,
  programStartDate: string | null,
  now: number = Date.now()
): DecoratedCoupon[] {
  const decorated: DecoratedCoupon[] = coupons.map((p) => {
    const hasCouponCode = p.coupon.length > 0;
    const pointsShortfall = Math.max(0, p.redeemPoints - rewardPoints);
    const resolvedExpiryDate = resolvePromotionExpiryDate(p, programStartDate, { skipIfPointsRequired: true });
    const expiryTime = resolvedExpiryDate ? new Date(resolvedExpiryDate).getTime() : Number.NaN;
    const isExpired = !Number.isNaN(expiryTime) && expiryTime < now;

    return {
      ...p,
      hasCouponCode,
      pointsShortfall,
      resolvedExpiryDate,
      isExpired,
      statusLabel: getCouponStatusLabel(p, isExpired, pointsShortfall > 0),
      statusColorClass: getCouponStatusColorClass(p, isExpired, pointsShortfall > 0),
      description: getCouponDescription(p, isExpired),
    };
  });

  return decorated.sort((a, b) => {
    const aRank = getCouponSortRank(a);
    const bRank = getCouponSortRank(b);
    const rankDiff = aRank - bRank;
    if (rankDiff !== 0) return rankDiff;
    // Sort direction must be derived from the bucket itself — not from
    // `a.isExpired` — because the Redeemed bucket (rank 3) can contain a mix
    // of expired and non-expired coupons. Using `a.isExpired` would make
    // `cmp(a,b)` and `cmp(b,a)` non-antisymmetric and produce unstable order.
    const sortDescending = aRank === 4;
    return compareByExpiryDate(a.resolvedExpiryDate, b.resolvedExpiryDate, sortDescending);
  });
}

// ─── Shared sort helpers ─────────────────────────────────────────────────────

function compareByExpiryDate(aDate: string | null, bDate: string | null, sortDescending: boolean): number {
  const aTime = aDate ? new Date(aDate).getTime() : Number.NaN;
  const bTime = bDate ? new Date(bDate).getTime() : Number.NaN;
  const aHasDate = !Number.isNaN(aTime);
  const bHasDate = !Number.isNaN(bTime);

  if (aHasDate && bHasDate) {
    return sortDescending ? bTime - aTime : aTime - bTime;
  }
  if (aHasDate) return -1;
  if (bHasDate) return 1;
  return 0;
}
