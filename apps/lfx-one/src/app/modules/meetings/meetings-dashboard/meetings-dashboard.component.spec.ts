// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { MeetingCreateMenuComponent } from '@app/modules/meetings/meeting-composer/meeting-create-menu.component';
import { ButtonComponent } from '@components/button/button.component';
import type { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsDashboardComponent } from './meetings-dashboard.component';

/**
 * Covers the one wire between the composer and this list: the composer saves in place instead of
 * navigating, so a create/edit only reaches the organizer's list if `saveCount` refetches it. The
 * host spec proves the counter moves; this proves the dashboard acts on it — and that the `skip(1)`
 * guarding the replayed value keeps a later mount from double-fetching everything.
 *
 * The component is instantiated directly rather than rendered: the assertions are all about the
 * constructor's stream wiring, and the template pulls in FullCalendar and the whole card stack.
 */
describe('MeetingsDashboardComponent', () => {
  let composer: MeetingComposerService;
  let getUserMeetings: ReturnType<typeof vi.fn>;
  let clearPastMeetingRecordingCache: ReturnType<typeof vi.fn>;

  const meeting = { uid: 'meeting-1', title: 'Weekly sync', start_time: '2099-01-01T10:00:00Z', duration: 60 } as unknown as Meeting;

  /** `toObservable` bridges emit on effect flush, so every signal write needs one. */
  const flush = (): void => TestBed.tick();

  const createComponent = (): MeetingsDashboardComponent => TestBed.runInInjectionContext(() => new MeetingsDashboardComponent());

  beforeEach(() => {
    getUserMeetings = vi.fn(() => of([meeting]));
    clearPastMeetingRecordingCache = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerService,
        {
          provide: MeetingService,
          useValue: {
            clearPastMeetingRecordingCache,
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
            getUserMeetings,
            getUserPastMeetings: vi.fn(() => of([] as PastMeeting[])),
          },
        },
        { provide: LensService, useValue: { activeLens: signal('me') } },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal(null), canWrite: signal(true), canWriteMeetings: signal(true) },
        },
        {
          provide: PersonaService,
          useValue: { personaLoaded: signal(true), hasBoardRole: signal(false), hasProjectRole: signal(false) },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });

    composer = TestBed.inject(MeetingComposerService);
  });

  it('refetches the list when the composer reports a save', () => {
    createComponent();
    flush();

    expect(getUserMeetings).toHaveBeenCalledTimes(1);

    composer.notifySaved();
    flush();

    // The new meeting is only in the list if the dashboard went back to the API for it.
    expect(getUserMeetings).toHaveBeenCalledTimes(2);
    // But the composer only touches an upcoming meeting, so the per-uid past-meeting recording
    // cache stays: dropping it costs one lookup per past meeting in the window on the next render.
    expect(clearPastMeetingRecordingCache).not.toHaveBeenCalled();
  });

  it('drops the recording cache on a card edit or delete', () => {
    const component = createComponent();
    flush();

    // Both lists render the same card, so an edit or delete raised from one can be a past meeting
    // whose recording has changed — that path still has to invalidate.
    component.refreshMeetings();
    flush();

    expect(clearPastMeetingRecordingCache).toHaveBeenCalledTimes(1);
  });

  it('refetches once per save, not once per subscriber', () => {
    createComponent();
    flush();

    composer.notifySaved();
    composer.notifySaved();
    flush();

    expect(getUserMeetings).toHaveBeenCalledTimes(2);
  });

  it('ignores a save that happened before it mounted', () => {
    // `saveCount` lives in a root service and is monotonic, so a dashboard mounted after an earlier
    // save sees a non-zero count replayed on subscribe. Acting on it would double every request the
    // initial fetch just made.
    composer.notifySaved();

    createComponent();
    flush();

    expect(getUserMeetings).toHaveBeenCalledTimes(1);
    expect(clearPastMeetingRecordingCache).not.toHaveBeenCalled();
  });

  describe('Me lens declined filter and stats', () => {
    const inHours = (hours: number): string => new Date(Date.now() + hours * 60 * 60_000).toISOString();
    const rsvp = (responseType: 'accepted' | 'declined', scope: 'all' | 'single') => ({ id: `r-${responseType}`, response_type: responseType, scope });
    const declinedAll = {
      id: 'declined',
      title: 'Declined series',
      start_time: inHours(2),
      duration: 30,
      is_invite_responses_enabled: true,
      my_rsvp: rsvp('declined', 'all'),
    };
    const declinedOne = {
      id: 'declined-one',
      title: 'Skipping one date',
      start_time: inHours(3),
      duration: 30,
      is_invite_responses_enabled: true,
      my_rsvp: rsvp('declined', 'single'),
    };
    const pending = { id: 'pending', title: 'Needs a reply', start_time: inHours(4), duration: 30, is_invite_responses_enabled: true, my_rsvp: null };
    const later = {
      id: 'later',
      title: 'Next month',
      start_time: inHours(24 * 30),
      duration: 30,
      is_invite_responses_enabled: true,
      my_rsvp: rsvp('accepted', 'all'),
    };

    beforeEach(() => {
      getUserMeetings.mockReturnValue(of([declinedAll, declinedOne, pending, later] as unknown as Meeting[]));
    });

    const ids = (component: MeetingsDashboardComponent): string[] => component.filteredMeetings().map((m) => m.id);

    it('hides meetings declined for every date until Show declined is on', () => {
      const component = createComponent();
      flush();

      expect(ids(component)).toEqual(['declined-one', 'pending', 'later']);
      expect(component['declinedCount']()).toBe(1);

      component.showDeclined.set(true);
      flush();
      expect(ids(component)).toEqual(['declined', 'declined-one', 'pending', 'later']);

      component.resetFilters();
      flush();
      expect(component.showDeclined()).toBe(false);
    });

    it('keeps a declined meeting the viewer organizes, and counts it under Organized by me', () => {
      const organizedDeclined = { ...declinedAll, id: 'organized-declined', created_by: { username: 'viewer', name: 'Viewer' } };
      getUserMeetings.mockReturnValue(of([organizedDeclined, declinedAll, pending] as unknown as Meeting[]));
      const component = createComponent();
      flush();

      expect(ids(component)).toEqual(['organized-declined', 'pending']);
      expect(component['declinedCount']()).toBe(1);
      expect(component['organizerCount']()).toBe(1);
    });

    it('counts dates in the stats window and RSVPs still needed, excluding declined-for-all meetings', () => {
      const component = createComponent();
      flush();

      expect(component['nextWindowCount']()).toBe(2);
      expect(component['pendingRsvpCount']()).toBe(1);
      expect(component['nextMeetingLabel']()).toContain('Skipping one date');
    });

    it('shows only accepted meetings when the Accepted filter is on, and clears it on reset', () => {
      const component = createComponent();
      flush();

      component.acceptedOnly.set(true);
      flush();
      expect(ids(component)).toEqual(['later']);
      expect(component['acceptedCount']()).toBe(1);

      component.resetFilters();
      flush();
      expect(component.acceptedOnly()).toBe(false);
      expect(ids(component)).toEqual(['declined-one', 'pending', 'later']);
    });

    it('toggles the pending-RSVP filter from the stat', () => {
      const component = createComponent();
      flush();

      component.onPendingRsvpStatClick();
      flush();
      expect(ids(component)).toEqual(['pending']);

      component.onPendingRsvpStatClick();
      flush();
      expect(component.pendingRsvpOnly()).toBe(false);
    });
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
    meetingsV2Enabled = signal(true);
    const on = await mount();

    // One trigger either way. The E2E specs pin the flag and then look for this id, so a branch that
    // renamed or duplicated it would pass every unit assertion above and still break them.
    expect(on.nativeElement.querySelectorAll('[data-testid="meeting-create-button"]')).toHaveLength(1);
  });
});
