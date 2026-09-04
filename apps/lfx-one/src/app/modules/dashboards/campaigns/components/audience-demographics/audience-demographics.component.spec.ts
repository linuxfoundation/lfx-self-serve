// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AudienceDemographicsComponent } from './audience-demographics.component';

describe('AudienceDemographicsComponent', () => {
  let fixture: ComponentFixture<AudienceDemographicsComponent>;
  const getAudience = vi.fn();

  beforeEach(async () => {
    getAudience.mockReset();
    await TestBed.configureTestingModule({
      imports: [AudienceDemographicsComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { getAudience } }],
    }).compileComponents();
  });

  // Two detectChanges: the load is driven by a `toObservable` on the inputs, which flushes on the
  // FIRST cycle -- so the response only lands in the view on the second.
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(AudienceDemographicsComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('days', 30);
    // Three cycles: `toObservable` is created in the CONSTRUCTOR and emits on the first flush,
    // the service call resolves on the microtask queue, and the view renders on the next cycle.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the empty state for a valid response with no buckets', async () => {
    // Copilot: `hasData` was `!!this.data()`, and the cutover returns a VALID
    // `{ age: [], gender: [], device: [] }` for a project campaign-service knows no campaigns
    // for. So a non-null-but-empty response rendered three blank cards instead of the empty
    // state that already existed for it.
    getAudience.mockReturnValue(of({ pulledAt: '2026-09-02T00:00:00Z', days: 30, age: [], gender: [], device: [] }));
    await render();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text, 'a valid empty response did not reach the empty state').toContain('No audience data available');
  });

  it('renders buckets when there is data', async () => {
    // The other direction, so the assertion above cannot be satisfied by always showing empty.
    getAudience.mockReturnValue(
      of({
        pulledAt: '2026-09-02T00:00:00Z',
        days: 30,
        // The REAL AudienceBucket shape -- the template formats every numeric field, so a
        // partial fixture throws in formatNumber rather than testing anything.
        age: [{ label: '25-34', impressions: 1000, clicks: 50, ctr: 5, spend: 25, conversions: 3 }],
        gender: [],
        device: [],
      })
    );
    await render();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('No audience data available');
  });

  it('surfaces the upstream reason rather than Angular generic text', async () => {
    // BaseApiError.toResponse serialises operator text as `{ error: string }`, so reading
    // `.error.message` yielded undefined and the operator saw "Http failure response for <url>".
    // A REAL HttpErrorResponse: `extractErrorMessage` narrows on `instanceof`, so a plain object
    // shaped like one takes the fallback path and proves nothing about the helper being wired.
    getAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Connect Google Ads for this project.' } })));
    await render();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text, 'the actionable upstream message was discarded').toContain('Connect Google Ads for this project.');
  });
});
