// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  isCanonicalGoogleAdsResourceId,
  CAMPAIGN_ALERT_THRESHOLDS,
  CAMPAIGN_EMAIL_TYPES,
  DEFAULT_CAMPAIGN_EMAIL_TYPE_ID,
  GOOGLE_ADS_BIDDING_BOUNDS,
  GOOGLE_ADS_CHANNEL_TYPE_ENUMS,
  GOOGLE_ADS_CONVERSION_ACTION_PATTERN,
  GOOGLE_ADS_MAX_CONVERSION_ACTIONS,
  GOOGLE_BIDDING_CPA_STRATEGIES,
  GOOGLE_BIDDING_DEFAULT_BY_CHANNEL,
  GOOGLE_BIDDING_ROAS_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL,
  GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES,
  GOOGLE_CAMPAIGN_CHANNELS,
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_CONVERSION_ACTION_CHANNELS,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_SECTION_TITLES,
  META_OBJECTIVE_LABELS,
  META_OBJECTIVE_PARAMS,
  META_SELECTABLE_OBJECTIVES,
  campaignToggleAction,
  canonicalMicrosoftMatchType,
  isMicrosoftMatchType,
  normalizeGeoTargets,
  normalizeMicrosoftGeoTargets,
} from './campaign.constants';

describe('campaignToggleAction', () => {
  it('offers pause for the statuses that are running upstream', () => {
    expect(campaignToggleAction('created', 'google-ads')).toBe('pause');
    expect(campaignToggleAction('active', 'google-ads')).toBe('pause');
  });

  /** Spending but refused a resume with 409 — pauseable, never resumable. */
  it('keeps created_degraded pauseable', () => {
    expect(campaignToggleAction('created_degraded', 'google-ads')).toBe('pause');
  });

  it('offers resume for a paused campaign', () => {
    expect(campaignToggleAction('paused', 'google-ads')).toBe('resume');
  });

  it('compares status case-insensitively', () => {
    expect(campaignToggleAction('CREATED', 'google-ads')).toBe('pause');
    expect(campaignToggleAction('Paused', 'google-ads')).toBe('resume');
  });

  /**
   * `enabled` is a Google Ads platform word, not a campaign-service status — it appears nowhere in
   * `internal/domain/model`. Mapping it onto Pause would be the fail-OPEN direction.
   */
  it('treats a status the service never writes as unknown', () => {
    expect(campaignToggleAction('enabled', 'google-ads')).toBe('unavailable');
  });

  /**
   * Narrowed to `twitter-ads` by LFXV2-3312, which ENABLED Microsoft.
   * `TOGGLEABLE_CAMPAIGN_PLATFORMS` is derived from `CAMPAIGN_PLATFORMS.filter((p) => !p.disabled)`,
   * so dropping that flag admits microsoft-ads here BY DESIGN. X stays disabled — a capability gap
   * rather than missing plumbing — so it remains the subject and the guard still binds: make X
   * toggleable and this goes red.
   *
   * Both statuses are still exercised, just both against X, so "at any status" stays true of the
   * assertion rather than becoming a claim only the deleted line supported.
   */
  it('refuses a platform this app does not offer, at any status', () => {
    expect(campaignToggleAction('created', 'twitter-ads')).toBe('unavailable');
    expect(campaignToggleAction('paused', 'twitter-ads')).toBe('unavailable');
  });

  /**
   * The other half of the same derivation, and the reason the case above could be narrowed safely
   * rather than simply deleted: Microsoft is now OFFERED, so its campaigns must be pausable. If
   * `disabled: true` is ever restored to the shared constant, this fails — which is what stops the
   * enablement from being silently reverted at the one site that has no other test.
   */
  it('offers pause and resume for microsoft-ads, which this app now enables', () => {
    expect(campaignToggleAction('created', 'microsoft-ads')).toBe('pause');
    expect(campaignToggleAction('paused', 'microsoft-ads')).toBe('resume');
  });

  /** Optional so the status-only question stays askable; absence is not "unsupported". */
  it('does not read an absent platform as unsupported', () => {
    expect(campaignToggleAction('created')).toBe('pause');
  });

  /**
   * The wire is not typed at runtime. `CampaignIndexDoc.status` is declared `string`, but nothing
   * between the index and this call validates it, so a missing or non-string status arrives
   * intact. `.toLowerCase()` on it threw a TypeError — and because the call is inside a computed
   * that maps EVERY row, one malformed document blanked the entire campaigns section rather than
   * one row, re-throwing on each change-detection pass.
   *
   * The binding assertion is that each of these RETURNS `unavailable`. Asserting merely that the
   * call does not throw would pass on a guard that returned `pause`, which is the fail-open answer
   * this function exists to avoid.
   */
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 123],
    ['an object', {}],
    ['an empty string', ''],
  ])('falls closed to unavailable for %s rather than throwing', (_label, status) => {
    expect(campaignToggleAction(status as unknown as string, 'google-ads')).toBe('unavailable');
  });
});

describe('normalizeGeoTargets', () => {
  it('uppercases lowercase codes', () => {
    expect(normalizeGeoTargets(['us', 'jp'])).toEqual(['US', 'JP']);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeGeoTargets([' US ', '\tJP\n'])).toEqual(['US', 'JP']);
  });

  /** The wire defect: uppercasing alone turned `["us","US"]` into `["US","US"]`. */
  it('collapses codes that differ only in case', () => {
    expect(normalizeGeoTargets(['us', 'US'])).toEqual(['US']);
  });

  it('collapses codes that differ only in whitespace', () => {
    expect(normalizeGeoTargets(['US', ' US'])).toEqual(['US']);
  });

  it('collapses exact repeats', () => {
    expect(normalizeGeoTargets(['US', 'JP', 'US'])).toEqual(['US', 'JP']);
  });

  /** First-seen order, matching campaign-service, so the chip list is stable across a re-render. */
  it('keeps first-seen order', () => {
    expect(normalizeGeoTargets(['jp', 'de', 'us', 'JP'])).toEqual(['JP', 'DE', 'US']);
  });

  it('drops codes that are not two letters', () => {
    expect(normalizeGeoTargets(['US', 'USA', 'U', '', '  ', '1', 'U1'])).toEqual(['US']);
  });

  it('drops non-string entries', () => {
    expect(normalizeGeoTargets(['US', null as unknown as string, undefined as unknown as string, 42 as unknown as string])).toEqual(['US']);
  });

  it('returns an empty list for nullish input', () => {
    expect(normalizeGeoTargets(null)).toEqual([]);
    expect(normalizeGeoTargets(undefined)).toEqual([]);
    expect(normalizeGeoTargets([])).toEqual([]);
  });

  /**
   * ASSIGNMENT is checked here; ELIGIBILITY is not. `ZZ` is well-shaped but sits in the ISO
   * user-assigned range, so no ad platform can ever target it — and the create path filters only
   * regulated markets, so it survived to `geo_locations` and Meta rejected it at AD-SET creation,
   * after the campaign POST had already created a billable resource.
   */
  it('drops a well-shaped code that is not an assigned country', () => {
    expect(normalizeGeoTargets(['zz'])).toEqual([]);
    expect(normalizeGeoTargets(['XA', 'QM', 'AA'])).toEqual([]);
  });

  /**
   * Reserved-but-not-assigned codes are the ones most likely to be typed in good faith: `UK` for
   * the United Kingdom (assigned code `GB`) and `EU` for the bloc. Both must be refused rather
   * than passed through to fail at the ad set.
   */
  it('drops reserved codes that look plausible', () => {
    expect(normalizeGeoTargets(['UK', 'EU'])).toEqual([]);
    expect(normalizeGeoTargets(['GB'])).toEqual(['GB']);
  });

  /**
   * Eligibility remains the SERVICE's call: a sanctioned or regulated market is officially
   * assigned, so it must still pass this helper and be filtered upstream where that list lives.
   * A guard that swept these out here would silently duplicate — and then drift from — that list.
   */
  it('keeps an assigned country the service may later filter', () => {
    expect(normalizeGeoTargets(['sg', 'kr', 'tw'])).toEqual(['SG', 'KR', 'TW']);
  });

  it('does not mutate its input', () => {
    const input = ['us', 'US'];
    normalizeGeoTargets(input);
    expect(input).toEqual(['us', 'US']);
  });
});

/**
 * `leads` is hidden from the picker while LFXV2-2665 builds instant-form support, but it is NOT
 * removed from the type, the params map or the labels map. The two halves are asserted separately
 * because they can regress independently: restoring the option is one edit, and deleting the
 * fallback that keeps old briefs dispatching is another.
 */
describe('META_SELECTABLE_OBJECTIVES', () => {
  it('omits leads', () => {
    expect(META_SELECTABLE_OBJECTIVES).not.toContain('leads');
  });

  /** Asserted as a literal list, not derived: a test built from the constant would agree with any value it took. */
  it('offers exactly the four supported objectives, in render order', () => {
    expect(META_SELECTABLE_OBJECTIVES).toEqual(['awareness', 'traffic', 'engagement', 'conversions']);
  });

  it('offers only objectives the params map can dispatch', () => {
    for (const objective of META_SELECTABLE_OBJECTIVES) {
      expect(META_OBJECTIVE_PARAMS[objective]).toBeDefined();
    }
  });

  /**
   * Partitions the objective union: every `MetaObjective` is either selectable or deliberately
   * hidden, never silently neither. The compile-time guard beside the constant is what enforces
   * this — a new objective that reaches neither list fails `tsc`, naming the omitted member —
   * and this pins the runtime half so the partition cannot drift unnoticed.
   */
  it('together with the hidden objectives, covers every objective the params map defines', () => {
    const hidden = ['leads'];
    const covered = [...META_SELECTABLE_OBJECTIVES, ...hidden].sort();

    expect(covered).toEqual(Object.keys(META_OBJECTIVE_PARAMS).sort());
  });
});

/**
 * The restore path. A brief or draft persisted before `leads` was hidden still carries it, and it
 * must keep dispatching as the WEBSITE-TRAFFIC campaign it has always run — not error, and not
 * silently become a real OUTCOME_LEADS campaign, which would fail at the ad set and orphan a
 * billable campaign.
 */
describe('persisted leads objective', () => {
  it('still resolves through the params map', () => {
    expect(META_OBJECTIVE_PARAMS['leads']).toBeDefined();
  });

  /** Wire values asserted literally: reading the constant back could never fail. */
  it('dispatches as a website-traffic campaign with no promoted object', () => {
    expect(META_OBJECTIVE_PARAMS['leads']).toEqual({
      campaignObjective: 'OUTCOME_TRAFFIC',
      optimizationGoal: 'LINK_CLICKS',
      promotedObjectType: 'none',
    });
  });

  /**
   * The campaign name and ad-set name in `meta-ads.service.ts` index the labels map with whatever
   * objective the request carries. A hidden objective with no label would put the string
   * `undefined` into the name of a campaign Meta bills against.
   */
  it('still resolves to a display label', () => {
    expect(META_OBJECTIVE_LABELS['leads']).toBe('Leads');
  });

  it('has a label for every objective the params map can dispatch', () => {
    for (const objective of Object.keys(META_OBJECTIVE_PARAMS) as (keyof typeof META_OBJECTIVE_PARAMS)[]) {
      expect(META_OBJECTIVE_LABELS[objective]).toBeTruthy();
    }
  });
});

/**
 * Direct coverage for the shared Microsoft helpers exercised below:
 * `canonicalMicrosoftMatchType`, `isMicrosoftMatchType` (asserted to agree with it), and
 * `normalizeMicrosoftGeoTargets`.
 *
 * All had only INDIRECT coverage through the implementation-tab component specs, which exercise
 * them via the form. That hides which layer a failure belongs to and leaves the helpers free to
 * drift for any caller that is not the form.
 *
 * The callers differ, so do not read "the BFF uses these" onto all three:
 * `isMicrosoftMatchType` and `normalizeMicrosoftGeoTargets` are called by both the form and
 * `campaign.controller.ts`; `canonicalMicrosoftMatchType` is UI-only today, reached from the
 * component alone. It is covered here anyway because it is exported and the agreement test below
 * pins it against the predicate the BFF does use.
 */
describe('canonicalMicrosoftMatchType', () => {
  it('canonicalises the case and whitespace upstream tolerates', () => {
    // Upstream does strings.ToLower(strings.TrimSpace(in)), so all of these are valid there.
    expect(canonicalMicrosoftMatchType('EXACT')).toBe('Exact');
    expect(canonicalMicrosoftMatchType('  exact  ')).toBe('Exact');
    expect(canonicalMicrosoftMatchType('bRoAd')).toBe('Broad');
    expect(canonicalMicrosoftMatchType('Phrase')).toBe('Phrase');
  });

  it('returns null for a value Microsoft has no match type for', () => {
    // null, not a default: substituting one would dispatch a match type the operator never chose.
    expect(canonicalMicrosoftMatchType('BROAD_MATCH')).toBeNull();
    expect(canonicalMicrosoftMatchType('')).toBeNull();
    expect(canonicalMicrosoftMatchType(undefined)).toBeNull();
    expect(canonicalMicrosoftMatchType(123)).toBeNull();
  });

  it('agrees with isMicrosoftMatchType on every input', () => {
    // The two are used as a pair — one to filter, one to convert — so a disagreement between them
    // is what would let a value pass the guard and then fail to convert.
    for (const v of ['EXACT', '  exact  ', 'bRoAd', 'Phrase', 'BROAD_MATCH', '', undefined, 123, null]) {
      expect(isMicrosoftMatchType(v)).toBe(canonicalMicrosoftMatchType(v) !== null);
    }
  });
});

describe('normalizeMicrosoftGeoTargets', () => {
  it('upper-cases, trims and de-dupes while preserving first-seen order', () => {
    expect(normalizeMicrosoftGeoTargets([' us ', 'DE', 'us', 'de', 'FR'])).toEqual(['US', 'DE', 'FR']);
  });

  it('keeps a code Meta excludes but Microsoft supports', () => {
    // The whole reason this is separate from normalizeGeoTargets: AN is in Microsoft's table and
    // not in this app's COUNTRIES, and dropping it silently retargeted the campaign.
    expect(normalizeMicrosoftGeoTargets(['AN'])).toEqual(['AN']);
  });

  it('drops malformed entries rather than passing them upstream', () => {
    expect(normalizeMicrosoftGeoTargets(['USA', '', '  ', 'u1', 'US'])).toEqual(['US']);
  });

  it('treats null and undefined as an empty list', () => {
    expect(normalizeMicrosoftGeoTargets(null)).toEqual([]);
    expect(normalizeMicrosoftGeoTargets(undefined)).toEqual([]);
  });
});

/**
 * These thresholds are the edit point for the LinkedIn, Meta and Reddit low-CTR and
 * clicks-without-conversions rules — not for every Optimize-tab rule. Google keeps its own
 * literals in `campaign-metrics.service.ts` and is deliberately out of scope here: its display
 * rule reads `!isSearch && ctr < 0.3 && impressions > 1000`, which is a different predicate over
 * a different population, so folding it in would flatten a real distinction rather than an
 * accidental one. LFXV2-3314's convergence is where that decision belongs.
 *
 * The rules themselves have no spec of their own. So this
 * block pins the VALUES rather than re-deriving the rules: the whole claim of LFXV2-3314's first
 * step is that centralising them changed no behaviour, and a value drifting here is exactly how
 * that claim would quietly stop being true.
 *
 * Written as literals on purpose. Asserting `x === CAMPAIGN_ALERT_THRESHOLDS[p].lowCtrPct` would
 * pass against any value at all.
 */
describe('CAMPAIGN_ALERT_THRESHOLDS', () => {
  it('preserves the values each service used before they were named', () => {
    expect(CAMPAIGN_ALERT_THRESHOLDS['linkedin-ads']).toEqual({
      lowCtrPct: 0.3,
      clicksWithoutConversions: 50,
      minImpressions: null,
    });
    expect(CAMPAIGN_ALERT_THRESHOLDS['meta-ads']).toEqual({
      lowCtrPct: 0.5,
      clicksWithoutConversions: 20,
      minImpressions: 500,
    });
    expect(CAMPAIGN_ALERT_THRESHOLDS['reddit-ads']).toEqual({
      lowCtrPct: 0.3,
      clicksWithoutConversions: 100,
      minImpressions: 1000,
    });
  });

  /**
   * The divergence is the finding, not an accident of this spec. Pinned so that CONVERGING the
   * platforms — LFXV2-3314's second step — has to delete this test deliberately rather than
   * discover it red, and so nobody "tidies" one value into agreement without that being the
   * point of their change.
   */
  it('records that the three platforms currently disagree', () => {
    const ctr = Object.values(CAMPAIGN_ALERT_THRESHOLDS).map((t) => t.lowCtrPct);
    const clicks = Object.values(CAMPAIGN_ALERT_THRESHOLDS).map((t) => t.clicksWithoutConversions);
    expect(new Set(ctr).size).toBeGreaterThan(1);
    expect(new Set(clicks).size).toBe(3);
  });

  /** LinkedIn alone has no floor; it guards with `ctr > 0` instead. Not equivalent — see the JSDoc. */
  it('records that only LinkedIn has no impression floor', () => {
    expect(CAMPAIGN_ALERT_THRESHOLDS['linkedin-ads'].minImpressions).toBeNull();
    expect(CAMPAIGN_ALERT_THRESHOLDS['meta-ads'].minImpressions).not.toBeNull();
    expect(CAMPAIGN_ALERT_THRESHOLDS['reddit-ads'].minImpressions).not.toBeNull();
  });
});

describe('CAMPAIGN_EMAIL_TYPES', () => {
  it('has a default id that actually exists in the list', () => {
    // Without this, renaming the id leaves `selectedEmailStage()` undefined, the stage is omitted
    // from generation, and the `[selected]` binding matches nothing -- so the control falls back
    // to the FIRST option. That is the CFP-Launch default bug, resurrected silently.
    expect(CAMPAIGN_EMAIL_TYPES.some((t) => t.id === DEFAULT_CAMPAIGN_EMAIL_TYPE_ID)).toBe(true);
  });

  it('maps every type to a stage campaign-service enumerates', () => {
    const upstream = new Set(['CFP Launch', 'Schedule Announcement', 'Registration Push', 'Discount Offer', 'Final Countdown', 'Post-Event']);
    // A stage outside the enum is refused with a 400, so a typo here breaks that type entirely.
    for (const t of CAMPAIGN_EMAIL_TYPES) {
      expect(upstream.has(t.stage), `${t.id} -> ${t.stage}`).toBe(true);
    }
  });

  it('gives every type at least one keyword to rank clones by', () => {
    for (const t of CAMPAIGN_EMAIL_TYPES) {
      expect(t.keywords.length, t.id).toBeGreaterThan(0);
    }
  });
});

describe('isCanonicalGoogleAdsResourceId', () => {
  /**
   * The controller refuses malformed keyword ids with "must each be a positive integer id" BEFORE
   * any fan-out, which is what keeps an irreversible REMOVE batch all-or-nothing. A digit-count
   * regex alone did not enforce that promise: "0", the leading-zero spelling and an out-of-range
   * value all passed here and were refused by campaign-service instead.
   */
  it.each([
    ['123', true],
    ['1', true],
    // math.MaxInt64 itself is VALID. An alternation-based range check silently rejected it, which
    // is why the bound is arithmetic rather than a regex.
    ['9223372036854775807', true],
    ['9223372036854775808', false],
    ['9999999999999999999', false],
    ['0', false],
    ['0305729261', false],
    ['', false],
    ['12a', false],
    ['-1', false],
  ])('%s -> %s', (value, expected) => {
    expect(isCanonicalGoogleAdsResourceId(value)).toBe(expected);
  });

  /**
   * The controller validates `req.body`, which is CAST rather than parsed, so a JSON number
   * reaches this helper as a number. The regex coerced it and passed, and the leading-zero check
   * then threw `startsWith is not a function` -- turning malformed input into a 500 instead of
   * the 400 this validation exists to produce.
   */
  it.each([
    [123, 'a JSON number'],
    [null, 'null'],
    [undefined, 'undefined'],
    [{}, 'an object'],
    [['1'], 'an array'],
    [true, 'a boolean'],
  ])('refuses %s (%s) without throwing', (value, _label) => {
    expect(() => isCanonicalGoogleAdsResourceId(value as never)).not.toThrow();
    expect(isCanonicalGoogleAdsResourceId(value as never)).toBe(false);
  });
});

/**
 * The Google channel catalogue is a REPRODUCTION of campaign-service's own tables — the picker is
 * built from it, and anything it offers that upstream refuses becomes a create that fails after
 * the budget has already been mutated. These cases pin the reproduction against the contract in
 * `internal/platform/googleads/bidding.go` and its sibling channel files, so a table edited here
 * without a corresponding upstream change goes red rather than shipping as a broken option.
 *
 * The direction matters: every assertion below is "we offer no more than upstream accepts". A set
 * narrower than upstream's costs an operator an option; a set wider than upstream's costs them a
 * campaign.
 */
describe('Google bidding catalogue', () => {
  it('covers every channel the app can create', () => {
    expect(Object.keys(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL).sort()).toEqual([...GOOGLE_CAMPAIGN_CHANNELS].sort());
    expect(Object.keys(GOOGLE_BIDDING_DEFAULT_BY_CHANNEL).sort()).toEqual([...GOOGLE_CAMPAIGN_CHANNELS].sort());
  });

  /**
   * Set-for-set against upstream. Written out rather than derived, because a derivation would
   * reproduce whatever mistake the constant made — these five sets genuinely disagree and the
   * disagreements are the contract.
   */
  it.each([
    ['search', ['manual-cpc', 'maximize-clicks', 'maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas']],
    ['demand-gen', ['maximize-clicks']],
    ['performance-max', ['maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas']],
    ['video', ['maximize-conversions', 'target-cpa']],
    ['display', ['maximize-clicks', 'maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas']],
  ])('offers %s exactly the strategies campaign-service accepts', (channel, expected) => {
    expect([...GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel as (typeof GOOGLE_CAMPAIGN_CHANNELS)[number]]]).toEqual(expected);
  });

  /**
   * Demand Gen is the one set a reader is most likely to "fix": every other automated strategy
   * looks like it should work there. A live `validateOnly` mutate returned
   * `BIDDING_STRATEGY_TYPE_INCOMPATIBLE_WITH_SHARED_BUDGET` for all of them.
   */
  it('keeps demand gen at maximize-clicks alone', () => {
    expect(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL['demand-gen']).toHaveLength(1);
  });

  /**
   * Performance Max has no manual bidding at all upstream; Display's omission is OURS — the client's
   * Display ad-group payload carries no bid field — so the two exclusions have different causes and
   * are pinned separately.
   */
  it('omits manual cpc where it cannot be sent', () => {
    expect(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL['performance-max']).not.toContain('manual-cpc');
    expect(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL.display).not.toContain('manual-cpc');
    expect(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL.search).toContain('manual-cpc');
  });

  it('offers no strategy outside the accepted vocabulary', () => {
    for (const strategies of Object.values(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL)) {
      for (const strategy of strategies) {
        expect(GOOGLE_BIDDING_STRATEGIES).toContain(strategy);
      }
    }
  });

  /**
   * A default that is not in its own channel's accepted set would preselect an option the picker
   * also refuses to show — the one combination guaranteed to fail the create.
   */
  it('defaults each channel to a strategy that channel accepts', () => {
    for (const channel of GOOGLE_CAMPAIGN_CHANNELS) {
      expect(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel]).toContain(GOOGLE_BIDDING_DEFAULT_BY_CHANNEL[channel]);
    }
  });

  /** `defaultBiddingStrategy` in `internal/platform/googleads/bidding.go`, channel by channel. */
  it.each([
    ['search', 'manual-cpc'],
    ['demand-gen', 'maximize-clicks'],
    ['performance-max', 'maximize-conversions'],
    ['video', 'maximize-conversions'],
    ['display', 'maximize-conversions'],
  ])('names %s default as %s', (channel, expected) => {
    expect(GOOGLE_BIDDING_DEFAULT_BY_CHANNEL[channel as (typeof GOOGLE_CAMPAIGN_CHANNELS)[number]]).toBe(expected);
  });

  /**
   * Upstream REFUSES a target carried on a strategy that cannot hold it rather than dropping it, so
   * a strategy appearing in both sets would offer both fields and make one of them fatal.
   */
  it('keeps the cpa and roas strategies disjoint', () => {
    for (const strategy of GOOGLE_BIDDING_CPA_STRATEGIES) {
      expect(GOOGLE_BIDDING_ROAS_STRATEGIES).not.toContain(strategy);
    }
  });

  it('requires a target only on the two target-bearing spellings', () => {
    expect([...GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES]).toEqual(['target-cpa', 'target-roas']);
    for (const strategy of GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES) {
      expect([...GOOGLE_BIDDING_CPA_STRATEGIES, ...GOOGLE_BIDDING_ROAS_STRATEGIES]).toContain(strategy);
    }
  });

  /**
   * Equal to upstream, never tighter: a bound narrower than `minCPCBid`/`maxCPCBid` (`adgroup_ad.go`)
   * or `minTargetCPA`/`maxTargetCPA`/`minTargetROAS`/`maxTargetROAS` (`bidding.go`) would refuse a
   * create Google would have accepted, which is the one failure mode this form must not have.
   */
  it('reproduces the upstream numeric bounds', () => {
    expect(GOOGLE_ADS_BIDDING_BOUNDS.cpcBid).toEqual({ min: 0.01, max: 100_000 });
    expect(GOOGLE_ADS_BIDDING_BOUNDS.targetCpa).toEqual({ min: 0.01, max: 1_000_000 });
    expect(GOOGLE_ADS_BIDDING_BOUNDS.targetRoas).toEqual({ min: 0.01, max: 1000 });
  });
});

describe('Google conversion actions', () => {
  /**
   * Not a Search-versus-the-rest split: `campaign.selective_optimization` is defined for SEARCH,
   * DISPLAY and VIDEO. Demand Gen has no such field and Performance Max selects conversions through
   * a resource that cannot be addressed until the campaign exists, so both REFUSE a list rather
   * than dropping it — the section has to be withheld there, not offered and discarded.
   */
  it('admits exactly the three channels upstream accepts a list on', () => {
    expect([...GOOGLE_CONVERSION_ACTION_CHANNELS]).toEqual(['search', 'video', 'display']);
    expect(GOOGLE_CONVERSION_ACTION_CHANNELS).not.toContain('demand-gen');
    expect(GOOGLE_CONVERSION_ACTION_CHANNELS).not.toContain('performance-max');
  });

  it('names only real channels', () => {
    for (const channel of GOOGLE_CONVERSION_ACTION_CHANNELS) {
      expect(GOOGLE_CAMPAIGN_CHANNELS).toContain(channel);
    }
  });

  /** `maxConversionActions` in `internal/platform/googleads/bidding.go`. */
  it('caps the list where upstream caps it', () => {
    expect(GOOGLE_ADS_MAX_CONVERSION_ACTIONS).toBe(100);
  });

  it.each([
    ['12345', true],
    ['1', true],
    ['customers/8666746580/conversionActions/678', true],
    // The resource name must be the whole value, not merely contained in it.
    ['customers/1/conversionActions/2 extra', false],
    ['not-an-id', false],
    ['', false],
    ['  12345', false],
    ['customers/abc/conversionActions/1', false],
    ['conversionActions/678', false],
  ])('matches %s -> %s', (value, expected) => {
    expect(GOOGLE_ADS_CONVERSION_ACTION_PATTERN.test(value)).toBe(expected);
  });

  /**
   * A shared `RegExp` with the `g` flag carries `lastIndex` between calls, so the same valid id
   * alternates true/false as a list is validated entry by entry. The flag is the whole hazard —
   * this pattern is module-level and reused, so the absence is asserted rather than assumed.
   */
  it('is stateless across repeated tests', () => {
    expect(GOOGLE_ADS_CONVERSION_ACTION_PATTERN.global).toBe(false);
    expect(GOOGLE_ADS_CONVERSION_ACTION_PATTERN.test('12345')).toBe(true);
    expect(GOOGLE_ADS_CONVERSION_ACTION_PATTERN.test('12345')).toBe(true);
  });
});

describe('Google channel enums and creative catalogue', () => {
  /**
   * The monitoring GAQL filters `campaign.advertising_channel_type` with these literals, and the
   * create path sends the matching channel — so a wrong spelling here does not fail loudly, it
   * silently drops that channel's campaigns out of every metrics read.
   */
  it('mirrors the advertising channel type each create sends', () => {
    expect(GOOGLE_ADS_CHANNEL_TYPE_ENUMS).toEqual({
      search: 'SEARCH',
      'demand-gen': 'DEMAND_GEN',
      'performance-max': 'PERFORMANCE_MAX',
      video: 'VIDEO',
      display: 'DISPLAY',
    });
  });

  /**
   * Search builds its ad from the shared headline/description copy, and the Google Ads API cannot
   * create a Video campaign at all — so neither collects a channel creative, and offering one would
   * build a form whose only possible outcome is a refusal.
   */
  it('collects a creative only for the three channels that carry one', () => {
    expect([...GOOGLE_CHANNELS_WITH_CREATIVE]).toEqual(['demand-gen', 'performance-max', 'display']);
    expect(GOOGLE_CHANNELS_WITH_CREATIVE).not.toContain('search');
    expect(GOOGLE_CHANNELS_WITH_CREATIVE).not.toContain('video');
  });

  it('gives each of those channels a spec, a request key and a section title', () => {
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      expect(GOOGLE_CREATIVE_FIELD_SPECS[channel].length).toBeGreaterThan(0);
      expect(GOOGLE_CREATIVE_REQUEST_KEYS[channel]).toBeTruthy();
      expect(GOOGLE_CREATIVE_SECTION_TITLES[channel]).toBeTruthy();
    }
  });

  /** campaign-service's own envelope spelling, which has nothing to do with the channel's wire value. */
  it('names the request keys campaign-service reads', () => {
    expect(GOOGLE_CREATIVE_REQUEST_KEYS).toEqual({
      'demand-gen': 'demandGenCreative',
      'performance-max': 'performanceMaxCreative',
      display: 'displayCreative',
    });
  });

  /**
   * The section headings spell the channel the way its own checkbox does — deliberately NOT the
   * reporting shorthand in `GOOGLE_CAMPAIGN_CHANNEL_LABELS` (`DG Display`, `PMax`), so the section
   * a user opens is named the same as the box they ticked to open it.
   */
  it('titles each section the way its checkbox reads', () => {
    expect(GOOGLE_CREATIVE_SECTION_TITLES).toEqual({
      'demand-gen': 'Demand Gen',
      'performance-max': 'Performance Max',
      display: 'Display',
    });
  });

  it('never states a minimum above its own maximum', () => {
    for (const specs of Object.values(GOOGLE_CREATIVE_FIELD_SPECS)) {
      for (const spec of specs) {
        const { min, max } = spec as { min?: number; max?: number };
        if (min !== undefined && max !== undefined) {
          expect(min).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  /**
   * The counts that differ between channels under the SAME field name — the trap the catalogue
   * exists to close. Performance Max needs three headlines and two descriptions where the other two
   * channels need one of each; a shared number would make a valid PMax form impossible to fill or a
   * valid Demand Gen form impossible to submit.
   */
  it.each([
    ['demand-gen', 'headlines', 1, 5],
    ['performance-max', 'headlines', 3, 15],
    ['display', 'headlines', 1, 5],
    ['demand-gen', 'descriptions', 1, 5],
    ['performance-max', 'descriptions', 2, 5],
    ['display', 'descriptions', 1, 5],
  ])('bounds %s %s at %i..%i', (channel, control, min, max) => {
    const spec = GOOGLE_CREATIVE_FIELD_SPECS[channel as (typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number]].find((f) => f.control === control) as {
      min?: number;
      max?: number;
    };
    expect(spec.min).toBe(min);
    expect(spec.max).toBe(max);
  });

  /**
   * `longHeadline` is a LIST on Performance Max and a SINGLE STRING on Display — same word, two
   * shapes. This is why the spec carries `kind` instead of letting a caller infer the shape from
   * the name, and reading the wrong one puts an array where upstream expects a string.
   */
  it('keeps the long headline shapes apart', () => {
    const pmax = GOOGLE_CREATIVE_FIELD_SPECS['performance-max'].find((f) => f.control === 'longHeadlines');
    const display = GOOGLE_CREATIVE_FIELD_SPECS.display.find((f) => f.control === 'longHeadline');
    expect(pmax?.kind).toBe('list');
    expect(display?.kind).toBe('text');
  });
});
