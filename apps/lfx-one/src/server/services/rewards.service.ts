// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REWARD_STEP_SIZE } from '@lfx-one/shared/constants';
import {
  REWARD_CATEGORIES,
  RewardCouponGenerationResponse,
  RewardPromotion,
  RewardPromotionCategory,
  RewardPromotionGroups,
  RewardPromotionRaw,
  RewardPromotionsPage,
  RewardsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { API_GW_TIMEOUT_MS, NEVER_EXPIRES_YEAR_PREFIX, REWARDS_SERVICE_NAME, UPSTREAM_ERROR_BODY_LIMIT } from '../constants';
import { MicroserviceError } from '../errors';
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { logger } from './logger.service';

export class RewardsService {
  public async getSummary(req: Request): Promise<RewardsSummaryResponse> {
    logger.debug(req, 'get_rewards_summary', 'Fetching rewards profile and promotions');

    const [userProfile, promotions] = await Promise.all([this.fetchUserProfile(req), this.fetchPromotions(req)]);
    const groupedPromotions = this.groupPromotions(promotions);
    const points = this.parsePoints(userProfile.TuxRewards);
    const nextRewardPoints = this.calculateNextThreshold(points);

    return {
      points,
      nextRewardPoints,
      pointsToNextReward: Math.max(0, nextRewardPoints - points),
      progressPercentage: nextRewardPoints > 0 ? Math.min(100, Math.round((points / nextRewardPoints) * 100)) : 0,
      programStartDate: userProfile.TuxProgramStartDate ?? null,
      programExpiryDate: this.calculateProgramExpiry(userProfile.TuxProgramStartDate),
      groupedPromotions,
      availableIncentives: this.flattenPromotions(groupedPromotions, 'earned'),
      coupons: this.flattenPromotions(groupedPromotions, 'redeemable'),
    };
  }

  public async redeemPromotion(req: Request, promotionId: string): Promise<RewardCouponGenerationResponse> {
    logger.debug(req, 'redeem_promotion', 'Generating coupon for promotion', { promotion_id: promotionId });

    return this.gatewayFetch<RewardCouponGenerationResponse>(req, `/me/promotions/${encodeURIComponent(promotionId)}/generateCoupon`, {
      operation: 'redeem_promotion',
      errorMessage: 'Coupon generation failed',
      errorCode: 'COUPON_GENERATION_FAILED',
      method: 'POST',
    });
  }

  private async fetchUserProfile(req: Request): Promise<{ TuxRewards: number; TuxProgramStartDate: string | null }> {
    logger.debug(req, 'fetch_user_profile', 'Fetching user profile for rewards data');

    const profile = await this.gatewayFetch<Record<string, unknown>>(req, '/me', {
      operation: 'fetch_user_profile',
      errorMessage: 'User profile fetch failed',
      errorCode: 'USER_PROFILE_FETCH_FAILED',
    });

    return {
      TuxRewards: Number(profile?.['TuxRewards']) || 0,
      TuxProgramStartDate: (profile?.['TuxProgramStartDate'] as string) ?? null,
    };
  }

  private async fetchPromotions(req: Request): Promise<RewardPromotionRaw[]> {
    logger.debug(req, 'fetch_promotions', 'Fetching user promotions');

    // Upstream `/me/promotions` is paginated as `{ Data, Metadata: { Offset, PageSize, TotalSize } }`.
    // Iterate until we have collected `TotalSize` items (or the page comes back short)
    // so the UI never silently drops incentives/coupons that fall past the first page.
    const promotions: RewardPromotionRaw[] = [];
    let offset = 0;

    while (true) {
      const response = await this.gatewayFetch<RewardPromotionsPage>(req, `/me/promotions?Offset=${offset}&PageSize=${REWARD_STEP_SIZE}`, {
        operation: 'fetch_promotions',
        errorMessage: 'Promotions fetch failed',
        errorCode: 'PROMOTIONS_FETCH_FAILED',
      });

      const data = response?.Data;

      if (!Array.isArray(data)) {
        logger.warning(req, 'fetch_promotions', 'Promotions response missing Data array', {
          response_type: typeof response,
          has_data: response?.Data !== undefined,
          offset,
        });
        return promotions;
      }

      const validPromotions = data.filter((item): item is RewardPromotionRaw => Boolean(item) && typeof item === 'object');
      promotions.push(...validPromotions);

      const metadata = response?.Metadata;
      const metadataOffset = typeof metadata?.Offset === 'number' ? metadata.Offset : offset;
      const totalSize = typeof metadata?.TotalSize === 'number' ? metadata.TotalSize : undefined;
      const nextOffset = metadataOffset + data.length;

      if (typeof totalSize === 'number' && nextOffset >= totalSize) {
        break;
      }

      if (data.length === 0 || data.length < REWARD_STEP_SIZE) {
        break;
      }

      // Defensive guard: if upstream metadata never advances, bail out instead of looping forever.
      if (nextOffset <= offset) {
        logger.warning(req, 'fetch_promotions', 'Promotions pagination did not advance offset', {
          offset,
          metadata_offset: metadata?.Offset,
          page_size: data.length,
          total_size: metadata?.TotalSize,
        });
        break;
      }

      offset = nextOffset;
    }

    return promotions;
  }

  private async gatewayFetch<T>(
    req: Request,
    path: string,
    options: { operation: string; errorMessage: string; errorCode: string; method?: 'GET' | 'POST' }
  ): Promise<T> {
    const baseUrl = getUserServiceBaseUrl(options.operation, REWARDS_SERVICE_NAME);
    this.assertApiGatewayToken(req, options.operation);

    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: { Authorization: `Bearer ${req.apiGatewayToken}` },
        signal: AbortSignal.timeout(API_GW_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        logger.warning(req, options.operation, 'Upstream request timed out', {
          timeout_ms: API_GW_TIMEOUT_MS,
        });
        throw new MicroserviceError(`${options.errorMessage}: request timed out after ${API_GW_TIMEOUT_MS}ms`, 504, 'UPSTREAM_TIMEOUT', {
          operation: options.operation,
        });
      }

      const cause = (error as (Error & { cause?: { code?: string } }) | undefined)?.cause;
      const networkCode = cause?.code ?? 'UPSTREAM_UNREACHABLE';
      const message = error instanceof Error ? error.message : String(error);

      logger.warning(req, options.operation, 'Upstream request failed before response', {
        error_code: networkCode,
        error_message: message,
      });

      throw new MicroserviceError(`${options.errorMessage}: ${message}`, 502, networkCode, {
        operation: options.operation,
      });
    }

    if (!upstream.ok) {
      // Capture the upstream body (truncated) so production logs preserve the
      // root cause — user-service typically explains *why* in the body, not
      // just the status line.
      const body = (await upstream.text().catch(() => '')).slice(0, UPSTREAM_ERROR_BODY_LIMIT);

      logger.warning(req, options.operation, 'Upstream returned non-OK response', {
        status: upstream.status,
        status_text: upstream.statusText,
        body,
      });

      throw new MicroserviceError(`${options.errorMessage}: ${upstream.status} ${upstream.statusText}`, upstream.status, options.errorCode, {
        operation: options.operation,
        errorBody: body,
      });
    }

    // Parse defensively — empty bodies and malformed JSON should surface as a
    // MicroserviceError, not an opaque SyntaxError from `await upstream.json()`
    // and not silently coerce to `null` (which would mask upstream failures
    // as degraded-but-successful responses).
    const rawBody = await upstream.text();

    if (!rawBody.trim()) {
      logger.warning(req, options.operation, 'Upstream returned empty response body', {
        status: upstream.status,
        status_text: upstream.statusText,
      });

      throw new MicroserviceError(`${options.errorMessage}: empty response from upstream`, 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: options.operation,
      });
    }

    try {
      return JSON.parse(rawBody) as T;
    } catch (error: unknown) {
      const truncatedBody = rawBody.slice(0, UPSTREAM_ERROR_BODY_LIMIT);
      const message = error instanceof Error ? error.message : String(error);

      logger.warning(req, options.operation, 'Upstream returned invalid JSON response', {
        status: upstream.status,
        status_text: upstream.statusText,
        body: truncatedBody,
        error: message,
      });

      throw new MicroserviceError(`${options.errorMessage}: invalid JSON response from upstream`, 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: options.operation,
        errorBody: truncatedBody,
      });
    }
  }

  private assertApiGatewayToken(req: Request, operation: string): void {
    if (!req.apiGatewayToken) {
      throw new MicroserviceError('API Gateway token not available — check API_GW_AUDIENCE env var and auth logs', 503, 'API_GATEWAY_UNAVAILABLE', {
        service: REWARDS_SERVICE_NAME,
        operation,
      });
    }
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

  private parsePoints(value: unknown): number {
    // Negative values from upstream are treated as 0 (defensive — TuxRewards
    // is always >= 0 in practice, but a malformed payload should not surface
    // a negative point balance to the UI).
    const points = Number(value);
    return Number.isFinite(points) && points >= 0 ? Math.floor(points) : 0;
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
