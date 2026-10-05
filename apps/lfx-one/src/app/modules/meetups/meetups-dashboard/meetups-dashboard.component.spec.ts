// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MeetupsService } from '@app/shared/services/meetups.service';
import { SelectComponent } from '@components/select/select.component';
import { EMPTY_MEETUP_FILTER_OPTIONS, EMPTY_MY_MEETUPS_RESPONSE } from '@lfx-one/shared/constants';
import { GetMyMeetupsParams, MeetupFilterOptionsResponse, MyMeetupsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetupsTopBarComponent } from './components/meetups-top-bar/meetups-top-bar.component';
import { MeetupsDashboardComponent } from './meetups-dashboard.component';

async function renderScopedFilters() {
  const requests: Subject<MeetupFilterOptionsResponse>[] = [];
  await TestBed.configureTestingModule({
    imports: [MeetupsDashboardComponent],
    providers: [
      provideNoopAnimations(),
      MessageService,
      {
        provide: MeetupsService,
        useValue: {
          getMyMeetups: (params: GetMyMeetupsParams) => {
            if (params.pageSize === 1) return of<MyMeetupsResponse>({ ...EMPTY_MY_MEETUPS_RESPONSE, pageSize: 1 });
            return of<MyMeetupsResponse>({
              data: [
                {
                  id: 'test-meetup',
                  name: 'Test Meetup',
                  community: 'Own Community',
                  startDate: '2026-11-10T00:00:00Z',
                  date: 'Nov 10, 2026',
                  location: 'Online',
                  role: 'Attendee',
                  status: 'Registered',
                  groupSlug: 'test-group',
                  eventSlug: 'test-meetup',
                  url: 'https://ocgroups.example/meetup',
                },
              ],
              total: 2,
              offset: params.offset ?? 0,
              pageSize: params.pageSize ?? 10,
            });
          },
          getMeetupFilters: () => {
            const request = new Subject<MeetupFilterOptionsResponse>();
            requests.push(request);
            return request;
          },
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(MeetupsDashboardComponent);
  await fixture.whenStable();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0].next({ communities: ['Own Community', 'Other Community'], roles: ['Attendee'] });
  requests[0].complete();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const topBar = fixture.debugElement.query(By.directive(MeetupsTopBarComponent)).componentInstance as MeetupsTopBarComponent;
  const communitySelect = fixture.debugElement.queryAll(By.directive(SelectComponent))[0].componentInstance as SelectComponent;
  const community = topBar.searchForm.get('community')!;
  return { fixture, root, topBar, communitySelect, community, requests };
}

describe('MeetupsDashboardComponent registration-delay hint', () => {
  it.each(['focus', 'mouseenter'])('shows the delay explanation on %s', async (event) => {
    await TestBed.configureTestingModule({
      imports: [MeetupsDashboardComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        {
          provide: MeetupsService,
          useValue: {
            getMyMeetups: () => of(EMPTY_MY_MEETUPS_RESPONSE),
            getMeetupFilters: () => of(EMPTY_MEETUP_FILTER_OPTIONS),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MeetupsDashboardComponent);
    await fixture.whenStable();
    const hint = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="meetups-registration-delay-hint"]')!;
    if (event === 'focus') {
      hint.focus();
    } else {
      hint.dispatchEvent(new MouseEvent('mouseenter'));
    }
    await vi.waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('It can take a while to show up here.');
    });
  });
});

describe('MeetupsDashboardComponent scoped Community loading', () => {
  it.each(['success', 'error'])('blocks stale Community choices and silently re-enables after %s', async (outcome) => {
    const { fixture, root, topBar, communitySelect, community, requests } = await renderScopedFilters();
    community.setValue('Other Community');
    await fixture.whenStable();
    const communityChanges = vi.fn();
    topBar.communityChange.subscribe(communityChanges);
    root.querySelector<HTMLButtonElement>('[data-testid="filter-pill-registered"]')!.click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(community.value).toBeNull();
    expect(community.disabled).toBe(true);
    expect(communitySelect.loading()).toBe(true);
    expect(topBar.searchForm.get('role')!.enabled).toBe(true);
    expect(communityChanges).not.toHaveBeenCalled();

    if (outcome === 'success') {
      requests[1].next({ communities: ['Own Community'], roles: ['Attendee'] });
      requests[1].complete();
    } else {
      requests[1].error(new Error('Scoped filters unavailable'));
    }
    await fixture.whenStable();
    expect(community.enabled).toBe(true);
    expect(communitySelect.loading()).toBe(false);
    expect(community.value).toBeNull();
    expect(communitySelect.options()).not.toContainEqual({ label: 'Other Community', value: 'Other Community' });
    expect(communityChanges).not.toHaveBeenCalled();
  });

  it('keeps Community disabled for the latest scope when a pending request is cancelled', async () => {
    const { fixture, root, communitySelect, community, requests } = await renderScopedFilters();
    root.querySelector<HTMLButtonElement>('[data-testid="filter-pill-registered"]')!.click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    root.querySelector<HTMLButtonElement>('[data-testid="filter-pill-all"]')!.click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(community.disabled).toBe(true);
    expect(communitySelect.loading()).toBe(true);

    requests[1].next({ communities: ['Stale Community'], roles: ['Attendee'] });
    requests[1].complete();
    await fixture.whenStable();
    expect(community.disabled).toBe(true);
    expect(communitySelect.options()).not.toContainEqual({ label: 'Stale Community', value: 'Stale Community' });

    requests[2].next({ communities: ['Current Community'], roles: ['Attendee'] });
    requests[2].complete();
    await fixture.whenStable();
    expect(community.enabled).toBe(true);
    expect(communitySelect.loading()).toBe(false);
    expect(communitySelect.options()).toContainEqual({ label: 'Current Community', value: 'Current Community' });
  });
});
