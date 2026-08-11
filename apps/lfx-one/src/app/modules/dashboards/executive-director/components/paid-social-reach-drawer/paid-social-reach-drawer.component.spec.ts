// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ProjectContext, SocialReachResponse } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, Subject } from 'rxjs';

import { PaidSocialReachDrawerComponent } from './paid-social-reach-drawer.component';

/**
 * Covers the `status` state machine that took two review rounds to get right:
 * a failed request must render the unavailable state (never fabricated zeros),
 * closing must reset to idle AND cancel any in-flight request, and a retry
 * (foundation switch while open) must go through loading rather than flashing
 * the previous attempt's result.
 */
describe('PaidSocialReachDrawerComponent', () => {
  const foundation: ProjectContext = { uid: 'f-1', name: 'The Linux Foundation', slug: 'tlf' };
  const response: SocialReachResponse = {
    totalReach: 1000,
    roas: 2.5,
    totalSpend: 500,
    totalRevenue: 1250,
    changePercentage: 10,
    trend: 'up',
    monthlyData: [],
    monthlyLabels: [],
    monthlyRoas: [],
    channelGroups: [],
  };

  let fixture: ComponentFixture<PaidSocialReachDrawerComponent>;
  let selectedFoundation: ReturnType<typeof signal<ProjectContext | null>>;
  let getSocialReach$: Subject<SocialReachResponse>;
  let getSocialReachMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    selectedFoundation = signal<ProjectContext | null>(foundation);
    getSocialReach$ = new Subject<SocialReachResponse>();
    getSocialReachMock = vi.fn(() => getSocialReach$.asObservable() as Observable<SocialReachResponse>);

    await TestBed.configureTestingModule({
      imports: [PaidSocialReachDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getSocialReach: getSocialReachMock } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaidSocialReachDrawerComponent);
    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
  });

  function open(): void {
    fixture.componentRef.setInput('visible', true);
  }

  it('shows the skeleton, never fabricated zeros, before a request settles', async () => {
    open();
    await fixture.whenStable();

    expect(fixture.componentInstance['drawerLoading']()).toBe(true);
    expect(fixture.componentInstance['dataUnavailable']()).toBe(false);
  });

  it('renders the unavailable state on a failed request, not zero-filled data', async () => {
    open();
    await fixture.whenStable();

    getSocialReach$.error(new Error('upstream failure'));
    await fixture.whenStable();

    expect(fixture.componentInstance['dataUnavailable']()).toBe(true);
    expect(fixture.componentInstance['drawerLoading']()).toBe(false);
  });

  it('resets to idle on close and cancels the in-flight request', async () => {
    open();
    await fixture.whenStable();
    expect(getSocialReachMock).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();

    expect(fixture.componentInstance['drawerLoading']()).toBe(true);
    expect(fixture.componentInstance['dataUnavailable']()).toBe(false);

    // The request that was in flight at close time must not be able to land afterward
    // and overwrite the 'idle' reset with 'loaded' or 'failed'.
    getSocialReach$.next(response);
    await fixture.whenStable();

    expect(fixture.componentInstance['dataUnavailable']()).toBe(false);
    expect(fixture.componentInstance['drawerData']().totalReach).toBe(0);
  });

  it('retries through loading — a foundation switch while open never flashes the previous result', async () => {
    open();
    await fixture.whenStable();
    getSocialReach$.next(response);
    await fixture.whenStable();

    expect(fixture.componentInstance['drawerData']().totalReach).toBe(1000);

    getSocialReach$ = new Subject<SocialReachResponse>();
    getSocialReachMock.mockReturnValue(getSocialReach$.asObservable());
    selectedFoundation.set({ ...foundation, uid: 'f-2', slug: 'other-foundation' });
    await fixture.whenStable();

    expect(fixture.componentInstance['drawerLoading']()).toBe(true);
    expect(fixture.componentInstance['dataUnavailable']()).toBe(false);
  });
});
