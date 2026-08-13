// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PAID_CAMPAIGN_LIMIT } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventDetailDrawerComponent } from './event-detail-drawer.component';

import type { EventDetailResponse, EventDrawerFocus } from '@lfx-one/shared/interfaces';

describe('EventDetailDrawerComponent', () => {
  const detail = (overrides: Partial<EventDetailResponse> = {}): EventDetailResponse => ({
    eventId: 'evt-1',
    eventName: 'KubeCon NA',
    startDate: '2026-11-10',
    isPast: false,
    location: 'Salt Palace Convention Center',
    city: 'Salt Lake City',
    country: 'United States',
    status: 'Active',
    eventUrl: 'https://events.example.org/kubecon',
    registrations: { actual: 900, goal: 1000 },
    registrationRevenue: { actual: null, goal: 0 },
    sponsorshipRevenue: { actual: 500000, goal: 1000000 },
    vsLastYear: 1.1,
    hasPriorYear: true,
    compScore: 'high',
    cfpStatus: 'Review Complete',
    sponsorshipTiers: [
      { tier: 'Diamond', revenue: 300000, sponsorCount: 2 },
      { tier: 'Gold', revenue: 200000, sponsorCount: 4 },
    ],
    channels: [],
    paidCampaigns: [],
    emailCampaigns: [],
    pacing: { available: false, daysLeft: null, current: null, priorYear: null, predictedAvg: null, predictedLow: null, predictedHigh: null, points: [] },
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
      providers: [{ provide: AnalyticsService, useValue: { getEventDetail } }, provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDetailDrawerComponent);
  }

  /**
   * Mirrors the parent: two separate signal writes per open, eventId first. `focus` selects which
   * half of the story renders — 'b2c' (the default) shows registrations and campaigns, 'b2b' shows
   * sponsorship, so a sponsorship assertion has to open the drawer the way the sponsorship bar does.
   */
  async function open(eventId: string, slug = 'tlf', focus: EventDrawerFocus = 'b2c'): Promise<void> {
    fixture.componentRef.setInput('eventId', eventId);
    fixture.componentRef.setInput('foundationSlug', slug);
    fixture.componentRef.setInput('focus', focus);
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
  // The breakdowns only ever rendered against empty arrays, so the totals, the truncation labels
  // and the collapse toggle could all regress while this suite stayed green.
  describe('paid and email breakdowns', () => {
    const paid = (name: string, spend: number, conversions: number) => ({
      name,
      platform: 'Google Ads',
      spend,
      conversions,
      clicks: 100,
      impressions: 1000,
      cpa: conversions > 0 ? spend / conversions : null,
    });

    it('sums spend and conversions across the campaigns it received', async () => {
      await setup(vi.fn().mockReturnValue(of(detail({ paidCampaigns: [paid('A', 6000, 3), paid('B', 4000, 1)] }))));
      await open('evt-1');

      // $10K total, and a blended CPA of 10000/4 = $2.5K — derived, not read off any single row.
      expect(text()).toContain('$10K');
      expect(text()).toContain('$2.5K');
    });

    // The cap is the reason the label exists: below it the header states a plain count, at it the
    // header must say the summary covers only the rows shown.
    it('labels a capped list as a top-N view rather than a complete count', async () => {
      const many = Array.from({ length: PAID_CAMPAIGN_LIMIT }, (_, i) => paid(`C${i}`, 100, 1));
      await setup(vi.fn().mockReturnValue(of(detail({ paidCampaigns: many }))));
      await open('evt-1');

      expect(text()).toContain('by spend');
    });

    it('states a plain campaign count when nothing was truncated', async () => {
      await setup(vi.fn().mockReturnValue(of(detail({ paidCampaigns: [paid('A', 100, 1), paid('B', 50, 1)] }))));
      await open('evt-1');

      expect(text()).toContain('2 campaigns');
      expect(text()).not.toContain('by spend');
    });

    // Rates are recomputed from the summed counts, not averaged across campaigns — averaging would
    // weight a 50-send email the same as a 50,000-send one.
    it('recomputes email open rate from the summed counts', async () => {
      await setup(
        vi.fn().mockReturnValue(
          of(
            detail({
              emailCampaigns: [
                { name: 'Big', sends: 10000, opens: 5000, clicks: 100, openRate: 50, ctr: 1 },
                { name: 'Small', sends: 100, opens: 10, clicks: 1, openRate: 10, ctr: 1 },
              ],
            })
          )
        )
      );
      await open('evt-1');

      // 5010/10100 = 49.6%, not the 30% a naive average of 50 and 10 would give.
      expect(text()).toContain('49.6%');
    });
  });

  it('exposes the registration goal bar to assistive technology', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1');

    // Only registrations renders as a bar in this layout; sponsorship is a figure, not a meter.
    const bars = document.querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('aria-valuenow')).toBe('90');
    expect(bars[0].getAttribute('aria-valuemin')).toBe('0');
    expect(bars[0].getAttribute('aria-valuemax')).toBe('100');
    expect(bars[0].getAttribute('aria-label')).toBeTruthy();
  });

  // The bar colours read the same shared thresholds as the roster's bar and at-risk icon, so
  // tuning either constant moves both views together instead of letting them disagree.
  it('colours the goal bar green at exactly the on-track threshold', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ registrations: { actual: 800, goal: 1000 } }))));

    await open('evt-1');

    expect(document.querySelector('[role="progressbar"]')?.classList.contains('bg-emerald-500')).toBe(true);
  });

  it('colours the goal bar red below the behind-goal threshold', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ registrations: { actual: 400, goal: 1000 } }))));

    await open('evt-1');

    expect(document.querySelector('[role="progressbar"]')?.classList.contains('bg-red-400')).toBe(true);
  });

  // hasPriorYear and vsLastYear are separate facts. Claiming "no prior year" when a prior edition
  // exists contradicts the pacing block below, which shows a Last year figure for the same event.
  it('says no comparison rather than no prior year when the ratio is missing', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ vsLastYear: null, hasPriorYear: true }))));

    await open('evt-1');

    expect(text()).toContain('no comparison available');
    expect(text()).not.toContain('no prior year');
  });

  it('says no prior year when there genuinely was no prior edition', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ vsLastYear: null, hasPriorYear: false }))));

    await open('evt-1');

    expect(text()).toContain('no prior year');
  });

  it('renders the sponsorship tier breakdown', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1', 'tlf', 'b2b');

    expect(document.querySelector('[data-testid="event-detail-tier-Diamond"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-tier-Gold"]')).toBeTruthy();
  });

  const paidRow = (name: string, spend: number, conversions: number) => ({
    name,
    platform: 'Google Ads',
    spend,
    conversions,
    clicks: 100,
    impressions: 1000,
    cpa: conversions > 0 ? spend / conversions : null,
  });
  const emailRow = (name: string, sends: number) => ({ name, sends, opens: sends / 2, clicks: 10, openRate: 50, ctr: 2 });

  // The focus input is the whole point of opening from a specific roster bar: clicking
  // registrations must not land the user in the sponsorship story, and vice versa. Asserted in
  // both directions so a later default change cannot quietly collapse the two views into one.
  it('hides the sponsorship story in the attendance view', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1', 'tlf', 'b2c');

    // The tier table carries the sponsor names, so its absence is what proves the story is hidden.
    expect(document.querySelector('[data-testid="event-detail-tier-Diamond"]')).toBeNull();
  });

  // document, not fixture.nativeElement: the drawer renders into an overlay outside the fixture
  // host, so a fixture-scoped query returns null regardless and the assertion passes vacuously.
  it('hides the paid and email breakdowns in the sponsorship view', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ paidCampaigns: [paidRow('A', 100, 1)], emailCampaigns: [emailRow('E', 500)] }))));

    await open('evt-1', 'tlf', 'b2b');

    expect(document.querySelector('[data-testid="event-detail-paid-summary"]')).toBeNull();
    expect(document.querySelector('[data-testid="event-detail-email-summary"]')).toBeNull();
  });

  it('shows the paid and email breakdowns in the attendance view', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ paidCampaigns: [paidRow('A', 100, 1)], emailCampaigns: [emailRow('E', 500)] }))));

    await open('evt-1', 'tlf', 'b2c');

    expect(document.querySelector('[data-testid="event-detail-paid-summary"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-email-summary"]')).toBeTruthy();
  });

  // Every section has to follow the focus, not just the breakdowns: pacing and registration
  // sources are attendance, revenue and tiers are sponsorship. Leaving any of them ungated means
  // a sponsorship-bar click still lands the reader in the attendance story.
  // document, not fixture.nativeElement: the drawer renders into an overlay outside the fixture's
  // host, so a fixture-scoped query returns null for everything and the assertion passes vacuously.
  it('hides the attendance-only sections in the sponsorship view', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1', 'tlf', 'b2b');

    expect(document.querySelector('[data-testid="event-detail-tiers"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-pacing"]')).toBeNull();
    expect(document.querySelector('[data-testid="event-detail-channels"]')).toBeNull();
    // The headline cards follow the focus too — a sponsorship view showing a Registrations card
    // puts the two stories back side by side, which is what the split exists to separate.
    expect(text()).not.toContain('Registrations');
    expect(text()).toContain('Sponsorship revenue');
    // Mirror of the above: the sponsorship view keeps the card, without the registration column.
    expect(text()).not.toContain('Registration revenue');
  });

  // The event page is a general action, not part of either half. It briefly lived inside the
  // attendance-gated pacing block, which removed it entirely from a sponsorship-bar open.
  it('keeps the event page link in both focus views', async () => {
    for (const focus of ['b2c', 'b2b'] as const) {
      await setup(vi.fn().mockReturnValue(of(detail())));
      await open('evt-1', 'tlf', focus);

      expect(document.querySelector('[data-testid="event-detail-event-link"]')).toBeTruthy();
    }
  });

  // The range is suppressed at the precision the reader sees, not at raw-float precision. Both
  // ends render through metricCount, which rounds, so 472.6–473.2 passes a `low !== high` test
  // and then prints "(473–473)" — exactly the non-forecast the suppression exists to hide. The
  // model emits fractional counts, so sub-unit intervals are the expected shape here.
  it('hides a predicted range that collapses once rounded for display', async () => {
    await setup(
      vi.fn().mockReturnValue(
        of(
          detail({
            pacing: {
              available: true,
              daysLeft: 30,
              current: 473,
              priorYear: null,
              predictedAvg: 473,
              predictedLow: 472.6,
              predictedHigh: 473.2,
              points: [],
            },
          })
        )
      )
    );
    await open('evt-1', 'tlf', 'b2c');

    const text = document.querySelector('[data-testid="event-detail-pacing"]')?.textContent ?? '';
    expect(text).toContain('Predicted');
    expect(text).not.toContain('473–473');
  });

  // The mirror: a range wider than one whole registration is a real forecast and must survive.
  it('shows a predicted range that stays distinct after rounding', async () => {
    await setup(
      vi.fn().mockReturnValue(
        of(
          detail({
            pacing: {
              available: true,
              daysLeft: 30,
              current: 473,
              priorYear: null,
              predictedAvg: 500,
              predictedLow: 450,
              predictedHigh: 550,
              points: [],
            },
          })
        )
      )
    );
    await open('evt-1', 'tlf', 'b2c');

    const text = document.querySelector('[data-testid="event-detail-pacing"]')?.textContent ?? '';
    expect(text).toContain('450');
    expect(text).toContain('550');
  });

  it('hides the sponsorship-only sections in the attendance view', async () => {
    await setup(vi.fn().mockReturnValue(of(detail())));

    await open('evt-1', 'tlf', 'b2c');

    expect(document.querySelector('[data-testid="event-detail-pacing"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="event-detail-tiers"]')).toBeNull();
    expect(text()).toContain('Registrations');
    // The Revenue card serves both halves, so it stays — but only the registration column.
    expect(document.querySelector('[data-testid="event-detail-revenue"]')).toBeTruthy();
    expect(text()).toContain('Registration revenue');
    expect(text()).not.toContain('Sponsorship revenue');
  });

  it('labels an unnamed tier rather than rendering a blank row', async () => {
    await setup(vi.fn().mockReturnValue(of(detail({ sponsorshipTiers: [{ tier: '', revenue: 1000, sponsorCount: 1 }] }))));

    await open('evt-1', 'tlf', 'b2b');

    expect(text()).toContain('Other');
  });
});
