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
  // CAMPAIGN id included in the key. A criterion id is unique only within its ad group, but the
  // controller accepts a body repeating the same (adGroupId, criterionId) pair under DIFFERENT
  // campaigns -- and grouping by campaign reorders results, so one campaign's failure and
  // another's success landed in a shared bucket and were handed out by arrival order. A keyword
  // that was never paused then reported "Paused", which is the one thing this module must never
  // say.
  const byKeyword = new Map<string, KeywordActionResponse[]>();
  for (const { source, response } of results) {
    const key = `${source.campaignId}-${source.adGroupId}-${source.criterionId}`;
    const bucket = byKeyword.get(key);
    if (bucket) bucket.push(response);
    else byKeyword.set(key, [response]);
  }
  // shift() so a request naming the same keyword twice consumes one result per occurrence
  // rather than repeating the first.
  return keywords
    .map((kw) => byKeyword.get(`${kw.campaignId}-${kw.adGroupId}-${kw.criterionId}`)?.shift())
    .filter((r): r is KeywordActionResponse => r !== undefined);
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
 * Compare what upstream confirmed against what was requested; returns a short description of the
 * difference, or null when they match.
 *
 * Matched as a MULTISET over (ad_group_id, criterion_id, action): order is not part of the
 * contract, but membership and count are. A criterion named twice in the request must be
 * confirmed twice, which is why counts are compared rather than sets.
 */
function describeOutcomeMismatch(
  group: KeywordActionGroup,
  action: KeywordActionType,
  applied: CampaignServiceKeywordActions,
  expectedCampaignId: string
): string | null {
  // THE ECHO, same as the resolver's. `campaign_id` is part of the mutation contract and was
  // never read: a misrouted or stale 2xx describing another campaign satisfies the count and
  // multiset checks below, because those only compare against what WE sent -- nothing tied the
  // response to the campaign it was sent for (Copilot).
  if (applied?.campaign_id !== expectedCampaignId) {
    return `campaign_id ${String(applied?.campaign_id)} != ${expectedCampaignId} requested`;
  }
  const requested = toUpstreamActions(group.keywords, action);
  if (applied.applied_count !== requested.length) {
    return `applied_count ${applied.applied_count} != ${requested.length} requested`;
  }
  // `results` is untrusted wire data, so its SHAPE is checked before it is iterated. A malformed
  // 2xx with `results` missing or null threw a TypeError here, and the caller's catch then
  // classified our own local bug as an upstream failure -- reporting a definite outcome for a
  // request whose actual result nobody had established (Copilot).
  //
  // Reported as a mismatch, which is the same fail-closed answer `applied_count` above already
  // gives: a response that cannot describe what it applied has not confirmed anything.
  if (!Array.isArray(applied.results)) {
    return 'upstream returned no results array to confirm against';
  }
  const key = (a: { ad_group_id: string; criterion_id: string; action: string }): string => `${a.ad_group_id}~${a.criterion_id}~${a.action}`;
  const tally = new Map<string, number>();
  for (const a of requested) {
    tally.set(key(a), (tally.get(key(a)) ?? 0) + 1);
  }
  for (const r of applied.results) {
    // ELEMENT shape, not just the array's. `Array.isArray` was added earlier for a missing
    // `results`, but `results: [null]` is a valid JSON array whose element still throws in
    // `key(r)` -- and that TypeError lands in the mutation catch, which has no errorBody to
    // classify, so it reports this group unconfirmed AND stops the fan-out, abandoning every
    // later campaign over a response that did reach the platform (Copilot).
    //
    // Reported as the controlled mismatch this function exists to return: a response that cannot
    // describe what it applied has confirmed nothing, which is the same answer the array and
    // count checks above already give.
    if (!r || typeof r.ad_group_id !== 'string' || typeof r.criterion_id !== 'string' || typeof r.action !== 'string') {
      return 'upstream returned a result entry that does not name a criterion';
    }
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

/**
 * Whether an error means the request never got a reply, as opposed to being answered.
 *
 * Only this class justifies abandoning the remaining campaigns: a 4xx other than 408 is
 * campaign-service refusing THIS request on its merits and says nothing about the next one.
 * `statusCode` first, because that is the field `MicroserviceError` carries.
 */
export function isTransportFailure(error: unknown): boolean {
  const e = error as { statusCode?: unknown; status?: unknown } | null | undefined;
  let status = 0;
  if (typeof e?.statusCode === 'number') {
    status = e.statusCode;
  } else if (typeof e?.status === 'number') {
    status = e.status;
  }
  // An ANSWER is not an outage, whatever its status. campaign-service returns 500 for a
  // pre-mutate credential fault and 503 for a definite platform refusal; both prove it replied,
  // so aborting the remaining campaigns on them stopped a fan-out that was fine to continue.
  // Only an error the BFF itself raised establishes that the next lookup is doomed.
  if (upstreamAnswered(error)) {
    return false;
  }
  return !(status >= 400 && status < 500 && status !== 408);
}

/**
 * Upstream's own words for an outcome it could not confirm.
 *
 * campaign-service distinguishes unconfirmed from definite IN THE MESSAGE, not in the status:
 * both arms answer 503. Its unconfirmed arm says "the keyword actions are unconfirmed — they may
 * or may not have been applied", while its `default` arm says "the keyword actions could not be
 * applied" and is commented "A DEFINITE upstream failure ... nothing was applied, so a plain
 * retry is the right remedy" (internal/service/brief_keyword_actions.go).
 *
 * Deriving the distinction from the status alone therefore relabelled every answered 500/503 as
 * uncertain — telling an operator not to retry a failure that is safe to retry, and leaving a
 * campaign spending. Matched case-insensitively on a stable fragment rather than the whole
 * sentence, so upstream rewording the tail does not silently flip the meaning back.
 */
const UPSTREAM_UNCONFIRMED_MARKER = 'are unconfirmed';

/**
 * Whether campaign-service ANSWERED, as opposed to never being reached.
 *
 * An answer -- any status it chose, including 500 and 503 -- describes THIS request only. A
 * BFF-raised transport failure is the one thing that says the next campaign is unreachable too,
 * and those are the errors that carry `originalError` or the TIMEOUT code.
 */
function upstreamAnswered(error: unknown): boolean {
  const e = error as { originalError?: unknown; code?: unknown; errorBody?: unknown; statusCode?: unknown } | null | undefined;
  // A BFF-raised failure is never an answer, however it is spelled.
  if (e?.originalError !== undefined || e?.code === 'TIMEOUT') {
    return false;
  }
  // The APPLICATION must have answered, not merely some HTTP layer. A status alone does not
  // establish that: executeRequest raises the same MicroserviceError shape for EVERY !response.ok
  // (see `executeRequest`'s `!response.ok` arm), so an ingress 502/503/504 campaign-service never saw
  // carries a real status and no originalError. Reading those as replies reported a gateway
  // timeout as a DEFINITE failure -- its text has no unconfirmed marker -- and invited a retry of
  // a REMOVE that Google cannot undo.
  //
  // Every campaign-service error is a Goa-rendered body with its own `code` and `message`
  // (internal/service/brief_keyword_actions.go), which executeRequest parses into errorBody. A
  // gateway sends HTML or nothing, so the parse leaves errorBody undefined. That parsed body is
  // the only evidence here that the application itself formed the response.
  // A parsed BODY is not enough on its own: a gateway commonly emits JSON such as
  // `{ message: 'Service Unavailable' }`, which satisfies any is-there-a-message test.
  //
  // What a gateway cannot accidentally produce is campaign-service's OWN error envelope, where
  // `code` is the numeric HTTP status as a STRING -- `{"code":"503","message":...}`. That holds
  // across all 185 error sites in internal/service (verified: every Code literal is numeric,
  // none is a word), and it is the narrowest property that distinguishes the two.
  const body = e?.errorBody as { code?: unknown; message?: unknown } | undefined;
  if (typeof body?.code !== 'string' || !/^[1-5][0-9]{2}$/.test(body.code)) {
    return false;
  }
  // And it must AGREE with the status actually received, so a relayed body cannot vouch for a
  // response the gateway rewrote.
  const status = typeof e?.statusCode === 'number' ? e.statusCode : 0;
  return body.code === String(status);
}

/**
 * The message a failed keyword mutation reports, and whether it claims certainty.
 *
 * EXPORTED so it can be pinned. It lived inline and unexported, which is exactly how it shipped
 * reading `.status` -- a field `MicroserviceError` does not have. Every real proxy error therefore
 * evaluated to 0, so a definite 4xx refusal was tagged UNCONFIRMED and the actionable
 * validation/authorization message was buried behind "may or may not have been applied".
 *
 * `statusCode` first, matching `access-error.helper.ts` and `key-contact-error.helper.ts`;
 * `status` is the fallback for plain `HttpErrorResponse` shapes.
 *
 * Only a 4xx other than 408 is a boundary refusal that provably never dispatched. Transport, 408
 * and 5xx are UNCONFIRMED: the mutate may already have run, and a retried REMOVE is irreversible.
 */
export function classifyMutationFailure(error: unknown): string {
  const e = error as { statusCode?: unknown; status?: unknown } | null | undefined;
  // Not a nested ternary: `.claude/rules` forbids them, and this reads better as a fallback chain.
  let status = 0;
  if (typeof e?.statusCode === 'number') {
    status = e.statusCode;
  } else if (typeof e?.status === 'number') {
    status = e.status;
  }
  const raw = error instanceof Error ? error.message : 'The keyword change could not be applied.';
  // Upstream's own marker decides it whenever upstream answered: it knows whether its mutate went
  // out, and the status cannot carry that (its definite and unconfirmed arms share 503).
  if (upstreamAnswered(error)) {
    return raw.toLowerCase().includes(UPSTREAM_UNCONFIRMED_MARKER) ? `${CAMPAIGN_OUTCOME_UNCONFIRMED} (${raw})` : raw;
  }
  // Nobody answered. A 4xx other than 408 still proves a boundary refusal that never dispatched;
  // anything else is a request that may already have run, so it fails CLOSED.
  const refusedAtBoundary = status >= 400 && status < 500 && status !== 408;
  return refusedAtBoundary ? raw : `${CAMPAIGN_OUTCOME_UNCONFIRMED} (${raw})`;
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
export const CAMPAIGN_DEADLINE_EXCEEDED = 'Not attempted: the request ran out of time before reaching this campaign. Nothing was changed for it.';

/**
 * Wall-clock budget for the whole fan-out, in ms.
 *
 * 45s against the ingress's documented 60s read timeout (`campaign-proxy.service.ts` documents the same ceiling).
 * The row cap bounds how MANY campaigns a request can name; it cannot bound how LONG they take,
 * and each one costs two sequential proxy calls at the client's 30s default. So a request of
 * slow-but-reachable campaigns could still exceed the ingress window -- and when it does, ingress
 * answers the caller while THIS LOOP KEEPS MUTATING, leaving irreversible REMOVEs applied against
 * a request that already reported a timeout (Copilot, raised twice).
 *
 * Stopping at the budget uses the same "not attempted" report the transport-failure path already
 * uses, so nothing new has to be true for a caller: a group either has an outcome, or is named as
 * unattempted.
 *
 * CHECKED TWICE per group, and the second check is what makes the budget real. Between groups is
 * not sufficient on its own -- a group admitted at 44s can spend 30s resolving and 30s mutating,
 * running to ~104s against a 60s window. The second check sits after the read-only resolve and
 * before the mutation, which is the only other point where stopping changes nothing upstream.
 */
export const KEYWORD_ACTION_DEADLINE_MS = 45_000;

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
  // Stops the fan-out once the service is clearly unreachable. The loop is sequential and the
  // controller admits up to MAX_BULK_KEYWORD_ACTIONS distinct campaigns, each costing a lookup at
  // the client's 30s default timeout -- so a campaign-service outage held ONE request open for
  // roughly 25 minutes while sending 50 doomed probes for a single user action.
  //
  // Only a TRANSPORT failure trips this. An unresolved or ambiguous campaign is an answer, and a
  // rejected mutation is upstream working correctly; neither says anything about the next group.
  // A lookup that never got a reply does.
  let transportFailed = false;
  // Wall-clock, captured before the first call so the budget covers the whole fan-out rather than
  // resetting per group.
  const startedAt = Date.now();

  for (const group of groupByCampaign(body.keywords)) {
    // Checked BETWEEN groups, never mid-group: a campaign is resolved and then mutated, and
    // abandoning between those two calls is the one split that could leave a group half-applied
    // with nothing recorded. Whole groups are the only safe unit to stop on.
    // ONE clock read feeds both the admission decision and the budget below. Reading it twice
    // let the boundary fall BETWEEN them: the check passed with a millisecond to spare, then
    // `resolveBudgetMs` recomputed to zero or negative and was passed to the resolver as its
    // timeout -- an instant timeout, which the catch reads as a transport outage and which
    // therefore stops every remaining group (Copilot).
    const elapsedMs = Date.now() - startedAt;
    const groupBudgetMs = KEYWORD_ACTION_DEADLINE_MS - elapsedMs;
    if (!transportFailed && groupBudgetMs <= 0) {
      results.push(...failedResults(group, body.action, CAMPAIGN_DEADLINE_EXCEEDED));
      continue;
    }
    if (transportFailed) {
      // Not attempted, and reported as such. Silently dropping these would leave the caller
      // zipping results onto a shorter list; claiming they failed upstream would be a claim
      // nobody established.
      results.push(...failedResults(group, body.action, CAMPAIGN_LOOKUP_FAILED));
      continue;
    }
    let ref;
    try {
      // The resolver is bounded too, not just the mutation. Bounding only the mutation left this
      // call able to overrun the window one step earlier -- a group entering just under the budget
      // could spend the client's full 30s here, and any EARLIER campaign's per-keyword response is
      // then lost when ingress closes the request, leaving an applied bulk REMOVE unreported
      // (Copilot).
      //
      // The SAME value the admission check used -- not a second read, which is what let a
      // non-positive budget reach the call. The mutation below recomputes, because the resolve
      // has run by then and genuinely consumed time.
      const resolveBudgetMs = groupBudgetMs;
      const resolution = await client.resolveGoogleAdsCampaign(req, projectSlug, group.platformCampaignId, resolveBudgetMs);
      // THE ECHO MUST MATCH WHAT WE ASKED FOR. `platform_campaign_id` is part of the resolution
      // contract and nothing checked it: a stale or misrouted 200 describing a DIFFERENT campaign
      // is internally consistent -- count agrees, array agrees, ids are well-formed -- so every
      // other check passes and the mutation applies to the wrong campaign (Copilot).
      //
      // Refused rather than treated as unresolved: "not managed here" tells the operator to stop
      // trying a campaign that may well be theirs, and this response says nothing about their
      // campaign either way. It is a lookup that cannot be trusted, which is what
      // CAMPAIGN_LOOKUP_FAILED means.
      if (resolution?.platform_campaign_id !== group.platformCampaignId) {
        results.push(...failedResults(group, body.action, CAMPAIGN_LOOKUP_FAILED));
        continue;
      }
      // The COUNT and the ARRAY must agree, and that is checked on EVERY arm rather than only
      // where a match is consumed. `match_count: 0` with a NON-empty `matches` is upstream
      // contradicting itself, and answering "not managed here" on it would tell the operator to
      // stop retrying a campaign that may well be theirs.
      // `matches` must BE an array before its length means anything. `matches?.length ?? 0`
      // coerced a missing or null array to zero, which then AGREED with `match_count: 0` -- so a
      // malformed 2xx passed this check and the next branch reported "not managed here",
      // telling the operator to stop retrying a campaign that may well be theirs. An absent
      // array is upstream failing to answer the question, not answering it with "none".
      if (!Array.isArray(resolution.matches) || resolution.match_count !== resolution.matches.length) {
        results.push(...failedResults(group, body.action, CAMPAIGN_LOOKUP_FAILED));
        continue;
      }
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
      // The COUNT is not the array. `match_count === 1` with an empty or malformed `matches` is
      // an inconsistent 2xx, and reading matches[0] blindly made `ref` undefined -- so
      // `ref.brief_id` below threw a TypeError into the MUTATION catch, which has no errorBody
      // to classify and therefore reported "unconfirmed" and stopped the fan-out, abandoning
      // every remaining campaign over a response that never reached the ad platform.
      //
      // Checked here, where it is still a RESOLUTION problem rather than a mutation one, so the
      // other campaigns in the batch continue. Count/array agreement is already established
      // above, so all that remains is whether the single entry carries usable ids.
      const match = resolution.matches?.[0];
      if (!match?.brief_id || !match?.campaign_id) {
        // CAMPAIGN_LOOKUP_FAILED, not CAMPAIGN_UNRESOLVED. An inconsistent 2xx -- match_count
        // says 1 but the entry is absent or id-less -- does NOT establish that the campaign is
        // unmanaged. Saying "not managed here" tells the operator to stop trying, and a
        // still-spending campaign keeps spending. Only match_count === 0 is upstream actually
        // answering "not yours"; this is upstream contradicting itself, which is transient.
        results.push(...failedResults(group, body.action, CAMPAIGN_LOOKUP_FAILED));
        continue;
      }
      ref = match;
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
      // A lookup that never reached campaign-service means the next 49 will not either. A 4xx
      // other than 408 is the service answering, so it is not a transport failure.
      transportFailed = isTransportFailure(error);
      continue;
    }

    try {
      // The remaining budget BOUNDS the mutation, rather than only gating whether it starts.
      //
      // Checking the clock and then dispatching is not enough, which is what the previous two
      // revisions of this got wrong: passing the check at 44s still permits a 30s call, running
      // to ~74s against a 60s window (Copilot, three times). Passing the remainder as the call's
      // own timeout is what makes the deadline real -- the request cannot outlive it.
      //
      // An expiry surfaces as a 408 from the client, which the mutation catch already classifies
      // as UNCONFIRMED: the call was dispatched, so nobody can say whether it applied. That is
      // the honest answer and it is the one already wired.
      const remainingMs = KEYWORD_ACTION_DEADLINE_MS - (Date.now() - startedAt);

      // Deadline check, after the read-only resolve and before the irreversible mutation.
      //
      // The between-groups check alone does not bound the request, which is what an earlier
      // version of this claimed: a group admitted at 44s can spend 30s resolving and 30s
      // mutating, so the loop runs to ~104s while the ingress answered the caller at 60s
      // (Copilot). Fifteen seconds of headroom was never enough -- one call can consume twice
      // that on its own.
      //
      // This is the only other point where stopping is SAFE. The resolve is a read, so
      // abandoning after it changes nothing upstream; abandoning after the mutation call has
      // started is what would leave a group applied but unrecorded.
      if (remainingMs <= 0) {
        results.push(...failedResults(group, body.action, CAMPAIGN_DEADLINE_EXCEEDED));
        continue;
      }
      const applied = await client.applyKeywordActions(
        req,
        projectSlug,
        ref.brief_id,
        ref.campaign_id,
        toUpstreamActions(group.keywords, body.action),
        remainingMs
      );
      // The 2xx is CHECKED, not assumed. Upstream's batch is all-or-nothing, so applied_count
      // should equal what was sent — but upstream derives it from the results it actually
      // returns (`AppliedCount: len(results)`) rather than asserting it against the request, so a
      // short or altered response would agree with itself. Reporting every requested keyword as
      // changed on the strength of that would tell someone a still-spending keyword was paused,
      // which is the one thing this path must never do.
      const mismatch = describeOutcomeMismatch(group, body.action, applied, ref.campaign_id);
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
      const message = classifyMutationFailure(error);
      // The stop flag is set HERE too, not only in the resolver catch. A transport failure means
      // the service is unreachable regardless of which call discovered it, and resolving first
      // does not make the next mutate any likelier to land — so leaving this arm out let a mutate
      // that lost its connection fall straight back into the fan-out this flag exists to stop.
      transportFailed = isTransportFailure(error);
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
