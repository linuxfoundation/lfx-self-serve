// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MeetupsService } from '@app/shared/services/meetups.service';
import { GetMyMeetupsParams, MyMeetupsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetupsTableComponent } from '../meetups-table/meetups-table.component';
import { MeetupsListComponent } from './meetups-list.component';

async function render({ synchronousCountError = false, listError = false, empty = false } = {}) {
  const count = new Subject<MyMeetupsResponse>();
  const messages = { add: vi.fn() };
  let failList = listError;
  const service = {
    getMyMeetups: vi.fn((params: GetMyMeetupsParams) => {
      if (params.pageSize === 1) return synchronousCountError ? throwError(() => new Error('Count unavailable')) : count;
      if (failList && !params.isPast) return throwError(() => new Error('List unavailable'));
      return of<MyMeetupsResponse>({
        data: empty
          ? []
          : [
              {
                id: 'meetup-1',
                name: 'Example Meetup',
                community: 'Example Community',
                startDate: '2026-11-10T00:00:00.000Z',
                date: 'Nov 10, 2026',
                location: 'Online',
                role: 'Attendee',
                status: 'Registered',
                groupSlug: 'example-group',
                eventSlug: 'example-meetup',
                url: 'https://ocgroups.example/meetup',
              },
            ],
        total: empty ? 0 : 30,
        offset: params.offset ?? 0,
        pageSize: params.pageSize ?? 10,
      });
    }),
  };
  await TestBed.configureTestingModule({
    imports: [MeetupsListComponent],
    providers: [provideNoopAnimations(), { provide: MeetupsService, useValue: service }, { provide: MessageService, useValue: messages }],
  }).compileComponents();
  const fixture = TestBed.createComponent(MeetupsListComponent);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const calls = () => service.getMyMeetups.mock.calls.map(([params]) => params).filter((params) => !params.isPast && params.pageSize !== 1);
  const pill = (id: string) => root.querySelector<HTMLButtonElement>(`[data-testid="meetups-upcoming-view-pills"] [data-testid="filter-pill-${id}"]`)!;
  const settle = async () => {
    await fixture.whenStable();
    await vi.waitFor(() => expect(calls().length).toBeGreaterThan(0));
  };
  const resolveCount = async (total: number) => {
    count.next({ data: [], total, offset: 0, pageSize: 1 });
    count.complete();
    await settle();
  };
  const failCount = async () => {
    count.error(new Error('Count unavailable'));
    await settle();
  };
  const changePage = async () => {
    const table = fixture.debugElement.query(By.directive(MeetupsTableComponent)).componentInstance as MeetupsTableComponent;
    table.pageChange.emit({ offset: 10, pageSize: 10 });
    await fixture.whenStable();
    await vi.waitFor(() => expect(calls().at(-1)?.offset).toBe(10));
  };
  return {
    fixture,
    root,
    messages,
    service,
    calls,
    pill,
    resolveCount,
    failCount,
    changePage,
    fail: () => {
      failList = true;
    },
    recover: () => {
      failList = false;
    },
  };
}

describe('MeetupsListComponent registration views', () => {
  it('waits for the count before making the first Upcoming list request', async () => {
    const { root, calls, service } = await render();
    expect(service.getMyMeetups.mock.calls[0][0]).toEqual({ isPast: false, offset: 0, pageSize: 1, status: 'registered' });
    expect(calls()).toHaveLength(0);
    expect(root.querySelector('[data-testid="meetups-upcoming-view-pills"]')).toBeNull();
  });

  it.each([
    { total: 0, view: 'all', status: undefined },
    { total: 2, view: 'registered', status: 'registered' },
  ])('defaults to $view for count=$total with one list fetch', async ({ total, view, status }) => {
    const { calls, pill, messages, resolveCount } = await render();
    await resolveCount(total);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].status).toBe(status);
    expect(pill(view).getAttribute('aria-pressed')).toBe('true');
    expect(messages.add).not.toHaveBeenCalled();
  });

  it('keeps registrations and notifies the user after a count failure without a list-error panel', async () => {
    const { calls, root, messages, failCount } = await render();
    await failCount();
    expect(calls()[0].status).toBe('registered');
    expect(root.querySelector('[data-testid="meetups-upcoming-error-state"]')).toBeNull();
    expect(messages.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Failed to load registration totals. Upcoming defaults to My Registrations.' })
    );
  });

  it('handles a synchronously failed count without briefly fetching All Meetups', async () => {
    const { fixture, calls } = await render({ synchronousCountError: true });
    await fixture.whenStable();
    await vi.waitFor(() => expect(calls()).toHaveLength(1));
    expect(calls()[0].status).toBe('registered');
  });

  it('resets pagination on a pill click and restores the default after switching tabs', async () => {
    const { fixture, calls, pill, resolveCount, changePage } = await render();
    await resolveCount(2);
    await changePage();
    pill('all').click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(calls().at(-1)).toMatchObject({ offset: 0, status: undefined }));
    fixture.componentRef.setInput('activeTab', 'past');
    await fixture.whenStable();
    fixture.componentRef.setInput('activeTab', 'upcoming');
    await fixture.whenStable();
    await vi.waitFor(() => expect(calls().at(-1)?.status).toBe('registered'));
    expect(pill('registered').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers discovery from a successful empty registration list', async () => {
    const { fixture, root, calls, resolveCount } = await render({ empty: true });
    await resolveCount(2);
    const emptyState = root.querySelector<HTMLElement>('[data-testid="meetups-upcoming-registered-empty-state"]')!;
    expect(emptyState.textContent).toContain('No upcoming registrations');
    emptyState.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(calls().at(-1)?.status).toBeUndefined());
    expect(root.querySelector('[data-testid="meetups-all-caption"]')?.textContent).toContain('next 50');
  });

  it('keeps the filtered no-results state distinct from no registrations', async () => {
    const { fixture, root, resolveCount } = await render({ empty: true });
    fixture.componentRef.setInput('searchQuery', 'missing meetup');
    await resolveCount(2);
    expect(root.querySelector('[data-testid="meetups-upcoming-empty-state"]')?.textContent).toContain('Reset filters');
    expect(root.querySelector('[data-testid="meetups-upcoming-registered-empty-state"]')).toBeNull();
  });

  it('shows Retry rather than a fake empty state and recovers with the same parameters', async () => {
    const { fixture, root, calls, messages, resolveCount, fail, recover, changePage } = await render();
    await resolveCount(2);
    fixture.componentRef.setInput('community', 'Example Community');
    fixture.componentRef.setInput('role', 'Attendee');
    fixture.componentRef.setInput('searchQuery', 'Example');
    await fixture.whenStable();
    await changePage();
    const table = fixture.debugElement.query(By.directive(MeetupsTableComponent)).componentInstance as MeetupsTableComponent;
    table.sortChange.emit({ field: 'EVENT_NAME' });
    await fixture.whenStable();
    await changePage();
    const request = { ...calls().at(-1)! };
    fail();
    table.pageChange.emit({ offset: 10, pageSize: 10 });
    await fixture.whenStable();
    await vi.waitFor(() => expect(root.querySelector('[data-testid="meetups-upcoming-error-state"]')).not.toBeNull());
    expect(root.querySelector('[data-testid="meetups-upcoming-empty-state"]')).toBeNull();
    expect(root.querySelector('[data-testid="meetups-upcoming-registered-empty-state"]')).toBeNull();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Failed to load meetups. Please try again.' }));
    recover();
    root.querySelector<HTMLButtonElement>('[data-testid="meetups-upcoming-error-state"] button')!.click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(root.querySelector('[data-testid="meetups-upcoming-error-state"]')).toBeNull());
    expect(calls().at(-1)).toEqual(request);
    expect(root.textContent).toContain('Example Meetup');
  });
});
