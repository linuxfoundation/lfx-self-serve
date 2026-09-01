// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import type { CampaignServiceClient } from './campaign-service.service';
import { logger } from './logger.service';

import type {
  BulkKeywordActionRequest,
  CampaignServiceKeywordActions,
  BulkKeywordActionResponse,
  CampaignServiceKeywordActionInput,
  KeywordActionGroup,
  KeywordActionRequest,
  KeywordActionResponse,
  KeywordActionType,
  OrderedKeywordResult,
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
  return keywords.map((kw) => byKeyword.get(`${kw.adGroupId}-${kw.criterionId}`)?.shift()).filter((r): r is KeywordActionResponse => r !== undefined);
}

/**
 * Collapse per-keyword outcomes into the UI's bulk response.
 *
 * `success` is true only when every keyword applied. A partially-applied batch is a failure at
 * this level even though each campaign either fully applied or fully did not: the caller asked
 * for one thing and got part of it.
 */
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

/**
 * Compare what upstream confirmed against what was requested; returns a short description of the
 * difference, or null when they match.
 *
 * Matched as a MULTISET over (ad_group_id, criterion_id, action): order is not part of the
 * contract, but membership and count are. A criterion named twice in the request must be
 * confirmed twice, which is why counts are compared rather than sets.
 */
function describeOutcomeMismatch(group: KeywordActionGroup, action: KeywordActionType, applied: CampaignServiceKeywordActions): string | null {
  const requested = toUpstreamActions(group.keywords, action);
  if (applied.applied_count !== requested.length) {
    return `applied_count ${applied.applied_count} != ${requested.length} requested`;
  }
  const key = (a: { ad_group_id: string; criterion_id: string; action: string }): string => `${a.ad_group_id}~${a.criterion_id}~${a.action}`;
  const tally = new Map<string, number>();
  for (const a of requested) {
    tally.set(key(a), (tally.get(key(a)) ?? 0) + 1);
  }
  for (const r of applied.results) {
    const remaining = tally.get(key(r));
    if (!remaining) {
      return 'upstream confirmed a criterion that was not requested';
    }
    tally.set(key(r), remaining - 1);
  }
  for (const remaining of tally.values()) {
    if (remaining !== 0) {
      return 'upstream did not confirm every requested criterion';
    }
  }
  return null;
}

/**
 * The batch may or may not have applied. Distinct from a definite failure: upstream returned a
 * 2xx, so the mutation probably ran — the confirmation simply does not match what was asked. The
 * caller must verify in the platform rather than retry, because a retried REMOVE is irreversible.
 */
export const CAMPAIGN_OUTCOME_UNCONFIRMED =
  'The change was sent but the confirmation did not match the request. Check the campaign in Google Ads before retrying.';

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

/**
 * Apply keyword actions through campaign-service, one call per campaign.
 *
 * The UI sends a flat keyword list; campaign-service takes a brief- and campaign-scoped batch.
 * The grouping lives here rather than upstream because `api-catalog.md` rule 5 forbids a bulk
 * mutation endpoint — each call this makes is still one permission-evaluated target.
 *
 * ATOMIC PER CAMPAIGN, NOT OVERALL. One campaign's keywords can pause while another's request
 * fails, so every keyword is reported individually and a campaign-level failure marks ALL of
 * that campaign's keywords failed — the batch is all-or-nothing upstream, so claiming
 * otherwise would leave someone hunting for which half applied.
 *
 * Campaigns are resolved and applied SEQUENTIALLY rather than in parallel. These are
 * spend-affecting mutations on live campaigns, and a burst of concurrent mutates against one
 * ad account is the shape most likely to hit upstream rate limiting — which would fail
 * campaigns for a reason that has nothing to do with the request.
 */
export async function applyKeywordActionsViaCampaignService(
  req: Request,
  client: CampaignServiceClient,
  projectSlug: string,
  body: BulkKeywordActionRequest
): Promise<BulkKeywordActionResponse> {
  const results: OrderedKeywordResult[] = [];

  for (const group of groupByCampaign(body.keywords)) {
    let ref;
    try {
      const resolution = await client.resolveGoogleAdsCampaign(req, projectSlug, group.platformCampaignId);
      // An unowned id is a 200 with no matches, not a throw — so this is checked, never
      // assumed. Acting on an unresolved campaign is not possible, and silently skipping it
      // would drop the keyword from the response entirely.
      if (resolution.match_count === 0) {
        results.push(...failedResults(group, body.action, CAMPAIGN_UNRESOLVED));
        continue;
      }
      // Ambiguity is refused rather than resolved by taking the first match: upstream reports
      // it precisely because picking one would mutate a campaign nobody named.
      if (resolution.match_count > 1) {
        results.push(...failedResults(group, body.action, CAMPAIGN_AMBIGUOUS));
        continue;
      }
      ref = resolution.matches[0];
    } catch (error) {
      // A failed LOOKUP is reported against this campaign's keywords rather than failing the
      // whole request: the other campaigns in the batch are unaffected and their actions
      // should still be attempted.
      logger.warning(req, 'keyword_actions', 'Campaign reference lookup failed', {
        platformCampaignId: group.platformCampaignId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      // A FAILED lookup, not an absent campaign. Reporting it as CAMPAIGN_UNRESOLVED would
      // tell the caller this campaign is not managed here — so they stop retrying, and a
      // spending campaign they meant to pause keeps spending. The distinction is the whole
      // difference between "never going to work" and "try again".
      results.push(...failedResults(group, body.action, CAMPAIGN_LOOKUP_FAILED));
      continue;
    }

    try {
      const applied = await client.applyKeywordActions(req, projectSlug, ref.brief_id, ref.campaign_id, toUpstreamActions(group.keywords, body.action));
      // The 2xx is CHECKED, not assumed. Upstream's batch is all-or-nothing, so applied_count
      // should equal what was sent — but upstream derives it from the results it actually
      // returns (`AppliedCount: len(results)`) rather than asserting it against the request, so a
      // short or altered response would agree with itself. Reporting every requested keyword as
      // changed on the strength of that would tell someone a still-spending keyword was paused,
      // which is the one thing this path must never do.
      const mismatch = describeOutcomeMismatch(group, body.action, applied);
      if (mismatch) {
        logger.warning(req, 'keyword_actions', 'Upstream confirmed a different set than was requested', {
          platformCampaignId: group.platformCampaignId,
          campaignId: ref.campaign_id,
          mismatch,
        });
        results.push(...failedResults(group, body.action, CAMPAIGN_OUTCOME_UNCONFIRMED));
        continue;
      }
      results.push(...appliedResults(group, body.action));
    } catch (error) {
      // The upstream message is surfaced because it carries the one distinction a caller must
      // act on: campaign-service separates a DEFINITE failure from an UNCONFIRMED one where
      // the mutate may already have applied. Flattening that to a generic string would leave
      // someone retrying an irreversible REMOVE that already ran.
      // A transport failure is UNCONFIRMED, not failed. campaign-service marks its own ambiguous
      // outcomes in the message, but a lost connection never reaches it to be marked — the BFF
      // raises the error itself, and the raw text carries no marker for the client to classify.
      // Reporting that as definite invites a retry of a mutate that may already have run, and a
      // retried REMOVE is irreversible. Only a 4xx other than 408 is a boundary refusal that
      // provably never dispatched.
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 0;
      const refusedAtBoundary = status >= 400 && status < 500 && status !== 408;
      const raw = error instanceof Error ? error.message : 'The keyword change could not be applied.';
      const message = refusedAtBoundary ? raw : `${CAMPAIGN_OUTCOME_UNCONFIRMED} (${raw})`;
      logger.warning(req, 'keyword_actions', 'Keyword action batch failed', {
        platformCampaignId: group.platformCampaignId,
        campaignId: ref.campaign_id,
        error: message,
      });
      results.push(...failedResults(group, body.action, message));
    }
  }

  // Put the caller's ORDER back before responding. The client zips `results[i]` onto the
  // keyword list it sent, and grouping by campaign reorders whenever campaigns interleave —
  // so without this a still-spending keyword can be shown as paused.
  return toBulkResponse(inRequestOrder(body.keywords, results));
}
