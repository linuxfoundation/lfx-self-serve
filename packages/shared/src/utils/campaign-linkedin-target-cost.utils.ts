// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CAMPAIGN_BIDDING_CENT_SCALE, CAMPAIGN_BIDDING_MAX_BID, LINKEDIN_TARGET_AMOUNT_FIELD } from '../constants/campaign.constants';
import type {
  CampaignBiddingConfig,
  LinkedInBiddingConfig,
  LinkedInConfigKeyRefusal,
  LinkedInObjectiveDraft,
  LinkedInTargetCostOfferInput,
} from '../interfaces/campaign.interface';

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

/**
 * Whether the Implement tab offers a target cost: an explicit yes from `linkedInTargetCostEnabled`, the Bidding control
 * offered (the target travels inside `bidding`), and LinkedIn's choice automatic, the default while untouched. The
 * helpers below are the tab's side; the amount rules stay `linkedInTargetCostRefusal`'s, so the tab refuses exactly what
 * the create route would.
 */
export function linkedInTargetCostOffered(input: LinkedInTargetCostOfferInput): boolean {
  return input.enabled === true && input.biddingAvailable && (input.strategy ?? 'automatic') === 'automatic';
}

/**
 * The typed text as the create would carry it: `undefined` when blank (no target), a number for a plain decimal, else the
 * text itself, which `linkedInTargetCostRefusal` refuses as not a number. Never `Number()` alone, which reads `0x10` or
 * `1e3` as numbers the operator did not type as an amount.
 */
function typedTargetCost(text: string | undefined): number | string | undefined {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') return undefined;
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** `draft` with the target cost as typed; a blank removes it, so a cleared field sends nothing and saves nothing. */
export function linkedInObjectiveDraftWithTargetCost(draft: LinkedInObjectiveDraft, text: string): LinkedInObjectiveDraft {
  const next: LinkedInObjectiveDraft = { objective: draft.objective, conversions: draft.conversions, conversionsOwner: draft.conversionsOwner };
  return text.trim() === '' ? next : { ...next, targetCost: text };
}

/** Why the typed target cost cannot be sent, as the field shows it, or `null`: blank or not offered holds nothing. */
export function linkedInTargetCostInputError(text: string | undefined, offered: boolean): string | null {
  const amount = typedTargetCost(text);
  if (!offered || amount === undefined) return null;
  return linkedInTargetCostRefusal({ bidding: { strategy: 'automatic', targetAmount: amount } }, true)?.message ?? null;
}

/** Why the target cost holds Create, as the create button says it, or `null`; see `linkedInTargetCostInputError`. */
export function linkedInTargetCostCreateRefusal(draft: LinkedInObjectiveDraft, offered: boolean): string | null {
  const error = linkedInTargetCostInputError(draft.targetCost, offered);
  return error === null ? null : `LinkedIn Ads: ${error}`;
}

/**
 * The LinkedIn `bidding` key with the target cost added: only while offered, beside an automatic `bidding`, and for a
 * typed number. Otherwise `field` unchanged, so a value kept while hidden (manual bidding, the capability off) is never
 * sent. A refused amount is held by `linkedInTargetCostCreateRefusal` before this is sent.
 */
export function linkedInBiddingWithTargetCost(
  field: { bidding?: CampaignBiddingConfig },
  draft: LinkedInObjectiveDraft,
  offered: boolean
): { bidding?: LinkedInBiddingConfig } {
  const amount = typedTargetCost(draft.targetCost);
  if (!offered || field.bidding?.strategy !== 'automatic' || typeof amount !== 'number') return field;
  return { bidding: { ...field.bidding, targetAmount: amount } };
}
