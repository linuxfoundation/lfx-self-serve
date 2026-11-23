// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GOOGLE_BIDDING_DEFAULT_BY_CHANNEL, GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL, GOOGLE_BIDDING_STRATEGY_LABELS } from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
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
});
