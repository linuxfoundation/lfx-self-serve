// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { of } from 'rxjs';
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

      const ids = items().map((el) => el.getAttribute('data-testid'));
      expect(ids).toEqual(['events-attention-item-b', 'events-attention-item-c', 'events-attention-item-d']);
      // A at 40% is the least behind of the four, so it is the one dropped.
      expect(text()).not.toContain('A is 40%');
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
});
