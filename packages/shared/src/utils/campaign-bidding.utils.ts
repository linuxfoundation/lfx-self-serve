// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CAMPAIGN_BIDDING_CENT_SCALE, CAMPAIGN_BIDDING_RULES } from '../constants/campaign.constants';
import type {
  CampaignBiddingConfig,
  CampaignBiddingContext,
  CampaignBiddingDraft,
  CampaignBiddingPlatform,
  CampaignBiddingPlatformRule,
} from '../interfaces/campaign.interface';

/**
 * Create-time bidding (#3299): the client-side mirror of the checks campaign-service runs on a
 * per-platform `bidding` object before it accepts a create (linuxfoundation/lfx-v2-campaign-service#332,
 * `internal/dispatch/bidding.go` and each dispatcher's `<platform>BidPlan`).
 *
 * The service stays the authority — it answers a broken bid with a synchronous 400 — but a choice
 * these functions refuse is one it would refuse too, so the form can say why before submitting.
 * Nothing is rounded: like the service, an amount finer than the platform's unit is refused, because
 * rounding would send one bid and record another.
 */

/** The default choice: automatic, no amount. */
export function defaultCampaignBiddingDraft(): CampaignBiddingDraft {
  return { strategy: 'automatic', bidAmount: null };
}

/**
 * Why this platform cannot be created with this bidding choice, or `null` when it can.
 *
 * Automatic is always sendable. Manual needs a finite amount greater than zero, within the
 * platform's bounds, at the platform's precision, and — per platform — the right objective (Meta,
 * Reddit) and a budget that fits the bid (Meta's daily budget of at least 5× the bid, X's bid of at
 * most the daily budget).
 */
export function campaignBiddingError(platform: CampaignBiddingPlatform, draft: CampaignBiddingDraft, context: CampaignBiddingContext = {}): string | null {
  if (draft.strategy === 'automatic') {
    return null;
  }
  const rule = CAMPAIGN_BIDDING_RULES[platform];
  const amount = draft.bidAmount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'Enter a max CPC bid for manual bidding, or choose Automatic.';
  }
  if (amount <= 0) {
    return 'The max CPC bid must be greater than zero.';
  }
  if (amount < rule.minBid) {
    return `The max CPC bid must be at least ${rule.minBid}.`;
  }
  if (amount > rule.maxBid) {
    return `The max CPC bid can be at most ${rule.maxBid.toLocaleString('en-US')}.`;
  }
  if (!isWholeMultiple(amount, rule.scale)) {
    return rule.scale === CAMPAIGN_BIDDING_CENT_SCALE
      ? 'Use at most two decimal places. The bid is never rounded.'
      : 'Use at most six decimal places. The bid is never rounded.';
  }
  const objectiveError = manualObjectiveError(rule, context.objective);
  if (objectiveError !== null) {
    return objectiveError;
  }
  return budgetError(rule, amount, context.dailyBudget ?? null);
}

/**
 * The `bidding` object to send, or `null` when the choice cannot be sent (see
 * {@link campaignBiddingError}). Never an empty string, never a `null` field and never an amount
 * beside `automatic` — the shapes campaign-service refuses.
 */
export function campaignBiddingPayload(
  platform: CampaignBiddingPlatform,
  draft: CampaignBiddingDraft,
  context: CampaignBiddingContext = {}
): CampaignBiddingConfig | null {
  if (campaignBiddingError(platform, draft, context) !== null) {
    return null;
  }
  if (draft.strategy === 'manual' && typeof draft.bidAmount === 'number') {
    return { strategy: 'manual', bidAmount: draft.bidAmount };
  }
  return { strategy: 'automatic' };
}

/**
 * The recorded `bidding_strategy` / `max_cpc_bid` of a campaign as one read-only line, or `''` when
 * neither is recorded. Values the contract does not define are ignored rather than echoed, because
 * they arrive from an index this app does not control.
 */
export function campaignBiddingSummary(platform: string, biddingStrategy: unknown, maxCpcBid: unknown): string {
  const strategy = biddingStrategy === 'automatic' || biddingStrategy === 'manual' ? biddingStrategy : null;
  const bid = typeof maxCpcBid === 'number' && Number.isFinite(maxCpcBid) && maxCpcBid > 0 ? maxCpcBid : null;
  const currency = platform === 'linkedin-ads' ? 'USD' : 'in the ad account currency';
  const bidText = bid === null ? '' : `max CPC bid ${bid} ${currency}`;
  if (strategy === 'automatic') {
    return bidText === '' ? 'Bidding: automatic' : `Bidding: created automatic · ${bidText}`;
  }
  if (strategy === 'manual') {
    return bidText === '' ? 'Bidding: manual' : `Bidding: manual · ${bidText}`;
  }
  return bidText === '' ? '' : `Bidding: ${bidText}`;
}

/**
 * Whether `amount` is exactly a whole number of `1/scale` units at the precision a decimal input
 * carries — the same round trip campaign-service's `exactScaled` makes. 0.29 at scale 100 passes;
 * 0.295 does not, and is never turned into 0.3 or 0.29.
 */
function isWholeMultiple(amount: number, scale: number): boolean {
  const scaled = Math.round(amount * scale);
  return Number.isSafeInteger(scaled) && scaled / scale === amount;
}

function manualObjectiveError(rule: CampaignBiddingPlatformRule, objective: string | undefined): string | null {
  if (rule.manualObjectives === null) {
    return null;
  }
  const effective = objective?.trim().toLowerCase() || rule.defaultObjective || '';
  if (rule.manualObjectives.includes(effective)) {
    return null;
  }
  const names = rule.manualObjectives.map((o) => o.charAt(0).toUpperCase() + o.slice(1)).join(' or ');
  return `Manual bidding on ${rule.label} needs the ${names} objective. Choose it, or use Automatic.`;
}

function budgetError(rule: CampaignBiddingPlatformRule, amount: number, dailyBudget: number | null): string | null {
  // No daily budget to compare with (a lifetime budget, or none yet): nothing to check here. A
  // missing or non-positive budget is the budget field's own error.
  if (dailyBudget === null || !Number.isFinite(dailyBudget) || dailyBudget <= 0) {
    return null;
  }
  if (rule.dailyBudgetMultiple !== null) {
    // Compared in whole cents, so floating-point error cannot refuse an exact 5×. Meta itself
    // compares in the account currency's minor units; for a zero-decimal currency (JPY) a
    // fractional budget can round up there and pass where this refuses — a budget field of whole
    // units never reaches that case.
    const budgetCents = Math.round(dailyBudget * CAMPAIGN_BIDDING_CENT_SCALE);
    const bidCents = Math.round(amount * CAMPAIGN_BIDDING_CENT_SCALE);
    if (budgetCents < rule.dailyBudgetMultiple * bidCents) {
      const needed = (rule.dailyBudgetMultiple * bidCents) / CAMPAIGN_BIDDING_CENT_SCALE;
      return `${rule.label} needs a daily budget of at least ${rule.dailyBudgetMultiple}× the bid (${needed}). Raise the budget, lower the bid, or use Automatic.`;
    }
  }
  if (rule.bidAtMostDailyBudget && Math.round(amount * rule.scale) > Math.round(dailyBudget * rule.scale)) {
    return `The max CPC bid cannot exceed the daily budget (${dailyBudget}) on ${rule.label}.`;
  }
  return null;
}
