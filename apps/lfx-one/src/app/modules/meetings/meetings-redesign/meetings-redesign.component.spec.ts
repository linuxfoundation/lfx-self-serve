// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { IMPERSONATION_BANNER_HEIGHT_PX, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsRedesignComponent } from './meetings-redesign.component';

const DAY_MS = 24 * 60 * 60 * 1000;

function buildMeeting(index: number, overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: `m-${index}`,
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    start_time: new Date(Date.now() + (40 + index) * DAY_MS).toISOString(),
    duration: 60,
    timezone: 'UTC',
    title: `Meeting ${index}`,
    description: '',
    recurrence: null,
    committees: [],
    meeting_type: 'Technical',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: null,
    invited: true,
    occurrences: [],
    ...overrides,
  };
}

describe('MeetingsRedesignComponent', () => {
  const HEADER_HEIGHT = 80;
  let impersonating: ReturnType<typeof signal<boolean>>;
  let personaLoaded: ReturnType<typeof signal<boolean>>;
  let desktop: boolean;
  let upcoming$: Subject<Meeting[]>;
  let past$: Subject<PastMeeting[]>;
  let latestPast$: Subject<PastMeeting[]>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let navigate: ReturnType<typeof vi.fn>;
  let observerCallback: IntersectionObserverCallback | null;

  const render = (): ComponentFixture<MeetingsRedesignComponent> => {
    const fixture = TestBed.createComponent(MeetingsRedesignComponent);
    fixture.detectChanges();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsRedesignComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  const loadFeeds = async (fixture: ComponentFixture<MeetingsRedesignComponent>, upcoming: Meeting[], past: PastMeeting[] = []): Promise<void> => {
    upcoming$.next(upcoming);
    past$.next(past);
    await fixture.whenStable();
  };
  const rowTitles = (fixture: ComponentFixture<MeetingsRedesignComponent>): string[] =>
    Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="meetings-home-day-group-row"]')).map(
      (row) => row.querySelector('[data-testid="meetings-home-row-title"]')?.textContent?.trim() ?? ''
    );

  beforeEach(() => {
    desktop = true;
    impersonating = signal(false);
    personaLoaded = signal(true);
    upcoming$ = new Subject();
    past$ = new Subject();
    latestPast$ = new Subject();
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    navigate = vi.fn().mockResolvedValue(true);
    observerCallback = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe = vi.fn();
        public disconnect = vi.fn();
        public constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
      }
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: desktop, media: q }));
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEADER_HEIGHT);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: UserService,
          useValue: {
            impersonating,
            meetingFeedIdentity: signal('viewer'),
            viewerUsername: signal('viewer'),
            getUserMeetings: () => upcoming$,
            getUserPastMeetings: () => past$,
            getUserLatestPastMeetings: () => latestPast$,
            authenticated: signal(true),
            meetingJoinIdentity: signal(null),
            confirmedMeetingRsvps: () => [],
            isMeetingRsvpCurrent: () => true,
            isMeetingRegistrationEnded: () => false,
          },
        },
        { provide: MeetingInviteResendService, useValue: { isResendingOwn: () => false } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: signal(new Set<string>()), getMeetingRsvps: () => of([]) } },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set<string>()) } },
        { provide: PersonaService, useValue: { personaLoaded } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useFactory: () => ({ queryParamMap: queryParamMap$ }) },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the header, tabs bar, list area and right column blocks', async () => {
    const fixture = render();
    await fixture.whenStable();

    expect(query(fixture, 'meetings-redesign-title')?.textContent).toContain('Meetings');
    expect(query(fixture, 'ui-tab-upcoming')).toBeTruthy();
    expect(query(fixture, 'ui-tab-past')).toBeTruthy();
    expect(query(fixture, 'meetings-redesign-search')).toBeTruthy();
    expect(query(fixture, 'meetings-redesign-list-upcoming')?.getAttribute('role')).toBe('tabpanel');
    for (const block of ['next-meeting', 'last-meeting']) {
      expect(query(fixture, `meetings-redesign-rail-${block}`)).toBeTruthy();
      expect(query(fixture, `meetings-redesign-folded-${block}`)).toBeTruthy();
    }
    expect(query(fixture, 'meetings-redesign-rail-pending-rsvps')).toBeNull();
  });

  it('paints the Last meeting card from the latest-past feed without waiting for the past list', async () => {
    const fixture = render();
    await fixture.whenStable();
    expect(query(fixture, 'meetings-home-last-card-loading')).toBeTruthy();

    latestPast$.next([]);
    await fixture.whenStable();

    expect(query(fixture, 'meetings-home-last-card-empty')).toBeTruthy();
  });

  it('hides the Last meeting card, with no error, when its feed fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = render();
    await fixture.whenStable();

    latestPast$.error(new Error('down'));
    await fixture.whenStable();

    expect(query(fixture, 'meetings-redesign-rail-last-meeting')).toBeNull();
    expect(query(fixture, 'meetings-redesign-folded-last-meeting')).toBeNull();
    expect(query(fixture, 'meetings-redesign-rail-next-meeting')).toBeTruthy();
  });

  it('has no Create meeting button', async () => {
    const fixture = render();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Create meeting');
  });

  it('renders a tabpanel per tab that every tab controls, hiding the inactive one', async () => {
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    for (const value of ['upcoming', 'past']) {
      const panel = query(fixture, `meetings-redesign-list-${value}`);
      const controlled = fixture.nativeElement.querySelector(`#${query(fixture, `ui-tab-${value}`)?.getAttribute('aria-controls')}`);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(controlled).toBe(panel);
      expect(panel?.getAttribute('aria-labelledby')).toBe(query(fixture, `ui-tab-${value}`)?.id);
    }
    expect(query(fixture, 'meetings-redesign-list-upcoming')?.hidden).toBe(false);
    expect(query(fixture, 'meetings-redesign-list-past')?.hidden).toBe(true);

    query(fixture, 'ui-tab-past')?.click();
    fixture.detectChanges();

    expect(query(fixture, 'meetings-redesign-list-upcoming')?.hidden).toBe(true);
    expect(query(fixture, 'meetings-redesign-list-past')?.hidden).toBe(false);
  });

  it('sticks the tabs bar below the measured header on desktop', async () => {
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query(fixture, 'meetings-redesign-header')?.style.top).toBe('0px');
    expect(query(fixture, 'meetings-redesign-tabs-bar')?.style.top).toBe(`${HEADER_HEIGHT}px`);
  });

  it("counts the layout wrapper's bottom padding, not main's own, in the desktop column height", async () => {
    vi.stubGlobal('innerHeight', 900);
    // The real shape: main (own padding) > content wrapper (21px) > route-entry host stand-in > the page.
    const main = document.createElement('main');
    main.style.paddingBottom = '40px';
    const wrapper = document.createElement('div');
    wrapper.style.paddingBottom = '21px';
    const entryHost = document.createElement('div');
    main.append(wrapper);
    wrapper.append(entryHost);
    document.body.append(main);

    try {
      const fixture = TestBed.createComponent(MeetingsRedesignComponent);
      entryHost.append(fixture.nativeElement);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-redesign')?.style.height).toBe('879px');
    } finally {
      main.remove();
    }
  });

  it('keeps the measured column height on a short viewport, with no minimum height', async () => {
    vi.stubGlobal('innerHeight', 400);
    const fixture = render();
    await fixture.whenStable();

    const root = query(fixture, 'meetings-redesign');
    expect(root?.style.height).toBe('400px');
    expect(root?.className).not.toContain('min-h-');
  });

  it('clears the impersonation banner when the window scrolls', async () => {
    desktop = false;
    impersonating.set(true);
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query(fixture, 'meetings-redesign-header')?.style.top).toBe(`${IMPERSONATION_BANNER_HEIGHT_PX}px`);
    expect(query(fixture, 'meetings-redesign-tabs-bar')?.style.top).toBe(`${IMPERSONATION_BANNER_HEIGHT_PX + HEADER_HEIGHT}px`);
  });

  describe('list', async () => {
    it('shows skeleton rows until the feed answers, then tab counts and day groups', async () => {
      const fixture = render();
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-list-loading')?.getAttribute('role')).toBe('status');
      expect(query(fixture, 'ui-tab-upcoming')?.textContent).not.toMatch(/\d/);

      await loadFeeds(fixture, [buildMeeting(1), buildMeeting(2)], []);

      expect(query(fixture, 'meetings-home-list-loading')).toBeNull();
      expect(query(fixture, 'ui-tab-upcoming')?.textContent).toContain('2');
      expect(query(fixture, 'ui-tab-past')?.textContent).toContain('0');
      expect(query(fixture, 'meetings-home-day-group-label')?.textContent?.trim()).toBeTruthy();
      expect(rowTitles(fixture)).toEqual(['Meeting 2']);
    });

    it('shows the soonest date in the Next meeting card instead of the list, still counting it on the tab', async () => {
      const fixture = render();
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-next-card')).toBeNull();
      expect(query(fixture, 'meetings-home-next-card-empty')).toBeNull();

      await loadFeeds(fixture, [buildMeeting(2), buildMeeting(1)]);

      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.querySelector('[data-testid="meetings-home-next-card-title"]')?.textContent).toBe(
        'Meeting 1'
      );
      expect(rowTitles(fixture)).toEqual(['Meeting 2']);
      expect(query(fixture, 'ui-tab-upcoming')?.textContent).toContain('2');
      const menu = (): Element | null | undefined =>
        query(fixture, 'meetings-home-next-card-menu')?.querySelector('[data-testid="meetings-home-row-actions-trigger"]');
      const firstMenu = menu();
      expect(firstMenu).toBeTruthy();

      upcoming$.next([buildMeeting(2), buildMeeting(3)]);
      await fixture.whenStable();
      expect(menu()).toBeTruthy();
      expect(menu()).not.toBe(firstMenu);
    });

    it('shows the empty Next meeting card and no list or empty state for a lone meeting', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, []);
      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.textContent).toContain('Your calendar is clear');
      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.querySelector('[data-testid="meetings-home-row-actions-trigger"]')).toBeNull();

      upcoming$.next([buildMeeting(1)]);
      await fixture.whenStable();

      expect(rowTitles(fixture)).toEqual([]);
      expect(query(fixture, 'meetings-home-empty-upcoming')).toBeNull();
      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
    });

    it('shows a header skeleton until the persona loads', async () => {
      personaLoaded.set(false);
      const fixture = render();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-persona-loading')).toBeTruthy();
      expect(query(fixture, 'meetings-redesign-title')).toBeNull();

      personaLoaded.set(true);
      await fixture.whenStable();

      expect(query(fixture, 'meetings-redesign-title')).toBeTruthy();
    });

    it('filters rows by the search text', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1, { title: 'Board Review' }), buildMeeting(2, { title: 'Tech Sync' })]);

      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'board';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(rowTitles(fixture)).toEqual(['Board Review']);
    });

    it('shows one page of rows, the next one when the trigger scrolls into view, then the end line', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(
        fixture,
        Array.from({ length: MEETINGS_HOME_PAGE_SIZE + 6 }, (_, index) => buildMeeting(index))
      );

      expect(rowTitles(fixture)).toHaveLength(MEETINGS_HOME_PAGE_SIZE);
      expect(query(fixture, 'meetings-home-all-loaded')).toBeNull();

      observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await fixture.whenStable();

      expect(rowTitles(fixture)).toHaveLength(MEETINGS_HOME_PAGE_SIZE + 5);
      expect(query(fixture, 'meetings-home-load-more')).toBeNull();
      expect(query(fixture, 'meetings-home-all-loaded')?.textContent?.trim()).toBe(`All ${MEETINGS_HOME_PAGE_SIZE + 5} meetings loaded`);
    });

    it('shows an error with a retry instead of the empty state when the feed fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fixture = render();
      await fixture.whenStable();

      upcoming$.error(new Error('down'));
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-error')?.textContent).toContain("Couldn't load your meetings");
      expect(query(fixture, 'meetings-home-empty-upcoming')).toBeNull();
      expect(query(fixture, 'ui-tab-upcoming')?.textContent).not.toMatch(/\d/);

      upcoming$ = new Subject();
      (query(fixture, 'meetings-home-error-retry')?.querySelector('button') as HTMLButtonElement).click();
      await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1)]);

      expect(query(fixture, 'meetings-home-error')).toBeNull();
      expect(rowTitles(fixture)).toEqual(['Meeting 1']);
    });

    it('shows the empty state for a tab without meetings and hides search', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, []);

      expect(query(fixture, 'meetings-home-empty-upcoming')?.textContent).toContain('No upcoming meetings');
      expect(query(fixture, 'meetings-home-empty-upcoming')?.textContent).toContain('Meetings from your committees and projects will appear here.');
      expect(query(fixture, 'meetings-redesign-search')).toBeNull();

      query(fixture, 'ui-tab-past')?.click();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-empty-past')?.textContent).toContain('No past meetings');
      expect(query(fixture, 'meetings-home-empty-past')?.textContent).toContain('Your past meetings will appear here.');
    });

    it('shows no "No results" when the search matches only the Next meeting card', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0, { title: 'Board Review' }), buildMeeting(1)]);
      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'board';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(rowTitles(fixture)).toEqual([]);
      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
    });

    it('shows no results with a reset that clears the search', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1)]);
      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'nothing matches';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-no-results')?.textContent).toContain('No results found');
      expect(query(fixture, 'meetings-home-no-results')?.textContent).toContain('Try adjusting your filter criteria');

      (query(fixture, 'meetings-home-no-results-reset')?.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
      expect(rowTitles(fixture)).toEqual(['Meeting 1']);
    });
  });

  describe('filters', async () => {
    const chips = (fixture: ComponentFixture<MeetingsRedesignComponent>): string[] =>
      Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="meetings-home-filters-chip"]')).map(
        (chip) => chip.querySelector('[data-testid="ui-chip-label"]')?.textContent?.trim() ?? ''
      );
    const applyOrganizedByMe = async (fixture: ComponentFixture<MeetingsRedesignComponent>): Promise<void> => {
      (query(fixture, 'meetings-home-filters-button')?.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();
      (document.querySelector('[data-testid="meetings-home-filters-organized"] input') as HTMLInputElement).click();
      await fixture.whenStable();
      (document.querySelector('[data-testid="meetings-home-filters-apply"] button') as HTMLButtonElement).click();
      await fixture.whenStable();
    };
    const meetings = (): Meeting[] => [
      buildMeeting(0),
      buildMeeting(1, { title: 'Board Review', created_by: { username: 'viewer', email: 'viewer@example.test' } }),
      buildMeeting(2, { title: 'Tech Sync' }),
    ];

    it('applies filters from the popover, counts them on the button and shows a chip each', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, meetings());

      expect(chips(fixture)).toEqual([]);
      await applyOrganizedByMe(fixture);

      expect(rowTitles(fixture)).toEqual(['Board Review']);
      expect(query(fixture, 'meetings-home-filters-count')?.textContent?.trim()).toBe('1');
      expect(chips(fixture)).toEqual(['Organized by me']);
    });

    it('removes only the filter whose chip is dismissed', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, meetings());
      document.body.appendChild(fixture.nativeElement);
      await applyOrganizedByMe(fixture);

      const dismiss = query(fixture, 'meetings-home-filters-chip')?.querySelector('[data-testid="ui-chip-dismiss"]') as HTMLButtonElement;
      dismiss.focus();
      dismiss.click();
      await fixture.whenStable();

      expect(chips(fixture)).toEqual([]);
      expect(query(fixture, 'meetings-home-filters-count')).toBeNull();
      expect(rowTitles(fixture)).toEqual(['Board Review', 'Tech Sync']);
      expect(document.activeElement).toBe(query(fixture, 'meetings-home-filters-button')?.querySelector('button'));
      fixture.nativeElement.remove();
    });

    it('clears applied filters on a tab switch but keeps the search', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, meetings(), [
        { ...buildMeeting(3, { start_time: new Date(Date.now() - DAY_MS).toISOString() }), occurrence_id: '' } as PastMeeting,
      ]);
      await applyOrganizedByMe(fixture);
      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'sync';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      query(fixture, 'ui-tab-past')?.click();
      await fixture.whenStable();

      expect(chips(fixture)).toEqual([]);
      expect(query(fixture, 'meetings-home-filters-count')).toBeNull();
      expect((query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement).value).toBe('sync');
    });
  });

  describe('tabs and URL', async () => {
    it('opens on the Past tab from ?time=past', async () => {
      queryParamMap$.next(convertToParamMap({ time: 'past' }));
      const fixture = render();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-redesign-list-past')?.hidden).toBe(false);
      expect(query(fixture, 'meetings-redesign-list-upcoming')?.hidden).toBe(true);
      expect(query(fixture, 'meetings-redesign-list-upcoming')?.classList.contains('flex')).toBe(false);

      queryParamMap$.next(convertToParamMap({}));
      await fixture.whenStable();

      expect(query(fixture, 'meetings-redesign-list-upcoming')?.hidden).toBe(false);
    });

    it('writes the tab to the URL on a switch', async () => {
      const fixture = render();
      await fixture.whenStable();

      query(fixture, 'ui-tab-past')?.click();
      await fixture.whenStable();
      expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { time: 'past' }, replaceUrl: true }));

      query(fixture, 'ui-tab-upcoming')?.click();
      await fixture.whenStable();
      expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { time: null } }));
    });
  });
});
