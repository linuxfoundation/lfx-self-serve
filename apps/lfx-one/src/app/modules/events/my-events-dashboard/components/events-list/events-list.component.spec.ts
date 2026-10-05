// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EventsService } from '@app/shared/services/events.service';
import type { GetMyEventsParams, MyEventsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventsListComponent } from './events-list.component';

async function render({ synchronousError = false } = {}) {
  const registeredStats = new Subject<MyEventsResponse>();
  const messages = { add: vi.fn() };
  const eventsService = {
    getMyEvents: vi.fn((params: GetMyEventsParams) => {
      if (params.pageSize === 1 && params.registeredOnly) {
        return synchronousError ? throwError(() => new Error('Count unavailable')) : registeredStats;
      }
      return of({ data: [], total: params.pageSize === 1 && !params.isPast ? 3 : 0, offset: 0, pageSize: params.pageSize ?? 10 });
    }),
  };
  await TestBed.configureTestingModule({
    imports: [EventsListComponent],
    providers: [provideNoopAnimations(), { provide: EventsService, useValue: eventsService }, { provide: MessageService, useValue: messages }],
  }).compileComponents();
  const fixture = TestBed.createComponent(EventsListComponent);
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
