// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CAMPAIGN_LIVE_METRICS_READ_ERRORS, CAMPAIGN_LIVE_METRICS_UNSUPPORTED_MESSAGE } from '@lfx-one/shared/constants';
import type { BriefMetricsRow, CampaignServiceCampaignMetrics } from '@lfx-one/shared/interfaces';
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

  // The tab already holds this measurement from its brief-wide read: shown with no call of its own.
  it("shows an ok brief-wide row's counters without reading, and reads only on Refresh", () => {
    const row: BriefMetricsRow = { campaign_id: 'c-1', platform: 'meta-ads', status: 'ok', metrics: { ...METRICS, clicks: 99 } };
    fixture.componentRef.setInput('briefRow', row);
    fixture.detectChanges();

    expect(getCampaignMetrics).not.toHaveBeenCalled();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('99');
    expect(button()!.textContent?.trim()).toBe('Refresh live counters');

    load();
    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('212');
  });

  const okRow = (clicks: number): BriefMetricsRow => ({ campaign_id: 'c-1', platform: 'meta-ads', status: 'ok', metrics: { ...METRICS, clicks } });

  // A tab Refresh lands a NEW brief-wide row after this row's own Refresh: the fresher answer wins.
  it("shows a newer brief-wide result over the row's own earlier Refresh, without reading again", () => {
    fixture.componentRef.setInput('briefRow', okRow(99));
    fixture.detectChanges();
    load();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('212');

    fixture.componentRef.setInput('briefRow', okRow(150));
    fixture.detectChanges();

    expect(text('optimization-campaign-live-clicks-c-1')).toBe('150');
    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
  });

  // The tab clears the brief-wide row to null when its Refresh starts, and leaves it null if that
  // read fails. Neither is a measurement, so the row's own settled answer stays until a real row lands.
  it("keeps the row's own settled counters while the tab reloads, and if the tab-wide read fails", () => {
    fixture.componentRef.setInput('briefRow', okRow(99));
    fixture.detectChanges();
    load();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('212');

    fixture.componentRef.setInput('briefRow', null);
    fixture.detectChanges();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('212');
    expect(button()!.textContent?.trim()).toBe('Refresh live counters');

    // A failed tab-wide read: the row stays null, and so does the answer shown.
    fixture.detectChanges();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('212');

    // A fresh non-null row is a newer measurement, and supersedes it.
    fixture.componentRef.setInput('briefRow', okRow(150));
    fixture.detectChanges();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('150');
    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
  });

  it("keeps the row's own settled error through a tab reload that clears the brief-wide row", () => {
    fixture.componentRef.setInput('briefRow', okRow(99));
    fixture.detectChanges();
    getCampaignMetrics.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'X' } })));
    load();
    fixture.componentRef.setInput('briefRow', null);
    fixture.detectChanges();

    expect(q('optimization-campaign-live-error-c-1')).not.toBeNull();
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();
  });

  it("clears the row's own earlier error when a newer brief-wide result measures it", () => {
    getCampaignMetrics.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'X' } })));
    load();
    expect(q('optimization-campaign-live-error-c-1')).not.toBeNull();

    fixture.componentRef.setInput('briefRow', okRow(150));
    fixture.detectChanges();

    expect(q('optimization-campaign-live-error-c-1')).toBeNull();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('150');
  });

  // A brief-wide row that lands while the row's own read is in flight is OLDER than that answer.
  it('keeps an in-flight own read, and its answer, over a brief-wide row that landed meanwhile', () => {
    const inFlight = new Subject<CampaignServiceCampaignMetrics>();
    getCampaignMetrics.mockReturnValue(inFlight.asObservable());
    fixture.componentRef.setInput('briefRow', okRow(99));
    fixture.detectChanges();
    load();

    fixture.componentRef.setInput('briefRow', okRow(150));
    fixture.detectChanges();
    expect(q('optimization-campaign-live-loading-c-1')).not.toBeNull();
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();

    inFlight.next({ ...METRICS, clicks: 300 });
    inFlight.complete();
    fixture.detectChanges();
    expect(text('optimization-campaign-live-clicks-c-1')).toBe('300');
    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
  });

  // LinkedIn reports `costInUsd` whatever the account bills in; every other platform, the account's own.
  it.each([
    ['linkedin-ads', 'Cost (USD)'],
    ['meta-ads', 'Cost (ad account currency)'],
    ['reddit-ads', 'Cost (ad account currency)'],
  ])('labels the cost of a %s row %s', (platform, label) => {
    fixture.componentRef.setInput('platform', platform);
    load();

    expect(text('optimization-campaign-live-cost-label-c-1')).toBe(label);
  });

  // A row the brief-wide read could not measure states its reason, and a click asks for the precise one.
  it("states a non-ok brief-wide row's reason, and reads this campaign only when clicked", () => {
    fixture.componentRef.setInput('briefRow', { campaign_id: 'c-1', platform: 'meta-ads', status: 'not_ready', reason: 'the campaign has no data yet' });
    fixture.detectChanges();

    expect(getCampaignMetrics).not.toHaveBeenCalled();
    expect(text('optimization-campaign-live-brief-reason-c-1')).toContain('the campaign has no data yet');
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();

    getCampaignMetrics.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'no data in the window', code: 'CLIENT_ERROR' } }))
    );
    load();
    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
    expect(text('optimization-campaign-live-error-c-1')).toBe('no data in the window');
    expect(q('optimization-campaign-live-brief-reason-c-1')).toBeNull();
  });

  it.each([
    ['project', 'projectSlug'],
    ['brief', 'briefId'],
  ])('offers no read while the %s is empty', (_label, inputName) => {
    fixture.componentRef.setInput(inputName, '');
    fixture.detectChanges();

    expect(button()).toBeNull();
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(getCampaignMetrics).not.toHaveBeenCalled();
  });

  // The BFF's own validation 400 says nothing about the platform: an error with a retry, not "unsupported".
  it("treats the BFF's VALIDATION_ERROR 400 as a retryable error", () => {
    getCampaignMetrics.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              error: 'Validation failed for briefId',
              code: 'VALIDATION_ERROR',
              errors: [{ field: 'briefId', message: 'briefId must be a brief UUID' }],
            },
          })
      )
    );
    load();

    expect(q('optimization-campaign-live-unsupported-c-1')).toBeNull();
    expect(text('optimization-campaign-live-error-c-1')).toBe('briefId must be a brief UUID');
    expect(button()!.textContent?.trim()).toBe('Try again');
  });

  // The email channel mirrors opens into impressions and bills nothing: "Opens", and no cost.
  it('labels the email channel counter Opens and shows no cost', () => {
    fixture.componentRef.setInput('platform', 'hubspot');
    getCampaignMetrics.mockReturnValue(
      of({ ...METRICS, impressions: 1840, cost_micros: 0, email: { sent: 9400, delivered: 9268, opens: 1840, clicks: 212, bounces: 95, unsubscribes: 17 } })
    );
    load();

    expect(text('optimization-campaign-live-impressions-label-c-1')).toBe('Opens');
    expect(text('optimization-campaign-live-impressions-c-1')).toBe('1,840');
    expect(q('optimization-campaign-live-cost-c-1')).toBeNull();
    expect(text('optimization-campaign-live-window-c-1')).toContain('to date for the emails sent over the last 30 days');
  });

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
    expect(text('optimization-campaign-live-impressions-label-c-1')).toBe('Impressions');
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

  // The request belonged to c-1 as it was then: coming back to c-1 does not replay it unasked.
  it('does not replay a request when the campaign changes away and back', () => {
    load();
    fixture.componentRef.setInput('campaignId', 'c-2');
    fixture.detectChanges();
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.detectChanges();

    expect(getCampaignMetrics).toHaveBeenCalledTimes(1);
    expect(q('optimization-campaign-live-counters-c-1')).toBeNull();
    expect(button()!.textContent?.trim()).toBe('Live counters');
  });
});
