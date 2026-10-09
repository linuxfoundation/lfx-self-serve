// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { MeetingCreateMenuComponent } from '@app/modules/meetings/meeting-composer/meeting-create-menu.component';
import { ButtonComponent } from '@components/button/button.component';
import type { Lens, Meeting, MeetingDashboardView, PastMeeting, ProjectContext, User } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsDashboardComponent } from './meetings-dashboard.component';

/** Direct instances avoid FullCalendar rendering while exercising real shared HTTP caches. */
describe('MeetingsDashboardComponent — cached consumers', () => {
  let composer: MeetingComposerService;
  let users: UserService;
  let meetings: MeetingService;
  let http: HttpTestingController;
  let lens: WritableSignal<Lens>;
  let context: WritableSignal<ProjectContext | null>;
  const route = { snapshot: { queryParamMap: convertToParamMap({}) } };
  const flush = (): void => TestBed.tick();
  const ids = (component: MeetingsDashboardComponent): string[] => component.filteredMeetings().map((m) => m.id);
  const row = (id: string, extra: Partial<Meeting> = {}): Meeting =>
    ({
      id,
      title: id,
      start_time: '2099-01-01T10:00:00Z',
      duration: 30,
      timezone: 'UTC',
      project_uid: 'child',
      parent_project_uid: 'foundation',
      meeting_type: 'Technical',
      is_invite_responses_enabled: true,
      my_rsvp: null,
      ...extra,
    }) as Meeting;
  const response = (responseType: 'accepted' | 'declined', scope: 'all' | 'single' = 'all'): NonNullable<Meeting['my_rsvp']> => ({
    id: `r-${responseType}`,
    meeting_id: 'synthetic-series',
    registrant_id: 'synthetic-registrant',
    username: 'viewer',
    email: 'synthetic@example.com',
    created_at: '2098-12-31T00:00:00Z',
    response_type: responseType,
    scope,
  });
  const owned = row('owned', { owner: { username: 'viewer' }, my_rsvp: response('accepted') });
  const pending = row('pending');
  const legacy = row('legacy', { is_invite_responses_enabled: false, organizer: true });
  const past = row('past-other', { start_time: '2098-01-01T10:00:00Z' }) as PastMeeting;
  const select = (component: MeetingsDashboardComponent, view: MeetingDashboardView): void => {
    component.onMeetingViewChange(view);
    flush();
  };
  const mount = (rows: Meeting[] = [owned, pending, legacy]): MeetingsDashboardComponent => {
    const component = TestBed.runInInjectionContext(() => new MeetingsDashboardComponent());
    flush();
    const request = http.expectOne('/api/user/meetings');
    expect(request.request.method).toBe('GET');
    request.flush(rows);
    flush();
    return component;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2098-12-31T10:00:00Z'));
    lens = signal<Lens>('me');
    context = signal<ProjectContext | null>(null);
    route.snapshot.queryParamMap = convertToParamMap({});
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        MeetingComposerService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: LensService, useValue: { activeLens: lens } },
        { provide: ProjectContextService, useValue: { activeContext: context, canWrite: signal(true), canWriteMeetings: signal(true) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true), hasBoardRole: signal(true), hasProjectRole: signal(true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: route },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    users = TestBed.inject(UserService);
    users.user.set({ username: 'alias', 'https://sso.linuxfoundation.org/claims/username': 'viewer' } as User);
    users.authenticated.set(true);
    meetings = TestBed.inject(MeetingService);
    vi.spyOn(meetings, 'clearPastMeetingRecordingCache');
    vi.spyOn(meetings, 'getPastMeetingRecording').mockReturnValue(EMPTY);
    vi.spyOn(meetings, 'getMeetingsByProjectPaginated').mockReturnValue(of({ data: [], page_token: undefined }));
    vi.spyOn(meetings, 'getPastMeetingsByProjectPaginated').mockReturnValue(of({ data: [], page_token: undefined }));
    vi.spyOn(meetings, 'getMeetingsCountByProject').mockReturnValue(of(0));
    vi.spyOn(meetings, 'getPastMeetingsCountByProject').mockReturnValue(of(0));
    composer = TestBed.inject(MeetingComposerService);
    http = TestBed.inject(HttpTestingController);
    flush();
  });
  afterEach(() => {
    for (const request of http.match('/api/profile')) request.flush({ profile: {} });
    http.verify();
    vi.useRealTimers();
  });

  it.each(['upcoming', 'past'] as const)('recovers a failed %s read when a successful save explicitly refreshes the list', (view) => {
    route.snapshot.queryParamMap = convertToParamMap(view === 'past' ? { time: 'past' } : {});
    const component = TestBed.runInInjectionContext(() => new MeetingsDashboardComponent());
    const endpoint = view === 'past' ? '/api/user/past-meetings' : '/api/user/meetings';
    flush();
    http.expectOne(endpoint).flush({}, { status: 500, statusText: 'Internal Server Error' });
    flush();
    expect(ids(component)).toEqual([]);

    composer.notifySaved();
    flush();
    const fresh = view === 'past' ? { ...past, id: 'recovered-past' } : row('recovered-upcoming', { owner: { username: 'viewer' } });
    http.expectOne(endpoint).flush([fresh]);
    flush();
    expect(ids(component)).toEqual([fresh.id]);
    expect(view === 'past' ? component.pastMeetingsLoading() : component.meetingsLoading()).toBe(false);
    if (view === 'upcoming') {
      expect(component['pendingRsvpCount']()).toBe(1);
      expect(component['organizerCount']()).toBe(1);
    }
  });

  it('replaces every view without intersections, including Past to special and repeated summary selection', () => {
    const component = mount();
    expect(component.meetingView()).toBe('upcoming');
    expect(ids(component)).toEqual(['owned', 'pending', 'legacy']);
    select(component, 'organizer');
    expect(ids(component)).toEqual(['owned']);
    component.onPendingRsvpStatClick();
    flush();
    expect(ids(component)).toEqual(['pending']);
    component.onPendingRsvpStatClick();
    flush();
    expect(component.meetingView()).toBe('pending');
    expect(ids(component)).toEqual(['pending']);
    for (const view of ['organizer', 'pending'] as const) {
      select(component, 'past');
      for (const request of http.match('/api/user/past-meetings')) request.flush([past, { ...past, id: 'past-owned', owner: { username: 'viewer' } }]);
      flush();
      expect(ids(component)).toEqual(['past-other', 'past-owned']);
      select(component, view);
      expect(component.timeFilter()).toBe('upcoming');
      expect(ids(component)).toEqual(view === 'pending' ? ['pending'] : ['owned']);
      select(component, view);
      http.expectNone('/api/user/meetings');
      select(component, 'upcoming');
      expect(ids(component)).toEqual(['owned', 'pending', 'legacy']);
    }
    expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { time: null }, queryParamsHandling: 'merge' })
    );
  });

  it.each(['pending', 'organizer'] as const)('uses the upcoming HTTP source when opening %s from a Past deep link', (view) => {
    route.snapshot.queryParamMap = convertToParamMap({ time: 'past', keep: 'yes' });
    const component = TestBed.runInInjectionContext(() => new MeetingsDashboardComponent());
    flush();
    http.expectNone('/api/user/meetings');
    http.expectOne('/api/user/past-meetings').flush([past]);
    flush();
    expect(component.meetingView()).toBe('past');
    expect(ids(component)).toEqual(['past-other']);
    select(component, view);
    http.expectOne('/api/user/meetings').flush([owned, pending]);
    flush();
    expect(ids(component)).toEqual(view === 'pending' ? ['pending'] : ['owned']);
  });

  it('keeps counts before secondary criteria, preserves search/type, clears only time-bound criteria and resets empty views', () => {
    const component = mount([owned, pending, row('other', { project_uid: 'elsewhere', parent_project_uid: 'elsewhere' }), legacy]);
    component.searchQuery.set('pending');
    component.onMeetingTypeChange('Technical');
    component.onFoundationFilterChange('foundation');
    component.onProjectFilterChange('child');
    component.showDeclined.set(true);
    flush();
    vi.advanceTimersByTime(300);
    flush();
    select(component, 'pending');
    expect(ids(component)).toEqual(['pending']);
    expect(component['pendingRsvpCount']()).toBe(2);
    expect(component['organizerCount']()).toBe(1);
    select(component, 'organizer');
    expect(ids(component)).toEqual([]);
    expect(component['isFiltered']()).toBe(true);
    expect([component.foundationFilter(), component.projectFilter(), component.showDeclined()]).toEqual(['foundation', 'child', true]);
    select(component, 'past');
    http.expectOne('/api/user/past-meetings').flush([past]);
    flush();
    expect([component.searchQuery(), component.meetingTypeFilter()]).toEqual(['pending', 'Technical']);
    expect([component.foundationFilter(), component.projectFilter(), component.showDeclined()]).toEqual([null, null, false]);
    component.resetFilters();
    flush();
    vi.advanceTimersByTime(300);
    flush();
    expect(component.meetingView()).toBe('past');
    expect(ids(component)).toEqual(['past-other']);
    for (const view of ['pending', 'organizer'] as const) {
      select(component, view);
      component.onProjectFilterChange('missing');
      flush();
      expect(ids(component)).toEqual([]);
      component.resetFilters();
      flush();
      expect(component.meetingView()).toBe('upcoming');
      expect([
        component.searchQuery(),
        component.meetingTypeFilter(),
        component.foundationFilter(),
        component.projectFilter(),
        component.showDeclined(),
      ]).toEqual(['', null, null, null, false]);
      expect(ids(component)).toEqual(['owned', 'pending', 'other', 'legacy']);
    }
  });

  it('resolves late canonical identity, not a conflicting alias or inherited management, and follows ownership transfer', () => {
    users.user.set({ username: 'alias' } as User);
    flush();
    const component = mount([
      owned,
      row('alias-owned', { owner: { username: 'alias' } }),
      legacy,
      row('creator', { created_by: { username: 'auth0|VIEWER', email: 'synthetic@example.com' } }),
    ]);
    select(component, 'organizer');
    expect(ids(component)).toEqual(['alias-owned']);
    users.user.set({ username: 'alias', 'https://sso.linuxfoundation.org/claims/username': ' Viewer ' } as User);
    flush();
    expect(ids(component)).toEqual(['owned', 'creator']);
    expect(component['organizerCount']()).toBe(2);
    http.expectNone('/api/user/meetings');
    users.refreshUserMeetings();
    http
      .expectOne('/api/user/meetings')
      .flush([
        { ...owned, owner: { username: 'new-owner' }, created_by: { username: 'viewer', email: 'synthetic@example.com' } },
        row('transferred-in', { owner: { username: 'viewer' }, created_by: { username: 'other', email: 'other@example.com' } }),
      ]);
    flush();
    expect(ids(component)).toEqual(['transferred-in']);
    expect(component['organizerCount']()).toBe(1);
  });

  it('settles unresolved organizer membership when a canonical LFID arrives after cached rows', () => {
    users.user.set(null);
    flush();
    const component = mount();
    select(component, 'organizer');
    expect(ids(component)).toEqual([]);
    expect(component['organizerCount']()).toBe(0);
    users.user.set({ 'https://sso.linuxfoundation.org/claims/username': 'viewer' } as User);
    flush();
    expect(ids(component)).toEqual(['owned']);
    expect(component['organizerCount']()).toBe(1);
    http.expectNone('/api/user/meetings');
  });

  it('matches the foundation and its children, but not sub-foundations or unrelated projects', () => {
    const component = mount([
      pending,
      row('foundation', { project_uid: 'foundation', is_foundation: true }),
      row('subfoundation', { project_uid: 'subfoundation', is_foundation: true }),
      row('other', { project_uid: 'other', parent_project_uid: 'unrelated' }),
    ]);
    component.onFoundationFilterChange('foundation');
    flush();
    select(component, 'pending');
    expect(ids(component)).toEqual(['pending', 'foundation']);
    component.onProjectFilterChange('other');
    flush();
    expect(ids(component)).toEqual(['other']);
  });

  it('shows only accepted meetings when the Accepted filter is on, and clears it on reset', () => {
    const component = mount([owned, pending, row('single-declined', { my_rsvp: response('declined', 'single') })]);

    component.acceptedOnly.set(true);
    flush();
    expect(ids(component)).toEqual(['owned']);
    expect(component['acceptedCount']()).toBe(1);

    component.resetFilters();
    flush();
    expect(component.acceptedOnly()).toBe(false);
    expect(ids(component)).toEqual(['owned', 'pending', 'single-declined']);
  });

  it('clears the Accepted filter when switching time tabs', () => {
    const component = mount();
    component.acceptedOnly.set(true);
    flush();
    expect(ids(component)).toEqual(['owned']);

    select(component, 'past');
    http.expectOne('/api/user/past-meetings').flush([past]);
    flush();
    expect(component.acceptedOnly()).toBe(false);
    expect(ids(component)).toEqual(['past-other']);
  });

  it('drops a removed meeting and its counts even when a stale refetch returns it', () => {
    const rows = [owned, pending, row('later', { start_time: '2099-03-01T10:00:00Z', my_rsvp: response('accepted') })];
    const component = mount(rows);
    expect(ids(component)).toEqual(['owned', 'pending', 'later']);
    expect(component['pendingRsvpCount']()).toBe(1);
    expect(component['nextWindowCount']()).toBe(2);

    meetings.markRegistrationRemoved('pending');
    flush();
    expect(ids(component)).toEqual(['owned', 'later']);
    expect(component['pendingRsvpCount']()).toBe(0);
    expect(component['nextWindowCount']()).toBe(1);
    expect(component['organizerCount']()).toBe(1);

    users.refreshUserMeetings();
    http.expectOne('/api/user/meetings').flush(rows);
    flush();
    expect(ids(component)).toEqual(['owned', 'later']);
    expect(component['pendingRsvpCount']()).toBe(0);

    select(component, 'pending');
    expect(ids(component)).toEqual([]);
  });

  it('keeps a removed meeting the viewer organizes', () => {
    const organized = row('organized', { owner: { username: 'viewer' }, organizer: true });
    meetings.markRegistrationRemoved('organized');
    const component = mount([organized, pending]);

    expect(ids(component)).toEqual(['organized', 'pending']);
    expect(component['pendingRsvpCount']()).toBe(2);
    expect(component['organizerCount']()).toBe(1);
    select(component, 'organizer');
    expect(ids(component)).toEqual(['organized']);
  });

  it('preserves series RSVP fallback, cancelled dates, all-date decline exclusion and organizer/single-date exceptions', () => {
    const occurrence = (id: string, status?: string) => ({ occurrence_id: id, start_time: '2099-01-01T12:00:00Z', duration: 30, status });
    const component = mount([
      row('declined', { my_rsvp: response('declined') }),
      row('single', { my_rsvp: response('declined', 'single') }),
      row('organized-declined', { owner: { username: 'viewer' }, my_rsvp: response('declined') }),
      row('series-answered', { occurrences: [occurrence('answered')], my_rsvp: response('accepted', 'single') }),
      row('cancelled', { occurrences: [occurrence('cancelled', 'cancel')] }),
      row('series-pending', { occurrences: [occurrence('cancelled', 'cancel'), occurrence('active')] }),
      row('later', { start_time: '2099-03-01T10:00:00Z', my_rsvp: response('accepted') }),
    ]);
    expect(ids(component)).toEqual(['single', 'organized-declined', 'series-answered', 'series-pending', 'later']);
    expect(component['declinedCount']()).toBe(1);
    expect(component['nextWindowCount']()).toBe(4);
    expect(component['nextMeetingLabel']()).toContain('single');
    expect(component['pendingRsvpCount']()).toBe(1);
    expect(component['organizerCount']()).toBe(1);
    select(component, 'pending');
    expect(ids(component)).toEqual(['series-pending']);
    select(component, 'organizer');
    expect(ids(component)).toEqual(['organized-declined']);
    select(component, 'upcoming');
    component.showDeclined.set(true);
    flush();
    expect(ids(component)).toContain('declined');
    component.resetFilters();
    flush();
    expect(ids(component)).not.toContain('declined');
  });

  it.each(['collection', 'cancellation', 'failure'] as const)('refreshes shared HTTP consumers only after a successful composer %s', (change) => {
    const initial = row('editable', {
      owner: { username: 'viewer' },
      occurrences: [{ occurrence_id: 'date', start_time: '2099-01-01T10:00:00Z', duration: 30 }],
    });
    const component = mount([initial]);
    let cached: Meeting[] = [];
    const upcoming = users.getUserMeetings().subscribe((rows) => (cached = rows));
    const history = users.getUserPastMeetings().subscribe();
    const latest = users.getUserLatestPastMeetings().subscribe();
    http.expectOne('/api/user/past-meetings').flush([past]);
    http.expectOne('/api/user/latest-past-meetings').flush([past]);
    select(component, 'pending');
    expect(ids(component)).toEqual(['editable']);
    const failed = vi.fn();
    meetings
      .updateMeeting('editable', {
        title: 'Edited',
        project_uid: initial.project_uid,
        start_time: initial.start_time,
        duration: initial.duration,
        timezone: initial.timezone,
      })
      .subscribe({ next: () => composer.notifySaved(), error: failed });
    const write = http.expectOne('/api/meetings/editable');
    if (change === 'failure') {
      write.flush({}, { status: 403, statusText: 'Forbidden' });
      flush();
      expect(failed).toHaveBeenCalledOnce();
      expect(composer.saveCount()).toBe(0);
      http.expectNone('/api/user/meetings');
      http.expectNone('/api/user/past-meetings');
      http.expectNone('/api/user/latest-past-meetings');
      expect(ids(component)).toEqual(['editable']);
      expect(component['pendingRsvpCount']()).toBe(1);
      expect(component['organizerCount']()).toBe(1);
      expect(cached).toEqual([initial]);
    } else {
      write.flush(null);
      flush();
      expect(composer.saveCount()).toBe(1);
      const fresh =
        change === 'collection'
          ? { ...initial, is_invite_responses_enabled: false }
          : { ...initial, occurrences: [{ ...initial.occurrences![0], status: 'cancel' }] };
      http.expectOne('/api/user/meetings').flush([fresh]);
      http.expectOne('/api/user/past-meetings').flush([past]);
      http.expectOne('/api/user/latest-past-meetings').flush([past]);
      flush();
      expect(cached).toEqual([fresh]);
      expect(ids(component)).toEqual([]);
      expect(component['pendingRsvpCount']()).toBe(0);
      expect(component['organizerCount']()).toBe(change === 'collection' ? 1 : 0);
      select(component, 'organizer');
      expect(ids(component)).toEqual(change === 'collection' ? ['editable'] : []);
      http.expectNone('/api/user/meetings');
    }
    expect(meetings.clearPastMeetingRecordingCache).not.toHaveBeenCalled();
    upcoming.unsubscribe();
    history.unsubscribe();
    latest.unsubscribe();
  });

  it('ignores pre-mount saves and coalesces a signal flush, while card mutations clear recordings and fetch each cache once', () => {
    composer.notifySaved();
    const component = mount();
    http.expectNone('/api/user/meetings');
    composer.notifySaved();
    composer.notifySaved();
    flush();
    http.expectOne('/api/user/meetings').flush([pending]);
    flush();
    expect(ids(component)).toEqual(['pending']);
    expect(meetings.clearPastMeetingRecordingCache).not.toHaveBeenCalled();
    component.refreshMeetings();
    http.expectOne('/api/user/meetings').flush([owned]);
    flush();
    expect(ids(component)).toEqual(['owned']);
    expect(meetings.clearPastMeetingRecordingCache).toHaveBeenCalledOnce();
  });

  it.each([
    ['pending', 'foundation'],
    ['organizer', 'foundation'],
    ['pending', 'project'],
    ['organizer', 'project'],
  ] as const)('normalizes %s into %s without losing scoped paging, calendar or Subscribe', (view, nextLens) => {
    const component = mount();
    select(component, view);
    const scoped = [row('scoped-first'), row('scoped-second')];
    vi.mocked(meetings.getMeetingsByProjectPaginated).mockImplementation((_uid, _sort, token) =>
      of(token ? { data: [scoped[1]] } : { data: [scoped[0]], page_token: 'next' })
    );
    context.set({ uid: 'scope', name: 'Synthetic scope' } as ProjectContext);
    lens.set(nextLens);
    flush();
    expect(component.meetingView()).toBe('upcoming');
    expect(ids(component)).toEqual(['scoped-first']);
    expect(component.meetingsLoading()).toBe(false);
    expect(component.hasMore()).toBe(true);
    component.loadMore();
    expect(ids(component)).toEqual(['scoped-first', 'scoped-second']);
    expect(component.hasMore()).toBe(false);
    expect(meetings.getMeetingsByProjectPaginated).toHaveBeenCalledWith('scope', undefined, 'next', undefined, undefined);
    component.viewMode.set('calendar');
    flush();
    expect(component.isCalendarView()).toBe(true);
    expect(component.calendarLoading()).toBe(false);
    expect(component.calendarEvents().map((event) => event.title)).toEqual(['scoped-first', 'scoped-second']);
    component.onSubscribe();
    expect(TestBed.inject(DialogService).open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: { feedUrl: expect.stringContaining('/public/api/projects/scope/calendar.ics'), name: 'Synthetic scope' } })
    );
    vi.mocked(meetings.getPastMeetingsByProjectPaginated).mockReturnValue(of({ data: [past] }));
    select(component, 'past');
    expect(ids(component)).toEqual(['past-other']);
    expect(meetings.getPastMeetingsByProjectPaginated).toHaveBeenCalledWith('scope', undefined, undefined, undefined);
    lens.set('me');
    flush();
    http.expectOne('/api/user/past-meetings').flush([past]);
    flush();
    expect(component.meetingView()).toBe('past');
    expect(component.isCalendarView()).toBe(false);
  });
});

/**
 * Covers the Create Meeting button's two shapes across `MEETING_V2_ENABLED_FLAG`.
 *
 * This is the busiest of the seven entry points and the one a targeted user is most likely to reach
 * first, so both shapes are asserted on a real render rather than on the flag read. The point of the
 * flag-off case is that the button is not merely present but still *navigates*: the pre-v2 create
 * page is a route, and a button that only toggles an absent dropdown would look identical in a
 * screenshot while doing nothing at all.
 */
describe('MeetingsDashboardComponent — create button per flag', () => {
  /** `MEETING_V2_ENABLED_FLAG`. Stated per test: the real service answers `false` in a TestBed. */
  let meetingsV2Enabled: WritableSignal<boolean>;

  async function mount(): Promise<import('@angular/core/testing').ComponentFixture<MeetingsDashboardComponent>> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MeetingComposerService,
        {
          provide: MeetingService,
          useValue: {
            clearPastMeetingRecordingCache: vi.fn(),
            removedRegistrationMeetingIds: signal<ReadonlySet<string>>(new Set()),
            getPastMeetingRecording: vi.fn(() => of(null)),
            getMeetingsByProjectPaginated: vi.fn(() => of({ meetings: [], pagination: {} })),
            getPastMeetingsByProjectPaginated: vi.fn(() => of({ meetings: [], pagination: {} })),
            getMeetingsCountByProject: vi.fn(() => of(0)),
            getPastMeetingsCountByProject: vi.fn(() => of(0)),
          },
        },
        {
          provide: UserService,
          useValue: {
            viewerUsername: signal<string | null>('viewer'),
            getUserMeetings: vi.fn(() => of([] as Meeting[])),
            getUserPastMeetings: vi.fn(() => of([] as PastMeeting[])),
            refreshUserMeetings: vi.fn(),
            refreshUserPastMeetings: vi.fn(),
          },
        },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal(null), canWrite: signal(true), canWriteMeetings: signal(true) },
        },
        {
          provide: PersonaService,
          useValue: { personaLoaded: signal(true), hasBoardRole: signal(false), hasProjectRole: signal(false) },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => meetingsV2Enabled } },
      ],
    });
    // A no-op override on the dashboard itself, and it is load-bearing. Its template defers the
    // meeting card, so the build attaches async metadata to the component — and `compileComponents`
    // only awaits that for components sitting in the override queue. Without this line
    // `createComponent` throws "has unresolved metadata. Please call await TestBed.compileComponents()"
    // having just been given exactly that.
    TestBed.overrideComponent(MeetingsDashboardComponent, { add: { providers: [] } });
    // Only the children are blanked — this suite is about what the dashboard's own header renders.
    TestBed.overrideComponent(ButtonComponent, { set: { template: '', imports: [] } });
    TestBed.overrideComponent(MeetingCreateMenuComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingsDashboardComponent);
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    meetingsV2Enabled = signal(false);
  });

  it('renders a navigating Create Meeting button while the flag is off', async () => {
    const fixture = await mount();

    const button = fixture.debugElement.query(By.css('[data-testid="meeting-create-button"]')).componentInstance as ButtonComponent;

    expect(button.routerLink()).toEqual(['/meetings', 'create']);
    expect(button.ariaHaspopup()).toBeUndefined();
    // Absent, not hidden: an untargeted user should not mount the composer's create menu at all.
    expect(fixture.debugElement.query(By.directive(MeetingCreateMenuComponent))).toBeNull();
  });

  it('renders the same button as a dropdown trigger once the flag is on', async () => {
    meetingsV2Enabled.set(true);
    const fixture = await mount();

    const button = fixture.debugElement.query(By.css('[data-testid="meeting-create-button"]')).componentInstance as ButtonComponent;

    // `menu`, and no `routerLink`: this branch opens the type picker over the list, and a router
    // link here would put a destination in the status bar that the click never goes to.
    expect(button.ariaHaspopup()).toBe('menu');
    expect(button.routerLink()).toBeUndefined();
    expect(fixture.debugElement.query(By.directive(MeetingCreateMenuComponent))).not.toBeNull();
  });

  it('keeps the button findable by the same test id on both branches', async () => {
    const off = await mount();
    expect(off.nativeElement.querySelectorAll('[data-testid="meeting-create-button"]')).toHaveLength(1);

    TestBed.resetTestingModule();
    meetingsV2Enabled.set(true);
    const on = await mount();

    // One trigger either way: consumers use the same test id regardless of the flag.
    expect(on.nativeElement.querySelectorAll('[data-testid="meeting-create-button"]')).toHaveLength(1);
  });
});
