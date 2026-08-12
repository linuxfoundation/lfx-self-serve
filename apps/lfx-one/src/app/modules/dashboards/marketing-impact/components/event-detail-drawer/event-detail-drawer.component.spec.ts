// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AnalyticsService } from '@services/analytics.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventDetailDrawerComponent } from './event-detail-drawer.component';

import type { EventDetailResponse } from '@lfx-one/shared/interfaces';

describe('EventDetailDrawerComponent', () => {
  const detail = (overrides: Partial<EventDetailResponse> = {}): EventDetailResponse => ({
    eventId: 'evt-1',
    eventName: 'KubeCon NA',
    startDate: '2026-11-10',
    country: 'United States',
    eventUrl: 'https://events.example.org/kubecon',
    registrations: { actual: 900, goal: 1000 },
    sponsorshipRevenue: { actual: 500000, goal: 1000000 },
    vsLastYear: 1.1,
    compScore: 'high',
    cfpStatus: 'Review Complete',
    sponsorshipTiers: [
      { tier: 'Diamond', revenue: 300000, sponsorCount: 2 },
      { tier: 'Gold', revenue: 200000, sponsorCount: 4 },
    ],
    ...overrides,
  });

  let fixture: ComponentFixture<EventDetailDrawerComponent>;
  let getEventDetail: ReturnType<typeof vi.fn>;

  async function setup(impl: ReturnType<typeof vi.fn>): Promise<void> {
    getEventDetail = impl;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventDetailDrawerComponent],
      // p-drawer uses synthetic animations; without a noop animations provider every render
      // through the drawer throws NG05105 before any assertion runs.
      providers: [{ provide: AnalyticsService, useValue: { getEventDetail } }, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDetailDrawerComponent);
  }

  /** Mirrors the parent: two separate signal writes per open, eventId first. */
  async function open(eventId: string, slug = 'tlf'): Promise<void> {
    fixture.componentRef.setInput('eventId', eventId);
    fixture.componentRef.setInput('foundationSlug', slug);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return document.body.textContent ?? '';
  }

  it('does not fetch until the drawer is opened', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    fixture.componentRef.setInput('eventId', 'evt-1');
    fixture.componentRef.setInput('foundationSlug', 'tlf');
    await fixture.whenStable();

    expect(getEventDetail).not.toHaveBeenCalled();
  });

  it('loads the event on open and passes the foundation slug', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1');

    expect(getEventDetail).toHaveBeenCalledWith('evt-1', 'tlf');
    expect(text()).toContain('KubeCon NA');
  });

  // The parent sets eventId and visible in two separate writes; without deduping the pair
  // one open would fire two identical requests.
  it('issues a single request per open', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1');

    expect(getEventDetail).toHaveBeenCalledTimes(1);
  });

  // The drawer stays open while the user clicks a different roster row. Reacting only to
  // `visible` left the previous event's numbers on screen under the new event's name.
  it('reloads when a different event is selected while already open', async () => {
    await setup(vi.fn().mockImplementation((id: string) => of(detail({ eventId: id, eventName: id === 'evt-1' ? 'KubeCon NA' : 'Open Source Summit' }))));

    await open('evt-1');
    expect(text()).toContain('KubeCon NA');

    fixture.componentRef.setInput('eventId', 'evt-2');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventDetail).toHaveBeenLastCalledWith('evt-2', 'tlf');
    expect(text()).toContain('Open Source Summit');
    expect(text()).not.toContain('KubeCon NA');
  });

  it('renders the empty state when the event genuinely has no detail', async () => {
    await setup(vi.fn().mockReturnValue(of(null)));

    await open('evt-1');

    expect(document.querySelector('[data-testid="event-detail-empty"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-error"]')).toBeNull();
  });

  // A failure and a genuine no-detail both leave detail() null; only one should tell the user
  // something went wrong, otherwise an outage reads as "this event has no data".
  it('distinguishes a load failure from a missing event', async () => {
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('boom'))));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await open('evt-1');

    expect(document.querySelector('[data-testid="event-detail-error"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-empty"]')).toBeNull();
  });

  it('clears the skeleton after a failed load', async () => {
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('boom'))));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await open('evt-1');

    expect(document.querySelector('[data-testid="event-detail-skeleton"]')).toBeNull();
  });

  // The roster's bars already expose progressbar semantics; the drawer shows the same metrics
  // and must not be the one place AT can't read completion.
  it('exposes both goal bars to assistive technology', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1');

    const bars = document.querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(2);
    // 900/1000 registrations, 500000/1000000 sponsorship.
    expect(bars[0].getAttribute('aria-valuenow')).toBe('90');
    expect(bars[1].getAttribute('aria-valuenow')).toBe('50');
    for (const bar of Array.from(bars)) {
      expect(bar.getAttribute('aria-valuemin')).toBe('0');
      expect(bar.getAttribute('aria-valuemax')).toBe('100');
      expect(bar.getAttribute('aria-label')).toBeTruthy();
    }
  });

  // The bar colours read the same shared thresholds as the roster's bar and at-risk icon, so
  // tuning either constant moves both views together instead of letting them disagree.
  it('colours the goal bars from the shared thresholds', async () => {
    // 800/1000 = 80%, exactly the on-track boundary; 400/1000 = 40%, below the behind-goal one.
    await setup(vi.fn().mockReturnValue(of(detail({ registrations: { actual: 800, goal: 1000 }, sponsorshipRevenue: { actual: 400000, goal: 1000000 } }))));

    await open('evt-1');

    const bars = document.querySelectorAll('[role="progressbar"]');
    expect(bars[0].classList.contains('bg-emerald-500')).toBe(true);
    expect(bars[1].classList.contains('bg-red-400')).toBe(true);
  });

  it('renders the sponsorship tier breakdown', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1');

    expect(document.querySelector('[data-testid="event-detail-tier-Diamond"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-tier-Gold"]')).toBeTruthy();
  });

  it('labels an unnamed tier rather than rendering a blank row', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ sponsorshipTiers: [{ tier: '', revenue: 1000, sponsorCount: 1 }] }))));

    await open('evt-1');

    expect(text()).toContain('Other');
  });
});
