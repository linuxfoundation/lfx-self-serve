// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EventsService } from '@app/shared/services/events.service';
import type { EventTabId, GetMyEventsParams, MyEventsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventsListComponent } from './events-list.component';

async function render({
  synchronousError = false,
  allStatsError = false,
  allStatsTotal = 3,
  upcomingResponse,
  activeTab = 'upcoming',
}: {
  activeTab?: EventTabId;
  synchronousError?: boolean;
  allStatsError?: boolean;
  allStatsTotal?: number;
  upcomingResponse?: MyEventsResponse;
} = {}) {
  const registeredStats = new Subject<MyEventsResponse>();
  const messages = { add: vi.fn() };
  const eventsService = {
    getMyEvents: vi.fn((params: GetMyEventsParams) => {
      if (params.pageSize === 1 && params.registeredOnly) {
        return synchronousError ? throwError(() => new Error('Count unavailable')) : registeredStats;
      }
      if (params.pageSize === 1 && !params.isPast) {
        return allStatsError ? throwError(() => new Error('All Events count unavailable')) : of({ data: [], total: allStatsTotal, offset: 0, pageSize: 1 });
      }
      if (!params.isPast && upcomingResponse) {
        return of(upcomingResponse);
      }
      return of({ data: [], total: 0, offset: 0, pageSize: params.pageSize ?? 10 });
    }),
  };
  await TestBed.configureTestingModule({
    imports: [EventsListComponent],
    providers: [provideNoopAnimations(), { provide: EventsService, useValue: eventsService }, { provide: MessageService, useValue: messages }],
  }).compileComponents();
  const fixture = TestBed.createComponent(EventsListComponent);
  fixture.componentRef.setInput('activeTab', activeTab);
  await fixture.whenStable();
  const upcomingCalls = () => eventsService.getMyEvents.mock.calls.map(([params]) => params).filter((params) => !params.isPast && params.pageSize !== 1);
  const pill = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`[data-testid="events-upcoming-view-pills"] [data-testid="filter-pill-${id}"]`)!;
  const resolveCount = async (total: number) => {
    registeredStats.next({ data: [], total, offset: 0, pageSize: 1 });
    registeredStats.complete();
    await fixture.whenStable();
    await vi.waitFor(() => expect(upcomingCalls()).toHaveLength(1));
  };
  const failCount = async () => {
    registeredStats.error(new Error('Count unavailable'));
    await fixture.whenStable();
    await vi.waitFor(() => expect(upcomingCalls()).toHaveLength(1));
  };
  return { fixture, registeredStats, messages, upcomingCalls, pill, resolveCount, failCount };
}

describe('EventsListComponent Upcoming navigation', () => {
  it('keeps view pills and allows switching when All Events stats fail but the registered count succeeds', async () => {
    const { fixture, upcomingCalls, pill, resolveCount } = await render({ allStatsError: true });
    await resolveCount(2);
    expect(pill('registered')).not.toBeNull();
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');

    pill('all').click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(upcomingCalls().at(-1)?.registeredOnly).toBeUndefined());
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps view pills when both counts fail but upcoming registered rows render', async () => {
    const { fixture, pill, failCount } = await render({
      allStatsError: true,
      upcomingResponse: {
        data: [
          {
            id: 'event-1',
            name: 'Example Summit',
            url: 'https://events.example/summit',
            registrationUrl: null,
            foundation: 'Example Foundation',
            startDate: '2026-11-10T00:00:00.000Z',
            date: 'Nov 10, 2026',
            location: 'Online',
            role: 'Attendee',
            status: 'Registered',
            isRegistered: true,
            travelFundEnd: null,
          },
        ],
        total: 1,
        offset: 0,
        pageSize: 10,
      },
    });
    await failCount();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Example Summit');
    expect(pill('registered')).not.toBeNull();
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the upcoming list total even if the current page has no rows and All Events stats fail', async () => {
    const { pill, resolveCount } = await render({
      allStatsError: true,
      upcomingResponse: { data: [], total: 2, offset: 20, pageSize: 10 },
    });
    await resolveCount(0);
    expect(pill('all')).not.toBeNull();
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
  });

  it('hides view pills after successful zero counts and an empty upcoming list', async () => {
    const { fixture, resolveCount } = await render({ allStatsTotal: 0 });
    await resolveCount(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="events-upcoming-view-pills"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="events-upcoming-empty-state"]')).not.toBeNull();
  });
});

describe('EventsListComponent registered-count default', () => {
  it('does not request Upcoming rows while the registered count is pending', async () => {
    const { fixture, upcomingCalls } = await render();
    expect(fixture.componentInstance.upcomingRegisteredOnly()).toBeNull();
    expect(upcomingCalls()).toHaveLength(0);
  });

  it('defaults to My Registrations after a successful positive count', async () => {
    const { upcomingCalls, pill, messages, resolveCount } = await render();
    await resolveCount(2);
    expect(upcomingCalls()[0].registeredOnly).toBe(true);
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');
    expect(messages.add).not.toHaveBeenCalled();
  });

  it('defaults to All Events only after a successful zero count', async () => {
    const { upcomingCalls, pill, messages, resolveCount } = await render();
    await resolveCount(0);
    expect(upcomingCalls()[0].registeredOnly).toBeUndefined();
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
    expect(messages.add).not.toHaveBeenCalled();
  });

  it('retains My Registrations and requests registered rows when the count fails', async () => {
    const { fixture, upcomingCalls, pill, failCount } = await render();
    await failCount();
    expect(fixture.componentInstance.upcomingRegisteredOnly()).toBe(true);
    expect(upcomingCalls()[0].registeredOnly).toBe(true);
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');
  });

  it('notifies the user when registration totals could not be loaded', async () => {
    const { messages, failCount } = await render();
    await failCount();
    expect(messages.add).toHaveBeenCalledTimes(1);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: expect.stringMatching(/registration/i) }));
  });

  it('explains the Upcoming recovery when registration totals fail on the initial Past tab', async () => {
    const { fixture, messages, failCount } = await render({ activeTab: 'past' });
    await failCount();
    expect(fixture.componentInstance.activeTab()).toBe('past');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="events-upcoming-view-pills"]')).toBeNull();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: expect.stringMatching(/Upcoming.*My Registrations/) }));
  });

  it('uses the registered fallback even when the count errors synchronously', async () => {
    const { upcomingCalls, pill } = await render({ synchronousError: true });
    await vi.waitFor(() => expect(upcomingCalls()).toHaveLength(1));
    expect(upcomingCalls()[0].registeredOnly).toBe(true);
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');
  });

  it('allows manual All Events selection after failure and resets to registrations on tab change', async () => {
    const { fixture, upcomingCalls, pill, failCount } = await render();
    await failCount();
    pill('all').click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(upcomingCalls().at(-1)?.registeredOnly).toBeUndefined());
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');

    fixture.componentRef.setInput('activeTab', 'past');
    await fixture.whenStable();
    fixture.componentRef.setInput('activeTab', 'upcoming');
    await fixture.whenStable();
    await vi.waitFor(() => expect(upcomingCalls().at(-1)?.registeredOnly).toBe(true));
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');
  });
});
