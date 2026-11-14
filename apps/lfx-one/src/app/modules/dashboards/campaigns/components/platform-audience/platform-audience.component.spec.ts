// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  CAMPAIGN_AUDIENCE_CONFLICT_CODE,
  CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE,
  CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE,
  CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE,
  CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE,
  CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE,
  CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE,
  CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE,
} from '@lfx-one/shared/constants';
import type { PlatformAudiencePanelPlatform } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformAudienceComponent } from './platform-audience.component';

describe('PlatformAudienceComponent', () => {
  let fixture: ComponentFixture<PlatformAudienceComponent>;
  const getPlatformAudience = vi.fn();

  beforeEach(async () => {
    getPlatformAudience.mockReset();
    await TestBed.configureTestingModule({
      imports: [PlatformAudienceComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { getPlatformAudience } }],
    }).compileComponents();
  });

  function render(platform: PlatformAudiencePanelPlatform, label: string): void {
    fixture = TestBed.createComponent(PlatformAudienceComponent);
    fixture.componentRef.setInput('platform', platform);
    fixture.componentRef.setInput('label', label);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.detectChanges();
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const bffError = (status: number, code: string, error: string): HttpErrorResponse => new HttpErrorResponse({ status, error: { error, code } });

  it("reads the platform's own default window and renders each breakdown", () => {
    getPlatformAudience.mockReturnValue(
      of({
        window: 'last_30_days',
        bucket_count: 2,
        account_currency: 'USD',
        buckets: [
          { dimension: 'age_gender', age: '25-34', gender: 'female', impressions: 1200, clicks: 60, cost_micros: 3_000_000, ctr: 0.05 },
          {
            dimension: 'placement',
            publisher_platform: 'instagram',
            platform_position: 'feed',
            impressions: 900,
            clicks: 9,
            cost_micros: 1_000_000,
            ctr: 0.01,
          },
        ],
      })
    );
    render('meta-ads', 'Meta');

    expect(getPlatformAudience).toHaveBeenCalledWith('tlf', 'meta-ads', 'last_30_days');
    expect(q('platform-audience-section-age_gender')!.textContent).toContain('25-34 · female');
    expect(q('platform-audience-section-age_gender')!.textContent).toContain('1,200');
    expect(q('platform-audience-section-placement')!.textContent).toContain('instagram · feed');
    expect(text()).toContain('Spend (USD)');
  });

  it('shows Not measured, never 0, for a counter the read did not carry', () => {
    getPlatformAudience.mockReturnValue(
      of({ window: 'last_30_days', bucket_count: 1, buckets: [{ dimension: 'age_gender', age: '25-34', gender: 'male', impressions: 40 }] })
    );
    render('meta-ads', 'Meta');

    const row = q('platform-audience-row-age_gender-0')!;
    expect(row.textContent).toContain('40');
    expect(row.textContent).toContain('Not measured');
    // No currency on the read: the unit is the ad account's own, not a guessed USD.
    expect(text()).toContain('Spend (acct. currency)');
  });

  it('only offers the windows the platform accepts, and re-reads on a pick (X caps at 7 days)', () => {
    getPlatformAudience.mockReturnValue(of({ window: 'last_7_days', bucket_count: 0, buckets: [], all_counters_null: false }));
    render('twitter-ads', 'X');

    expect(getPlatformAudience).toHaveBeenCalledWith('tlf', 'twitter-ads', 'last_7_days');
    expect(q('platform-audience-window-last_30_days')).toBeNull();
    (q('platform-audience-window-yesterday') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getPlatformAudience).toHaveBeenLastCalledWith('tlf', 'twitter-ads', 'yesterday');
    expect(q('platform-audience-empty')!.textContent).toContain('No X audience activity');
  });

  it('marks an unmeasured X breakdown and says why', () => {
    getPlatformAudience.mockReturnValue(
      of({
        window: 'last_7_days',
        bucket_count: 1,
        all_counters_null: true,
        buckets: [{ dimension: 'gender', value: 'Female', impressions: 0, clicks: 0, cost_micros: 0, ctr: 0 }],
      })
    );
    render('twitter-ads', 'X');

    expect(q('platform-audience-not-measured-note')).not.toBeNull();
    expect(q('platform-audience-section-not-measured-gender')).not.toBeNull();
    expect(q('platform-audience-row-gender-0')!.textContent).not.toContain('0.00');
  });

  it('states a Microsoft read with no finished report as building, not as no audience', () => {
    getPlatformAudience.mockReturnValue(of({ window: 'last_30_days', buckets: [], bucket_count: 0, metrics_pending: true, data_incomplete: false }));
    render('microsoft-ads', 'Microsoft Advertising');

    expect(q('platform-audience-building')).not.toBeNull();
    expect(q('platform-audience-empty')).toBeNull();
  });

  it('renders Reddit gender, country and community, with unattributed traffic labelled as such', () => {
    getPlatformAudience.mockReturnValue(
      of({
        window: 'last_30_days',
        bucket_count: 2,
        buckets: [
          { dimension: 'gender', impressions: 70, clicks: 7, cost_micros: 700_000, ctr: 0.1 },
          { dimension: 'community', value: 'devops', impressions: 40, clicks: 2, cost_micros: 200_000, ctr: 0.05 },
        ],
      })
    );
    render('reddit-ads', 'Reddit');

    expect(getPlatformAudience).toHaveBeenCalledWith('tlf', 'reddit-ads', 'last_30_days');
    expect(q('platform-audience-row-gender-0')!.textContent).toContain('Unattributed');
    expect(q('platform-audience-section-community')!.textContent).toContain('devops');
    expect(q('platform-audience-window-yesterday')).toBeNull();
    expect(text()).toContain('Spend (acct. currency)');
  });

  it('states a 409 (Reddit mixed provenance, a campaign cap or a malformed id: campaign-service does not say which) with every cause and both remedies', () => {
    getPlatformAudience.mockReturnValue(throwError(() => bffError(409, CAMPAIGN_AUDIENCE_CONFLICT_CODE, CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE)));
    render('reddit-ads', 'Reddit');

    const error = q('platform-audience-error-conflict')!.textContent ?? '';
    expect(error).toContain('Reconnect the account the campaigns run in');
    expect(error).toContain('re-dispatch');
    expect(error).toContain('more campaigns than this read covers');
    expect(q('platform-audience-retry')).not.toBeNull();
  });

  it('labels LinkedIn figures as estimates', () => {
    getPlatformAudience.mockReturnValue(
      of({
        window: 'last_30_days',
        bucket_count: 1,
        approximate: true,
        buckets: [{ dimension: 'seniority', value: 'urn:li:seniority:5', impressions: 300, clicks: 3, cost_micros: 1, ctr: 0.01 }],
      })
    );
    render('linkedin-ads', 'LinkedIn');

    expect(q('platform-audience-approximate')).not.toBeNull();
    // Every LinkedIn figure is an estimate, the CTR derived from them included: each cell carries the marker.
    const cells = Array.from(q('platform-audience-row-seniority-0')!.querySelectorAll('td')).slice(1);
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.textContent).toContain('≈');
    }
    expect(text()).toContain('Spend (USD)');
  });

  it.each([
    [404, CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE, CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE, 'no-connection', 'This project has no LinkedIn connection.'],
    [409, CAMPAIGN_AUDIENCE_CONFLICT_CODE, CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE, 'conflict', "can't read these campaigns together"],
    [503, CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE, CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE, 'unavailable', "LinkedIn didn't confirm the audience read"],
  ])('states a %i (%s) by cause, naming the platform, with a retry', (status, code, message, kind, expected) => {
    getPlatformAudience.mockReturnValueOnce(throwError(() => bffError(status, code, message)));
    render('linkedin-ads', 'LinkedIn');

    const error = q(`platform-audience-error-${kind}`)!;
    expect(error.textContent).toContain(expected);
    expect(error.getAttribute('role')).toBe('alert');

    getPlatformAudience.mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [], approximate: true }));
    (q('platform-audience-retry')!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getPlatformAudience).toHaveBeenCalledTimes(2);
    expect(q('platform-audience-empty')).not.toBeNull();
  });

  it('offers no retry for a read this environment has switched off', () => {
    getPlatformAudience.mockReturnValue(throwError(() => bffError(400, CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE, CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE)));
    render('microsoft-ads', 'Microsoft Advertising');

    expect(q('platform-audience-error-not-enabled')!.textContent).toContain("Microsoft Advertising audience insights aren't available");
    expect(q('platform-audience-retry')).toBeNull();
  });

  it('does not read a bare 404 (a route switched off) as a missing connection', () => {
    getPlatformAudience.mockReturnValue(throwError(() => bffError(404, 'NOT_FOUND', 'Route not found')));
    render('meta-ads', 'Meta');

    expect(q('platform-audience-error-no-connection')).toBeNull();
    expect(q('platform-audience-error-failed')).not.toBeNull();
  });

  it('treats no answer at all as a read the platform did not confirm', () => {
    getPlatformAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') })));
    render('meta-ads', 'Meta');

    expect(q('platform-audience-error-unavailable')).not.toBeNull();
  });
});
