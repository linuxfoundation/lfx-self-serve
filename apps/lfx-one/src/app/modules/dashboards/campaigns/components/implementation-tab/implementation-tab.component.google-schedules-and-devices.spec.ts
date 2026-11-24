// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignAdSchedule, CampaignDeviceBidModifier, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  configureGoogleTab,
  restoreGoogleDraft,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Ad schedules and device bid adjustments (#4991). The panel's edits land in two tab signals; these
 * pin what the create request carries for each channel, that Create waits on the shared refusals the
 * BFF answers with, and that a list hidden by a channel switch is held and said to be held.
 */
describe('ImplementationTabComponent google ad schedules and devices', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const MONDAY_EVENINGS: CampaignAdSchedule = { dayOfWeek: 'MONDAY', startHour: 18, startMinute: 0, endHour: 24, endMinute: 0, bidModifier: 0.8 };
  const NO_TABLETS: CampaignDeviceBidModifier = { device: 'TABLET', bidModifier: 0 };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedTargeting(patch: Record<string, unknown>): Record<string, any> {
    const c = seedChannel(fixture, patch);
    c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS]);
    c['onGoogleDeviceBidModifiersChange']([NO_TABLETS]);
    fixture.detectChanges();
    return c;
  }

  // Display and Performance Max default to Maximize Conversions, under which the window's -20% is
  // refused (Google would not bid it), so their payload is built but Create waits on it. Demand Gen
  // refuses it on the channel (`validateCriteriaPlan`), whatever the strategy. Every channel takes the
  // tablet exclusion, Performance Max since campaign-service v1.0.33 (linuxfoundation/lfx-v2-campaign-service#500).
  it.each([
    ['search', { includeSearch: true }, { adSchedules: [MONDAY_EVENINGS], deviceBidModifiers: [NO_TABLETS] }, false],
    ['display', { includeDisplay: true }, { adSchedules: [MONDAY_EVENINGS], deviceBidModifiers: [NO_TABLETS] }, true],
    ['performance-max', { includePerformanceMax: true }, { adSchedules: [MONDAY_EVENINGS], deviceBidModifiers: [NO_TABLETS] }, true],
    ['demand-gen', { includeDemandGen: true }, { adSchedules: [MONDAY_EVENINGS], deviceBidModifiers: [NO_TABLETS] }, true],
  ])(
    'builds the payload %s accepts, holds the rest, and holds Create on an adjustment its default strategy ignores',
    STATE_ONLY,
    (_channel, patch, expected, heldByStrategy) => {
      const c = seedTargeting(patch);

      expect(c['googleTargetingPayload']()).toEqual(expected);
      expect(c['googleAdSchedules']()).toEqual([MONDAY_EVENINGS]);
      expect(c['googleDeviceBidModifiers']()).toEqual([NO_TABLETS]);
      if (heldByStrategy) {
        expect(c['googleAdSchedulesError']()).toContain('ad schedule 1 has a bid modifier of 0.8');
        expect(c['canSubmit']()).toBe(false);
      } else {
        expect(c['googleAdSchedulesError']()).toBeNull();
      }
    }
  );

  it('submits both lists on Search, copied rather than shared', STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedTargeting({ includeSearch: true });
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['adSchedules']).toEqual([MONDAY_EVENINGS]);
    expect(request['deviceBidModifiers']).toEqual([NO_TABLETS]);
    expect((request['adSchedules'] as CampaignAdSchedule[])[0]).not.toBe(c['googleAdSchedules']()[0]);
  });

  it('sends neither key when nothing was set', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleTargetingPayload']()).toEqual({});
  });

  it('renders the panel on Demand Gen, with TV screens and no Adjust bid, and holds nothing', async () => {
    seedTargeting({ includeDemandGen: true });
    const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

    expect(query('implementation-google-ad-schedule')).not.toBeNull();
    expect(query('implementation-google-device-CONNECTED_TV')?.textContent).toContain('TV screens');
    expect(query('implementation-google-devices-hint')?.textContent).toContain('Demand Gen campaigns take a device only as an exclusion');
    expect(query('implementation-google-ad-schedule-hint')?.textContent).toContain('Demand Gen campaigns take an ad schedule only without a bid adjustment');
    expect(query('implementation-google-targeting-withheld')).toBeNull();
  });

  /**
   * `validateCriteriaPlan`'s Demand Gen arm (campaign-service v1.0.31): a window only without a bid
   * modifier, and a device only as an exclusion, under every strategy — Maximize Clicks included,
   * which takes a schedule adjustment on Search and Display. Both are held with a reason, in the live
   * region too, and Create waits.
   */
  describe('on demand gen', () => {
    const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

    it('holds a window adjustment set on Search, says why, and lets Create go once it is cleared', () => {
      const c = seedChannel(fixture, { includeDemandGen: true });
      c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-clicks');
      c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS]);
      fixture.detectChanges();

      expect(c['googleAdSchedulesError']()).toContain('Demand Gen campaigns take an ad schedule only without a bid adjustment');
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-google-schedule-adjustments-held')?.textContent).toContain(
        "Demand Gen campaigns take an ad schedule only without a bid adjustment, so LFX One doesn't send one. The bid adjustment on 1 ad schedule window is kept for a switch back, and Create Campaign waits until you clear it."
      );
      expect(query('implementation-google-schedule-adjustments-held-live')?.textContent).toContain('kept for a switch back');

      const unadjusted: CampaignAdSchedule = { ...MONDAY_EVENINGS };
      delete unadjusted.bidModifier;
      c['onGoogleAdSchedulesChange']([unadjusted]);
      fixture.detectChanges();
      expect(c['googleAdSchedulesError']()).toBeNull();
      expect(c['googleTargetingPayload']()).toEqual({ adSchedules: [unadjusted] });
    });

    it('holds a device adjustment set under Manual CPC on Search, says why, and sends exclusions', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['onGoogleDeviceBidModifiersChange']([{ device: 'MOBILE', bidModifier: 1.25 }]);
      c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
      fixture.detectChanges();

      expect(c['googleDeviceBidModifiersError']()).toContain('Demand Gen campaigns take a device only as an exclusion');
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-google-device-adjustments-held')?.textContent).toContain(
        "Demand Gen campaigns take a device only as an exclusion, so LFX One doesn't send a device bid adjustment there. The adjustment on Mobile phones is kept for a switch back, and Create Campaign waits until you set it to Default bid or Exclude."
      );

      c['onGoogleDeviceBidModifiersChange']([NO_TABLETS, { device: 'CONNECTED_TV', bidModifier: 0 }]);
      fixture.detectChanges();
      expect(c['googleDeviceBidModifiersError']()).toBeNull();
      expect(c['googleDeviceAdjustmentsHeldMessage']()).toBe('');
      expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: [NO_TABLETS, { device: 'CONNECTED_TV', bidModifier: 0 }] });
    });

    it('holds a TV screens exclusion after a switch to Search, says so, and sends the rest', () => {
      const c = seedChannel(fixture, { includeDemandGen: true });
      c['onGoogleDeviceBidModifiersChange']([NO_TABLETS, { device: 'CONNECTED_TV', bidModifier: 0 }]);
      c['campaignForm'].patchValue({ includeDemandGen: false, includeSearch: true });
      fixture.detectChanges();

      expect(query('implementation-google-device-CONNECTED_TV')).toBeNull();
      expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: [NO_TABLETS] });
      expect(c['googleDeviceBidModifiersError']()).toBeNull();
      expect(query('implementation-google-targeting-withheld')?.textContent).toContain(
        'Search campaigns do not take TV screens, so the 1 device setting you set will not be sent.'
      );

      c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
      fixture.detectChanges();
      expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: [NO_TABLETS, { device: 'CONNECTED_TV', bidModifier: 0 }] });
    });

    it('round-trips a TV screens exclusion through a draft', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includeDemandGen: true });
      let emitted: CampaignImplementationDraft | undefined;
      fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
      c['onGoogleDeviceBidModifiersChange']([{ device: 'CONNECTED_TV', bidModifier: 0 }]);
      expect(emitted?.googleDeviceBidModifiers).toEqual([{ device: 'CONNECTED_TV', bidModifier: 0 }]);

      c['googleDeviceBidModifiers'].set([]);
      restoreGoogleDraft(fixture, c, { googleDeviceBidModifiers: [{ device: 'CONNECTED_TV', bidModifier: 0 }] });
      expect(c['googleDeviceBidModifiers']()).toEqual([{ device: 'CONNECTED_TV', bidModifier: 0 }]);
    });
  });

  it('holds Create on the shared refusal and shows it under the panel', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS, { ...MONDAY_EVENINGS, startHour: 20, bidModifier: undefined }]);
    fixture.detectChanges();

    expect(c['googleAdSchedulesError']()).toContain('overlaps MONDAY 18:00-24:00');
    expect(c['canSubmit']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-ad-schedule-error"]')?.textContent).toContain('overlaps');

    c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS]);
    c['onGoogleDeviceBidModifiersChange']([{ device: 'MOBILE', bidModifier: 0.05 }]);
    expect(c['googleDeviceBidModifiersError']()).toContain('bid modifier of 0.05');
    expect(c['canSubmit']()).toBe(false);
  });

  // #5094 review: an unresolved strategy skips only the strategy pass. The per-entry checks still run,
  // so an overlapping window holds Create rather than reaching the BFF's 400.
  describe('with no resolved strategy', () => {
    it('still refuses an overlapping window', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includeSearch: true });
      Object.defineProperty(c, 'googleBiddingStrategy', { value: signal(null) });
      c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS, { ...MONDAY_EVENINGS, startHour: 20, bidModifier: undefined }]);

      expect(c['googleAdSchedulesError']()).toContain('overlaps MONDAY 18:00-24:00');
      expect(c['canSubmit']()).toBe(false);
    });
  });

  /**
   * campaign-service refuses any non-zero device modifier unless the EFFECTIVE strategy is manual-cpc
   * (`validateBiddingPlan`). The tab judges with the same shared refusal, under the strategy it sends.
   */
  describe('device adjustments and the bidding strategy', () => {
    const MOBILE_UP: CampaignDeviceBidModifier = { device: 'MOBILE', bidModifier: 1.25 };
    const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

    it.each([
      ['search', { includeSearch: true }, 'manual-cpc', true],
      ['search', { includeSearch: true }, 'maximize-clicks', false],
      ['search', { includeSearch: true }, 'maximize-conversions', false],
      ['display', { includeDisplay: true }, '', false],
      ['display', { includeDisplay: true }, 'maximize-clicks', false],
    ])('on %s (%o) under strategy "%s", offers Adjust bid only for Manual CPC', STATE_ONLY, (_channel, patch, strategy, adjustable) => {
      const c = seedChannel(fixture, patch);
      c['campaignForm'].controls.googleBiddingStrategy.setValue(strategy);
      c['onGoogleDeviceBidModifiersChange']([MOBILE_UP]);
      fixture.detectChanges();

      if (adjustable) {
        expect(c['googleDeviceAdjustBlockedReason']()).toBeNull();
        expect(c['googleDeviceBidModifiersError']()).toBeNull();
        expect(c['googleDeviceAdjustmentsHeldMessage']()).toBe('');
        expect(c['canSubmit']()).toBe(true);
      } else {
        expect(c['googleDeviceAdjustBlockedReason']()).toMatch(
          /LFX One sends a device bid adjustment only under Manual CPC|Google Ads doesn't apply a device bid adjustment under/
        );
        expect(c['googleDeviceBidModifiersError']()).toContain('gives MOBILE a bid modifier of 1.25');
        expect(c['googleDeviceAdjustmentsHeldMessage']()).toContain('The adjustment on Mobile phones is kept for a switch back');
        expect(c['canSubmit']()).toBe(false);
        // Held, not dropped: the list still carries it for a switch back.
        expect(c['googleDeviceBidModifiers']()).toEqual([MOBILE_UP]);
      }
    });

    it('says how to get Manual CPC back on Search, and that Display has none', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-clicks');
      fixture.detectChanges();
      expect(c['googleDeviceAdjustBlockedReason']()).toBe(
        "LFX One sends a device bid adjustment only under Manual CPC, so it doesn't send one under Maximize Clicks. You can keep the default bid or exclude a device. Choose Manual CPC as the bidding strategy to adjust bids by device."
      );

      c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true, googleBiddingStrategy: '' });
      fixture.detectChanges();
      expect(c['googleDeviceAdjustBlockedReason']()).toBe(
        "Google Ads doesn't apply a device bid adjustment under Maximize Conversions, except a -100% exclusion, so LFX One doesn't send one. You can keep the default bid or exclude a device. Display campaigns cannot bid Manual CPC here."
      );
      expect(query('implementation-google-devices-hint')?.textContent).toContain('Display campaigns cannot bid Manual CPC here.');
    });

    it('holds an adjustment across a switch from Manual CPC to automated and back, blocking Create only while automated', () => {
      const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      const c = seedChannel(fixture, { includeSearch: true });
      c['onGoogleDeviceBidModifiersChange']([MOBILE_UP, NO_TABLETS]);
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(true);
      expect(query('implementation-google-device-adjustments-held')).toBeNull();

      c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversions');
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(false);
      expect(c['googleDeviceBidModifiers']()).toEqual([MOBILE_UP, NO_TABLETS]);
      const held =
        "Google Ads doesn't apply a device bid adjustment under Maximize Conversions, except a -100% exclusion, so LFX One doesn't send one. The adjustment on Mobile phones is kept for a switch back, and Create Campaign waits until you set it to Default bid or Exclude, or choose Manual CPC again.";
      expect(query('implementation-google-device-adjustments-held')?.textContent?.trim()).toBe(held);
      expect(query('implementation-google-device-adjustments-held-live')?.textContent?.trim()).toBe(held);
      expect(query('implementation-google-devices-error')?.textContent).toContain('gives MOBILE a bid modifier of 1.25');
      c['submit']();
      expect(createCampaign).not.toHaveBeenCalled();

      c['campaignForm'].controls.googleBiddingStrategy.setValue('manual-cpc');
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(true);
      expect(query('implementation-google-device-adjustments-held')).toBeNull();
      expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: [MOBILE_UP, NO_TABLETS] });
    });

    it('names every held device in one list, and on Display leaves Manual CPC out of the way back', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['onGoogleDeviceBidModifiersChange']([MOBILE_UP, { device: 'DESKTOP', bidModifier: 0.8 }, { device: 'TABLET', bidModifier: 1 }]);
      c['campaignForm'].controls.googleBiddingStrategy.setValue('target-cpa');
      fixture.detectChanges();
      expect(c['googleDeviceAdjustmentsHeldMessage']()).toContain(
        'The adjustments on Mobile phones, Computers and Tablets are kept for a switch back, and Create Campaign waits until you set them to Default bid or Exclude, or choose Manual CPC again.'
      );

      c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true, googleBiddingStrategy: '' });
      fixture.detectChanges();
      expect(c['googleDeviceAdjustmentsHeldMessage']()).toMatch(/until you set them to Default bid or Exclude\.$/);
      expect(c['googleDeviceBidModifiersError']()).not.toContain('bid with Manual CPC');
    });

    it('gives the channel as the Adjust bid reason on Performance Max, whatever the strategy', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includePerformanceMax: true });
      fixture.detectChanges();
      expect(c['googleBiddingStrategy']()).toBe('maximize-conversions');
      expect(c['googleDeviceAdjustBlockedReason']()).toBe(
        "Performance Max campaigns take a device only as an exclusion, so LFX One doesn't send a device bid adjustment there. You can keep the default bid or exclude a device."
      );
    });

    it('still sends an Exclude under an automated strategy, on Search and on Display', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['campaignForm'].controls.googleBiddingStrategy.setValue('target-roas');
      c['onGoogleDeviceBidModifiersChange']([NO_TABLETS]);
      fixture.detectChanges();
      expect(c['googleDeviceBidModifiersError']()).toBeNull();
      expect(c['googleDeviceAdjustmentsHeldMessage']()).toBe('');
      expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: [NO_TABLETS] });

      c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true, googleBiddingStrategy: '' });
      fixture.detectChanges();
      expect(c['googleDeviceBidModifiersError']()).toBeNull();
      expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: [NO_TABLETS] });
    });
  });

  it('withholds the panel and both keys off the campaign-service road', () => {
    const c = seedTargeting({ includeSearch: true });
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleTargetingPayload']()).toEqual({});
    expect(c['googleTargetingWithheldMessage']()).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-targeting-panel"]')).toBeNull();
  });

  it('round-trips both lists through a draft and empties them for a new brief', STATE_ONLY, () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedTargeting({ includeSearch: true });

    expect(emitted?.googleAdSchedules).toEqual([MONDAY_EVENINGS]);
    expect(emitted?.googleDeviceBidModifiers).toEqual([NO_TABLETS]);

    c['resetGoogleFields']();
    expect(c['googleAdSchedules']()).toEqual([]);
    restoreGoogleDraft(fixture, c, { googleAdSchedules: [MONDAY_EVENINGS], googleDeviceBidModifiers: [NO_TABLETS] });

    expect(c['googleAdSchedules']()).toEqual([MONDAY_EVENINGS]);
    expect(c['googleDeviceBidModifiers']()).toEqual([NO_TABLETS]);
  });

  /**
   * Google takes 0.1-10.0 on an ad schedule (0 is only a device exclusion) and applies a schedule
   * adjustment only under Manual CPC and Maximize Clicks, ignoring it under Smart Bidding. Neither is
   * refused upstream, so the shared judge refuses both, and the tab judges with it under the EFFECTIVE
   * strategy (#5088 review). The windows themselves are sent under every strategy.
   */
  describe('ad schedule adjustments and the bidding strategy', () => {
    const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
    const UNADJUSTED: CampaignAdSchedule = { dayOfWeek: 'MONDAY', startHour: 18, startMinute: 0, endHour: 24, endMinute: 0 };
    const SENTENCE = 'Google Ads applies an ad schedule bid adjustment only under Manual CPC or Maximize Clicks.';

    it.each([
      ['search', { includeSearch: true }, 'manual-cpc', true],
      ['search', { includeSearch: true }, 'maximize-conversions', false],
      ['display', { includeDisplay: true }, '', false],
      ['display', { includeDisplay: true }, 'maximize-clicks', true],
      ['performance-max', { includePerformanceMax: true }, '', false],
    ])('on %s (%o) under strategy "%s", offers a schedule adjustment only where Google applies it', (_channel, patch, strategy, adjustable) => {
      const c = seedChannel(fixture, patch);
      c['campaignForm'].controls.googleBiddingStrategy.setValue(strategy);
      c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS]);
      fixture.detectChanges();

      if (adjustable) {
        expect(c['googleScheduleAdjustBlockedReason']()).toBeNull();
        expect(c['googleAdSchedulesError']()).toBeNull();
        expect(c['googleScheduleAdjustmentsHeldMessage']()).toBe('');
        expect(query('implementation-google-ad-schedule-adjustment-0')?.readOnly).toBe(false);
      } else {
        expect(c['googleScheduleAdjustBlockedReason']()).toContain(SENTENCE);
        expect(c['googleAdSchedulesError']()).toContain('The Google Ads ad schedule 1 has a bid modifier of 0.8.');
        expect(c['googleScheduleAdjustmentsHeldMessage']()).toContain('The bid adjustment on 1 ad schedule window is kept for a switch back');
        expect(c['canSubmit']()).toBe(false);
        // Held, not dropped: the list still carries it for a switch back.
        expect(c['googleAdSchedules']()).toEqual([MONDAY_EVENINGS]);
        expect(query('implementation-google-ad-schedule-adjustment-0')?.readOnly).toBe(true);
      }
    });

    it('says which strategies give the adjustment back on each channel', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversions');
      fixture.detectChanges();
      expect(c['googleScheduleAdjustBlockedReason']()).toBe(
        `${SENTENCE} Under Maximize Conversions it would ignore it, so LFX One doesn't send one. The windows still decide when the campaign serves. Choose Manual CPC or Maximize Clicks as the bidding strategy to adjust bids by time.`
      );
      expect(query('implementation-google-ad-schedule-hint')?.textContent).toContain('Choose Manual CPC or Maximize Clicks as the bidding strategy');

      c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true, googleBiddingStrategy: '' });
      fixture.detectChanges();
      expect(c['googleScheduleAdjustBlockedReason']()).toMatch(/Choose Maximize Clicks as the bidding strategy to adjust bids by time\.$/);

      c['campaignForm'].patchValue({ includeDisplay: false, includePerformanceMax: true, googleBiddingStrategy: '' });
      fixture.detectChanges();
      expect(c['googleScheduleAdjustBlockedReason']()).toMatch(/Performance Max campaigns cannot bid Manual CPC or Maximize Clicks here\.$/);
    });

    it('holds an adjustment across a switch to Smart Bidding, blocking Create until it is cleared, and sends the window', async () => {
      const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      const c = seedChannel(fixture, { includeSearch: true });
      c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS, { ...UNADJUSTED, dayOfWeek: 'TUESDAY' }]);
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(true);
      expect(query('implementation-google-schedule-adjustments-held')).toBeNull();

      c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversions');
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(false);
      expect(c['googleAdSchedules']()).toEqual([MONDAY_EVENINGS, { ...UNADJUSTED, dayOfWeek: 'TUESDAY' }]);
      const held = `${SENTENCE} Under Maximize Conversions it would ignore it, so LFX One doesn't send one. The bid adjustment on 1 ad schedule window is kept for a switch back, and Create Campaign waits until you clear it, or choose Manual CPC or Maximize Clicks.`;
      expect(query('implementation-google-schedule-adjustments-held')?.textContent?.trim()).toBe(held);
      expect(query('implementation-google-schedule-adjustments-held-live')?.textContent?.trim()).toBe(held);
      expect(query('implementation-google-ad-schedule-error')?.textContent).toContain('ad schedule 1 has a bid modifier of 0.8');
      c['submit']();
      expect(createCampaign).not.toHaveBeenCalled();

      // Clearing it in the panel lets Create through under the same strategy, window kept.
      (query('implementation-google-ad-schedule-clear-0')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(c['googleAdSchedules']()).toEqual([UNADJUSTED, { ...UNADJUSTED, dayOfWeek: 'TUESDAY' }]);
      expect(c['googleAdSchedulesError']()).toBeNull();
      expect(query('implementation-google-schedule-adjustments-held')).toBeNull();
      expect(c['googleTargetingPayload']()).toEqual({ adSchedules: [UNADJUSTED, { ...UNADJUSTED, dayOfWeek: 'TUESDAY' }] });
    });

    it('lets a held adjustment through again on a switch back to Manual CPC', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['onGoogleAdSchedulesChange']([MONDAY_EVENINGS, { ...MONDAY_EVENINGS, dayOfWeek: 'TUESDAY' }]);
      c['campaignForm'].controls.googleBiddingStrategy.setValue('target-roas');
      fixture.detectChanges();
      expect(c['googleScheduleAdjustmentsHeldMessage']()).toContain(
        'The bid adjustments on 2 ad schedule windows are kept for a switch back, and Create Campaign waits until you clear them, or choose Manual CPC or Maximize Clicks.'
      );

      c['campaignForm'].controls.googleBiddingStrategy.setValue('manual-cpc');
      fixture.detectChanges();
      expect(c['googleScheduleAdjustmentsHeldMessage']()).toBe('');
      expect(c['googleAdSchedulesError']()).toBeNull();
      expect(c['canSubmit']()).toBe(true);
      expect(c['googleTargetingPayload']()).toEqual({ adSchedules: [MONDAY_EVENINGS, { ...MONDAY_EVENINGS, dayOfWeek: 'TUESDAY' }] });
    });

    it('restores a Display draft whose window is adjusted as held, since Display defaults to Maximize Conversions', () => {
      const c = seedChannel(fixture, { includeDisplay: true });
      restoreGoogleDraft(fixture, c, { includeDisplay: true, googleAdSchedules: [MONDAY_EVENINGS] });

      expect(c['googleAdSchedules']()).toEqual([MONDAY_EVENINGS]);
      expect(c['googleScheduleAdjustmentsHeldMessage']()).toContain('The bid adjustment on 1 ad schedule window is kept for a switch back');
      expect(c['googleScheduleAdjustmentsHeldMessage']()).toMatch(/clear it, or choose Maximize Clicks\.$/);
      expect(query('implementation-google-ad-schedule-adjustment-0')?.readOnly).toBe(true);
      expect(c['canSubmit']()).toBe(false);
    });

    it('sends unadjusted windows under Smart Bidding with no notice', STATE_ONLY, () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['campaignForm'].controls.googleBiddingStrategy.setValue('maximize-conversions');
      c['onGoogleAdSchedulesChange']([UNADJUSTED]);
      fixture.detectChanges();
      expect(c['googleAdSchedulesError']()).toBeNull();
      expect(c['googleScheduleAdjustmentsHeldMessage']()).toBe('');
      expect(c['googleTargetingPayload']()).toEqual({ adSchedules: [UNADJUSTED] });
    });

    it('refuses a typed -100% under Manual CPC, since 0 is only a device exclusion', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['onGoogleAdSchedulesChange']([UNADJUSTED]);
      fixture.detectChanges();
      const box = query('implementation-google-ad-schedule-adjustment-0') as HTMLInputElement;
      box.value = '-100';
      box.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(c['googleAdSchedules']()[0].bidModifier).toBe(0);
      expect(c['googleAdSchedulesError']()).toContain('A bid modifier of 0 excludes a device, not an ad schedule');
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-google-ad-schedule-error')?.textContent).toContain('remove this window and keep at least one other');
    });
  });
});

/**
 * Device exclusions on Performance Max (#5262). campaign-service v1.0.33's `validateCriteriaPlan`
 * takes a device there only as an exclusion (linuxfoundation/lfx-v2-campaign-service#500), TV screens included, and refuses a list that
 * excludes all four devices. The tab offers the same four rows, holds an adjustment, and waits on
 * the shared refusal the BFF answers with.
 */
describe('ImplementationTabComponent google device exclusions on performance max', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const PMAX_COMPLETE = {
    headlines: 'One headline\nTwo headline\nThree headline',
    longHeadlines: 'A long headline',
    descriptions: 'A short description\nAnother short description',
    businessName: 'Acme',
    marketingImages: 'https://example.com/a.png',
    squareMarketingImages: 'https://example.com/square.png',
    logoImages: 'https://example.com/logo.png',
  };
  const excluded = (...devices: string[]): CampaignDeviceBidModifier[] => devices.map((device) => ({ device, bidModifier: 0 }) as CampaignDeviceBidModifier);
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const pmax = (): Record<string, any> => {
    const c = seedChannel(fixture, { includePerformanceMax: true });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.detectChanges();
    return c;
  };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows the device control on Performance Max with a row per device, TV screens included, and no Adjust bid', () => {
    const c = pmax();

    expect(c['googleDeviceBidModifiersAvailable']()).toBe(true);
    for (const device of ['MOBILE', 'DESKTOP', 'TABLET', 'CONNECTED_TV']) {
      expect(find(`implementation-google-device-${device}`)).not.toBeNull();
    }
    expect(find('implementation-google-devices-hint')?.textContent).toContain('Performance Max campaigns take a device only as an exclusion');
  });

  it('sends three exclusions, TV screens among them, and a request without them is byte-identical to one built before', STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = pmax();
    c['submit']();
    await fixture.whenStable();
    const before = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(JSON.stringify(before)).not.toContain('deviceBidModifiers');

    c['onGoogleDeviceBidModifiersChange'](excluded('MOBILE', 'TABLET', 'CONNECTED_TV'));
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);
    c['submit']();
    await fixture.whenStable();
    const after = createCampaign.mock.calls[1][0] as unknown as Record<string, unknown>;
    expect(after['deviceBidModifiers']).toEqual(excluded('MOBILE', 'TABLET', 'CONNECTED_TV'));
    const rest = { ...after };
    delete rest['deviceBidModifiers'];
    expect(JSON.stringify(rest)).toBe(JSON.stringify(before));
  });

  it('holds Create with a visible, announced reason when every device is excluded', () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = pmax();
    c['onGoogleDeviceBidModifiersChange'](excluded('MOBILE', 'DESKTOP', 'TABLET', 'CONNECTED_TV'));
    fixture.detectChanges();

    const reason = 'exclude every device (Mobile phones, Computers, Tablets and TV screens) on a Performance Max campaign';
    expect(c['googleDeviceBidModifiersError']()).toContain(reason);
    expect(find('implementation-google-devices-error')?.textContent).toContain(reason);
    expect(find('implementation-google-targeting-live')?.textContent).toContain(reason);
    expect(c['canSubmit']()).toBe(false);
    c['submit']();
    expect(createCampaign).not.toHaveBeenCalled();

    c['onGoogleDeviceBidModifiersChange'](excluded('MOBILE', 'DESKTOP', 'TABLET'));
    fixture.detectChanges();
    expect(c['googleDeviceBidModifiersError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('holds a Search adjustment after a switch to Performance Max, says so, and waits until it is cleared', () => {
    const c = seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'manual-cpc' });
    c['onGoogleDeviceBidModifiersChange']([{ device: 'MOBILE', bidModifier: 1.2 }, ...excluded('TABLET')]);
    fixture.detectChanges();
    expect(c['googleDeviceBidModifiersError']()).toBeNull();

    c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true, googleBiddingStrategy: '' });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.detectChanges();

    const held = c['googleDeviceAdjustmentsHeldMessage']();
    expect(held).toContain('Performance Max campaigns take a device only as an exclusion');
    expect(held).toContain('The adjustment on Mobile phones is kept for a switch back');
    expect(find('implementation-google-device-adjustments-held')?.textContent).toContain('The adjustment on Mobile phones is kept');
    expect(c['googleDeviceBidModifiersError']()).toContain('Performance Max campaigns take a device only as an exclusion');
    expect(c['canSubmit']()).toBe(false);
    // Held, not discarded.
    expect(c['googleDeviceBidModifiers']()).toEqual([{ device: 'MOBILE', bidModifier: 1.2 }, ...excluded('TABLET')]);
  });

  it('holds a TV screens exclusion after a switch to Search, says so, and sends it again on a switch back', () => {
    const c = pmax();
    c['onGoogleDeviceBidModifiersChange'](excluded('TABLET', 'CONNECTED_TV'));
    fixture.detectChanges();

    c['campaignForm'].patchValue({ includePerformanceMax: false, includeSearch: true });
    fixture.detectChanges();
    expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: excluded('TABLET') });
    const notice = c['googleTargetingWithheldMessage']();
    expect(notice).toContain('Search campaigns do not take TV screens');
    expect(find('implementation-google-targeting-withheld')?.textContent).toContain('Search campaigns do not take TV screens');
    expect(find('implementation-google-targeting-withheld-live')?.textContent?.trim()).toBe(notice);

    c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    fixture.detectChanges();
    expect(c['googleTargetingWithheldMessage']()).toBe('');
    expect(c['googleTargetingPayload']()).toEqual({ deviceBidModifiers: excluded('TABLET', 'CONNECTED_TV') });
  });

  it('round-trips the exclusions through emitDraft and restore', STATE_ONLY, () => {
    const c = pmax();
    let draft: Record<string, any> | undefined;
    c['draftChange'].subscribe((d: Record<string, any>) => (draft = d));
    c['onGoogleDeviceBidModifiersChange'](excluded('DESKTOP', 'CONNECTED_TV'));
    c['emitDraft']();
    const saved = draft?.['googleDeviceBidModifiers'];
    expect(saved).toEqual(excluded('DESKTOP', 'CONNECTED_TV'));

    // Clearing emits a fresh draft, so restore the one saved above.
    c['onGoogleDeviceBidModifiersChange']([]);
    expect(c['googleDeviceBidModifiers']()).toEqual([]);
    restoreGoogleDraft(fixture, c, { googleDeviceBidModifiers: saved });
    expect(c['googleDeviceBidModifiers']()).toEqual(excluded('DESKTOP', 'CONNECTED_TV'));
  });
});
