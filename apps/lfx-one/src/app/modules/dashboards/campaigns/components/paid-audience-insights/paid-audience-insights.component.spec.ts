// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaidAudienceInsightsComponent } from './paid-audience-insights.component';

describe('PaidAudienceInsightsComponent', () => {
  let fixture: ComponentFixture<PaidAudienceInsightsComponent>;
  const getPlatformAudience = vi.fn();

  beforeEach(async () => {
    getPlatformAudience.mockReset();
    getPlatformAudience.mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [], all_counters_null: false, approximate: true }));
    await TestBed.configureTestingModule({
      imports: [PaidAudienceInsightsComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { getPlatformAudience } }],
    }).compileComponents();

    fixture = TestBed.createComponent(PaidAudienceInsightsComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.detectChanges();
  });

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('offers Meta, LinkedIn, Microsoft, Reddit and X, and opens on Meta only', () => {
    expect(q('paid-audience-insights-platform-meta-ads')).not.toBeNull();
    expect(q('paid-audience-insights-platform-linkedin-ads')).not.toBeNull();
    expect(q('paid-audience-insights-platform-microsoft-ads')).not.toBeNull();
    expect(q('paid-audience-insights-platform-twitter-ads')).not.toBeNull();
    expect(q('paid-audience-insights-platform-reddit-ads')).not.toBeNull();

    expect(q('platform-audience-meta-ads')).not.toBeNull();
    // One live read at a time: only the picked platform's panel is mounted.
    expect(getPlatformAudience).toHaveBeenCalledTimes(1);
    expect(getPlatformAudience).toHaveBeenCalledWith('tlf', 'meta-ads', 'last_30_days');
  });

  it.each([
    ['linkedin-ads', 'last_30_days'],
    ['microsoft-ads', 'last_30_days'],
    ['reddit-ads', 'last_30_days'],
    ['twitter-ads', 'last_7_days'],
  ])('mounts the %s panel on its default window when picked', (platform, window) => {
    (q(`paid-audience-insights-platform-${platform}`) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(q(`platform-audience-${platform}`)).not.toBeNull();
    expect(q('platform-audience-meta-ads')).toBeNull();
    expect(getPlatformAudience).toHaveBeenLastCalledWith('tlf', platform, window);
    expect(q(`paid-audience-insights-platform-${platform}`)!.getAttribute('aria-pressed')).toBe('true');
  });
});
