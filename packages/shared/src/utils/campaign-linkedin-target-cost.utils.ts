// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CAMPAIGN_BIDDING_CENT_SCALE, CAMPAIGN_BIDDING_MAX_BID, LINKEDIN_TARGET_AMOUNT_FIELD } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';

/**
 * LinkedIn target cost (linuxfoundation/lfx-v2-campaign-service#674), mirroring campaign-service's checks on
 * `linkedInConfig.bidding.targetAmount` (`checkBiddingShape` in `internal/dispatch/bidding.go`, `linkedinTargetAmount`
 * and `linkedinBidPlan` in `internal/dispatch/linkedin.go`, `ValidateTargetCost` in
 * `internal/platform/linkedin/bid_update.go`), so a create campaign-service would refuse is refused here first, with a
 * field to point at.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Whether `amount` is a whole number of cents, exactly: campaign-service's round trip through the two-decimal wire form
 * (`validateCentAmount`). Never rounded, so 2.345 is refused rather than sent as 2.35.
 */
function isWholeCents(amount: number): boolean {
  const cents = Math.round(amount * CAMPAIGN_BIDDING_CENT_SCALE);
  return Number((cents / CAMPAIGN_BIDDING_CENT_SCALE).toFixed(2)) === amount;
}

/**
 * Why `raw`'s `bidding.targetAmount` cannot be sent, or `null` (#674). Typed runtime checks, since the create route has no
 * body validator. Absent the key (or a `bidding` that is not an object, which campaign-service refuses on its own),
 * nothing is checked. Refused, in campaign-service's order:
 *
 * - a `targetAmount` that is not a number: `null`, text or any other JSON type (`checkBiddingShape`);
 * - any `targetAmount` while this deployment cannot send one (`enabled`): refused, never dropped, since the legacy
 *   creator ignores it and campaign-service refuses it while its own `LINKEDIN_ADS_TARGET_COST_ENABLED` is off;
 * - a `targetAmount` beside `strategy: "manual"`: a manual campaign's bid is `bidAmount`;
 * - an amount that is not finite and above zero, exceeds `CAMPAIGN_BIDDING_MAX_BID`, rounds to zero cents, or is not a
 *   whole number of cents (`ValidateTargetCost`).
 *
 * Messages never echo a caller value.
 */
export function linkedInTargetCostRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const bidding = plainRecord(plainRecord(raw)?.['bidding']);
  if (!bidding || !('targetAmount' in bidding)) return null;
  const field = LINKEDIN_TARGET_AMOUNT_FIELD;
  const amount = bidding['targetAmount'];
  if (typeof amount !== 'number') {
    return { field, message: 'The target cost must be a number in USD, for example 17.88. Remove it for automatic bidding with no target.' };
  }
  if (!enabled) return { field, message: 'This deployment cannot set a LinkedIn target cost. Remove it to create the campaign with automatic bidding.' };
  if (bidding['strategy'] === 'manual') {
    return { field, message: 'A target cost is only accepted with automatic bidding. A manual campaign takes a bid amount instead.' };
  }
  if (!Number.isFinite(amount) || amount <= 0) return { field, message: 'The target cost must be greater than zero.' };
  if (amount > CAMPAIGN_BIDDING_MAX_BID) return { field, message: 'The target cost can be at most 1,000,000 USD.' };
  if (Math.round(amount * CAMPAIGN_BIDDING_CENT_SCALE) < 1) return { field, message: 'The smallest target cost is 0.01 USD.' };
  if (!isWholeCents(amount)) return { field, message: 'The target cost must be a whole number of cents (at most two decimals).' };
  return null;
}
