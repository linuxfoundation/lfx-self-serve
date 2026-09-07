// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REWARD_CATEGORIES, REWARD_STEP_SIZE } from '@lfx-one/shared/constants';
import {
  RewardCouponGenerationResponse,
  RewardPromotion,
  RewardPromotionCategory,
  RewardPromotionGroups,
  RewardPromotionRaw,
  RewardPromotionsPage,
  RewardUserProfileRaw,
  RewardsProfileProjection,
  RewardsSubject,
  RewardsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { NEVER_EXPIRES_YEAR_PREFIX, REWARDS_SERVICE_NAME, REWARD_PROMOTIONS_PAGE_SIZE } from '../constants';
import { AuthorizationError, MicroserviceError } from '../errors';
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { isImpersonating } from '../utils/auth-helper';
import { resolveRewardsSubject } from '../utils/rewards-subject';
import { logger } from './logger.service';

export class RewardsService {
  public async getSummary(req: Request): Promise<RewardsSummaryResponse> {
    const subject = await resolveRewardsSubject(req);
    logger.debug(req, 'get_rewards_summary', 'Fetching rewards profile and promotions', { subject_mode: subject.mode });

    const [profileResult, promotionsResult] = await Promise.allSettled([
      this.fetchUserProfile(req, subject),
      this.fetchPromotions(req, subject).then((promotions) => this.groupPromotions(promotions)),
    ]);
    const profile = this.unwrapSource(req, 'profile', profileResult);
    const promotionGroups = this.unwrapSource(req, 'promotions', promotionsResult);
    const groupedPromotions = promotionGroups ?? this.groupPromotions([]);

    return {
      availability: {
        profile: profile ? 'available' : 'unavailable',
        promotions: promotionGroups ? 'available' : 'unavailable',
      },
      readOnly: subject.readOnly,
      points: profile?.points ?? null,
      nextRewardPoints: profile?.nextRewardPoints ?? null,
      pointsToNextReward: profile?.pointsToNextReward ?? null,
      progressPercentage: profile?.progressPercentage ?? null,
      programStartDate: profile?.programStartDate ?? null,
      programExpiryDate: profile?.programExpiryDate ?? null,
      groupedPromotions,
      availableIncentives: this.flattenPromotions(groupedPromotions, 'earned'),
      coupons: this.flattenPromotions(groupedPromotions, 'redeemable'),
    };
  }

  public async redeemPromotion(req: Request, promotionId: string): Promise<RewardCouponGenerationResponse> {
    logger.debug(req, 'redeem_promotion', 'Generating coupon for promotion', { promotion_id: promotionId });

    if (isImpersonating(req)) {
      throw new AuthorizationError('This action is not available while impersonating a user', {
        operation: 'impersonation_readonly',
        service: REWARDS_SERVICE_NAME,
        path: req.path,
        code: 'IMPERSONATION_READ_ONLY',
      });
    }

    const baseUrl = getUserServiceBaseUrl('redeem_promotion', REWARDS_SERVICE_NAME);
    const result = await gatewayFetch<RewardCouponGenerationResponse>(req, `${baseUrl}/me/promotions/${encodeURIComponent(promotionId)}/generateCoupon`, {
      operation: 'redeem_promotion',
      service: REWARDS_SERVICE_NAME,
      errorMessage: 'Coupon generation failed',
      errorCode: 'COUPON_GENERATION_FAILED',
      method: 'POST',
      redactResponseBody: true,
    });

    if (!result) {
      throw new MicroserviceError('Coupon generation failed: empty response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'redeem_promotion',
        service: REWARDS_SERVICE_NAME,
      });
    }

    return result;
  }

  private async fetchUserProfile(req: Request, subject: RewardsSubject): Promise<RewardsProfileProjection> {
    logger.debug(req, 'fetch_user_profile', 'Fetching user profile for rewards data');

    const baseUrl = getUserServiceBaseUrl('fetch_user_profile', REWARDS_SERVICE_NAME);
    const path = subject.mode === 'self' ? '/me' : `/users/${encodeURIComponent(subject.salesforceId)}`;
    const profile = await gatewayFetch<RewardUserProfileRaw>(req, `${baseUrl}${path}`, {
      operation: 'fetch_user_profile',
      service: REWARDS_SERVICE_NAME,
      errorMessage: 'User profile fetch failed',
      errorCode: 'USER_PROFILE_FETCH_FAILED',
      redactResponseBody: true,
    });

    if (!profile) {
      throw this.invalidResponse('fetch_user_profile', 'User profile response was empty');
    }
    if (subject.mode === 'impersonated' && !this.profileMatchesSubject(profile, subject.username)) {
      throw new MicroserviceError('User profile identity did not match the rewards subject', 502, 'REWARDS_SUBJECT_MISMATCH', {
        operation: 'fetch_user_profile',
        service: REWARDS_SERVICE_NAME,
      });
    }

    return this.projectProfile(profile);
  }

  private async fetchPromotions(req: Request, subject: RewardsSubject): Promise<RewardPromotionRaw[]> {
    logger.debug(req, 'fetch_promotions', 'Fetching user promotions');

    const baseUrl = getUserServiceBaseUrl('fetch_promotions', REWARDS_SERVICE_NAME);
    const subjectPath = subject.mode === 'self' ? '/me' : `/users/${encodeURIComponent(subject.salesforceId)}`;
    const promotions: RewardPromotionRaw[] = [];
    let offset = 0;

    while (true) {
      const response = await gatewayFetch<RewardPromotionsPage>(
        req,
        `${baseUrl}${subjectPath}/promotions?offset=${offset}&pageSize=${REWARD_PROMOTIONS_PAGE_SIZE}`,
        {
          operation: 'fetch_promotions',
          service: REWARDS_SERVICE_NAME,
          errorMessage: 'Promotions fetch failed',
          errorCode: 'PROMOTIONS_FETCH_FAILED',
          redactResponseBody: true,
        }
      );
      const { data, nextOffset, totalSize } = this.validatePromotionPage(response, offset);
      promotions.push(...data);

      if (nextOffset === totalSize) return promotions;
      offset = nextOffset;
    }
  }

  private validatePromotionPage(response: RewardPromotionsPage | null, requestedOffset: number) {
    const data = response?.Data;
    const metadata = response?.Metadata;

    if (
      !metadata ||
      !isNonNegativeInteger(metadata.Offset) ||
      metadata.Offset !== requestedOffset ||
      !isNonNegativeInteger(metadata.PageSize) ||
      // User-service echoes the requested page size. Exact equality verifies the
      // query contract before trusting collection completeness.
      metadata.PageSize !== REWARD_PROMOTIONS_PAGE_SIZE ||
      !isNonNegativeInteger(metadata.TotalSize) ||
      !Array.isArray(data) ||
      !data.every(isValidPromotion)
    ) {
      throw this.invalidResponse('fetch_promotions', 'Promotions response was malformed');
    }

    const nextOffset = requestedOffset + data.length;
    const totalSize = metadata.TotalSize;
    const incomplete = nextOffset > totalSize || (nextOffset < totalSize && data.length < REWARD_PROMOTIONS_PAGE_SIZE);
    if (incomplete) {
      throw this.invalidResponse('fetch_promotions', 'Promotions pagination was incomplete');
    }

    return { data, nextOffset, totalSize };
  }

  private projectProfile(profile: RewardUserProfileRaw): RewardsProfileProjection {
    const rawPoints = profile.TuxRewards;
    if (typeof rawPoints !== 'number' || !Number.isFinite(rawPoints) || rawPoints < 0) {
      throw this.invalidResponse('fetch_user_profile', 'User profile reward points were malformed');
    }

    const points = Math.floor(rawPoints);
    const nextRewardPoints = this.calculateNextThreshold(points);
    const programStartDate = this.normalizeProgramStartDate(profile.TuxProgramStartDate);
    return {
      points,
      nextRewardPoints,
      pointsToNextReward: Math.max(0, nextRewardPoints - points),
      progressPercentage: Math.min(100, Math.round((points / nextRewardPoints) * 100)),
      programStartDate,
      programExpiryDate: this.calculateProgramExpiry(programStartDate),
    };
  }

  private profileMatchesSubject(profile: RewardUserProfileRaw, username: string): boolean {
    const returnedUsername = profile.Username;
    return typeof returnedUsername === 'string' && username === returnedUsername.trim();
  }

  private normalizeProgramStartDate(value: unknown): string | null {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  }

  private invalidResponse(operation: string, message: string): MicroserviceError {
    return new MicroserviceError(message, 502, 'UPSTREAM_INVALID_RESPONSE', {
      operation,
      service: REWARDS_SERVICE_NAME,
    });
  }

  private isCriticalSourceFailure(reason: unknown): boolean {
    const statusCode = (reason as { statusCode?: unknown } | null)?.statusCode;
    if (statusCode === 401 || statusCode === 403) return true;

    const code = (reason as { code?: unknown } | null)?.code;
    return code === 'API_GATEWAY_UNAVAILABLE' || code === 'API_GATEWAY_MISCONFIGURED' || code === 'REWARDS_SUBJECT_MISMATCH';
  }

  private unwrapSource<T>(req: Request, source: 'profile' | 'promotions', result: PromiseSettledResult<T>): T | null {
    if (result.status === 'fulfilled') return result.value;
    if (this.isCriticalSourceFailure(result.reason)) throw result.reason;

    const code = result.reason instanceof MicroserviceError ? result.reason.code : 'UNKNOWN';
    logger.warning(req, 'get_rewards_summary', 'Rewards source unavailable', {
      source,
      error_code: code,
    });
    return null;
  }

  private groupPromotions(promotions: RewardPromotionRaw[]): RewardPromotionGroups {
    const grouped: RewardPromotionGroups = {
      Event: { earned: [], redeemable: [] },
      Training: { earned: [], redeemable: [] },
      Certification: { earned: [], redeemable: [] },
    };

    const seenIds = new Set<string>();

    for (const raw of promotions) {
      if (!this.isDisplayable(raw)) {
        continue;
      }

      const id = raw.PromotionID?.trim();
      if (!id || seenIds.has(id)) {
        continue;
      }

      const category = this.normalizeCategory(raw.Category);
      if (!category) {
        continue;
      }

      seenIds.add(id);
      const mapped = this.mapPromotion(raw, category, id);

      if (mapped.redeemPoints > 0) {
        grouped[category].redeemable.push(mapped);
      } else {
        grouped[category].earned.push(mapped);
      }
    }

    for (const cat of REWARD_CATEGORIES) {
      grouped[cat].earned.sort((a, b) => a.title.localeCompare(b.title));
      grouped[cat].redeemable.sort((a, b) => a.redeemPoints - b.redeemPoints || a.title.localeCompare(b.title));
    }

    return grouped;
  }

  private mapPromotion(raw: RewardPromotionRaw, category: RewardPromotionCategory, id: string): RewardPromotion {
    const title = raw.Description?.trim() || 'Promotion';
    const coupon = raw.Coupon?.trim() ?? '';

    return {
      id,
      uid: [id, title, coupon, raw.Redeemed ? 'redeemed' : 'active', raw.RequiredRewards].join('::'),
      category,
      title,
      discountLabel: this.formatDiscount(raw.Discount, raw.DiscountType),
      redeemPoints: Number(raw.RequiredRewards) || 0,
      eligible: Boolean(raw.Eligible),
      redeemed: Boolean(raw.Redeemed),
      coupon,
      expiresAt: this.normalizeExpiry(raw.ExpiresAT),
      relativeExpiryInterval: Number(raw.RelativeExpiryInterval) || 0,
      eligibilityComment: raw.EligiblityComment || '',
      logo: raw.Products?.find((p) => Boolean(p.LogoURL))?.LogoURL || raw.LogoURL || '',
    };
  }

  private isDisplayable(raw: RewardPromotionRaw): boolean {
    return (raw.Products?.length ?? 0) > 0 || (raw.TIContentTypes?.length ?? 0) > 0;
  }

  private normalizeExpiry(value: string | undefined): string {
    if (!value || value.startsWith(NEVER_EXPIRES_YEAR_PREFIX)) {
      return '';
    }

    // Reject any non-ISO/unparseable date so downstream UI formatting cannot
    // crash on malformed upstream values.
    return Number.isNaN(Date.parse(value)) ? '' : value;
  }

  private normalizeCategory(category?: string): RewardPromotionCategory | null {
    if (!category) {
      return null;
    }
    return REWARD_CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase()) ?? null;
  }

  /**
   * Builds the human-readable discount label shown on a promotion card.
   *
   * Upstream contract (user-service GET /v1/me/promotions):
   * - When `DiscountType` is `'percentage'` or `'%'`, `Discount` is the
   *   percentage value as-is (e.g. `25` => `"25% OFF"`).
   * - For any other `DiscountType` (treated as a fixed monetary amount),
   *   `Discount` is denominated in **cents**, so it is divided by 100 to
   *   render dollars (e.g. `2500` => `"$25 OFF"`, `2599` => `"$25.99 OFF"`).
   *
   * Returns `'Offer available'` when the value is missing, non-finite, or
   * non-positive so the UI never renders `$0 OFF` or `NaN% OFF`.
   */
  private formatDiscount(discount?: number, discountType?: string): string {
    const value = Number(discount);
    if (!Number.isFinite(value) || value <= 0) {
      return 'Offer available';
    }

    const type = discountType?.toLowerCase();
    if (type === 'percentage' || type === '%') {
      return `${value}% OFF`;
    }

    const dollars = value / 100;
    return `$${Number.isInteger(dollars) ? dollars.toString() : dollars.toFixed(2)} OFF`;
  }

  private flattenPromotions(groups: RewardPromotionGroups, type: 'earned' | 'redeemable'): RewardPromotion[] {
    return REWARD_CATEGORIES.flatMap((cat) => groups[cat][type]);
  }

  private calculateNextThreshold(points: number): number {
    return Math.floor(points / REWARD_STEP_SIZE) * REWARD_STEP_SIZE + REWARD_STEP_SIZE;
  }

  private calculateProgramExpiry(startDate: string | null): string | null {
    if (!startDate) {
      return null;
    }

    const date = new Date(startDate);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date.toISOString();
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidPromotion(value: unknown): value is RewardPromotionRaw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const promotion = value as Record<string, unknown>;
  const category = promotion['Category'];
  const products = promotion['Products'];
  const contentTypes = promotion['TIContentTypes'];
  return (
    typeof promotion['PromotionID'] === 'string' &&
    Boolean(promotion['PromotionID'].trim()) &&
    typeof category === 'string' &&
    REWARD_CATEGORIES.some((candidate) => candidate.toLowerCase() === category.toLowerCase()) &&
    ['Description', 'DiscountType', 'ExpiresAT', 'Coupon', 'EligiblityComment', 'LogoURL'].every((field) => isOptionalString(promotion[field])) &&
    ['Discount', 'RequiredRewards', 'RelativeExpiryInterval'].every((field) => isOptionalNonNegativeNumber(promotion[field])) &&
    ['Eligible', 'Redeemed'].every((field) => isOptionalBoolean(promotion[field])) &&
    (products == null || (Array.isArray(products) && products.every(isValidPromotionProduct))) &&
    (contentTypes == null || (Array.isArray(contentTypes) && contentTypes.every((item) => typeof item === 'string')))
  );
}

function isOptionalString(value: unknown): boolean {
  return value == null || typeof value === 'string';
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isOptionalBoolean(value: unknown): boolean {
  return value == null || typeof value === 'boolean';
}

function isValidPromotionProduct(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const product = value as Record<string, unknown>;
  return ['ID', 'Name', 'LogoURL'].every((field) => isOptionalString(product[field]));
}
