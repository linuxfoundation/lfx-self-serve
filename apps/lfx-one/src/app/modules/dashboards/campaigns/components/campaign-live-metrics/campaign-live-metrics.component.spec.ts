// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CAMPAIGN_LIVE_METRICS_READ_ERRORS, CAMPAIGN_LIVE_METRICS_UNSUPPORTED_MESSAGE } from '@lfx-one/shared/constants';
import type { CampaignServiceCampaignMetrics } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignLiveMetricsComponent } from './campaign-live-metrics.component';

const METRICS: CampaignServiceCampaignMetrics = {
  campaign_id: 'c-1',
  platform_campaign_id: '123',
  window: 'last_30_days',
  impressions: 18400,
  clicks: 212,
  cost_micros: 1284567890,
  ctr: 0.01152,
};

describe('CampaignLiveMetricsComponent (#3299)', () => {
  let fixture: ComponentFixture<CampaignLiveMetricsComponent>;
  let getCampaignMetrics: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getCampaignMetrics = vi.fn(() => of(METRICS));
    await TestBed.configureTestingModule({
      imports: [CampaignLiveMetricsComponent],
      providers: [{ provide: CampaignService, useValue: { getCampaignMetrics } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignLiveMetricsComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    fixture.detectChanges();
  });

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => q(testId)?.textContent?.trim() ?? '';
  const button = (): HTMLButtonElement | null => q('optimization-campaign-live-load-c-1') as HTMLButtonElement | null;

  function load(): void {
    button()!.click();
    fixture.detectChanges();
  }

  it('reads nothing until the operator asks', () => {
    expect(getCampaignMetrics).not.toHaveBeenCalled();
    expect(button()!.textContent?.trim()).toBe('Live counters');
    expect(button()!.getAttribute('aria-label')).toBe('Live counters for KubeCon EU');
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();
  });

  it('reads this campaign without a window and shows its counters, cost without a currency symbol', () => {
    load();

    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
    expect(getCampaignMetrics).toHaveBeenCalledWith('tlf', 'b-1', 'c-1');
    expect(text('optimization-campaign-live-impressions-c-1')).toBe('18,400');
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('212');
    expect(text('optimization-campaign-live-cost-c-1')).toBe('1,284.57');
    expect(text('optimization-campaign-live-cost-c-1')).not.toContain('$');
    expect(text('optimization-campaign-live-ctr-c-1')).toBe('1.15%');
    expect(text('optimization-campaign-live-window-c-1')).toContain('the last 30 days');
    expect(button()!.textContent?.trim()).toBe('Refresh live counters');
  });

  it('names the narrower window the platform served', () => {
    getCampaignMetrics.mockReturnValue(of({ ...METRICS, window: 'last_7_days' }));
    load();

    expect(text('optimization-campaign-live-window-c-1')).toContain('the last 7 days');
  });

  it('shows the read in flight, disables the button and ignores a second click', () => {
    const inFlight = new Subject<CampaignServiceCampaignMetrics>();
    getCampaignMetrics.mockReturnValue(inFlight.asObservable());
    load();

    expect(q('optimization-campaign-live-loading-c-1')).not.toBeNull();
    expect(button()!.disabled).toBe(true);
    expect(button()!.getAttribute('aria-busy')).toBe('true');
    fixture.componentInstance.load();
    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);

    inFlight.next(METRICS);
    inFlight.complete();
    fixture.detectChanges();
    expect(q('optimization-campaign-live-loading-c-1')).toBeNull();
    expect(q('optimization-campaign-live-counters-c-1')).not.toBeNull();
  });

  it('reads the platform again on Refresh', () => {
    load();
    getCampaignMetrics.mockReturnValue(of({ ...METRICS, clicks: 300 }));
    load();

    expect(getCampaignMetrics).toHaveBeenCalledTimes(2);
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('300');
  });

  // A 400 is the platform having no metrics read: a property of the row, with nothing to retry.
  it('reports an unsupported platform without an error or a retry', () => {
    getCampaignMetrics.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'not supported', code: 'X' } })));
    load();

    expect(text('optimization-campaign-live-unsupported-c-1')).toBe(CAMPAIGN_LIVE_METRICS_UNSUPPORTED_MESSAGE);
    expect(q('optimization-campaign-live-error-c-1')).toBeNull();
    expect(button()).toBeNull();
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();
  });

  it('maps a failure to a fixed sentence and reads again on Try again', () => {
    getCampaignMetrics.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'platform text', code: 'X' } })));
    load();

    expect(text('optimization-campaign-live-error-c-1')).toBe(CAMPAIGN_LIVE_METRICS_READ_ERRORS[503]);
    expect(text('optimization-campaign-live-error-c-1')).not.toContain('platform text');
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();
    expect(button()!.textContent?.trim()).toBe('Try again');

    load();
    expect(getCampaignMetrics).toHaveBeenCalledTimes(2);
    expect(q('optimization-campaign-live-error-c-1')).toBeNull();
    expect(q('optimization-campaign-live-counters-c-1')).not.toBeNull();
  });

  it("keeps campaign-service's own reason for a 409", () => {
    getCampaignMetrics.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'campaign is not fully provisioned', code: 'CLIENT_ERROR' } }))
    );
    load();

    expect(text('optimization-campaign-live-error-c-1')).toBe('campaign is not fully provisioned');
  });

  // Another campaign in this slot is not the one the operator asked about: back to idle, nothing read.
  it('drops back to idle without reading when the campaign changes', () => {
    load();
    fixture.componentRef.setInput('campaignId', 'c-2');
    fixture.detectChanges();

    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
    expect(q('optimization-campaign-live-counters-c-2')).toBeNull();
    expect(q('optimization-campaign-live-load-c-2')!.textContent?.trim()).toBe('Live counters');
  });
});
