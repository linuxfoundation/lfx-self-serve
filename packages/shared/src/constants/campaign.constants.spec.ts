// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_ALERT_THRESHOLDS,
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
