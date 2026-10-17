// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { META_AD_UNLISTED_NOTE, META_ADS_READ_FAILED_MESSAGE, META_ADS_TRUNCATED_NOTE } from '@lfx-one/shared/constants';
import type { CampaignServiceMetaAd, CampaignServiceMetaAds } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaAdSetAdsComponent } from './meta-ad-set-ads.component';

describe('MetaAdSetAdsComponent', () => {
  let fixture: ComponentFixture<MetaAdSetAdsComponent>;
  const listMetaAds = vi.fn();

  const ad = (over: Partial<CampaignServiceMetaAd> = {}): CampaignServiceMetaAd => ({
    id: '999',
    listed: true,
    name: 'Leads — Image A',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    creative_id: '777',
    creative_name: 'Image A',
    impressions: 920,
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
    currency: 'USD',
    read_at: '2026-10-15T09:30:00Z',
    truncated: false,
    ads: items,
    ad_count: items.length,
    ...over,
  });

  beforeEach(async () => {
    listMetaAds.mockReset();
    await TestBed.configureTestingModule({
      imports: [MetaAdSetAdsComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { listMetaAds } }],
    }).compileComponents();
  });

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(MetaAdSetAdsComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('adSetId', '111');
    fixture.componentRef.setInput('adSetName', 'Leads — US');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it("reads the ad set's ads on creation and renders each ad with its window, without any action", () => {
    listMetaAds.mockReturnValue(of(ads([ad(), ad({ id: '998', name: undefined, creative_name: undefined, status: 'PAUSED' })])));
    render();

    expect(listMetaAds).toHaveBeenCalledTimes(1);
    expect(listMetaAds).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', '111');
    expect(q('meta-ad-row-999')!.textContent).toContain('Leads — Image A');
    expect(q('meta-ad-creative-999')!.textContent).toContain('Image A');
    expect(q('meta-ad-impressions-999')!.textContent).toContain('920');
    expect(q('meta-ad-ctr-999')!.textContent).toContain('2.28%');
    expect(q('meta-ad-spend-999')!.textContent).toContain('6.17');
    // An unnamed ad falls back to its id, an unnamed creative to the creative's id.
    expect(q('meta-ad-row-998')!.textContent).toContain('998');
    expect(q('meta-ad-creative-998')!.textContent).toContain('777');
    expect(q('meta-ad-status-998')!.textContent).toContain('PAUSED');
    expect(q('meta-ad-set-ads-window-111')!.textContent).toContain('Last 30 days');
    expect(q('meta-ad-set-ads-read-at-111')).not.toBeNull();
    expect(q('meta-ad-set-ads-truncated-111')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(0);
  });

  it('shows a window it has no label for verbatim', () => {
    listMetaAds.mockReturnValue(of(ads([ad()], { window: 'last_90_days' as CampaignServiceMetaAds['window'] })));
    render();

    expect(q('meta-ad-set-ads-window-111')!.textContent).toContain('last_90_days');
  });

  it('shows the loading state until the read lands', () => {
    const pending = new Subject<CampaignServiceMetaAds>();
    listMetaAds.mockReturnValue(pending);
    render();

    expect(q('meta-ad-set-ads-loading-111')).not.toBeNull();
    pending.next(ads([ad()]));
    fixture.detectChanges();
    expect(q('meta-ad-set-ads-loading-111')).toBeNull();
    expect(q('meta-ad-row-999')).not.toBeNull();
  });

  it('states an ad set with no ads', () => {
    listMetaAds.mockReturnValue(of(ads([])));
    render();

    expect(q('meta-ad-set-ads-empty-111')!.textContent).toContain('Meta lists no ads for this ad set.');
  });

  it('notes a truncated listing and still lists an unlisted ad by its counters', () => {
    listMetaAds.mockReturnValue(of(ads([ad(), { id: '888', listed: false, impressions: 4, clicks: 0, cost_micros: 0, ctr: 0 }], { truncated: true })));
    render();

    expect(q('meta-ad-set-ads-truncated-111')!.textContent).toContain(META_ADS_TRUNCATED_NOTE);
    expect(q('meta-ad-unlisted-888')!.textContent).toContain(META_AD_UNLISTED_NOTE);
    expect(q('meta-ad-row-999')).not.toBeNull();
  });

  it('states a failed read as an alert, falls back to its own message, and retries', () => {
    listMetaAds.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    render();

    const error = q('meta-ad-set-ads-error-111')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain(META_ADS_READ_FAILED_MESSAGE);

    listMetaAds.mockReturnValue(of(ads([ad()])));
    (q('meta-ad-set-ads-retry-111')!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(listMetaAds).toHaveBeenCalledTimes(2);
    expect(q('meta-ad-set-ads-error-111')).toBeNull();
    expect(q('meta-ad-row-999')).not.toBeNull();
  });

  it('re-reads when the reload token is bumped, keeping the previous list on screen meanwhile', () => {
    listMetaAds.mockReturnValue(of(ads([ad()])));
    render();

    const reread = new Subject<CampaignServiceMetaAds>();
    listMetaAds.mockReturnValue(reread);
    fixture.componentRef.setInput('reloadToken', 1);
    fixture.detectChanges();

    expect(listMetaAds).toHaveBeenCalledTimes(2);
    expect(q('meta-ad-row-999')).not.toBeNull();
    expect(q('meta-ad-set-ads-loading-111')).toBeNull();

    reread.next(ads([ad({ id: '997' })]));
    fixture.detectChanges();
    expect(q('meta-ad-row-999')).toBeNull();
    expect(q('meta-ad-row-997')).not.toBeNull();
  });
});
