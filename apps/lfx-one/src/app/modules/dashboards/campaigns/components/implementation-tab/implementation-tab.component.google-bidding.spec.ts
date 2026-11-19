// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GOOGLE_ADS_BIDDING_BOUNDS,
  GOOGLE_ADS_MAX_CONVERSION_ACTIONS,
  GOOGLE_BIDDING_DEFAULT_BY_CHANNEL,
  GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL,
  GOOGLE_BIDDING_STRATEGY_LABELS,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The bidding plan.
 *
 * Every per-channel set, bound and default here is campaign-service's own, read off
 * `internal/platform/googleads/bidding.go` and carried in the shared catalogue. The assertions
 * name the catalogue, so a set that moves upstream moves these expectations with it.
 */
describe('ImplementationTabComponent google bidding', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('offers no bidding plan until a Google channel is selected', () => {
    const c = seedChannel(fixture, {});

    expect(c['googleBiddingChannel']()).toBeNull();
    expect(c['googleBiddingOptions']()).toEqual([]);
    expect(c['googleBiddingStrategy']()).toBeNull();
    expect(c['googleBiddingDefaultLabel']()).toBe('');
    expect(c['googleBiddingPayload']()).toEqual({});
  });

  it.each([
    ['includeSearch', 'search'],
    ['includeDemandGen', 'demand-gen'],
    ['includePerformanceMax', 'performance-max'],
    ['includeDisplay', 'display'],
  ])('offers exactly the strategies %s accepts', (control, channel) => {
    const c = seedChannel(fixture, { [control]: true });
    const accepted = GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel as keyof typeof GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL];

    expect(c['googleBiddingChannel']()).toBe(channel);
    expect(c['googleBiddingOptions']().map((o: { value: string }) => o.value)).toEqual([...accepted]);
    expect(c['googleBiddingOptions']()[0].label).toBe(GOOGLE_BIDDING_STRATEGY_LABELS[accepted[0]]);
  });

  /**
   * Search wins the pair, mirroring `buildGoogleAdsConfig`, which emits `channel: 'search'` for
   * Search + Demand Gen and funds Demand Gen out of the split. Offering Demand Gen's single-entry
   * set here would hand the operator a plan the campaign they actually get cannot use.
   */
  it('writes the plan against search when search accompanies demand gen', () => {
    const c = seedChannel(fixture, { includeSearch: true, includeDemandGen: true });

    expect(c['googleBiddingChannel']()).toBe('search');
    expect(c['googleBiddingOptions']()).toHaveLength(GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL.search.length);
  });

  it.each([
    ['includeSearch', 'search'],
    ['includeDemandGen', 'demand-gen'],
    ['includePerformanceMax', 'performance-max'],
    ['includeDisplay', 'display'],
  ])('resolves an unpicked strategy to the %s channel default', (control, channel) => {
    const c = seedChannel(fixture, { [control]: true });
    const fallback = GOOGLE_BIDDING_DEFAULT_BY_CHANNEL[channel as keyof typeof GOOGLE_BIDDING_DEFAULT_BY_CHANNEL];

    expect(c['googleBiddingStrategy']()).toBe(fallback);
    expect(c['googleBiddingDefaultLabel']()).toBe(GOOGLE_BIDDING_STRATEGY_LABELS[fallback]);
    // Unpicked means ABSENT on the wire, which is how campaign-service's own default is reached.
    expect(c['googleBiddingPayload']().biddingStrategy).toBeUndefined();
  });

  /**
   * Display takes a target CPA again (#5737): campaign-service #593 (v1.0.36) sends it as the
   * standalone `targetCpa`, which Google accepts on Display, where #5554 had to withhold the folded
   * form v1.0.35 sent (#5536). The field, the Target CPA strategy and the value are all offered and sent.
   */
  describe('display target CPA (#5737)', () => {
    const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    it('offers every strategy in the display catalogue, target CPA included', () => {
      const c = seedChannel(fixture, { includeDisplay: true });
      const offered = c['googleBiddingOptions']().map((o: { value: string }) => o.value);

      expect(offered).toEqual([...GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL.display]);
      expect(offered).toContain('target-cpa');
    });

    // Every channel that bids to a conversion takes a target CPA under both strategies. One table
    // for all four, so a future per-channel exception (as #5554 was) fails here, not only Display.
    it.each([
      ['search', 'maximize-conversions', { includeSearch: true }],
      ['search', 'target-cpa', { includeSearch: true }],
      ['performance max', 'maximize-conversions', { includePerformanceMax: true }],
      ['performance max', 'target-cpa', { includePerformanceMax: true }],
      ['demand gen', 'maximize-conversions', { includeDemandGen: true }],
      ['demand gen', 'target-cpa', { includeDemandGen: true }],
      ['display', 'maximize-conversions', { includeDisplay: true }],
      ['display', 'target-cpa', { includeDisplay: true }],
    ])('shows the field and sends a target CPA on %s under %s', (_label, strategy, patch) => {
      const c = seedChannel(fixture, { ...patch, googleBiddingStrategy: strategy, googleTargetCpa: '25' });
      fixture.detectChanges();

      expect(c['googleTakesTargetCpa']()).toBe(true);
      expect(query('implementation-google-target-cpa')).not.toBeNull();
      expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: strategy, targetCpa: 25 });
      expect(c['googleBiddingOptions']().map((o: { value: string }) => o.value)).toContain('target-cpa');
      expect(query('implementation-google-target-cpa-withheld')).toBeNull();
    });

    it('keeps a target CPA pick and its value on a switch from search to display', () => {
      const c = seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'target-cpa', googleTargetCpa: '25' });

      c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true });
      fixture.detectChanges();

      expect(c['googleBiddingChannel']()).toBe('display');
      expect(c['googleBiddingStrategy']()).toBe('target-cpa');
      expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'target-cpa', targetCpa: 25 });
    });

    it('restores a target CPA draft on display as it was saved', () => {
      const c = seedChannel(fixture, { includeDisplay: true });
      c['restoreGoogleBidding']({ googleBiddingStrategy: 'target-cpa', googleTargetCpa: '25' } as CampaignImplementationDraft);
      // The restore writes without emitting; the full draft restore emits once at the end, as here.
      c['campaignForm'].updateValueAndValidity();

      expect(c['campaignForm'].controls.googleBiddingStrategy.value).toBe('target-cpa');
      expect(c['googleBiddingStrategy']()).toBe('target-cpa');
      expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'target-cpa', targetCpa: 25 });
    });
  });

  /**
   * Reachable by ordinary use, not by tampering: pick Target ROAS on Display, switch the campaign
   * to Demand Gen, and the control still holds a value Demand Gen refuses. Resolving it away is
   * what keeps the dependent fields — and the payload — honest about what will be sent.
   */
  it('resolves an out-of-set pick to the default and withholds it from the payload', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-roas');
    expect(c['googleBiddingStrategy']()).toBe('target-roas');

    c['campaignForm'].controls.includeDisplay.setValue(false);
    c['campaignForm'].controls.includeDemandGen.setValue(true);

    expect(c['googleBiddingChannel']()).toBe('demand-gen');
    expect(c['googleBiddingStrategy']()).toBe(GOOGLE_BIDDING_DEFAULT_BY_CHANNEL['demand-gen']);
    expect(c['googleBiddingPayload']().biddingStrategy).toBeUndefined();
  });

  it('sends a picked strategy the channel accepts', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
    c['campaignForm'].controls.googleTargetCpa.setValue('25');

    expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'target-cpa', targetCpa: 25 });
  });

  /**
   * Which dependent fields are in play is a question about the EFFECTIVE strategy, and upstream
   * REFUSES a target on a strategy that cannot carry it rather than dropping it.
   */
  it('shows the target CPA field only under a CPA strategy', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-clicks');
    expect(c['googleTakesTargetCpa']()).toBe(false);

    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
    expect(c['googleTakesTargetCpa']()).toBe(true);
    expect(c['googleTakesTargetRoas']()).toBe(false);
    expect(c['googleTakesCpcBid']()).toBe(false);
  });

  it('shows the target ROAS field only under a ROAS strategy', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversion-value');

    expect(c['googleTakesTargetRoas']()).toBe(true);
    expect(c['googleTakesTargetCpa']()).toBe(false);
  });

  /**
   * `demandGenBiddingStrategies` (campaign-service v1.0.31, #474): conversion bidding on Demand Gen,
   * with a target CPA sent in the same `targetCpa` field (campaign-service builds the standalone
   * strategy from it), and never a target ROAS — `validateBiddingPlan` refuses one there even under
   * Maximize Conversion Value, so the field is not offered and a value typed on Display is withheld.
   */
  it('offers demand gen conversion bidding and a target CPA, never a target ROAS', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversion-value');
    c['campaignForm'].controls.googleTargetRoas.setValue('4');
    expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'maximize-conversion-value', targetRoas: 4 });

    c['campaignForm'].patchValue({ includeDisplay: false, includeDemandGen: true });
    fixture.detectChanges();
    expect(c['googleBiddingOptions']().map((o: { value: string }) => o.value)).toEqual([
      'maximize-clicks',
      'maximize-conversions',
      'target-cpa',
      'maximize-conversion-value',
    ]);
    expect(c['googleTakesTargetRoas']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-target-roas"]')).toBeNull();
    expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'maximize-conversion-value' });

    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
    c['campaignForm'].controls.googleTargetCpa.setValue('25');
    expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'target-cpa', targetCpa: 25 });
  });

  /** The CPC bid is manual CPC's alone, and manual CPC is Search's alone. */
  it('shows the CPC bid only under manual CPC', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleBiddingStrategy']()).toBe('manual-cpc');
    expect(c['googleTakesCpcBid']()).toBe(true);

    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-clicks');
    expect(c['googleTakesCpcBid']()).toBe(false);
  });

  /**
   * A CHANNEL question, not a strategy one: campaign-service v1.0.31 applies the list as a
   * campaign-level custom conversion goal (`applyCampaignConversionGoal`) on every channel and under
   * any strategy. LFX One offers it everywhere but Performance Max, which it leaves on the account's
   * goals by choice (#5262).
   */
  it.each([
    ['includeSearch', true],
    ['includeDisplay', true],
    ['includeDemandGen', true],
    ['includePerformanceMax', false],
  ])('gates the conversion-action list on the channel (%s)', (control, allowed) => {
    const c = seedChannel(fixture, { [control]: true });

    expect(c['googleTakesConversionActions']()).toBe(allowed);
  });

  it('withholds a conversion list typed on a channel that refuses it', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.googleConversionActions.setValue('12345');
    expect(c['googleBiddingPayload']().conversionActions).toEqual(['12345']);

    c['campaignForm'].controls.includeDisplay.setValue(false);
    c['campaignForm'].controls.includePerformanceMax.setValue(true);

    expect(c['googleBiddingPayload']().conversionActions).toBeUndefined();
  });

  /**
   * Demand Gen takes the list under every strategy it offers (#5262): campaign-service bids toward
   * the goal under a conversion strategy and counts by it under Maximize Clicks
   * (`biddingOptimizesConversions`), refusing neither.
   */
  it.each([['maximize-clicks'], ['maximize-conversions'], ['target-cpa'], ['maximize-conversion-value']])(
    'sends demand gen conversion actions under %s',
    (strategy) => {
      const c = seedChannel(fixture, { includeDemandGen: true, googleBiddingStrategy: strategy, googleConversionActions: ' 111 \n\n222' });
      expect(c['googleBiddingPayload']().conversionActions).toEqual(['111', '222']);
      expect(c['googleConversionActionsWithheldMessage']()).toBe('');
    }
  );

  it('checks demand gen conversion actions as it checks every other channel', () => {
    const c = seedChannel(fixture, { includeDemandGen: true, googleConversionActions: '12345\nnot-an-id' });
    expect(c['googleBiddingError']()).toBe('"not-an-id" is not a conversion action id or resource name.');
  });

  /**
   * A blank box adds nothing, so a Demand Gen request without conversion actions is the request it
   * was before #5262; and the other channels send exactly what they did.
   */
  it.each([
    ['demand gen, blank, default strategy', { includeDemandGen: true }, {}],
    [
      'demand gen, blank, maximize conversions',
      { includeDemandGen: true, googleBiddingStrategy: 'maximize-conversions' },
      { biddingStrategy: 'maximize-conversions' },
    ],
    ['demand gen, whitespace only', { includeDemandGen: true, googleConversionActions: '  \n \n' }, {}],
    ['search', { includeSearch: true, googleConversionActions: '111' }, { conversionActions: ['111'] }],
    ['display', { includeDisplay: true, googleConversionActions: '111' }, { conversionActions: ['111'] }],
    ['performance max', { includePerformanceMax: true, googleConversionActions: '111' }, {}],
  ])('sends the same bidding plan as before on %s', (_label, patch, expected) => {
    const c = seedChannel(fixture, patch);
    expect(c['googleBiddingPayload']()).toEqual(expected);
  });

  it('holds demand gen conversion actions on a switch to performance max, and sends them again on a switch back', () => {
    const c = seedChannel(fixture, { includeDemandGen: true, googleConversionActions: '111' });
    expect(c['googleBiddingPayload']().conversionActions).toEqual(['111']);

    c['campaignForm'].patchValue({ includeDemandGen: false, includePerformanceMax: true });
    expect(c['googleBiddingPayload']().conversionActions).toBeUndefined();
    expect(c['googleConversionActionsWithheldMessage']()).toBe(
      "LFX One creates Performance Max campaigns on the Google Ads account's own conversion goals, so the 1 conversion action you entered will not be sent. Switch the channel back to keep it."
    );

    c['campaignForm'].patchValue({ includePerformanceMax: false, includeDemandGen: true });
    expect(c['googleBiddingPayload']().conversionActions).toEqual(['111']);
    expect(c['googleConversionActionsWithheldMessage']()).toBe('');
  });

  it('accepts a bare id and a full resource name, deduplicating nothing client-side', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue('12345\n  customers/8666746580/conversionActions/999  \n\n');

    expect(c['googleBiddingError']()).toBeNull();
    expect(c['googleBiddingPayload']().conversionActions).toEqual(['12345', 'customers/8666746580/conversionActions/999']);
  });

  it('names a malformed conversion action', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue('12345\nnot-an-id');

    expect(c['googleBiddingError']()).toBe('"not-an-id" is not a conversion action id or resource name.');
    expect(c['canSubmit']()).toBe(false);
  });

  it('refuses more conversion actions than Google accepts', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue(Array.from({ length: GOOGLE_ADS_MAX_CONVERSION_ACTIONS + 1 }, (_, i) => `${i + 1}`).join('\n'));

    expect(c['googleBiddingError']()).toBe(`Google accepts at most ${GOOGLE_ADS_MAX_CONVERSION_ACTIONS} conversion actions.`);
  });

  it('accepts exactly the cap', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue(Array.from({ length: GOOGLE_ADS_MAX_CONVERSION_ACTIONS }, (_, i) => `${i + 1}`).join('\n'));

    expect(c['googleBiddingError']()).toBeNull();
  });

  it.each([
    ['googleCpcBid', 'manual-cpc', 'Max CPC bid', GOOGLE_ADS_BIDDING_BOUNDS.cpcBid],
    ['googleTargetCpa', 'target-cpa', 'Target CPA', GOOGLE_ADS_BIDDING_BOUNDS.targetCpa],
    ['googleTargetRoas', 'target-roas', 'Target ROAS', GOOGLE_ADS_BIDDING_BOUNDS.targetRoas],
  ])('bounds %s at campaign-service’s own limits', (control, strategy, label, bounds) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue(strategy);

    c['campaignForm'].controls[control].setValue('abc');
    expect(c['googleBiddingError']()).toBe(`${label} must be a number.`);

    c['campaignForm'].controls[control].setValue(`${bounds.min / 2}`);
    expect(c['googleBiddingError']()).toBe(`${label} must be between ${bounds.min} and ${bounds.max}.`);

    c['campaignForm'].controls[control].setValue(`${bounds.max + 1}`);
    expect(c['googleBiddingError']()).toBe(`${label} must be between ${bounds.min} and ${bounds.max}.`);

    c['campaignForm'].controls[control].setValue(`${bounds.max}`);
    expect(c['googleBiddingError']()).toBeNull();
  });

  /**
   * Blank is the normal way to leave a bid unset, and the two strategies that genuinely REQUIRE
   * their target say so themselves rather than through the bounds check. Both halves matter: the
   * blank-is-fine case is what keeps the optional targets optional.
   */
  it('treats a blank bid as unset but requires the target the strategy is named for', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversions');
    expect(c['googleBiddingError']()).toBeNull();
    expect(c['googleBiddingPayload']().targetCpa).toBeUndefined();

    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
    expect(c['googleBiddingError']()).toBe('Target CPA strategy needs a target CPA.');

    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-roas');
    expect(c['googleBiddingError']()).toBe('Target ROAS strategy needs a target ROAS.');

    c['campaignForm'].controls.googleTargetRoas.setValue('4');
    expect(c['googleBiddingError']()).toBeNull();
  });

  /**
   * A value typed under one strategy and abandoned under another is WITHHELD, not forwarded into
   * an upstream refusal — the same gate the template renders on.
   */
  it('withholds a target abandoned under another strategy', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
    c['campaignForm'].controls.googleTargetCpa.setValue('25');
    expect(c['googleBiddingPayload']().targetCpa).toBe(25);

    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-clicks');

    expect(c['googleBiddingPayload']().targetCpa).toBeUndefined();
    expect(c['googleBiddingError']()).toBeNull();
  });

  /** Zero is "absent", not a value — no bid Google accepts is zero, and the bounds start at 0.01. */
  it('treats a zero or unparseable amount as absent in the payload', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('manual-cpc');

    c['campaignForm'].controls.googleCpcBid.setValue('0');
    expect(c['googleBiddingPayload']().cpcBid).toBeUndefined();

    c['campaignForm'].controls.googleCpcBid.setValue('   ');
    expect(c['googleBiddingPayload']().cpcBid).toBeUndefined();
  });

  /**
   * The error gates the Create button, and it is a `computed` reading `campaignFormRevision` rather
   * than control validators — Angular never revalidates a SIBLING control, so a bounds validator
   * sitting on a now-hidden control would silently make the whole form invalid for a campaign with
   * nothing wrong with it. Warming the memo before the edit is what proves the bridge.
   */
  it('blocks and unblocks the create button as the plan is corrected', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    expect(c['canSubmit']()).toBe(true);

    c['campaignForm'].controls.googleCpcBid.setValue('abc');
    expect(c['canSubmit']()).toBe(false);

    c['campaignForm'].controls.googleCpcBid.setValue('1.25');
    expect(c['canSubmit']()).toBe(true);
    expect(c['googleBiddingPayload']().cpcBid).toBe(1.25);
  });

  /**
   * The plan is Google's alone — a LinkedIn-only campaign must not be gated by it.
   *
   * The same unusable `googleCpcBid` is left on the form across the platform switch deliberately:
   * the controls stay on the form whatever the brief selects, so a gate keyed on the control
   * rather than on `showGoogleSection` would block a campaign that sends no Google config at all.
   */
  it('does not gate a non-Google campaign', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleCpcBid.setValue('abc');
    expect(c['googleBiddingError']()).not.toBeNull();

    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['linkedin-ads'],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    expect(c['showGoogleSection']()).toBe(false);
    expect(c['googleBiddingError']()).toBeNull();
  });

  /**
   * The draft carries the plan as TYPED, not as resolved: only strings, only keys the draft has.
   * A draft saved before this section shipped carries none of them and must leave the form alone,
   * and a hand-edited non-string must not reach a non-nullable control every reader assumes is one.
   */
  it('round-trips the plan through a draft, skipping missing and non-string keys', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    c['campaignForm'].patchValue({ googleBiddingStrategy: 'target-cpa', googleTargetCpa: '25', googleConversionActions: '12345' });

    // The plan reaches the parent's draft as TYPED — the resolution happens at payload time.
    expect(emitted?.googleBiddingStrategy).toBe('target-cpa');
    expect(emitted?.googleTargetCpa).toBe('25');
    expect(emitted?.googleConversionActions).toBe('12345');

    c['campaignForm'].patchValue({ googleBiddingStrategy: '', googleTargetCpa: '', googleConversionActions: '' });
    c['restoreGoogleBidding']({
      googleBiddingStrategy: 'target-cpa',
      googleTargetCpa: 25 as unknown as string,
      googleConversionActions: '12345',
    } as CampaignImplementationDraft);

    expect(c['campaignForm'].controls.googleBiddingStrategy.value).toBe('target-cpa');
    expect(c['campaignForm'].controls.googleTargetCpa.value).toBe('');
    expect(c['campaignForm'].controls.googleConversionActions.value).toBe('12345');

    c['restoreGoogleBidding']({} as CampaignImplementationDraft);
    expect(c['campaignForm'].controls.googleBiddingStrategy.value).toBe('target-cpa');
  });

  /**
   * An unknown strategy name is restored AS TYPED rather than blanked — `googleBiddingStrategy`
   * resolves it away, so the operator sees what they left instead of a silently emptied picker.
   */
  it('restores an unknown strategy as typed and resolves it away', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['restoreGoogleBidding']({ googleBiddingStrategy: 'retired-strategy' } as CampaignImplementationDraft);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.googleBiddingStrategy.value).toBe('retired-strategy');
    expect(c['googleBiddingStrategy']()).toBe(GOOGLE_BIDDING_DEFAULT_BY_CHANNEL.search);
    expect(c['googleBiddingPayload']().biddingStrategy).toBeUndefined();
  });
});
