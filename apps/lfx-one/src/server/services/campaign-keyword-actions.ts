// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  BulkKeywordActionRequest,
  BulkKeywordActionResponse,
  CampaignServiceKeywordActionInput,
  KeywordActionRequest,
  KeywordActionResponse,
  KeywordActionType,
} from '@lfx-one/shared/interfaces';

// ---------------------------------------------------------------------------
// Keyword actions across campaign-service
//
// The UI sends ONE flat list of keywords with one action. campaign-service takes one
// brief- and campaign-scoped request whose batch is atomic, and that difference is
// deliberate upstream rather than an inconvenience: `api-catalog.md` rule 5 forbids a bulk
// mutation endpoint precisely because a single call would cut across per-target permission
// boundaries. So the grouping and the fan-out belong here, where each resulting call is still
// one permission-evaluated target.
//
// What that costs, stated plainly: a batch spanning several campaigns is atomic PER CAMPAIGN
// and not overall. One campaign's keywords can pause while another's request fails. The UI's
// response shape already models exactly that — `{succeeded, failed, results}` — so the outcome
// is reportable; what must not happen is reporting a campaign's failure as a success, or
// claiming an action was applied to a keyword whose campaign never resolved.
// ---------------------------------------------------------------------------

/** campaign-service's action vocabulary is UPPERCASE; the UI's is lowercase. */
function upstreamAction(action: KeywordActionType): 'PAUSE' | 'REMOVE' {
  return action === 'remove' ? 'REMOVE' : 'PAUSE';
}

/**
 * The label the UI shows for a keyword.
 *
 * Matches the legacy path's wording exactly. The keyword TEXT is not available here — the
 * request carries ids only — so changing this to something friendlier would require a lookup
 * the action path does not do, and inventing a name would be worse than a precise id.
 */
function keywordLabel(criterionId: string): string {
  return `Criterion ${criterionId}`;
}

function failure(action: KeywordActionType, criterionId: string, message: string): KeywordActionResponse {
  return { success: false, action, keyword: keywordLabel(criterionId), message };
}

function success(action: KeywordActionType, criterionId: string): KeywordActionResponse {
  return {
    success: true,
    action,
    keyword: keywordLabel(criterionId),
    message: `Keyword ${action === 'remove' ? 'removed' : 'paused'} successfully`,
  };
}

/**
 * One outcome together with the request entry it belongs to.
 *
 * The pairing is what makes the response re-orderable: the grouped sequence is not the request
 * sequence, and the client reads results positionally.
 */
export interface OrderedKeywordResult {
  source: KeywordActionRequest;
  response: KeywordActionResponse;
}

/** One campaign's worth of the request, keyed by the platform campaign id the UI sent. */
export interface KeywordActionGroup {
  platformCampaignId: string;
  keywords: KeywordActionRequest[];
}

/**
 * Group the flat request by campaign, preserving the order each campaign was first seen.
 *
 * Order matters for the response: the UI renders `results` as a list, and a stable grouping
 * keeps a batch's results in a predictable order rather than one that depends on object-key
 * iteration for numeric-looking keys.
 */
export function groupByCampaign(keywords: KeywordActionRequest[]): KeywordActionGroup[] {
  const groups = new Map<string, KeywordActionGroup>();
  for (const kw of keywords) {
    const existing = groups.get(kw.campaignId);
    if (existing) {
      existing.keywords.push(kw);
      continue;
    }
    groups.set(kw.campaignId, { platformCampaignId: kw.campaignId, keywords: [kw] });
  }
  return [...groups.values()];
}

export function toUpstreamActions(keywords: KeywordActionRequest[], action: KeywordActionType): CampaignServiceKeywordActionInput[] {
  return keywords.map((kw) => ({
    ad_group_id: kw.adGroupId,
    criterion_id: kw.criterionId,
    action: upstreamAction(action),
  }));
}

/**
 * Build the response entries for one campaign whose batch was applied.
 *
 * Every keyword in the group is reported as applied, and that is sound ONLY because the
 * upstream batch is all-or-nothing: `applied_count` always equals the number requested, or the
 * whole call threw. Reading `results` back per-criterion would be no more accurate and would
 * silently drop a keyword if upstream ever returned them in a different order.
 */
export function appliedResults(group: KeywordActionGroup, action: KeywordActionType): OrderedKeywordResult[] {
  return group.keywords.map((kw) => ({ source: kw, response: success(action, kw.criterionId) }));
}

/**
 * Build the response entries for one campaign whose batch did NOT apply.
 *
 * EVERY keyword in the group is marked failed, not just one. The batch is atomic, so a failure
 * means none of them changed — reporting anything else would leave a caller believing some
 * keywords were paused and hunting for which.
 */
export function failedResults(group: KeywordActionGroup, action: KeywordActionType, message: string): OrderedKeywordResult[] {
  return group.keywords.map((kw) => ({ source: kw, response: failure(action, kw.criterionId, message) }));
}

/**
 * Collapse per-keyword outcomes into the UI's bulk response.
 *
 * `success` is true only when every keyword applied. A partially-applied batch is a failure at
 * this level even though each campaign either fully applied or fully did not: the caller asked
 * for one thing and got part of it.
 */
/**
 * Restore the caller's original keyword order.
 *
 * THE RESPONSE IS POSITIONAL. `optimization-tab.component.ts` zips `res.results[i]` onto the
 * keyword list it sent, so an entry that moves lands on a DIFFERENT keyword — and a still-
 * spending keyword can be shown as paused. The legacy path could not hit this because it looped
 * the request in order; grouping by campaign reorders whenever campaigns interleave, so the
 * order has to be put back before the response leaves.
 *
 * Matched on the (adGroupId, criterionId) pair rather than criterionId alone, because a
 * criterion id is unique only within its ad group — the same reason `keyword-actions` upstream
 * requires both to address a criterion.
 *
 * A result with no matching request entry cannot arise from this module's own grouping, but it
 * is dropped rather than appended: appending would push every later entry one position out and
 * reintroduce exactly the misalignment this exists to prevent.
 */
export function inRequestOrder(keywords: KeywordActionRequest[], results: OrderedKeywordResult[]): KeywordActionResponse[] {
  const byKeyword = new Map<string, KeywordActionResponse[]>();
  for (const { source, response } of results) {
    const key = `${source.adGroupId}-${source.criterionId}`;
    const bucket = byKeyword.get(key);
    if (bucket) bucket.push(response);
    else byKeyword.set(key, [response]);
  }
  // shift() so a request naming the same keyword twice consumes one result per occurrence
  // rather than repeating the first.
  return keywords
    .map((kw) => byKeyword.get(`${kw.adGroupId}-${kw.criterionId}`)?.shift())
    .filter((r): r is KeywordActionResponse => r !== undefined);
}

export function toBulkResponse(results: KeywordActionResponse[]): BulkKeywordActionResponse {
  const succeeded = results.filter((r) => r.success).length;
  return {
    success: succeeded === results.length && results.length > 0,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

/**
 * Why a campaign could not be acted on, in words a user can act on.
 *
 * Both cases are refusals rather than errors upstream, so they arrive as ordinary answers and
 * have to be turned into per-keyword failures here.
 */
export const CAMPAIGN_UNRESOLVED = 'This campaign is not managed here, so its keywords cannot be changed.';
/**
 * A lookup that FAILED, as distinct from one that answered "no such campaign".
 *
 * Kept separate because the two call for opposite responses: an unowned campaign will never be
 * actionable and retrying is pointless, while a resolver outage is transient and retrying is
 * exactly right. Reporting a failure as CAMPAIGN_UNRESOLVED tells someone their campaign is not
 * managed here — so they stop trying, and a spending campaign keeps spending.
 */
export const CAMPAIGN_LOOKUP_FAILED = 'The campaign could not be looked up just now. Try again.';
export const CAMPAIGN_AMBIGUOUS = 'This campaign id matches more than one campaign, so it is not clear which to change.';

export type { BulkKeywordActionRequest };
