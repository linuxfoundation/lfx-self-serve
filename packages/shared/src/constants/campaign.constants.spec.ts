// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CampaignPlatform, GoogleCreativeEitherOrRule, GoogleCreativeFieldSpec, RedditObjective } from '../interfaces/campaign.interface';
import { CAMPAIGN_ADOPT_PLATFORMS } from './campaign-optimize.constants';
import { lfxColors } from './colors.constants';
import {
  isCanonicalGoogleAdsResourceId,
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_MIME_TYPES,
  isCreativeAssetMimeType,
  sniffCreativeAssetMimeType,
  BUDGET_WRITABLE_CAMPAIGN_PLATFORMS,
  DAILY_ONLY_BUDGET_CAMPAIGN_PLATFORMS,
  CAMPAIGN_ALERT_THRESHOLDS,
  CAMPAIGN_PLATFORMS,
  MONITOR_PLATFORM_BUTTON_COLORS,
  CAMPAIGN_EMAIL_TYPES,
  DEFAULT_CAMPAIGN_EMAIL_TYPE_ID,
  DEFAULT_REDDIT_CALL_TO_ACTION,
  DEFAULT_REDDIT_OBJECTIVE,
  GOOGLE_ADS_AGE_RANGE_MAP,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_BIDDING_BOUNDS,
  GOOGLE_ADS_CHANNEL_TYPE_ENUMS,
  GOOGLE_ADS_CONVERSION_ACTION_PATTERN,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_LANGUAGE_LABELS,
  GOOGLE_ADS_LANGUAGE_MAP,
  GOOGLE_ADS_MAX_CONVERSION_ACTIONS,
  GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_ADS_MAX_DEVICE_BID_MODIFIERS,
  GOOGLE_BIDDING_CPA_STRATEGIES,
  GOOGLE_BIDDING_DEFAULT_BY_CHANNEL,
  GOOGLE_BIDDING_ROAS_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL,
  GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES,
  GOOGLE_CAMPAIGN_CHANNELS,
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_ASSET_PLAN_ANY_OF_SLOT_KEYS,
  GOOGLE_ASSET_PLAN_SLOT_CONTROLS,
  GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS,
  GOOGLE_CONVERSION_ACTION_CHANNELS,
  GOOGLE_CREATIVE_EITHER_OR_RULES,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_SECTION_TITLES,
  MAX_REDDIT_HEADLINE_LENGTH,
  META_OBJECTIVE_LABELS,
  META_OBJECTIVE_PARAMS,
  META_SELECTABLE_OBJECTIVES,
  REDDIT_CALL_TO_ACTIONS,
  REDDIT_OBJECTIVE_LABELS,
  REDDIT_OBJECTIVE_PARAMS,
  REDDIT_SELECTABLE_OBJECTIVES,
  REDDIT_VIDEO_GOAL_LABELS,
  REDDIT_VIDEO_GOALS,
  TOGGLEABLE_CAMPAIGN_PLATFORMS,
  campaignToggleAction,
  canonicalMicrosoftMatchType,
  isMicrosoftMatchType,
  normalizeGeoTargets,
  normalizeMicrosoftGeoTargets,
  resolveRedditOptimizationGoal,
  googleAdsEchoed,
  googleAdsBoundExtensionText,
  googleAdsToLower,
  googleAdsDecodedText,
  googleAdsTrimSpace,
  googleAdsWellFormed,
  googleAdsUrlGoParseFlaw,
  isGoogleAdsServableUrl,
  isGoSpaceCode,
  PAUSE_ONLY_CAMPAIGN_PLATFORMS,
  campaignResumeWithheldForPlatform,
  campaignPlatformMonitorable,
} from './campaign.constants';

/**
 * The Monitoring tab's offer is decoupled from the CREATE flow's `disabled` flag, as the toggle is.
 * X's adopted campaigns are live and spending, so its monitor shows while its create stays off.
 */
describe('campaignPlatformMonitorable', () => {
  it('offers X to the Monitoring tab while X create stays disabled', () => {
    expect(CAMPAIGN_PLATFORMS.find((p) => p.id === 'twitter-ads')?.disabled).toBe(true);
    expect(campaignPlatformMonitorable('twitter-ads')).toBe(true);
  });

  it('offers every create-enabled platform', () => {
    for (const platform of CAMPAIGN_PLATFORMS.filter((p) => !p.disabled)) {
      expect(campaignPlatformMonitorable(platform.id)).toBe(true);
    }
  });

  it('keeps X out of the create-enabled platforms the Implement tab and the picker offer', () => {
    expect(CAMPAIGN_PLATFORMS.filter((p) => !p.disabled).map((p) => p.id)).not.toContain('twitter-ads');
  });

  it('answers false for a platform the list does not know', () => {
    expect(campaignPlatformMonitorable('unknown-ads' as CampaignPlatform)).toBe(false);
  });
});

/**
 * The toggle is decoupled from the CREATE flow's `disabled` flag. A campaign reaches this app by
 * being created here or by being adopted, and an adopted campaign is live and spending, so it must
 * be pausable whether or not its platform can be created. X is the case that proves it: create
 * stays off, pause is on.
 */
describe('TOGGLEABLE_CAMPAIGN_PLATFORMS', () => {
  it('is exactly the create-enabled platforms plus the adoptable ones', () => {
    const createEnabled = CAMPAIGN_PLATFORMS.filter((p) => !p.disabled).map((p) => p.id);
    const expected = [...new Set<string>([...createEnabled, ...CAMPAIGN_ADOPT_PLATFORMS])].sort();
    expect([...TOGGLEABLE_CAMPAIGN_PLATFORMS].sort()).toEqual(expected);
  });

  it('pins the toggleable set, including X', () => {
    expect([...TOGGLEABLE_CAMPAIGN_PLATFORMS].sort()).toEqual(['google-ads', 'linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads', 'twitter-ads']);
  });

  it('keeps X create disabled while its adopted campaigns are toggleable', () => {
    expect(CAMPAIGN_PLATFORMS.find((p) => p.id === 'twitter-ads')?.disabled).toBe(true);
    expect(TOGGLEABLE_CAMPAIGN_PLATFORMS.has('twitter-ads')).toBe(true);
  });
});

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
   * A platform outside `TOGGLEABLE_CAMPAIGN_PLATFORMS` is refused at any status, because the BFF
   * rejects it before the status is consulted. Every paid platform is toggleable now that X is
   * (adopted X campaigns), so the subject is a platform string this app does not know at all.
   */
  it('refuses a platform this app does not offer, at any status', () => {
    expect(campaignToggleAction('created', 'tiktok-ads')).toBe('unavailable');
    expect(campaignToggleAction('paused', 'tiktok-ads')).toBe('unavailable');
  });

  it('offers pause and resume for microsoft-ads', () => {
    expect(campaignToggleAction('created', 'microsoft-ads')).toBe('pause');
    expect(campaignToggleAction('paused', 'microsoft-ads')).toBe('resume');
    expect(campaignResumeWithheldForPlatform('paused', 'microsoft-ads')).toBe(false);
  });

  // Every X row is adopted (X create is off) and upstream 409s ACTIVE on an adopted row, so X is
  // pause-only: Resume is withheld rather than offered as a button whose every click fails.
  it('offers pause but withholds resume for twitter-ads', () => {
    expect([...PAUSE_ONLY_CAMPAIGN_PLATFORMS]).toEqual(['twitter-ads']);
    expect(campaignToggleAction('created', 'twitter-ads')).toBe('pause');
    expect(campaignToggleAction('paused', 'twitter-ads')).toBe('unavailable');
    expect(campaignResumeWithheldForPlatform('paused', 'twitter-ads')).toBe(true);
    expect(campaignResumeWithheldForPlatform('created', 'twitter-ads')).toBe(false);
    expect(campaignResumeWithheldForPlatform('deleted', 'twitter-ads')).toBe(false);
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

  /**
   * The scalar counterpart of `min`, and the exact set campaign-service refuses a non-empty
   * creative without: a business name on all three (`demandgen_creative.go`, `pmax_creative.go`,
   * `display_creative.go`), plus the responsive display ad's single long headline. Marking one
   * more than that set would refuse a creative Google takes.
   */
  it('marks exactly the fields upstream requires once a creative is started', () => {
    const required = Object.fromEntries(
      GOOGLE_CHANNELS_WITH_CREATIVE.map((channel) => [
        channel,
        (GOOGLE_CREATIVE_FIELD_SPECS[channel] as readonly GoogleCreativeFieldSpec[]).filter((f) => f.requiredOnce === true).map((f) => f.control),
      ])
    );
    expect(required).toEqual({
      'demand-gen': ['businessName'],
      'performance-max': ['businessName'],
      display: ['longHeadline', 'businessName'],
    });
  });

  /** `requiredOnce` is the scalar rule; a list states its floor as `min`, which counts entries. */
  it('never marks a list field required-once', () => {
    for (const specs of Object.values(GOOGLE_CREATIVE_FIELD_SPECS)) {
      for (const spec of specs as readonly GoogleCreativeFieldSpec[]) {
        if (spec.requiredOnce === true) expect(spec.kind).toBe('text');
      }
    }
  });

  /**
   * Demand Gen and Display require a marketing image OR a square one; Performance Max requires
   * both separately and so carries no rule. An empty list for Performance Max is the point, not an
   * omission — a rule there would duplicate the two `min: 1` entries and read as an either-or.
   */
  it('states the marketing-image either-or only where upstream states it', () => {
    expect(GOOGLE_CREATIVE_EITHER_OR_RULES['demand-gen'].map((r) => r.controls)).toEqual([['marketingImages', 'squareMarketingImages']]);
    expect(GOOGLE_CREATIVE_EITHER_OR_RULES.display.map((r) => r.controls)).toEqual([['marketingImages', 'squareMarketingImages']]);
    expect(GOOGLE_CREATIVE_EITHER_OR_RULES['performance-max']).toEqual([]);
  });

  /** Performance Max's independent requirement, which is what makes its empty rule list correct. */
  it('requires both Performance Max marketing arrays separately', () => {
    const specs = GOOGLE_CREATIVE_FIELD_SPECS['performance-max'] as readonly GoogleCreativeFieldSpec[];
    expect(specs.find((f) => f.control === 'marketingImages')?.min).toBe(1);
    expect(specs.find((f) => f.control === 'squareMarketingImages')?.min).toBe(1);
  });

  /** Every rule names fields that exist on its own channel, and names at least two of them. */
  it('points every either-or rule at real list fields of its channel', () => {
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      const lists = (GOOGLE_CREATIVE_FIELD_SPECS[channel] as readonly GoogleCreativeFieldSpec[]).filter((f) => f.kind === 'list').map((f) => f.control);
      for (const rule of GOOGLE_CREATIVE_EITHER_OR_RULES[channel] as readonly GoogleCreativeEitherOrRule[]) {
        expect(rule.controls.length).toBeGreaterThan(1);
        for (const control of rule.controls) expect(lists).toContain(control);
      }
    }
  });
});

/**
 * Guards on the Reddit values copied from lfx-v2-campaign-service rather than derived here. They
 * cannot detect upstream drift — only a re-capture does that — but they do pin the invariants
 * upstream states about its own tables, so a careless edit on this side fails here instead of as
 * an opaque Reddit 400 at create time.
 */
describe('Reddit promoted-post contract', () => {
  /** Upstream requires this of `defaultRedditCTA`, and a default outside the list is unsendable. */
  it('keeps the default call to action inside the accepted set', () => {
    expect(REDDIT_CALL_TO_ACTIONS).toContain(DEFAULT_REDDIT_CALL_TO_ACTION);
  });

  /**
   * Upstream keys its CTA table on the UPPER-CASED label for case-insensitive lookup, so two
   * labels differing only in case would be one entry there and two rows in any control built from
   * this list. Checking the upper-cased forms catches that; checking the labels alone would not.
   */
  it('gives every call to action a distinct case-insensitive label', () => {
    const upper = REDDIT_CALL_TO_ACTIONS.map((cta) => cta.toUpperCase());
    expect(new Set(upper).size).toBe(REDDIT_CALL_TO_ACTIONS.length);
  });

  /** Reddit matches the label exactly once case is folded; a padded one is rejected. */
  it('sends every call to action trimmed and non-empty', () => {
    for (const cta of REDDIT_CALL_TO_ACTIONS) {
      expect(cta).toBe(cta.trim());
      expect(cta.length).toBeGreaterThan(0);
    }
  });

  /**
   * The headline cap is `maxRedditHeadlineRunes` upstream, and the only failure mode that matters
   * is refusing a headline Reddit would have accepted — so an accidental edit DOWNWARD is the one
   * to catch. Pinned by value because the value is copied, not derived.
   */
  it('keeps the headline cap at the length upstream enforces', () => {
    expect(MAX_REDDIT_HEADLINE_LENGTH).toBe(300);
  });

  /**
   * Pinned as a whole set, not by count: Reddit has no bare `VIDEO_VIEWS` goal, so a video-view
   * campaign must name one of exactly these, and upstream rejects anything else before it creates.
   */
  it('offers exactly the video goals upstream accepts', () => {
    expect([...REDDIT_VIDEO_GOALS]).toEqual(['VIDEO_VIEW_6S', 'VIDEO_VIEW_15S']);
  });

  /** Every goal the picker offers has a readable name, and nothing else does. */
  it('labels exactly the video goals upstream accepts', () => {
    expect(Object.keys(REDDIT_VIDEO_GOAL_LABELS)).toEqual([...REDDIT_VIDEO_GOALS]);
  });

  /**
   * The picker's set is a SUBSET of `RedditObjective`, never a value outside it.
   *
   * `REDDIT_OBJECTIVE_LABELS` is typed total over `RedditObjective`, so its keys are that type at
   * runtime — an objective added to the picker without being added to the union would have no
   * label here, and the control would render a blank row. The types catch that on the constant
   * itself; this catches it after a cast, which is how the picker list is written.
   */
  it('offers only objectives the request type admits', () => {
    for (const objective of REDDIT_SELECTABLE_OBJECTIVES) {
      expect(Object.keys(REDDIT_OBJECTIVE_LABELS)).toContain(objective);
    }
  });

  /**
   * And the default is one of them. It seeds the control on a fresh campaign, so a default outside
   * the picker's set would open every new Reddit campaign on a value shown as
   * "(no longer available)" and disabled — unchangeable except by picking something else.
   */
  it('seeds the picker with an objective the picker offers', () => {
    expect([...REDDIT_SELECTABLE_OBJECTIVES]).toContain(DEFAULT_REDDIT_OBJECTIVE);
  });
});

/**
 * One case per branch of the resolution step in `Client.CreateCampaign` upstream
 * (`lfx-v2-campaign-service`, `internal/platform/reddit/client.go`), named for the branch it pins
 * rather than for the rule they add up to — a branch dropped in a future edit then shows up as an
 * absent test instead of hiding inside a passing one (#3449).
 */
describe('resolveRedditOptimizationGoal', () => {
  /**
   * The three static goals, pinned by value against upstream's `redditObjectiveParams`. Pinned
   * rather than derived: the table is a hand-maintained copy, and a test that read the same table
   * the resolver reads would certify whatever the table happened to say.
   */
  it.each([
    ['awareness', 'IMPRESSIONS'],
    ['traffic', 'CLICKS'],
    ['conversions', 'PURCHASE'],
  ] as const)('sends the static goal upstream carries for %s', (objective, goal) => {
    expect(resolveRedditOptimizationGoal(objective)).toBe(goal);
  });

  /**
   * The bug this function exists for: `video_views` used to carry a baked-in `VIDEO_VIEWS`, which
   * is not a goal Reddit has. The table must stay silent so the goal can only come from the
   * request.
   */
  it('leaves video_views without a static goal in the table', () => {
    expect(REDDIT_OBJECTIVE_PARAMS.video_views.optimizationGoal).toBeUndefined();
  });

  /**
   * The tripwire for the resolver's `as string` cast. The value pins above cover only the three
   * objectives named today; this walks the table itself, so a new objective added without a goal
   * fails here instead of silently resolving to `undefined` through the cast (#3504).
   */
  it('carries a static goal on every objective except video_views', () => {
    const goalless = Object.entries(REDDIT_OBJECTIVE_PARAMS)
      .filter(([objective, params]) => objective !== 'video_views' && !params.optimizationGoal)
      .map(([objective]) => objective);

    expect(goalless).toEqual([]);
  });

  /** Upstream trims and upper-cases before testing membership, so a lowercase goal is accepted. */
  it.each(['VIDEO_VIEW_6S', 'video_view_15s', '  VIDEO_VIEW_6S  '])('resolves video_views from the request goal %s', (videoGoal) => {
    expect(resolveRedditOptimizationGoal('video_views', videoGoal)).toBe(videoGoal.trim().toUpperCase());
  });

  /**
   * Empty and absent are the live cases, not exotic ones: nothing in the Implementation tab
   * collects a video goal yet, so every `video_views` request that reaches either creator today
   * arrives without one. Refusing is the whole point — the alternative is a PAUSED campaign
   * orphaned by a rejection at the ad group.
   */
  it.each([undefined, '', '   ', 'VIDEO_VIEWS', 'VIDEO_VIEW_30S'])('refuses video_views carrying the goal %s', (videoGoal) => {
    expect(() => resolveRedditOptimizationGoal('video_views', videoGoal)).toThrow(/must be one of VIDEO_VIEW_6S, VIDEO_VIEW_15S/);
  });

  /**
   * Reached only after a runtime widening — `POST /api/campaigns/create` forwards `redditConfig` without
   * validating `objective`, so the compiler's guarantee does not hold at this boundary.
   */
  it('refuses an objective outside the table', () => {
    expect(() => resolveRedditOptimizationGoal('reach' as RedditObjective)).toThrow(/Unsupported Reddit objective: reach/);
  });

  /**
   * The table is a plain object literal, so these five resolve to inherited `Object.prototype`
   * members — every one truthy, which is exactly what the previous `!objParams` test asked for.
   * Each then carried no `optimizationGoal`, so the resolver returned `undefined` through its cast
   * and the caller sent a campaign POST missing `objective`, `bid_type` and `optimization_goal`
   * rather than refusing before the call. Pinned by name because the guard that fixes it,
   * `Object.hasOwn`, is easy to "simplify" back into a truthiness test (#3504).
   */
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])('refuses the inherited prototype key %s', (objective) => {
    expect(() => resolveRedditOptimizationGoal(objective as RedditObjective)).toThrow(`Unsupported Reddit objective: ${objective}`);
  });
});

describe('Google Ads language tables', () => {
  /**
   * The two maps share no type-level key constraint — `GOOGLE_ADS_LANGUAGE_MAP` is a plain
   * `Record<string, string>` so it stays a line-for-line mirror of upstream's `languageConstants` —
   * so this is what ties them. A code in the map and not the labels would be a language upstream
   * accepts that the picker never offers; the reverse would offer one with no constant id behind it.
   */
  it('labels exactly the codes the language map carries', () => {
    expect(Object.keys(GOOGLE_ADS_LANGUAGE_LABELS).sort()).toEqual(Object.keys(GOOGLE_ADS_LANGUAGE_MAP).sort());
  });
});

/** Go's `strings.TrimSpace` and `strings.ToLower`, the two rules upstream's callout checks use. */
describe('Google Ads string rules', () => {
  it.each([
    ['ASCII space and tabs', ' \tFree\n', 'Free'],
    ['U+0085, which Go trims and JS `trim` keeps', '\u0085Free\u0085', 'Free'],
    ['no-break and line separators', '\u00a0Free\u2028', 'Free'],
    ['U+FEFF, which JS `trim` strips and Go keeps', '\ufeffFree', '\ufeffFree'],
  ])('trims %s as Go does', (_label, input, expected) => {
    expect(googleAdsTrimSpace(input)).toBe(expected);
  });

  it("matches Go's `unicode.IsSpace` on every UTF-16 code unit", () => {
    // `\t`–`\r`, U+0085 and category Z: Go's set, written as a regex only here, as the reference.
    const goSpace = /^[\t\n\v\f\r\u0085\p{Z}]$/u;
    const mismatches: number[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      if (isGoSpaceCode(code) !== goSpace.test(String.fromCharCode(code))) mismatches.push(code);
    }

    expect(mismatches).toEqual([]);
  });

  it.each([
    ['a lone high surrogate', 'a\ud800b', 'a\ufffdb'],
    ['a lone low surrogate', 'a\udc00b', 'a\ufffdb'],
    ['a high surrogate at the end', 'ab\ud801', 'ab\ufffd'],
    ['two lone surrogates in a row', '\udc00\ud800', '\ufffd\ufffd'],
    ['a reversed pair', '\ude00\ud83d', '\ufffd\ufffd'],
  ])("replaces %s with U+FFFD as Go's JSON decoder does", (_label, input, expected) => {
    expect(googleAdsWellFormed(input)).toBe(expected);
  });

  it('keeps well-formed text, astral characters included, as the same string', () => {
    const text = 'Labs \u{1F600} \u00e9';
    expect(googleAdsWellFormed(text)).toBe(text);
  });

  it('reads two different lone surrogates as the same text, as upstream does', () => {
    expect(googleAdsDecodedText(' Talks\ud800 ')).toBe(googleAdsDecodedText('Talks\ud801'));
    expect(googleAdsDecodedText(' Talks\ud800 ')).toBe('Talks\ufffd');
  });

  it('trims a long interior whitespace run in linear time', () => {
    // A `[ws]+$` regex backtracks quadratically here: 40,000 spaces took about 2.5 s.
    const text = `x${' '.repeat(1_000_000)}x`;
    const started = Date.now();

    expect(googleAdsTrimSpace(` ${text} `)).toBe(text);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each([
    ['short text, unchanged', 'Free shipping', 'Free shipping'],
    ['long text, cut at 32 code points', 'A'.repeat(40), `${'A'.repeat(32)}…`],
    ['an emoji at the cut, kept whole', `${'A'.repeat(31)}🎉🎉`, `${'A'.repeat(31)}🎉…`],
  ])('echoes %s', (_label, input, expected) => {
    expect(googleAdsEchoed(input)).toBe(expected);
  });

  // The extension bound the brief generator and the brief restore both call, so a callout or a
  // sitelink label arriving from a model response or from an opaque stored row is held to the
  // same rule the editor's own add-guard applies.
  it.each([
    ['a non-string', 42, 25, ''],
    ['text inside the cap, trimmed', '  Free Admission  ', 25, 'Free Admission'],
    ['U+0085, which Go trims and JS `trim` keeps', '\u0085Free\u0085', 25, 'Free'],
    ['U+FEFF, which JS `trim` strips and Go keeps', '\ufeffFree', 25, '\ufeffFree'],
    // Counted in runes, not UTF-16 units: `.slice(0, 3)` would cut this after the lone high
    // surrogate of the second emoji and leave an unpaired one behind.
    ['astral characters, counted as runes', '🎉🎉🎉🎉', 3, '🎉🎉🎉'],
    // The cut lands immediately after a space, and a trailing space is a difference upstream's
    // own duplicate check sees — so the bound re-trims after cutting.
    ['a cut that lands on a space', 'Free Admission Today', 5, 'Free'],
  ])('bounds %s', (_label, value, maxRunes, expected) => {
    expect(googleAdsBoundExtensionText(value, maxRunes)).toBe(expected);
  });

  it.each([
    ['a final sigma, with no word-end rule', 'ΟΔΟΣ', 'οδοσ'],
    ['a dotted capital I, to a plain i', 'İnfo', 'info'],
    ['ASCII', 'Free Shipping', 'free shipping'],
  ])('lower-cases %s as Go does', (_label, input, expected) => {
    expect(googleAdsToLower(input)).toBe(expected);
  });

  it.each([
    ['a plain https URL', 'https://events.example.org/register?utm=a&b=c#top', false],
    ['an uppercase scheme', 'HTTPS://events.example.org/', false],
    ['a valid percent escape', 'https://events.example.org/a%20b', false],
    ['a semicolon in the fragment, which is not the query', 'https://events.example.org/#a;b', false],
    ['a semicolon in the query', 'https://events.example.org/?a=1;b=2', true],
    ['a stray percent sign', 'https://events.example.org/50%off', true],
    ['a percent sign with one hex digit', 'https://events.example.org/?q=%2', true],
    ['no `//` after the scheme', 'https:events.example.org', true],
    ['backslashes for slashes', 'https:\\\\events.example.org', true],
    // Found by running Go's `url.Parse` and this helper over the same generated corpus.
    ['a newline inside the host, which `new URL()` deletes', 'https://exa\nmple.org/path', true],
    ['a tab inside the path', 'https://events.example.org/pa\tth', true],
    ['a C0 control in the query', 'https://events.example.org/?a=\u0001', true],
    ['DEL in the path', 'https://events.example.org/a\u007fb', true],
    ['a control character in the fragment, which Go cuts off before checking', 'https://events.example.org/#a\u0001b', false],
    ['a backslash inside the authority', 'https://events.example.org\\path', true],
    ['a backslash in the path, which both parsers accept', 'https://events.example.org/a\\b', false],
    ['a brace in the host', 'https://{events.example.org/', true],
    ['a backtick in the host', 'https://ev`ents.example.org/', true],
    ['a percent escape in the host', 'https://ev%41nts.example.org/', true],
    ['an empty userinfo, which Go still refuses', 'https://@events.example.org/', true],
    ['an empty authority', 'https:///register', true],
  ])("flags %s as Go's parser would", (_label, url, expected) => {
    expect(googleAdsUrlGoParseFlaw(url)).toBe(expected);
  });
});

/**
 * Every Monitor tab platform button's SELECTED colours must clear WCAG AA (4.5:1) for its 12px
 * label. Recomputed from the hex values, so a brand-colour change that breaks AA fails here.
 */
describe('MONITOR_PLATFORM_BUTTON_COLORS', () => {
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each(Object.entries(MONITOR_PLATFORM_BUTTON_COLORS))('%s clears 4.5:1, with a text class that renders its foreground', (_platform, colors) => {
    expect(contrast(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5);
    expect(colors.textClass).toBe(colors.foreground === lfxColors.white ? 'text-white' : 'text-gray-950');
    expect(colors.foreground === lfxColors.white || colors.foreground === lfxColors.gray[950]).toBe(true);
  });

  it('covers every platform the Monitor tab offers', () => {
    expect(Object.keys(MONITOR_PLATFORM_BUTTON_COLORS).sort()).toEqual(['google', 'hubspot', 'linkedin', 'meta', 'microsoft', 'reddit', 'twitter']);
  });
});

describe('Google Ads campaign criteria vocabularies', () => {
  it('caps the device bid modifier list at the number of devices it accepts, as upstream does', () => {
    // The cap's whole claim is "a longer list must repeat a device", and `maxDeviceBidModifiers`
    // upstream tracks `len(deviceTypes)` with a test of its own saying so. A device added to the
    // vocabulary without raising the cap would refuse a list that repeats nothing.
    expect(GOOGLE_ADS_MAX_DEVICE_BID_MODIFIERS).toBe(GOOGLE_ADS_DEVICES.length);
  });

  it('accepts both spellings of every age range, since upstream resolves them to the same enum', () => {
    // `ageRangeTypes` carries the friendly spelling and Google's own `AGE_RANGE_*` name for each
    // range deliberately. A friendly spelling without its enum twin — or an enum name that resolved
    // somewhere else — would refuse here what upstream accepts.
    for (const range of GOOGLE_ADS_AGE_RANGES) {
      const enumName = GOOGLE_ADS_AGE_RANGE_MAP[range as keyof typeof GOOGLE_ADS_AGE_RANGE_MAP];

      expect(enumName).toMatch(/^AGE_RANGE_/);
      expect(GOOGLE_ADS_AGE_RANGE_MAP[enumName]).toBe(enumName);
    }
  });

  it('offers only the friendly spellings in a refusal, so a message is not both halves of the map', () => {
    expect(GOOGLE_ADS_AGE_RANGES).toEqual(['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'UNDETERMINED']);
  });

  it('keeps UNDETERMINED in both vocabularies, since it is an ordinary member of each', () => {
    // Not a placeholder for "unset": excluding it is how a campaign skips the users Google could
    // not classify, which is a real targeting choice and one Google accepts on both criteria.
    expect(GOOGLE_ADS_AGE_RANGES).toContain('UNDETERMINED');
    expect(GOOGLE_ADS_GENDERS).toContain('UNDETERMINED');
  });

  it('fences both criteria off the same two channels today, from two separate lists', () => {
    // Separate constants because `validateCriteriaPlan` fences them in separate branches for
    // separate reasons — a bid Performance Max does not set, against demographics it takes as
    // asset-group signals — so either could move without the other.
    expect(GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS).not.toContain('demand-gen');
    expect(GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS).not.toContain('performance-max');
    expect(GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS).not.toContain('demand-gen');
    expect(GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS).not.toContain('performance-max');
  });

  it('caps each demographic exclusion list at 20, the per-list bound upstream checks twice', () => {
    expect(GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS).toBe(20);
  });
});

describe('creative-asset upload allowlist', () => {
  // campaign-service's `upload-creative-asset` content_type enum; anything else is refused upstream.
  it('admits exactly PNG and JPEG', () => {
    expect([...CREATIVE_ASSET_MIME_TYPES]).toEqual(['image/png', 'image/jpeg']);
    expect(isCreativeAssetMimeType('image/png')).toBe(true);
    expect(isCreativeAssetMimeType('image/jpeg')).toBe(true);
    for (const other of ['image/gif', 'image/webp', 'image/jpg', 'IMAGE/PNG', '', undefined, 42]) {
      expect(isCreativeAssetMimeType(other)).toBe(false);
    }
  });

  // Below campaign-service's own 30 MiB decoded ceiling, so nothing this app sends is refused there for size.
  it('bounds an upload at 10 MiB, inside the upstream 30 MiB ceiling', () => {
    expect(CREATIVE_ASSET_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(CREATIVE_ASSET_MAX_BYTES).toBeLessThan(30 * 1024 * 1024);
  });

  it('sniffs the PNG signature and the JPEG SOI marker, and nothing else', () => {
    expect(sniffCreativeAssetMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    expect(sniffCreativeAssetMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    // A truncated PNG signature, a GIF and an empty body are not images this upload accepts.
    expect(sniffCreativeAssetMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffCreativeAssetMimeType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffCreativeAssetMimeType(new Uint8Array())).toBeNull();
    // Only a real byte buffer is read: a request body tampered into an array or a string whose
    // indexes spell a PNG signature is not an image (CodeQL type confusion).
    expect(sniffCreativeAssetMimeType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])).toBeNull();
    expect(sniffCreativeAssetMimeType('\x89PNG\r\n\x1a\n')).toBeNull();
    expect(sniffCreativeAssetMimeType(undefined)).toBeNull();
  });
});

describe('budget-writable platforms (#3299)', () => {
  // campaign-service's `update-campaign-budget` serves Google, LinkedIn, Meta, Microsoft, Reddit
  // and X (docs/api-catalog.md); every other platform is a 400 upstream.
  it('includes X alongside the other five platforms campaign-service writes budgets on', () => {
    expect([...BUDGET_WRITABLE_CAMPAIGN_PLATFORMS].sort()).toEqual(['google-ads', 'linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads', 'twitter-ads']);
  });

  // X budgets are written as a daily amount only: a `lifetime` request is always a 409 upstream.
  it('marks X, and only X, as daily-only', () => {
    expect([...DAILY_ONLY_BUDGET_CAMPAIGN_PLATFORMS]).toEqual(['twitter-ads']);
  });

  it('never marks a platform daily-only that it cannot write a budget on', () => {
    for (const platform of DAILY_ONLY_BUDGET_CAMPAIGN_PLATFORMS) {
      expect(BUDGET_WRITABLE_CAMPAIGN_PLATFORMS.has(platform)).toBe(true);
    }
  });
});

/**
 * The accept set the editor's add guard, the brief-restore path and the sitelink generator all
 * share, and whose refusals `describeDestinationUrl` (`campaign.controller.ts`) reports by name.
 *
 * It existed as three hand-written copies before, and the third had drifted to a scheme check
 * alone — so these cases pin the set itself rather than any one tier's use of it.
 */
describe('isGoogleAdsServableUrl', () => {
  it.each([
    ['a plain https URL', 'https://events.example.org/register', true],
    ['a plain http URL, which four of five platforms accept', 'http://events.example.org/register', true],
    ['a URL with an ordinary & query', 'https://events.example.org/r?a=1&b=2', true],
    ['an empty string', '', false],
    ['a relative path', '/register', false],
    ['an unparseable value', 'not a url', false],
    ['a javascript: destination', 'javascript:alert(1)', false],
    ['a mailto: destination', 'mailto:hello@example.org', false],
    ['a URL with no hostname', 'https:///register', false],
    ['embedded credentials', 'https://user:pw@events.example.org/', false],
    ['an empty userinfo, which Go still refuses', 'https://@events.example.org/', false],
    ['no // after the scheme', 'https:events.example.org/register', false],
    ['a `;` separating query parameters', 'https://events.example.org/r?a=1;b=2', false],
    ['a stray `%` that is not an escape', 'https://events.example.org/r?q=100%', false],
    ['a backslash in the authority', 'https://events.example.org\\evil/', false],
  ])('judges %s', (_label, url, expected) => {
    expect(isGoogleAdsServableUrl(url)).toBe(expected);
  });

  /**
   * The contract the docblock states: the argument must ALREADY be trimmed, with
   * `googleAdsTrimSpace` rather than `String.prototype.trim`. The two disagree on U+0085 and
   * U+FEFF, and the trimmed value is the one the caller goes on to store — so trimming inside
   * would judge a string no caller keeps.
   */
  it('refuses an untrimmed value rather than trimming it', () => {
    const url = 'https://events.example.org/register';
    expect(isGoogleAdsServableUrl(` ${url} `)).toBe(false);
    expect(isGoogleAdsServableUrl(googleAdsTrimSpace(` ${url} `))).toBe(true);
    // U+0085 is whitespace to Go and not to `String.prototype.trim`, which is why callers must use
    // `googleAdsTrimSpace`: `.trim()` would leave it in and this would still refuse.
    expect(`\u0085${url}`.trim()).toBe(`\u0085${url}`);
    expect(isGoogleAdsServableUrl(googleAdsTrimSpace(`\u0085${url}`))).toBe(true);
  });
});

describe('GOOGLE_ASSET_PLAN_ANY_OF_SLOT_KEYS', () => {
  // #4833: the grid matches each rule's members against the form counts, which are keyed the way
  // `googlePlanSlotKeysFor` builds them. A member that drifts from the slot table would read as never
  // filled, and the "still need an image" count would quietly regress for that channel.
  const planSlotKeys = GOOGLE_CHANNELS_WITH_CREATIVE.flatMap((channel) =>
    Object.keys(GOOGLE_ASSET_PLAN_SLOT_CONTROLS[channel]).map((slot) => `google-ads/${GOOGLE_ADS_CHANNEL_TYPE_ENUMS[channel]}/${slot}`)
  );

  it.each(Object.entries(GOOGLE_ASSET_PLAN_ANY_OF_SLOT_KEYS))('every member of the %s rule is a mapped plan slot of that channel', (rule, members) => {
    expect(members.length).toBeGreaterThan(1);
    for (const member of members) {
      expect(member.startsWith(`${rule}/`)).toBe(true);
      expect(planSlotKeys).toContain(member);
    }
  });

  it('has a rule for Demand Gen and Display, and none for Performance Max', () => {
    expect(Object.keys(GOOGLE_ASSET_PLAN_ANY_OF_SLOT_KEYS).sort()).toEqual(['google-ads/DEMAND_GEN', 'google-ads/DISPLAY']);
  });
});
