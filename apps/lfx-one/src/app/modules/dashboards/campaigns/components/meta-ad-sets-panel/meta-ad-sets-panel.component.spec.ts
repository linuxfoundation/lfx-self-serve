// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  LIVE_REGION_MOUNT_DELAY_MS,
  META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON,
  META_AD_SET_DELIBERATE_PAUSE_ADVICE,
  META_AD_SET_DELIBERATE_RESUME_ADVICE,
  META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON,
  META_AD_SET_RESUME_ELSEWHERE_REASON,
  META_AD_UNLISTED_NOTE,
  META_ADS_TRUNCATED_NOTE,
} from '@lfx-one/shared/constants';
import type {
  CampaignServiceMetaAd,
  CampaignServiceMetaAds,
  CampaignServiceMetaAdSet,
  CampaignServiceMetaAdSets,
  MetaAdSetToggleOutcome,
  MetaAdSetToggleRequest,
} from '@lfx-one/shared/interfaces';
import { metaAdSetCampaignEligibility } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaAdSetsPanelComponent } from './meta-ad-sets-panel.component';

describe('MetaAdSetsPanelComponent', () => {
  let fixture: ComponentFixture<MetaAdSetsPanelComponent>;
  const listMetaAdSets = vi.fn();
  const listMetaAds = vi.fn();
  let emitted: MetaAdSetToggleRequest[];

  const adSet = (over: Partial<CampaignServiceMetaAdSet> = {}): CampaignServiceMetaAdSet => ({
    id: '111',
    listed: true,
    name: 'Leads — US',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    impressions: 0,
    clicks: 0,
    cost_micros: 0,
    ctr: 0,
    recorded: true,
    deliberately_paused: false,
    ...over,
  });

  const list = (sets: CampaignServiceMetaAdSet[]): CampaignServiceMetaAdSets => ({
    campaign_id: 'c-1',
    platform_campaign_id: '555',
    window: 'last_30_days',
    currency: 'EUR',
    read_at: '2026-10-13T09:30:00Z',
    ad_sets: sets,
    ad_set_count: sets.length,
  });

  const unconfirmedPause: MetaAdSetToggleOutcome = {
    state: 'unconfirmed',
    message: 'may or may not have been applied',
    adSetId: '111',
    adSetName: 'Leads — US',
    requestedStatus: 'PAUSED',
  };

  beforeEach(async () => {
    listMetaAdSets.mockReset();
    listMetaAds.mockReset();
    emitted = [];
    await TestBed.configureTestingModule({
      imports: [MetaAdSetsPanelComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { listMetaAdSets, listMetaAds } }],
    }).compileComponents();
  });

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(MetaAdSetsPanelComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    // A toggleable campaign unless a test says otherwise; the input itself defaults to refusing both.
    fixture.componentRef.setInput('eligibility', metaAdSetCampaignEligibility('active'));
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.componentInstance.toggleAdSet.subscribe((request) => emitted.push(request));
    fixture.detectChanges();
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('renders name, status, effective status, budget and the deliberately-paused badge', () => {
    listMetaAdSets.mockReturnValue(
      of(
        list([
          adSet({ status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', budget_type: 'lifetime', budget_amount: '900.00', deliberately_paused: true }),
          adSet({ id: '222', name: undefined, recorded: false }),
        ])
      )
    );
    render();

    expect(q('meta-ad-set-status-111')!.textContent).toContain('PAUSED');
    expect(q('meta-ad-set-status-111')!.textContent).toContain('Effective: CAMPAIGN_PAUSED');
    expect(q('meta-ad-set-budget-111')!.textContent).toContain('900.00 EUR lifetime');
    expect(q('meta-ad-set-deliberately-paused-111')).not.toBeNull();
    // An ad set with no budget of its own (Campaign Budget Optimization) and no name.
    // A null budget is not proof of no budget: the note says what is missing, never "no budget".
    expect(q('meta-ad-set-budget-222')!.textContent).toContain('No ad set budget reported (it may use the campaign budget)');
    expect(q('meta-ad-set-row-222')!.textContent).toContain('222');
    expect(q('meta-ad-set-deliberately-paused-222')).toBeNull();
  });

  it('asks the parent for the opposite status and never acts while locked', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet()])));
    render();

    (q('meta-ad-set-toggle-111') as HTMLButtonElement).click();
    expect(emitted).toEqual([{ adSetId: '111', adSetName: 'Leads — US', status: 'PAUSED', kind: 'toggle' }]);

    fixture.componentRef.setInput('pending', { adSetId: '111', kind: 'toggle' });
    fixture.detectChanges();
    const button = q('meta-ad-set-toggle-111') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    button.click();
    expect(emitted).toHaveLength(1);
  });

  it('is locked, and says why, while the parent blocks the row', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet()])));
    render({ blockedReason: 'Refresh the campaign list first.' });

    expect((q('meta-ad-set-toggle-111') as HTMLButtonElement).disabled).toBe(true);
    expect(q('meta-ad-sets-blocked')!.textContent).toContain('Refresh the campaign list first.');
  });

  it('offers no Resume on a paused ad set it did not create, nor on a deleted or unlisted one', () => {
    listMetaAdSets.mockReturnValue(
      of(list([adSet({ status: 'PAUSED', recorded: false }), adSet({ id: '222', status: 'DELETED' }), adSet({ id: '333', listed: false })]))
    );
    render();

    expect(q('meta-ad-set-toggle-111')).toBeNull();
    expect(q('meta-ad-set-no-action-111')!.textContent).toContain(META_AD_SET_RESUME_ELSEWHERE_REASON);
    expect(q('meta-ad-set-toggle-222')).toBeNull();
    expect(q('meta-ad-set-toggle-333')).toBeNull();
  });

  it('re-reads when the parent bumps the reload token', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet()])));
    render();
    expect(listMetaAdSets).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('reloadToken', 1);
    fixture.detectChanges();
    expect(listMetaAdSets).toHaveBeenCalledTimes(2);
  });

  it('after an unconfirmed pause, waits for the re-read made for it, then flags a record it does not show', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', deliberately_paused: true })])));
    render();
    // The list on screen shows the record, but it predates the change: no verdict from it.
    const reread = new Subject<CampaignServiceMetaAdSets>();
    listMetaAdSets.mockReturnValue(reread.asObservable());
    fixture.componentRef.setInput('outcome', unconfirmedPause);
    fixture.componentRef.setInput('reloadToken', 1);
    fixture.detectChanges();

    expect(q('meta-ad-sets-record-check-advice')!.textContent).toContain(META_AD_SET_DELIBERATE_PAUSE_ADVICE);
    expect(q('meta-ad-sets-record-check-pending')).not.toBeNull();
    expect(q('meta-ad-sets-record-check-confirmed')).toBeNull();

    reread.next(list([adSet({ status: 'PAUSED', deliberately_paused: false })]));
    fixture.detectChanges();
    expect(q('meta-ad-sets-record-check-missing')!.textContent).toContain('Pause again (record)');
  });

  it('confirms the record once the re-read shows it', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', deliberately_paused: true })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-sets-record-check-confirmed')!.textContent).toContain('as deliberately paused');
  });

  it('treats a re-read that FAILS as a missing record, never as fine', () => {
    listMetaAdSets.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'Meta did not answer', code: 'SERVICE_UNAVAILABLE' } }))
    );
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-sets-record-check-missing')!.textContent).toContain('could not be re-read');
  });

  it('treats a re-read that OMITS the ad set as a missing record', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ id: '999' })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-sets-record-check-missing')!.textContent).toContain('does not list Leads — US');
  });

  it('after an unconfirmed RESUME, checks the record was cleared and offers Resume again (clear record) when it was not', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'ACTIVE', deliberately_paused: true })])));
    render({ outcome: { ...unconfirmedPause, requestedStatus: 'ACTIVE' } });

    expect(q('meta-ad-sets-record-check-advice')!.textContent).toContain(META_AD_SET_DELIBERATE_RESUME_ADVICE);
    expect(q('meta-ad-sets-record-check-missing')!.textContent).toContain('still shows Leads — US as deliberately paused');
    const clear = q('meta-ad-set-record-action-111') as HTMLButtonElement;
    expect(clear.textContent).toContain('Resume again (clear record)');
    clear.click();
    // Never PAUSED: re-sending ACTIVE clears the record and pauses nothing.
    expect(emitted).toEqual([{ adSetId: '111', adSetName: 'Leads — US', status: 'ACTIVE', kind: 'record' }]);
  });

  it.each(['ACTIVE', 'PAUSED'] as const)(
    'says it cannot tell, rather than flagging a failed record, when deliberately_paused is ABSENT after an unconfirmed %s',
    (direction) => {
      const raw = adSet({ status: direction });
      delete (raw as Partial<CampaignServiceMetaAdSet>).deliberately_paused;
      listMetaAdSets.mockReturnValue(of(list([raw])));
      render({ outcome: { ...unconfirmedPause, requestedStatus: direction } });

      expect(q('meta-ad-sets-record-check-unknown')!.textContent).toContain('does not say whether');
      expect(q('meta-ad-sets-record-check-missing')).toBeNull();
      expect(q('meta-ad-sets-record-check-confirmed')).toBeNull();
    }
  );

  it('confirms a cleared record after an unconfirmed resume', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'ACTIVE', deliberately_paused: false })])));
    render({ outcome: { ...unconfirmedPause, requestedStatus: 'ACTIVE' } });

    expect(q('meta-ad-sets-record-check-confirmed')!.textContent).toContain('deliberate pause cleared');
  });

  it('offers Pause again (record) beside Resume, asks for PAUSED, and marks only the RUNNING button busy', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', deliberately_paused: false })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-set-toggle-111')!.textContent).toContain('Resume');
    const record = q('meta-ad-set-record-action-111') as HTMLButtonElement;
    expect(record.textContent).toContain('Pause again (record)');
    expect(record.getAttribute('aria-label')).toBe('Pause again (record) Leads — US');
    record.click();
    // Never ACTIVE: re-sending PAUSED records the pause and activates nothing.
    expect(emitted).toEqual([{ adSetId: '111', adSetName: 'Leads — US', status: 'PAUSED', kind: 'record' }]);

    fixture.componentRef.setInput('pending', { adSetId: '111', kind: 'record' });
    fixture.detectChanges();
    const toggle = q('meta-ad-set-toggle-111') as HTMLButtonElement;
    const running = q('meta-ad-set-record-action-111') as HTMLButtonElement;
    expect(running.getAttribute('aria-busy')).toBe('true');
    expect(running.querySelector('.fa-spinner-third')).not.toBeNull();
    expect(toggle.getAttribute('aria-busy')).toBeNull();
    expect(toggle.querySelector('.fa-spinner-third')).toBeNull();
    running.click();
    expect(running.disabled).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it.each([
    ['already recorded as deliberately paused', { status: 'PAUSED', deliberately_paused: true }],
    ['active and not recorded', { status: 'ACTIVE' }],
    ['not created here', { status: 'PAUSED', recorded: false }],
  ])('offers no record action on an ad set that is %s', (_label, over) => {
    listMetaAdSets.mockReturnValue(of(list([adSet(over as Partial<CampaignServiceMetaAdSet>)])));
    render();

    expect(q('meta-ad-set-record-action-111')).toBeNull();
  });

  it('runs no record check for an ad set whose pause is never recorded', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', recorded: false })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-sets-record-check-advice')).toBeNull();
  });

  // The parent mounts this panel only when it opens, so a region inserted pre-filled would miss the
  // FIRST read: the persistent region starts empty and gains the text after its first render, and
  // the SAME element announces a Retry's read.
  it('announces each read in flight through one persistent, initially empty live region', async () => {
    const first = new Subject<CampaignServiceMetaAdSets>();
    listMetaAdSets.mockReturnValueOnce(first);
    render();
    const region = q('meta-ad-sets-live')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(q('meta-ad-sets-loading')!.getAttribute('role')).toBeNull();
    // Empty on the render that mounts it: the loading text arrives as a CHANGE, which is announced.
    expect(region.textContent!.trim()).toBe('');

    await new Promise((resolve) => setTimeout(resolve, LIVE_REGION_MOUNT_DELAY_MS + 20));
    fixture.detectChanges();
    expect(region.textContent!.trim()).toBe('Loading ad sets');

    first.error(new HttpErrorResponse({ status: 503 }));
    fixture.detectChanges();
    expect(q('meta-ad-sets-live')).toBe(region);
    expect(region.textContent!.trim()).toBe('');

    listMetaAdSets.mockReturnValueOnce(new Subject<CampaignServiceMetaAdSets>());
    (q('meta-ad-sets-retry')!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('meta-ad-sets-live')).toBe(region);
    expect(region.textContent!.trim()).toBe('Loading ad sets');
  });

  it('announces a failed read as an alert', () => {
    listMetaAdSets.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Campaign not found', code: 'NOT_FOUND' } })));
    render();

    expect(q('meta-ad-sets-error')!.getAttribute('role')).toBe('alert');
  });

  it('states a failed read with a retry', () => {
    listMetaAdSets.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Campaign not found', code: 'NOT_FOUND' } })));
    render();

    expect(q('meta-ad-sets-error')!.textContent).toContain('Campaign not found');
    listMetaAdSets.mockReturnValue(of(list([])));
    (q('meta-ad-sets-retry')!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('meta-ad-sets-empty')).not.toBeNull();
  });

  describe('campaign-state directions', () => {
    it('under created_degraded keeps Pause and Pause again (record) usable and disables Resume with the reconciliation reason', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet({ id: '111', status: 'ACTIVE' }), adSet({ id: '222', status: 'PAUSED', deliberately_paused: false })])));
      render({ eligibility: metaAdSetCampaignEligibility('created_degraded') });

      expect(q('meta-ad-sets-campaign-state')!.textContent).toContain(META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON);
      const pause = q('meta-ad-set-toggle-111') as HTMLButtonElement;
      const resume = q('meta-ad-set-toggle-222') as HTMLButtonElement;
      const record = q('meta-ad-set-record-action-222') as HTMLButtonElement;
      expect(pause.disabled).toBe(false);
      expect(record.disabled).toBe(false);
      expect(resume.disabled).toBe(true);
      expect(resume.getAttribute('aria-describedby')).toBe('meta-ad-sets-campaign-state-c-1');

      resume.click();
      expect(emitted).toEqual([]);
      record.click();
      pause.click();
      expect(emitted.map((request) => request.status)).toEqual(['PAUSED', 'PAUSED']);
    });

    it('under created_degraded disables Resume again (clear record) too', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'ACTIVE', deliberately_paused: true })])));
      render({ eligibility: metaAdSetCampaignEligibility('created_degraded') });

      const clear = q('meta-ad-set-record-action-111') as HTMLButtonElement;
      expect(clear.textContent).toContain('Resume again (clear record)');
      expect(clear.disabled).toBe(true);
      clear.click();
      expect(emitted).toEqual([]);
      expect((q('meta-ad-set-toggle-111') as HTMLButtonElement).disabled).toBe(false);
    });

    it('on a campaign still provisioning disables every action but keeps the ad sets readable', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet({ id: '111', status: 'ACTIVE' }), adSet({ id: '222', status: 'PAUSED', deliberately_paused: false })])));
      render({ eligibility: metaAdSetCampaignEligibility('pending') });

      expect(q('meta-ad-sets-campaign-state')!.textContent).toContain(META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON);
      expect(q('meta-ad-set-row-111')!.textContent).toContain('Leads — US');
      for (const id of ['meta-ad-set-toggle-111', 'meta-ad-set-toggle-222', 'meta-ad-set-record-action-222']) {
        expect((q(id) as HTMLButtonElement).disabled).toBe(true);
      }
    });

    it('fails closed when no eligibility is passed', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      fixture = TestBed.createComponent(MetaAdSetsPanelComponent);
      fixture.componentRef.setInput('projectSlug', 'tlf');
      fixture.componentRef.setInput('briefId', 'b-1');
      fixture.componentRef.setInput('campaignId', 'c-1');
      fixture.componentRef.setInput('campaignName', 'KubeCon EU');
      fixture.detectChanges();
      fixture.detectChanges();

      expect((q('meta-ad-set-toggle-111') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('read-only Ads section', () => {
    const ad = (over: Partial<CampaignServiceMetaAd> = {}): CampaignServiceMetaAd => ({
      id: '999',
      listed: true,
      name: 'Leads — Image A',
      status: 'ACTIVE',
      effective_status: 'ADSET_PAUSED',
      creative_id: '777',
      creative_name: 'Image A',
      impressions: 1920,
      clicks: 21,
      cost_micros: 6_170_000,
      ctr: 0.0228,
      ...over,
    });

    const ads = (items: CampaignServiceMetaAd[], over: Partial<CampaignServiceMetaAds> = {}): CampaignServiceMetaAds => ({
      campaign_id: 'c-1',
      platform_campaign_id: '555',
      ad_set_id: '111',
      window: 'last_30_days',
      currency: 'EUR',
      read_at: '2026-10-15T09:30:00Z',
      truncated: false,
      ads: items,
      ad_count: items.length,
      ...over,
    });

    const toggleAds = (adSetId = '111'): void => {
      (q(`meta-ad-set-ads-toggle-${adSetId}`) as HTMLButtonElement).click();
      fixture.detectChanges();
    };

    it("reads an ad set's ads only once it is expanded, and renders name, status, creative and counters", () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([ad()])));
      render();

      expect(listMetaAds).not.toHaveBeenCalled();
      expect(q('meta-ad-set-ads-111')).toBeNull();
      expect(q('meta-ad-set-ads-toggle-111')!.getAttribute('aria-expanded')).toBe('false');

      toggleAds();

      expect(listMetaAds).toHaveBeenCalledTimes(1);
      expect(listMetaAds).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', '111');
      const toggle = q('meta-ad-set-ads-toggle-111')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe('meta-ad-set-ads-region-c-1-111');
      expect(fixture.nativeElement.querySelector('#meta-ad-set-ads-region-c-1-111')).not.toBeNull();
      expect(q('meta-ad-row-999')!.textContent).toContain('Leads — Image A');
      expect(q('meta-ad-creative-999')!.textContent).toContain('Creative: Image A');
      expect(q('meta-ad-status-999')!.textContent).toContain('ACTIVE');
      expect(q('meta-ad-status-999')!.textContent).toContain('Effective: ADSET_PAUSED');
      expect(q('meta-ad-impressions-999')!.textContent).toContain('1,920');
      expect(q('meta-ad-clicks-999')!.textContent).toContain('21');
      expect(q('meta-ad-ctr-999')!.textContent).toContain('2.28%');
      expect(q('meta-ad-spend-999')!.textContent).toContain('6.17');
      expect(q('meta-ad-set-ads-111')!.textContent).toContain('Spend (EUR)');
      expect(q('meta-ad-set-ads-truncated-111')).toBeNull();
    });

    it('is strictly read-only: the section offers no per-ad action', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([ad(), ad({ id: '998', status: 'PAUSED' })])));
      render();
      toggleAds();

      expect(q('meta-ad-set-ads-111')!.querySelectorAll('button')).toHaveLength(0);
      expect(emitted).toEqual([]);
    });

    it('collapses without another read, and expanding again re-reads', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([ad()])));
      render();
      toggleAds();
      toggleAds();

      expect(q('meta-ad-set-ads-111')).toBeNull();
      expect(q('meta-ad-set-ads-toggle-111')!.getAttribute('aria-expanded')).toBe('false');
      expect(listMetaAds).toHaveBeenCalledTimes(1);

      toggleAds();
      expect(listMetaAds).toHaveBeenCalledTimes(2);
    });

    it('expands each ad set on its own', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet(), adSet({ id: '222' })])));
      listMetaAds.mockReturnValue(of(ads([ad()])));
      render();
      toggleAds('222');

      expect(listMetaAds).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', '222');
      expect(q('meta-ad-set-ads-222')).not.toBeNull();
      expect(q('meta-ad-set-ads-111')).toBeNull();
    });

    it('notes a truncated listing', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([ad()], { truncated: true })));
      render();
      toggleAds();

      expect(q('meta-ad-set-ads-truncated-111')!.textContent).toContain(META_ADS_TRUNCATED_NOTE);
      expect(q('meta-ad-row-999')).not.toBeNull();
    });

    it('shows an unlisted ad by its id with its counters only', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([{ id: '888', listed: false, impressions: 40, clicks: 2, cost_micros: 500_000, ctr: 0.05 }])));
      render();
      toggleAds();

      expect(q('meta-ad-row-888')!.textContent).toContain('888');
      expect(q('meta-ad-unlisted-888')!.textContent).toContain(META_AD_UNLISTED_NOTE);
      expect(q('meta-ad-creative-888')).toBeNull();
      expect(q('meta-ad-status-888')!.textContent).toContain('Not reported');
      expect(q('meta-ad-spend-888')!.textContent).toContain('0.50');
    });

    it('states an ad set with no ads', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([])));
      render();
      toggleAds();

      expect(q('meta-ad-set-ads-empty-111')!.textContent).toContain('Meta lists no ads for this ad set.');
    });

    it('shows the loading state while the read is out', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      const pending = new Subject<CampaignServiceMetaAds>();
      listMetaAds.mockReturnValue(pending);
      render();
      toggleAds();

      expect(q('meta-ad-set-ads-loading-111')).not.toBeNull();
      pending.next(ads([ad()]));
      fixture.detectChanges();
      expect(q('meta-ad-set-ads-loading-111')).toBeNull();
      expect(q('meta-ad-row-999')).not.toBeNull();
    });

    it('states a failed read as an alert with a retry that reads again', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'The ad set does not belong to this campaign.', code: 'CONFLICT' } }))
      );
      render();
      toggleAds();

      const error = q('meta-ad-set-ads-error-111')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('The ad set does not belong to this campaign.');

      listMetaAds.mockReturnValue(of(ads([ad()])));
      (q('meta-ad-set-ads-retry-111')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(listMetaAds).toHaveBeenCalledTimes(2);
      expect(q('meta-ad-set-ads-error-111')).toBeNull();
      expect(q('meta-ad-row-999')).not.toBeNull();
    });

    it('forgets an expansion whose ad set a re-read no longer lists', () => {
      listMetaAdSets.mockReturnValue(of(list([adSet(), adSet({ id: '222' })])));
      listMetaAds.mockReturnValue(of(ads([ad()])));
      render();
      toggleAds('222');
      toggleAds('111');

      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      fixture.componentRef.setInput('reloadToken', 1);
      fixture.detectChanges();
      expect(q('meta-ad-set-ads-111')).not.toBeNull();

      // Listed again later: it comes back collapsed, not reopened from the stale expansion.
      listMetaAdSets.mockReturnValue(of(list([adSet(), adSet({ id: '222' })])));
      fixture.componentRef.setInput('reloadToken', 2);
      fixture.detectChanges();
      expect(q('meta-ad-set-ads-222')).toBeNull();
      expect(q('meta-ad-set-ads-toggle-222')!.getAttribute('aria-expanded')).toBe('false');
      expect(q('meta-ad-set-ads-111')).not.toBeNull();
    });

    it("re-reads an expanded ad set's ads when the parent bumps the reload token", () => {
      listMetaAdSets.mockReturnValue(of(list([adSet()])));
      listMetaAds.mockReturnValue(of(ads([ad()])));
      render();
      toggleAds();

      fixture.componentRef.setInput('reloadToken', 1);
      fixture.detectChanges();

      expect(listMetaAds).toHaveBeenCalledTimes(2);
      expect(q('meta-ad-set-ads-111')).not.toBeNull();
    });
  });
});
