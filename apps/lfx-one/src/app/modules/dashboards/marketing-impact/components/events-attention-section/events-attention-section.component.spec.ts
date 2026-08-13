// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventsAttentionSectionComponent } from './events-attention-section.component';

import type { EventRosterResponse, EventRosterRow } from '@lfx-one/shared/interfaces';

describe('EventsAttentionSectionComponent', () => {
  const row = (overrides: Partial<EventRosterRow> = {}): EventRosterRow => ({
    eventId: 'evt-1',
    eventName: 'KubeCon NA',
    startDate: '2026-11-10',
    isPast: false,
    country: 'United States',
    eventUrl: 'https://events.example.org/kubecon',
    registrations: { actual: 100, goal: 1000 },
    sponsorshipRevenue: { actual: 0, goal: 0 },
    vsLastYear: null,
    compScore: 'low',
    cfpStatus: '',
    ...overrides,
  });

  let fixture: ComponentFixture<EventsAttentionSectionComponent>;

  // `slug` is deliberately not a defaulted parameter — an explicit `undefined` must mean
  // "no foundation", which a default value would silently override.
  async function render(events: EventRosterRow[], slug: string | undefined): Promise<void> {
    const response: EventRosterResponse = { projectId: 'proj-1', events };
    const getEventRoster = vi.fn().mockReturnValue(of(response));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventsAttentionSectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventRoster } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsAttentionSectionComponent);
    fixture.componentRef.setInput('foundationSlug', slug);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function items(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="events-attention-item-"]'));
  }

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  describe('which events qualify', () => {
    // At-risk needs BOTH conditions; each of the next cases holds one back.
    it('includes an event behind goal and pacing low', async () => {
      await render([row()], 'tlf');

      expect(items()).toHaveLength(1);
    });

    it('excludes an event behind goal but pacing well', async () => {
      await render([row({ compScore: 'high' })], 'tlf');

      expect(items()).toHaveLength(0);
    });

    it('excludes an event pacing low but tracking near its goal', async () => {
      await render([row({ registrations: { actual: 900, goal: 1000 } })], 'tlf');

      expect(items()).toHaveLength(0);
    });

    // No goal means there is nothing to be behind on — not 0% attained.
    it('excludes an event with no registration goal', async () => {
      await render([row({ registrations: { actual: 0, goal: 0 } })], 'tlf');

      expect(items()).toHaveLength(0);
    });

    // The threshold is "below 50", so exactly 50% is not yet behind goal.
    it('treats exactly the behind-goal threshold as on track', async () => {
      await render([row({ registrations: { actual: 500, goal: 1000 } })], 'tlf');

      expect(items()).toHaveLength(0);
    });

    it('renders nothing when the roster is empty', async () => {
      await render([], 'tlf');

      expect(items()).toHaveLength(0);
    });
  });

  describe('ranking', () => {
    it('surfaces at most three events, furthest behind first', async () => {
      await render(
        [
          row({ eventId: 'a', eventName: 'A', registrations: { actual: 400, goal: 1000 } }),
          row({ eventId: 'b', eventName: 'B', registrations: { actual: 50, goal: 1000 } }),
          row({ eventId: 'c', eventName: 'C', registrations: { actual: 200, goal: 1000 } }),
          row({ eventId: 'd', eventName: 'D', registrations: { actual: 300, goal: 1000 } }),
        ],
        'tlf'
      );

      // Ranking is unchanged — furthest behind first — but the strip now collapses to the first
      // COLLAPSED_COUNT rows behind a "see more" toggle, so only the two worst render initially.
      const ids = items().map((el) => el.getAttribute('data-testid'));
      expect(ids).toEqual(['events-attention-item-b', 'events-attention-item-c']);
      // A at 40% is the least behind of the four, so it is dropped from the ranking entirely —
      // not merely collapsed, which is why expanding below must not surface it.
      expect(text()).not.toContain('A is 40%');
    });

    // The collapse is only half the behaviour: without exercising the toggle, a dead click
    // handler or a third row that never appears would both pass the test above.
    it('reveals the third ranked event on expand and collapses again', async () => {
      await render(
        [
          row({ eventId: 'a', eventName: 'A', registrations: { actual: 400, goal: 1000 } }),
          row({ eventId: 'b', eventName: 'B', registrations: { actual: 50, goal: 1000 } }),
          row({ eventId: 'c', eventName: 'C', registrations: { actual: 200, goal: 1000 } }),
          row({ eventId: 'd', eventName: 'D', registrations: { actual: 300, goal: 1000 } }),
        ],
        'tlf'
      );

      const toggle = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="events-attention-toggle"]');
      expect(toggle()).toBeTruthy();

      toggle().click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(items().map((el) => el.getAttribute('data-testid'))).toEqual(['events-attention-item-b', 'events-attention-item-c', 'events-attention-item-d']);
      // Still capped at MAX_ATTENTION_ITEMS — expanding reveals the ranked remainder, not the
      // events the ranking already excluded.
      expect(text()).not.toContain('A is 40%');

      toggle().click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(items().map((el) => el.getAttribute('data-testid'))).toEqual(['events-attention-item-b', 'events-attention-item-c']);
    });
  });

  describe('severity', () => {
    // WCAG 1.4.1: red vs amber must not be the only signal, so the tag text differs too.
    it('labels a critically behind event distinctly from a merely behind one', async () => {
      await render([row({ registrations: { actual: 100, goal: 1000 } })], 'tlf');
      expect(text()).toContain('CRITICALLY BEHIND GOAL');

      await render([row({ registrations: { actual: 400, goal: 1000 } })], 'tlf');
      expect(text()).toContain('BEHIND GOAL');
      expect(text()).not.toContain('CRITICALLY BEHIND GOAL');
    });

    // Boundary: the escalation is "below 25", so exactly 25% is still a warning.
    it('treats exactly the critical threshold as a warning', async () => {
      await render([row({ registrations: { actual: 250, goal: 1000 } })], 'tlf');

      expect(text()).toContain('BEHIND GOAL');
      expect(text()).not.toContain('CRITICALLY BEHIND GOAL');
    });
  });

  describe('pace line', () => {
    it('omits the vs-last-year clause when there is no baseline', async () => {
      await render([row({ vsLastYear: null })], 'tlf');

      expect(text()).not.toContain('vs last year');
    });

    it('states the pace against last year when a baseline exists', async () => {
      await render([row({ vsLastYear: 0.6 })], 'tlf');

      expect(text()).toContain('-40% vs last year');
    });
  });

  // The host sits in the overview tab's flex column, so an empty strip would otherwise still
  // claim a gap slot above the summary tiles.
  it('drops out of flex layout entirely when there is nothing to show', async () => {
    await render([], 'tlf');

    expect(fixture.nativeElement.style.display).toBe('none');
  });

  it('participates in layout when it has items', async () => {
    await render([row()], 'tlf');

    expect(fixture.nativeElement.style.display).toBe('contents');
  });

  // getEventRoster rethrows by design. An error reaching toSignal poisons the signal, so every
  // later read would throw during change detection and take the whole Overview tab down — this
  // supplementary strip must fail closed instead.
  it('renders nothing when the roster fails rather than breaking the tab', async () => {
    const getEventRoster = vi.fn().mockReturnValue(throwError(() => new Error('boom')));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventsAttentionSectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventRoster } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsAttentionSectionComponent);
    fixture.componentRef.setInput('foundationSlug', 'tlf');
    await fixture.whenStable();
    fixture.detectChanges();

    // Reading these must not throw — that is the regression.
    expect(items()).toHaveLength(0);
    expect(fixture.nativeElement.style.display).toBe('none');
  });

  // toSignal holds the previous roster until the next request emits, so without gating on the
  // loading flag a foundation switch would leave the outgoing foundation's at-risk events on
  // screen — and clickable — under the new foundation's name.
  it('hides the outgoing foundation while the next roster loads', async () => {
    const first: EventRosterResponse = { projectId: 'p1', events: [row({ eventId: 'old', eventName: 'Old Foundation Event' })] };
    const pending = new Subject<EventRosterResponse>();
    const getEventRoster = vi.fn().mockReturnValueOnce(of(first)).mockReturnValueOnce(pending);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventsAttentionSectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventRoster } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsAttentionSectionComponent);
    fixture.componentRef.setInput('foundationSlug', 'tlf');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Old Foundation Event');

    // Switch foundations; the second request has not emitted yet.
    fixture.componentRef.setInput('foundationSlug', 'cncf');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text()).not.toContain('Old Foundation Event');
    expect(fixture.nativeElement.style.display).toBe('none');

    pending.complete();
  });
});
