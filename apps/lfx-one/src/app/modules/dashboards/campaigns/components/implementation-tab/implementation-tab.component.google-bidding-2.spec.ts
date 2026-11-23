// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GOOGLE_ADS_BIDDING_BOUNDS, GOOGLE_ADS_MAX_CONVERSION_ACTIONS, GOOGLE_BIDDING_DEFAULT_BY_CHANNEL } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  configureGoogleTab,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

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
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
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
  ])('sends the same bidding plan as before on %s', STATE_ONLY, (_label, patch, expected) => {
    const c = seedChannel(fixture, patch);
    expect(c['googleBiddingPayload']()).toEqual(expected);
  });

  it('holds demand gen conversion actions on a switch to performance max, and sends them again on a switch back', STATE_ONLY, () => {
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

  it('accepts a bare id and a full resource name, deduplicating nothing client-side', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue('12345\n  customers/8666746580/conversionActions/999  \n\n');

    expect(c['googleBiddingError']()).toBeNull();
    expect(c['googleBiddingPayload']().conversionActions).toEqual(['12345', 'customers/8666746580/conversionActions/999']);
  });

  it('names a malformed conversion action', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue('12345\nnot-an-id');

    expect(c['googleBiddingError']()).toBe('"not-an-id" is not a conversion action id or resource name.');
    expect(c['canSubmit']()).toBe(false);
  });

  it('refuses more conversion actions than Google accepts', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue(Array.from({ length: GOOGLE_ADS_MAX_CONVERSION_ACTIONS + 1 }, (_, i) => `${i + 1}`).join('\n'));

    expect(c['googleBiddingError']()).toBe(`Google accepts at most ${GOOGLE_ADS_MAX_CONVERSION_ACTIONS} conversion actions.`);
  });

  it('accepts exactly the cap', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleConversionActions.setValue(Array.from({ length: GOOGLE_ADS_MAX_CONVERSION_ACTIONS }, (_, i) => `${i + 1}`).join('\n'));

    expect(c['googleBiddingError']()).toBeNull();
  });

  it.each([
    ['googleCpcBid', 'manual-cpc', 'Max CPC bid', GOOGLE_ADS_BIDDING_BOUNDS.cpcBid],
    ['googleTargetCpa', 'target-cpa', 'Target CPA', GOOGLE_ADS_BIDDING_BOUNDS.targetCpa],
    ['googleTargetRoas', 'target-roas', 'Target ROAS', GOOGLE_ADS_BIDDING_BOUNDS.targetRoas],
  ])('bounds %s at campaign-service’s own limits', STATE_ONLY, (control, strategy, label, bounds) => {
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
  it('treats a blank bid as unset but requires the target the strategy is named for', STATE_ONLY, () => {
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
  it('withholds a target abandoned under another strategy', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
    c['campaignForm'].controls.googleTargetCpa.setValue('25');
    expect(c['googleBiddingPayload']().targetCpa).toBe(25);

    c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-clicks');

    expect(c['googleBiddingPayload']().targetCpa).toBeUndefined();
    expect(c['googleBiddingError']()).toBeNull();
  });

  /** Zero is "absent", not a value — no bid Google accepts is zero, and the bounds start at 0.01. */
  it('treats a zero or unparseable amount as absent in the payload', STATE_ONLY, () => {
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
  it('blocks and unblocks the create button as the plan is corrected', STATE_ONLY, () => {
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
  it('does not gate a non-Google campaign', STATE_ONLY, () => {
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
  it('round-trips the plan through a draft, skipping missing and non-string keys', STATE_ONLY, () => {
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
  it('restores an unknown strategy as typed and resolves it away', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['restoreGoogleBidding']({ googleBiddingStrategy: 'retired-strategy' } as CampaignImplementationDraft);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.googleBiddingStrategy.value).toBe('retired-strategy');
    expect(c['googleBiddingStrategy']()).toBe(GOOGLE_BIDDING_DEFAULT_BY_CHANNEL.search);
    expect(c['googleBiddingPayload']().biddingStrategy).toBeUndefined();
  });
});
