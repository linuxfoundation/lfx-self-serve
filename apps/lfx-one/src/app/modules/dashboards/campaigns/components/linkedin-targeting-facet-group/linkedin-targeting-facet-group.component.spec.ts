// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE, LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkedInTargetingFacetGroupComponent } from './linkedin-targeting-facet-group.component';

// Wiring only: a failed search reaches the alert (the message rule is linkedInTargetingSearchFailure's, tested in
// campaign-linkedin-targeting-form.utils.spec.ts). The happy paths are covered through linkedin-targeting-editor's spec.
describe('LinkedInTargetingFacetGroupComponent', () => {
  let fixture: ComponentFixture<LinkedInTargetingFacetGroupComponent>;
  const call = (name: string, ...args: unknown[]): void => (fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => void>)[name](...args);

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [LinkedInTargetingFacetGroupComponent],
      providers: [{ provide: CampaignService, useValue: { searchLinkedInTargeting: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 }))) } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LinkedInTargetingFacetGroupComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('testId', 'group');
    fixture.componentRef.setInput('picks', {});
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a failed search as an alert, logging only its status', async () => {
    call('onSearch', { query: 'golang', originalEvent: new Event('input') });
    await vi.advanceTimersByTimeAsync(LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="group-search-error"]')?.textContent).toContain(LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), 503);
  });
});
