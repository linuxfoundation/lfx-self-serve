// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { KeywordActionRequest } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appliedResults,
  CAMPAIGN_OUTCOME_UNCONFIRMED,
  classifyMutationFailure,
  failedResults,
  groupByCampaign,
  inRequestOrder,
  toBulkResponse,
  toUpstreamActions,
  applyKeywordActionsViaCampaignService,
} from './campaign-keyword-actions';
import { MicroserviceError } from '../errors/microservice.error';

const kw = (campaignId: string, criterionId: string, adGroupId = 'ag-1'): KeywordActionRequest => ({
  campaignId,
  adGroupId,
  criterionId,
  action: 'pause',
});

describe('groupByCampaign', () => {
  it('groups keywords by their campaign', () => {
    const groups = groupByCampaign([kw('555', '1'), kw('666', '2'), kw('555', '3')]);

    expect(groups).toHaveLength(2);
    expect(groups[0].platformCampaignId).toBe('555');
    expect(groups[0].keywords.map((k) => k.criterionId)).toEqual(['1', '3']);
    expect(groups[1].keywords.map((k) => k.criterionId)).toEqual(['2']);
  });

  // Campaign ids are numeric strings, and a plain object would iterate them in ascending
  // numeric order regardless of insertion — so a Map is required, not incidental. Asserted with
  // a descending pair, which is the case an object key ordering would silently reorder.
  it('preserves the order campaigns were first seen', () => {
    const groups = groupByCampaign([kw('999', '1'), kw('111', '2')]);

    expect(groups.map((g) => g.platformCampaignId)).toEqual(['999', '111']);
  });

  it('returns nothing for an empty request', () => {
    expect(groupByCampaign([])).toEqual([]);
  });
});

describe('toUpstreamActions', () => {
  // The vocabularies differ in case, and getting it wrong is a 400 from upstream rather than a
  // type error here.
  it.each([
    ['pause', 'PAUSE'],
    ['remove', 'REMOVE'],
  ] as const)('maps the %s action to %s', (uiAction, upstream) => {
    const actions = toUpstreamActions([kw('555', '1')], uiAction);

    expect(actions).toEqual([{ ad_group_id: 'ag-1', criterion_id: '1', action: upstream }]);
  });

  it('carries each keyword through with its own ids', () => {
    const actions = toUpstreamActions([kw('555', '1', 'ag-1'), kw('555', '2', 'ag-2')], 'pause');

    // Distinct ad group ids: a mapper that reused the first keyword's would pass a
    // single-element check.
    expect(actions.map((a) => a.ad_group_id)).toEqual(['ag-1', 'ag-2']);
    expect(actions.map((a) => a.criterion_id)).toEqual(['1', '2']);
  });
});

describe('failedResults', () => {
  // THE ATOMICITY CONTRACT. Upstream applies the batch in full or not at all, so a failure means
  // NONE of the campaign's keywords changed. Marking only one failed would leave a caller
  // believing the rest were paused and hunting for which.
  it('marks every keyword in the campaign failed, not just one', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2'), kw('555', '3')]);

    const results = failedResults(group, 'pause', 'upstream said no');

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.response.success)).toBe(true);
    expect(results.map((r) => r.response.message)).toEqual(['upstream said no', 'upstream said no', 'upstream said no']);
  });

  it('names each keyword by its own criterion id', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2')]);

    expect(failedResults(group, 'pause', 'x').map((r) => r.response.keyword)).toEqual(['Criterion 1', 'Criterion 2']);
  });
});

describe('appliedResults', () => {
  it('reports every keyword in the campaign as applied', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2')]);

    const results = appliedResults(group, 'remove');

    expect(results.every((r) => r.response.success)).toBe(true);
    expect(results[0].response.message).toContain('removed');
    expect(results[0].response.action).toBe('remove');
  });

  it('uses the paused wording for a pause', () => {
    const [group] = groupByCampaign([kw('555', '1')]);

    expect(appliedResults(group, 'pause')[0].response.message).toContain('paused');
  });
});

describe('toBulkResponse', () => {
  // A partially-applied batch is a FAILURE at this level. Each campaign is all-or-nothing, but
  // the caller asked for one thing and got part of it, so `success` must not be true.
  it('reports a mixed outcome as not successful', () => {
    const [ok] = groupByCampaign([kw('555', '1')]);
    const [bad] = groupByCampaign([kw('666', '2')]);

    const response = toBulkResponse([...appliedResults(ok, 'pause'), ...failedResults(bad, 'pause', 'nope')].map((r) => r.response));

    expect(response.success).toBe(false);
    expect(response.total).toBe(2);
    expect(response.succeeded).toBe(1);
    expect(response.failed).toBe(1);
  });

  it('reports a fully applied batch as successful', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2')]);

    const response = toBulkResponse(appliedResults(group, 'pause').map((r) => r.response));

    expect(response.success).toBe(true);
    expect(response.succeeded).toBe(2);
    expect(response.failed).toBe(0);
  });

  // An empty result set is not a success. Nothing was applied, and answering `success: true`
  // would tell a caller their keywords were paused when no request was ever made.
  it('does not report an empty result set as successful', () => {
    expect(toBulkResponse([])).toMatchObject({ success: false, total: 0, succeeded: 0, failed: 0 });
  });
});

describe('inRequestOrder', () => {
  it('keeps two campaigns sharing an ad-group/criterion pair apart', () => {
    // A criterion id is unique only WITHIN its ad group, and the controller accepts a body that
    // repeats the same (adGroupId, criterionId) under different campaigns. Grouping by campaign
    // reorders results, so campaign A's FAILURE and campaign B's SUCCESS landed in one bucket
    // and were handed out by arrival order -- reporting a keyword that was never paused as
    // "Paused". That is the one thing this module must never say.
    const kws = [kw('camp-A', 'k-1'), kw('camp-B', 'k-1')];
    const results = [
      { source: kws[1], response: { adGroupId: 'ag-1', criterionId: 'k-1', success: true, message: 'Paused' } },
      { source: kws[0], response: { adGroupId: 'ag-1', criterionId: 'k-1', success: false, message: 'Failed' } },
    ] as never;

    const out = inRequestOrder(kws, results);

    expect(out[0].success, 'campaign A failed but was reported as paused').toBe(false);
    expect(out[1].success).toBe(true);
  });

  /**
   * THE REGRESSION. `optimization-tab.component.ts` zips `res.results[i]` onto the keyword list
   * it sent, so any reordering lands a result on a DIFFERENT keyword — and a still-spending
   * keyword gets shown as paused. Grouping by campaign reorders whenever campaigns interleave,
   * which the legacy per-keyword loop never did.
   *
   * The fixture interleaves two campaigns and gives them OPPOSITE outcomes, so a response left
   * in grouped order puts every success on a failure's keyword and vice versa.
   */
  it('restores the request order after grouping reordered the results', () => {
    const request = [kw('555', '1'), kw('666', '2'), kw('555', '3')];
    const [groupA, groupB] = groupByCampaign(request);

    // Grouped order is [555/1, 555/3, 666/2] — campaign 555's two keywords adjacent.
    const grouped = [...appliedResults(groupA, 'pause'), ...failedResults(groupB, 'pause', 'nope')];
    expect(grouped.map((r) => r.source.criterionId)).toEqual(['1', '3', '2']);

    const ordered = inRequestOrder(request, grouped);

    expect(ordered.map((r) => r.keyword)).toEqual(['Criterion 1', 'Criterion 2', 'Criterion 3']);
    // Campaign 666's keyword (index 1) is the failure; both 555 keywords succeeded. Left
    // unordered, index 1 would have carried 555/3's success.
    expect(ordered.map((r) => r.success)).toEqual([true, false, true]);
  });

  it('is a no-op when the request was already in grouped order', () => {
    const request = [kw('555', '1'), kw('555', '2')];
    const [group] = groupByCampaign(request);

    const ordered = inRequestOrder(request, appliedResults(group, 'pause'));

    expect(ordered.map((r) => r.keyword)).toEqual(['Criterion 1', 'Criterion 2']);
  });

  // A criterion id is unique only within its ad group, so the match must use BOTH ids — the
  // same reason upstream requires the pair to address a criterion.
  /**
   * Two ad groups in one campaign sharing a criterion id — the case the pair key exists for.
   *
   * NOT revert-binding, and that is stated rather than glossed: keying on `criterionId` alone
   * produces the SAME output here. Results are drained with `shift()` in request order, so one
   * merged bucket happens to yield the same sequence as two separate ones. I could not construct
   * a fixture that distinguishes them.
   *
   * The pair key is kept anyway, for the reason upstream requires both ids to address a
   * criterion: a criterion id is unique only within its ad group. This test pins the CONTRACT —
   * same-id keywords in different ad groups keep their own outcomes — rather than proving the
   * key choice, which is weaker evidence than a binding test and should be read as such.
   */
  it('keeps distinct outcomes for same-id keywords in different ad groups', () => {
    const a = { campaignId: '555', adGroupId: 'ag-1', criterionId: '1', action: 'pause' } as const;
    const mid = { campaignId: '666', adGroupId: 'ag-9', criterionId: '9', action: 'pause' } as const;
    const b = { campaignId: '555', adGroupId: 'ag-2', criterionId: '1', action: 'pause' } as const;
    const request = [a, mid, b];
    const [group555, group666] = groupByCampaign(request);

    const ordered = inRequestOrder(request, [...failedResults(group555, 'pause', 'batch failed'), ...appliedResults(group666, 'pause')]);

    expect(ordered.map((r) => r.success)).toEqual([false, true, false]);
    expect(ordered.map((r) => r.keyword)).toEqual(['Criterion 1', 'Criterion 9', 'Criterion 1']);
  });
});

/**
 * The classifier must read the field the real error actually carries.
 *
 * `MicroserviceError` exposes `statusCode`, not `status`. Reading only `status` made this
 * evaluate to 0 for every real proxy error, so a definite 4xx refusal was tagged UNCONFIRMED --
 * hiding an actionable validation or authorization message behind "may or may not have been
 * applied", and inviting a retry the caller did not need.
 *
 * Driven with a REAL MicroserviceError rather than a `{ status }` literal: a literal is exactly
 * what the old tests used, and it is why the bug shipped.
 */
describe('classifyMutationFailure', () => {
  it('treats a real MicroserviceError 4xx as a definite refusal', () => {
    const err = new MicroserviceError('adGroupId must be numeric', 400, 'BAD_REQUEST', {});
    const msg = classifyMutationFailure(err);

    expect(msg).toBe('adGroupId must be numeric');
    expect(msg).not.toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  /**
   * campaign-service marks an unconfirmed outcome IN THE MESSAGE, not in the status: its definite
   * and its unconfirmed arms BOTH answer 503 (internal/service/brief_keyword_actions.go). So the
   * status cannot decide this, and deriving it from the status relabelled every answered failure
   * as uncertain -- telling an operator not to retry something safe to retry, and leaving a
   * campaign spending.
   */
  it("honours upstream's own unconfirmed marker on a 503", () => {
    const msg = classifyMutationFailure(
      new MicroserviceError('the keyword actions are unconfirmed — they may or may not have been applied on the ad platform', 503, 'ERR', {
        // The parsed Goa body is what proves the APPLICATION answered; executeRequest raises the
        // same shape for a gateway 502/504, which has no parseable body at all.
        errorBody: { code: '503', message: 'the keyword actions are unconfirmed — they may or may not have been applied on the ad platform' },
      })
    );
    expect(msg).toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  it.each([
    [500, 'pre-mutate credential fault'],
    [503, 'definite platform refusal'],
  ])('reports an ANSWERED %i (%s) as definite, because upstream said so', (code) => {
    // Upstream's own words for its definite arm, whose comment reads "A DEFINITE upstream
    // failure ... nothing was applied, so a plain retry is the right remedy".
    const msg = classifyMutationFailure(
      new MicroserviceError('the keyword actions could not be applied', code, 'ERR', {
        errorBody: { code: String(code), message: 'the keyword actions could not be applied' },
      })
    );
    expect(msg).not.toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  it.each([
    [502, 'bad gateway'],
    [503, 'ingress unavailable'],
    [504, 'gateway timeout'],
  ])('treats a GATEWAY %i (%s) as unconfirmed, not as an upstream answer', (code) => {
    // executeRequest raises the same MicroserviceError shape for EVERY !response.ok, so an
    // ingress error campaign-service never saw carries a real status and no originalError. An
    // earlier version of this guard keyed on "has a status", which read these as application
    // replies -- and because their text has no unconfirmed marker, reported a gateway timeout as
    // a DEFINITE failure, inviting a retry of a REMOVE Google cannot undo.
    //
    // No errorBody: a gateway sends HTML or nothing, so executeRequest's JSON.parse leaves it
    // undefined. That absence is the whole discriminator.
    const msg = classifyMutationFailure(new MicroserviceError('Service Unavailable', code, 'ERR', {}));
    expect(msg).toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  it('treats a real timeout as unconfirmed', () => {
    // code TIMEOUT, which is what ApiClientService actually emits for a 408 -- not the 'ERR' a
    // previous version of this test used, which production never produces.
    const msg = classifyMutationFailure(new MicroserviceError('Request timeout after 30000ms', 408, 'TIMEOUT', {}));
    expect(msg).toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  it('treats a transport failure with no status at all as unconfirmed', () => {
    // Nobody answered, so nothing establishes the mutate did not run. Fails CLOSED.
    expect(classifyMutationFailure(new Error('socket hang up'))).toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });
});

/**
 * The two predicates that decide whether campaign-service ACTUALLY answered, pinned directly.
 *
 * dealako, round 4: both shipped unpinned -- reverting either left the suite green. Their stated
 * purpose is to stop a gateway-relayed body vouching for a response the gateway rewrote, and that
 * is exactly what an untested guard cannot promise.
 */
describe('classifyMutationFailure — what proves upstream answered', () => {
  it('refuses a body whose code is not the numeric status shape', () => {
    // A gateway can emit `{code: 'SERVICE_UNAVAILABLE'}`. campaign-service never does: every one
    // of its 185 error sites carries the numeric status as a string.
    const msg = classifyMutationFailure(
      new MicroserviceError('Service Unavailable', 503, 'ERR', { errorBody: { code: 'oops', message: 'Service Unavailable' } })
    );

    expect(msg, 'a non-numeric code was accepted as an upstream answer').toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  it('refuses a code that AGREES with the status but is not a status', () => {
    // The isolating case for the numeric-shape check. dealako, round 5: the `{code:'oops'}`
    // fixture is caught by the AGREEMENT check too, so deleting the shape check leaves it green
    // and the guard stays in the state the round-4 item objected to.
    //
    // Only a code that matches its status while not being status-SHAPED separates them: a
    // gateway inventing `{code:'5030'}` under a 5030 would otherwise be accepted as an upstream
    // answer, which is exactly what the shape check exists to refuse.
    const msg = classifyMutationFailure(new MicroserviceError('made up', 5030, 'ERR', { errorBody: { code: '5030', message: 'made up' } }));

    expect(msg, 'a non-status code that agreed with its status was accepted').toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });

  it('does not MUTATE a group whose resolve consumed the remaining budget', async () => {
    // Copilot: checking only between groups does not bound the request. A group admitted just
    // under the budget can spend 30s resolving and 30s mutating, running well past the ingress
    // window -- so the mutation lands after the caller has already been answered, which is the
    // exact late-application case the deadline exists to prevent.
    //
    // The resolve is a READ, so stopping after it changes nothing upstream. That makes this the
    // only other safe point to stop.
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    const resolveGoogleAdsCampaign = vi.fn().mockImplementation(() => {
      // Admitted inside the budget, but the resolve alone exhausts it.
      now += 50_000;
      return Promise.resolve({ platform_campaign_id: 'camp-1', match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] });
    });
    const applyKeywordActions = vi.fn();

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'remove' as const, keywords: [kw('camp-1', 'k-1')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);
    nowSpy.mockRestore();

    // The resolve ran -- it was admitted -- but the IRREVERSIBLE mutation did not.
    expect(resolveGoogleAdsCampaign).toHaveBeenCalledTimes(1);
    expect(applyKeywordActions, 'an irreversible REMOVE was dispatched past the deadline').not.toHaveBeenCalled();
    expect(String(res.results[0].message)).toMatch(/ran out of time/);
    expect(res.results[0].success).toBe(false);
  });

  it('stops the fan-out at the deadline and names the rest UNATTEMPTED', async () => {
    // Copilot, raised twice: the 50-row cap bounds how MANY campaigns a request names, not how
    // LONG they take. Each costs two sequential proxy calls at a 30s client default, so a request
    // of slow-but-reachable campaigns can exceed the ingress's 60s window -- and when it does,
    // ingress answers the caller while this loop KEEPS MUTATING. Irreversible REMOVEs would land
    // against a request that already reported a timeout.
    const resolveGoogleAdsCampaign = vi.fn().mockImplementation(() => {
      // Each resolve advances the clock past the budget.
      now += 30_000;
      return Promise.resolve({ platform_campaign_id: 'camp-1', match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] });
    });
    const applyKeywordActions = vi
      .fn()
      .mockResolvedValue({ campaign_id: 'c-1', applied_count: 1, results: [{ ad_group_id: 'ag-1', criterion_id: 'k-1', action: 'PAUSE' }] });

    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    // Three distinct campaigns; the budget is exhausted before the third.
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1'), kw('camp-2', 'k-2'), kw('camp-3', 'k-3')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);
    nowSpy.mockRestore();

    // The loop STOPPED -- it did not keep mutating past the budget.
    expect(resolveGoogleAdsCampaign.mock.calls.length, 'the fan-out ran past its deadline').toBeLessThan(3);
    // And the caller is TOLD, rather than being handed a short list to zip onto its request.
    expect(res.results.length, 'skipped groups vanished from the response').toBe(3);
    const unattempted = res.results.filter((r) => String(r.message).includes('ran out of time'));
    expect(unattempted.length, 'a skipped campaign was not reported as unattempted').toBeGreaterThan(0);
    // Never reported as a failure upstream: nothing was sent for these.
    expect(unattempted.every((r) => r.success === false)).toBe(true);
  });

  it('refuses a MUTATION response that describes a different campaign', async () => {
    // Copilot: `campaign_id` is part of the mutation contract and was never read. The count and
    // multiset checks only compare against what WE sent, so nothing tied the response to the
    // campaign it was sent FOR -- a misrouted or stale 2xx for another campaign satisfies them
    // all and gets reported as an applied change. Sibling of the resolver echo, one call later.
    const resolveGoogleAdsCampaign = vi
      .fn()
      .mockResolvedValue({ platform_campaign_id: 'camp-1', match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] });
    // Everything agrees EXCEPT the campaign it claims to describe.
    const applyKeywordActions = vi
      .fn()
      .mockResolvedValue({ campaign_id: 'c-9', applied_count: 1, results: [{ ad_group_id: 'ag-1', criterion_id: 'k-1', action: 'PAUSE' }] });

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    // action 'pause' matches the kw() helper's own action, so the multiset key agrees and
    // ONLY campaign_id can fail this. With 'remove' the action mismatched instead, and the test
    // passed for the wrong reason -- it went green with the guard removed.
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    // Reported UNCONFIRMED, not applied: the mutation was dispatched, so nobody can say what
    // happened to the campaign we asked about -- only that this answer is not about it.
    expect(res.results[0].success, 'a response for another campaign was reported as applied').toBe(false);
    expect(String(res.results[0].message)).toMatch(/did not match the request/i);
  });

  it('refuses a resolution that describes a DIFFERENT campaign', async () => {
    // Copilot: `platform_campaign_id` is part of the resolution contract and nothing checked it.
    // A stale or misrouted 200 for another campaign is internally CONSISTENT -- count agrees,
    // array agrees, ids are well-formed -- so every other check passes and the mutation applies
    // to the wrong campaign. That is a write against something the operator never named.
    const resolveGoogleAdsCampaign = vi.fn().mockResolvedValue({
      // Asked about camp-1; answered about camp-9.
      platform_campaign_id: 'camp-9',
      match_count: 1,
      matches: [{ brief_id: 'b-9', campaign_id: 'c-9' }],
    });
    const applyKeywordActions = vi.fn();

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'remove' as const, keywords: [kw('camp-1', 'k-1')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    // NOTHING was mutated -- this is the assertion that matters.
    expect(applyKeywordActions, 'mutated a campaign the resolution did not describe').not.toHaveBeenCalled();
    expect(res.results[0].success).toBe(false);
    // LOOKUP_FAILED, not UNRESOLVED: "not managed here" would tell the operator to stop trying a
    // campaign that may well be theirs, and this response says nothing about their campaign.
    expect(String(res.results[0].message)).toMatch(/could not be looked up/i);
  });

  it('reports a mismatch when a results ENTRY is not a criterion', async () => {
    // Copilot: `Array.isArray` was added for a missing `results`, but `results: [null]` is a
    // valid array whose element still throws in `key(r)`. That TypeError lands in the mutation
    // catch, which has no errorBody to classify -- so it reports this group unconfirmed AND stops
    // the fan-out, abandoning every later campaign over a response that DID reach the platform.
    const resolveGoogleAdsCampaign = vi
      .fn()
      .mockResolvedValue({ platform_campaign_id: 'camp-1', match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] });
    // applied_count AGREES and `results` IS an array -- only the element can fail this.
    const applyKeywordActions = vi.fn().mockResolvedValue({ campaign_id: 'c-1', applied_count: 1, results: [null] });

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1'), kw('camp-2', 'k-2')] };
    const warn = vi.fn();
    const req = { log: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    // THE FAN-OUT CONTINUED. This is the assertion that distinguishes the controlled mismatch
    // from the TypeError path -- both produce the same operator message, but only the crash
    // abandons the remaining campaigns.
    expect(resolveGoogleAdsCampaign.mock.calls.length, 'a malformed entry stopped the whole batch').toBe(2);
    expect(res.results.every((r) => r.success === false)).toBe(true);
    // And it was DIAGNOSED, not thrown: the mismatch branch logs; the catch does not.
    expect(
      warn.mock.calls.some((c) => JSON.stringify(c).includes('mismatch')),
      'reached by throwing, not by the shape check'
    ).toBe(true);
  });

  it('reports a mismatch when the 2xx carries no results ARRAY', async () => {
    // Copilot: `applied.results` is untrusted wire data. A malformed 2xx with `results` missing
    // threw a TypeError inside the verification, and the caller's catch then classified our own
    // local bug as an upstream failure -- a definite-looking outcome for a request whose real
    // result nobody had established. Same shape as the match_count/matches case below.
    const resolveGoogleAdsCampaign = vi
      .fn()
      .mockResolvedValue({ platform_campaign_id: 'camp-1', match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] });
    // applied_count AGREES, so only the missing array can fail this.
    const applyKeywordActions = vi.fn().mockResolvedValue({ campaign_id: 'c-1', applied_count: 1 });

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1')] };
    const warn = vi.fn();
    const req = { log: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    expect(res.results[0].success, 'a response with no results array was read as a confirmed success').toBe(false);
    // The operator-facing wording is the shared mismatch copy -- "sent but the confirmation did
    // not match", which tells them to check Google Ads before retrying.
    expect(String(res.results[0].message), 'a malformed envelope should read as an unverified outcome').toMatch(/did not match the request/i);

    // ASSERTED ON THE PATH, not only the outcome. Without the Array.isArray guard the loop throws
    // a TypeError that the catch converts into the SAME operator message, so the message alone
    // cannot tell a diagnosed mismatch from an undiagnosed crash. The mismatch branch logs a
    // warning naming what differed; the catch does not. That log is the only thing that
    // distinguishes "we checked and it disagreed" from "we threw while checking".
    const mismatchWarn = warn.mock.calls.find((c) => JSON.stringify(c).includes('mismatch'));
    expect(mismatchWarn, 'the outcome was reached by throwing, not by the shape check').toBeDefined();
  });

  it('refuses a body whose code DISAGREES with the status received', () => {
    // A relayed body cannot vouch for a response something else rewrote: code 500 arriving under
    // a 503 means the two came from different places.
    const msg = classifyMutationFailure(
      new MicroserviceError('the keyword actions could not be applied', 503, 'ERR', {
        errorBody: { code: '500', message: 'the keyword actions could not be applied' },
      })
    );

    expect(msg, 'a code/status mismatch was accepted as an upstream answer').toContain(CAMPAIGN_OUTCOME_UNCONFIRMED);
  });
});

describe('applyKeywordActionsViaCampaignService — the fan-out stop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['an empty matches array', { match_count: 1, matches: [] }],
    ['a match missing its ids', { match_count: 1, matches: [{}] }],
    // count says one, array holds TWO: the same self-contradiction in the other direction.
    // Taking matches[0] would mutate one of two campaigns upstream never disambiguated.
    [
      'more matches than the count claims',
      {
        match_count: 1,
        matches: [
          { brief_id: 'b-1', campaign_id: 'c-1' },
          { brief_id: 'b-9', campaign_id: 'c-9' },
        ],
      },
    ],
    // A missing or null `matches` under count 0: `matches?.length ?? 0` coerced these to zero,
    // which AGREED with the count, so they passed the check and were reported "not managed
    // here" -- telling the operator to stop retrying a campaign that may be theirs. An absent
    // array is upstream failing to answer, not answering "none".
    ['a missing matches array', { match_count: 0 }],
    ['a null matches array', { match_count: 0, matches: null }],
    [
      // count 0 with a NON-empty array. The agreement guard was MOVED above the match_count===0
      // arm precisely so this reaches it: answering "not managed here" on a self-contradictory
      // response tells the operator to stop retrying a campaign that may well be theirs.
      'a zero count with matches present',
      { match_count: 0, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] },
    ],
  ])('refuses %s rather than trusting match_count', async (_label, resolution) => {
    // The COUNT is not the ARRAY. Reading matches[0] on the strength of match_count === 1 made
    // `ref` undefined, so `ref.brief_id` threw a TypeError into the MUTATION catch -- which has
    // no errorBody, so it reported "unconfirmed" AND stopped the fan-out, abandoning every
    // remaining campaign over a response that never reached the ad platform.
    const resolveGoogleAdsCampaign = vi
      .fn()
      // Each row's malformed shape is what the case is ABOUT; the echo is spread in so the new
      // echo guard does not short-circuit the check under test.
      .mockResolvedValueOnce({ platform_campaign_id: 'camp-1', ...(resolution as object) })
      .mockResolvedValueOnce({ platform_campaign_id: 'camp-2', match_count: 1, matches: [{ brief_id: 'b-2', campaign_id: 'c-2' }] });
    const applyKeywordActions = vi
      .fn()
      .mockResolvedValue({ campaign_id: 'c-2', applied_count: 1, results: [{ ad_group_id: 'ag-1', criterion_id: 'k-2', action: 'PAUSE' }] });

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1'), kw('camp-2', 'k-2')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    // Nothing was sent for the malformed one.
    expect(applyKeywordActions).toHaveBeenCalledTimes(1);
    expect(res.results[0].success).toBe(false);
    // Reported as a TRANSIENT lookup failure -- "try again" -- not as "not managed here".
    // An inconsistent 2xx does not establish the campaign is unmanaged, and telling an operator
    // it is stops them retrying while a spending campaign keeps spending.
    expect(res.results[0].message).toContain('could not be looked up');
    expect(res.results[0].message).not.toContain('not managed here');
    // And not an unconfirmed MUTATION either: nothing reached the platform.
    expect(res.results[0].message).not.toContain('unconfirmed');
    // And the batch CONTINUED -- the second campaign is unaffected by the first's bad response.
    expect(resolveGoogleAdsCampaign).toHaveBeenCalledTimes(2);
    expect(res.results[1].success).toBe(true);
  });

  it('does NOT stop the fan-out when campaign-service answers, even with a 500 or 503', async () => {
    // An ANSWER describes THIS campaign only. campaign-service returns 500 for a pre-mutate
    // credential fault and 503 for a definite platform refusal -- both prove it replied, so
    // abandoning the remaining campaigns on them stopped a fan-out that was fine to continue and
    // left keywords the operator asked about unattempted for no reason.
    const resolveGoogleAdsCampaign = vi
      .fn()
      // Echoes whichever campaign is asked for -- this case drives more than one group, and a
      // fixed echo would fail the new guard on the second rather than exercising the fan-out.
      .mockImplementation((_r: unknown, _s: string, id: string) =>
        Promise.resolve({ platform_campaign_id: id, match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-2' }] })
      );
    const applyKeywordActions = vi
      .fn()
      .mockRejectedValueOnce(
        new MicroserviceError('the keyword actions could not be applied', 503, 'ERR', {
          errorBody: { code: '503', message: 'the keyword actions could not be applied' },
        })
      )
      .mockResolvedValueOnce({ campaign_id: 'c-2', applied_count: 1, results: [{ ad_group_id: 'ag-1', criterion_id: 'k-2', action: 'PAUSE' }] });

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1'), kw('camp-2', 'k-2')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    // BOTH campaigns attempted: the first one's answered failure said nothing about the second.
    expect(resolveGoogleAdsCampaign).toHaveBeenCalledTimes(2);
    expect(applyKeywordActions).toHaveBeenCalledTimes(2);
    expect(res.results).toHaveLength(2);
    expect(res.results[1].success, 'the second campaign was abandoned after an ANSWERED failure').toBe(true);
  });

  it('stops the fan-out when the MUTATION loses its connection, not only the lookup', async () => {
    // The stop flag was set in the resolver catch only. If the resolver succeeds and
    // applyKeywordActions then times out, the loop kept resolving and mutating every remaining
    // campaign -- recreating the exact fan-out the flag exists to prevent, one call later.
    const resolveGoogleAdsCampaign = vi
      .fn()
      .mockResolvedValue({ platform_campaign_id: 'camp-1', match_count: 1, matches: [{ brief_id: 'b-1', campaign_id: 'c-1' }] });
    const applyKeywordActions = vi
      .fn()
      .mockRejectedValue(new MicroserviceError('Request failed: fetch failed', 503, 'ECONNRESET', { originalError: new Error('fetch failed') }));

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1'), kw('camp-2', 'k-2')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    expect(res.results).toHaveLength(2);
    // The second group is never even resolved -- the mutation failure stopped the fan-out.
    expect(resolveGoogleAdsCampaign).toHaveBeenCalledTimes(1);
    expect(applyKeywordActions).toHaveBeenCalledTimes(1);
    expect(res.results[1].success).toBe(false);
  });

  it('reports groups it never reached instead of dropping them, once the service is unreachable', async () => {
    // The defect: the loop is sequential and the controller admits up to MAX_BULK_KEYWORD_ACTIONS
    // campaigns, so an outage sent 50 doomed probes at a 30s timeout each -- one HTTP request held
    // open for ~25 minutes for a single user action. A transport failure means the NEXT lookup is
    // doomed too, so the fan-out stops; a 4xx would not, because that is an answer about THIS
    // request only.
    const resolveGoogleAdsCampaign = vi
      .fn()
      .mockRejectedValue(new MicroserviceError('Request failed: fetch failed', 503, 'ECONNRESET', { originalError: new Error('fetch failed') }));
    const applyKeywordActions = vi.fn();

    const client = { resolveGoogleAdsCampaign, applyKeywordActions } as never;
    const body = { action: 'pause' as const, keywords: [kw('camp-1', 'k-1'), kw('camp-2', 'k-2')] };
    const req = { log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } } as never;

    const res = await applyKeywordActionsViaCampaignService(req, client, 'aswf', body);

    // Nothing dropped: the response is zipped onto the request BY INDEX in optimization-tab, so a
    // short array would land a still-spending keyword on another row's outcome.
    expect(res.results).toHaveLength(2);
    // The second group was never probed -- that is the whole fix.
    expect(resolveGoogleAdsCampaign).toHaveBeenCalledTimes(1);
    expect(res.results[1].success).toBe(false);
  });
});
