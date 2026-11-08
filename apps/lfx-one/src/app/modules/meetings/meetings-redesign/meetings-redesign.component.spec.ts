// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { IMPERSONATION_BANNER_HEIGHT_PX, MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { AppService } from '@services/app.service';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { PersonaService } from '@services/persona.service';
import { PlausibleService } from '@services/plausible.service';
import { SegmentService } from '@services/segment.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiButtonComponent } from '@shared/uikit/button/button.component';

import { MeetingsFiltersComponent } from './components/meetings-filters/meetings-filters.component';
import { PendingRsvpsComponent } from './components/pending-rsvps/pending-rsvps.component';
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
  let openCreateDialog: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let refreshUserPastMeetings: ReturnType<typeof vi.fn>;
  let elementScrollBy: ReturnType<typeof vi.fn<(options?: ScrollToOptions) => void>>;
  let windowScrollBy: ReturnType<typeof vi.spyOn>;

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
  const button = (fixture: ComponentFixture<MeetingsRedesignComponent>, testId: string): UiButtonComponent =>
    fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).componentInstance;
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
    openCreateDialog = vi.fn();
    refreshUserMeetings = vi.fn();
    refreshUserPastMeetings = vi.fn();
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
    // jsdom has no element scrolling and only a logging window.scrollBy.
    elementScrollBy = vi.fn<(options?: ScrollToOptions) => void>();
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', { value: elementScrollBy, configurable: true, writable: true });
    windowScrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
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
            meetingsRefresh$: new Subject<void>(),
            pastMeetingsRefresh$: new Subject<void>(),
            authenticated: signal(true),
            meetingJoinIdentity: signal(null),
            confirmedMeetingRsvps: () => [],
            isMeetingRsvpCurrent: () => true,
            refreshUserMeetings,
            refreshUserPastMeetings,
          },
        },
        { provide: CreateArtifactDialogService, useValue: { open: openCreateDialog } },
        { provide: MeetingOwnInviteResendService, useValue: { isResendingOwn: () => false } },
        {
          provide: MeetingService,
          useValue: {
            removedRegistrationMeetingIds: signal(new Set<string>()),
            getPastMeetingSummary: () => of(null),
            getPastMeetingRecording: () => of(null),
          },
        },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set<string>()) } },
        { provide: PersonaService, useValue: { personaLoaded, hasBoardRole: signal(false), hasProjectRole: signal(true) } },
        { provide: Router, useValue: { navigate, navigateByUrl: navigate } },
        { provide: ActivatedRoute, useFactory: () => ({ queryParamMap: queryParamMap$ }) },
        { provide: PlausibleService, useValue: { trackEvent: vi.fn() } },
        { provide: SegmentService, useValue: { trackEvent: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
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

  it('gives the Last meeting card the row menu', async () => {
    const fixture = render();
    await fixture.whenStable();

    latestPast$.next([{ ...buildMeeting(4, { start_time: new Date(Date.now() - DAY_MS).toISOString() }), occurrence_id: '' } as PastMeeting]);
    await fixture.whenStable();

    const trigger = query(fixture, 'meetings-home-last-card-menu')?.querySelector<HTMLButtonElement>(
      '[data-testid="meetings-home-row-actions-trigger"] button'
    );
    navigate.mockClear();
    trigger?.click();
    await fixture.whenStable();

    expect(document.querySelector('[data-testid="meetings-home-row-actions-menu"]')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
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
    // The lone folded card spans both columns.
    const folded = query(fixture, 'meetings-redesign-folded-next-meeting');
    expect(folded?.className).toContain('@[621px]:only:col-span-2');
    expect(folded?.parentElement?.querySelectorAll(':scope > section')).toHaveLength(1);
  });

  describe('Create Meeting', () => {
    it('opens the create dialog for meetings from a labelled button', async () => {
      const fixture = render();
      await fixture.whenStable();

      const button = query(fixture, 'meetings-home-create')?.querySelector('button');
      expect(button?.textContent?.trim()).toBe('Create Meeting');
      expect(button?.querySelector('i')?.className).toContain('fa-plus');
      button?.click();

      expect(openCreateDialog).toHaveBeenCalledWith('meeting');
    });

    it('is waited for while the persona loads, and the header actions hide with nothing pending', async () => {
      personaLoaded.set(false);
      const fixture = render();
      await loadFeeds(fixture, [buildMeeting(1)]);

      expect(query(fixture, 'meetings-home-create')).toBeNull();
      expect(query(fixture, 'meetings-redesign-header-actions')?.classList).toContain('hidden');
      // Capped to the header and wrapping, so both buttons fit on a 320px phone.
      expect(query(fixture, 'meetings-redesign-header-actions')?.className).toContain('max-w-full flex-none flex-wrap');
    });

    it('stays in the header on the empty Upcoming and Past tabs, whose empty states have no Create', async () => {
      const fixture = render();
      await fixture.whenStable();

      // Kept while the feed loads.
      expect(query(fixture, 'meetings-home-create')).not.toBeNull();

      await loadFeeds(fixture, []);
      expect(query(fixture, 'meetings-home-empty-upcoming')).not.toBeNull();
      expect(query(fixture, 'meetings-home-empty-upcoming')?.querySelector('button')).toBeNull();
      expect(query(fixture, 'meetings-home-create')).not.toBeNull();
      expect(query(fixture, 'meetings-redesign-header-actions')?.classList).not.toContain('hidden');

      query(fixture, 'ui-tab-past')?.click();
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-empty-past')).not.toBeNull();
      expect(query(fixture, 'meetings-home-create')).not.toBeNull();
    });

    it('stays beside the error when the Upcoming feed fails to load', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fixture = render();
      await fixture.whenStable();

      upcoming$.error(new Error('down'));
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-error')).not.toBeNull();
      expect(query(fixture, 'meetings-home-create')).not.toBeNull();
    });

    it('takes focus once the last pending RSVP is answered', async () => {
      const fixture = render();
      await fixture.whenStable();
      const pending: PendingRsvpsComponent = fixture.debugElement.query(By.directive(PendingRsvpsComponent)).componentInstance;

      expect(pending.fallbackFocus()).toBe(fixture.debugElement.query(By.css('[data-testid="meetings-home-create"]')).componentInstance);
    });

    it('keeps the heading as the focus fallback while the persona loads', async () => {
      personaLoaded.set(false);
      const fixture = render();
      await fixture.whenStable();
      const pending: PendingRsvpsComponent = fixture.debugElement.query(By.directive(PendingRsvpsComponent)).componentInstance;

      expect(query(fixture, 'meetings-home-persona-loading')).toBeTruthy();
      expect(pending.fallbackFocus()).not.toBeNull();
      expect(pending.fallbackFocus()).toBe(query(fixture, 'meetings-redesign-title'));
    });

    it('refetches both feeds after the composer saves', async () => {
      const fixture = render();
      await fixture.whenStable();
      expect(refreshUserMeetings).not.toHaveBeenCalled();

      TestBed.inject(MeetingComposerService).notifySaved();
      await fixture.whenStable();

      expect(refreshUserMeetings).toHaveBeenCalledOnce();
      expect(refreshUserPastMeetings).toHaveBeenCalledOnce();
    });
  });

  it('stops the tabs bar wrapping above 1024px in a centre of 440px or more, narrowing the search instead', async () => {
    const fixture = render();
    await fixture.whenStable();

    const search = query(fixture, 'meetings-redesign-search');
    expect(query(fixture, 'meetings-redesign-tabs')?.className).toContain('flex-wrap');
    expect(query(fixture, 'meetings-redesign-tabs')?.className).toContain('min-[1025px]:@[440px]:flex-nowrap');
    expect(search?.parentElement?.className).toContain('min-[1025px]:min-w-0 min-[1025px]:flex-nowrap');
    expect(search?.className).toContain('min-[1025px]:w-[280px] min-[1025px]:min-w-0');
  });

  it('puts search and Filters inside the tabs, on their rule', async () => {
    const fixture = render();
    await fixture.whenStable();

    const tabs = query(fixture, 'meetings-redesign-tabs');
    expect(tabs?.contains(query(fixture, 'meetings-redesign-search'))).toBe(true);
    expect(tabs?.contains(query(fixture, 'meetings-home-filters-button'))).toBe(true);
    expect(query(fixture, 'ui-tab-upcoming')?.className).toContain('text-[13px]');
  });

  it('folds the right column into a two-column grid and hides the description at 1024px and below', async () => {
    const fixture = render();
    await fixture.whenStable();

    const folded = query(fixture, 'meetings-redesign-folded-rail');
    expect(folded?.className).toContain('grid grid-cols-1');
    expect(folded?.className).toContain('@[621px]:grid-cols-2');
    expect(folded?.className).toContain('min-[1025px]:hidden');
    expect(folded?.parentElement?.classList).toContain('@container');
    expect(query(fixture, 'meetings-redesign-right-column')?.className).toContain('hidden');
    expect(query(fixture, 'meetings-redesign-description')?.className).toContain('hidden text-[13px] text-gray-500 min-[1025px]:block');
  });

  it('shows skeleton Next meeting cards while the upcoming feed loads, and hides them when it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = render();
    await fixture.whenStable();
    expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.querySelector('[data-testid="meetings-home-next-card-loading"]')).toBeTruthy();

    upcoming$.error(new Error('down'));
    await fixture.whenStable();

    expect(query(fixture, 'meetings-redesign-rail-next-meeting')).toBeNull();
    expect(query(fixture, 'meetings-redesign-folded-next-meeting')).toBeNull();
  });

  it('shows the Pending RSVPs button in the header once the feed has dates to answer', async () => {
    const fixture = render();
    await loadFeeds(fixture, [buildMeeting(1, { my_rsvp: null, my_rsvps: [], is_invite_responses_enabled: true }), buildMeeting(2)]);

    expect(query(fixture, 'meetings-redesign-header')?.querySelector('[data-testid="meetings-home-pending-rsvps-count"]')?.textContent?.trim()).toBe('1');
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

  it('sticks the day headings below the header and tabs bar, and drops the fade under a stuck heading', async () => {
    const fixture = render();
    await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1)]);
    fixture.detectChanges();

    const separator = query(fixture, 'meetings-home-day-group-separator');
    expect(separator?.className).toContain('sticky');
    expect(separator?.style.top).toBe(`${HEADER_HEIGHT * 2}px`);
    expect(query(fixture, 'meetings-home-filters-chips')?.className ?? '').not.toContain('sticky');

    const fade = (): string => query(fixture, 'meetings-redesign-tabs-fade')?.className ?? '';
    const list = query(fixture, 'meetings-home-list') as HTMLElement;
    const scrollListTo = async (top: number): Promise<void> => {
      vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 100, 1000));
      query(fixture, 'meetings-redesign-centre')?.dispatchEvent(new Event('scroll'));
      await fixture.whenStable();
    };
    expect(fade()).not.toContain('mt-[44px]');

    await scrollListTo(HEADER_HEIGHT * 2 - 40);
    expect(fade()).toContain('mt-[44px]');

    await scrollListTo(HEADER_HEIGHT * 2 + 40);
    expect(fade()).not.toContain('mt-[44px]');

    // The padded heading box starts 20px above the list, so it is stuck once the list is within 20px of the edge.
    await scrollListTo(HEADER_HEIGHT * 2 + 20);
    expect(fade()).toContain('mt-[44px]');
    await scrollListTo(HEADER_HEIGHT * 2 + 21);
    expect(fade()).not.toContain('mt-[44px]');

    // Swapping the list for an empty state, with no scroll, drops the offset too.
    await scrollListTo(HEADER_HEIGHT * 2 - 40);
    query(fixture, 'ui-tab-past')?.click();
    await fixture.whenStable();
    expect(query(fixture, 'meetings-home-empty-past')).toBeTruthy();
    expect(fade()).not.toContain('mt-[44px]');
  });

  it("sizes the desktop column from its own top alone, the layout's bottom padding being cancelled by the host", async () => {
    vi.stubGlobal('innerHeight', 900);
    const fixture = render();
    vi.spyOn(fixture.nativeElement as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 60, 100, 100));
    window.dispatchEvent(new Event('resize'));
    await fixture.whenStable();

    expect(fixture.nativeElement.className).toContain('-my-6');
    expect(query(fixture, 'meetings-redesign')?.style.height).toBe('840px');
    expect(query(fixture, 'meetings-redesign')?.style.minHeight).toBe('');
  });

  it('renders the app footer at the end of the centre column and hides the layout footer while shown', async () => {
    const appService = TestBed.inject(AppService);
    const fixture = render();
    await fixture.whenStable();

    const centre = query(fixture, 'meetings-redesign-centre');
    expect(centre?.lastElementChild?.getAttribute('data-testid')).toBe('meetings-redesign-footer');
    expect(appService.pageOwnsFooter()).toBe(true);

    fixture.destroy();
    expect(appService.pageOwnsFooter()).toBe(false);
  });

  it('uses the available height as the minimum page height when the window scrolls', async () => {
    desktop = false;
    vi.stubGlobal('innerHeight', 700);
    const fixture = render();
    await fixture.whenStable();

    const root = query(fixture, 'meetings-redesign');
    expect(root?.style.height).toBe('');
    expect(root?.style.minHeight).toBe('700px');
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

    await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1)]);
    expect(query(fixture, 'meetings-home-day-group-separator')?.style.top).toBe(`${IMPERSONATION_BANNER_HEIGHT_PX + HEADER_HEIGHT * 2}px`);
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
      expect(rowTitles(fixture)).toEqual(['Meeting 1', 'Meeting 2']);
    });

    it('shows the soonest date in the Next meeting card and keeps it in the list, counted on the tab', async () => {
      const fixture = render();
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-next-card')).toBeNull();
      expect(query(fixture, 'meetings-home-next-card-empty')).toBeNull();

      await loadFeeds(fixture, [buildMeeting(2), buildMeeting(1)]);

      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.querySelector('[data-testid="meetings-home-next-card-title"]')?.textContent).toBe(
        'Meeting 1'
      );
      expect(rowTitles(fixture)).toEqual(['Meeting 1', 'Meeting 2']);
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

    it('pages the Next meeting card through the meetings that overlap it, in both card copies', async () => {
      const start = Date.now() + 2 * DAY_MS;
      const at = (minutes: number): string => new Date(start + minutes * 60_000).toISOString();
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(1, { start_time: at(0) }), buildMeeting(2, { start_time: at(30) }), buildMeeting(3, { start_time: at(60) })]);
      const pager = (scope: string): HTMLElement | null => query(fixture, `meetings-redesign-${scope}-next-pager`);
      const title = (scope: string): string | null | undefined =>
        query(fixture, `meetings-redesign-${scope}-next-meeting`)?.querySelector('[data-testid="meetings-home-next-card-title"]')?.textContent;
      const pagerButton = (name: string): UiButtonComponent => button(fixture, `meetings-redesign-rail-next-pager-${name}`);
      const click = async (name: string): Promise<void> => {
        (query(fixture, `meetings-redesign-rail-next-pager-${name}`)?.querySelector('button') as HTMLButtonElement).click();
        await fixture.whenStable();
      };

      expect(query(fixture, 'meetings-redesign-rail-next-pager-position')?.textContent?.trim()).toBe('1 of 2');
      expect(pager('rail')?.querySelector('[aria-live="polite"]')).toBeTruthy();
      expect(pagerButton('previous').disabled()).toBe(true);
      expect(pagerButton('next').ariaLabel()).toBe('Next concurrent meeting');
      expect(title('rail')).toBe('Meeting 1');

      await click('next');

      expect(query(fixture, 'meetings-redesign-folded-next-pager-position')?.textContent?.trim()).toBe('2 of 2');
      expect(title('rail')).toBe('Meeting 2');
      expect(title('folded')).toBe('Meeting 2');
      expect(pagerButton('next').disabled()).toBe(true);

      await click('previous');
      expect(title('rail')).toBe('Meeting 1');
    });

    it('shows no pager when no other meeting overlaps the next one', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(1), buildMeeting(2)]);

      expect(query(fixture, 'meetings-redesign-rail-next-pager')).toBeNull();
      expect(query(fixture, 'meetings-redesign-folded-next-pager')).toBeNull();
    });

    it('shows the empty Next meeting card, then lists a lone meeting there and in the list', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, []);
      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.textContent).toContain('Your calendar is clear');
      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.querySelector('[data-testid="meetings-home-row-actions-trigger"]')).toBeNull();

      upcoming$.next([buildMeeting(1)]);
      await fixture.whenStable();

      expect(rowTitles(fixture)).toEqual(['Meeting 1']);
      expect(query(fixture, 'meetings-home-empty-upcoming')).toBeNull();
      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
    });

    it('shows the title and a description skeleton until the persona loads', async () => {
      personaLoaded.set(false);
      const fixture = render();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-persona-loading')).toBeTruthy();
      expect(query(fixture, 'meetings-redesign-title')?.textContent).toContain('Meetings');
      expect(query(fixture, 'meetings-redesign-description')).toBeNull();

      personaLoaded.set(true);
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-persona-loading')).toBeNull();
      expect(query(fixture, 'meetings-redesign-description')).toBeTruthy();
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

    it('shows one page of rows, the next one when the trigger scrolls into view', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(
        fixture,
        Array.from({ length: MEETINGS_HOME_PAGE_SIZE + 5 }, (_, index) => buildMeeting(index))
      );

      expect(rowTitles(fixture)).toHaveLength(MEETINGS_HOME_PAGE_SIZE);
      observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await fixture.whenStable();

      expect(rowTitles(fixture)).toHaveLength(MEETINGS_HOME_PAGE_SIZE + 5);
      expect(query(fixture, 'meetings-home-load-more')).toBeNull();
    });

    it('scrolls the list back to its start on a search, filter or tab change, so a page loads only on a scroll', async () => {
      const fixture = render();
      await fixture.whenStable();
      const pastMeeting = { ...buildMeeting(99, { start_time: new Date(Date.now() - DAY_MS).toISOString() }), occurrence_id: '' } as PastMeeting;
      await loadFeeds(
        fixture,
        Array.from({ length: MEETINGS_HOME_PAGE_SIZE * 2 + 1 }, (_, index) => buildMeeting(index)),
        [pastMeeting]
      );
      observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await fixture.whenStable();
      expect(rowTitles(fixture)).toHaveLength(MEETINGS_HOME_PAGE_SIZE * 2);

      // Scrolled 500px into the list, or the chips above it; the header and tabs bar are 80px each.
      let listTop = HEADER_HEIGHT * 2 - 500;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, this.matches('[data-testid="meetings-home-filters-chips"], [data-testid="meetings-home-list"]') ? listTop : 0, 100, 1000);
      });
      elementScrollBy.mockClear();

      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'meeting';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(rowTitles(fixture)).toHaveLength(MEETINGS_HOME_PAGE_SIZE);
      expect(elementScrollBy).toHaveBeenLastCalledWith({ top: -500 });

      fixture.debugElement
        .query(By.directive(MeetingsFiltersComponent))
        .componentInstance.filters.set({ ...MEETINGS_HOME_DEFAULT_FILTERS, meetingType: 'Technical' });
      await fixture.whenStable();
      expect(elementScrollBy).toHaveBeenCalledTimes(2);
      expect(elementScrollBy).toHaveBeenLastCalledWith({ top: -500 });

      query(fixture, 'ui-tab-past')?.click();
      await fixture.whenStable();
      expect(elementScrollBy).toHaveBeenCalledTimes(3);

      // A list that still starts below the tabs bar stays where it is.
      listTop = HEADER_HEIGHT * 2;
      query(fixture, 'ui-tab-upcoming')?.click();
      await fixture.whenStable();
      expect(elementScrollBy).toHaveBeenCalledTimes(3);
    });

    it('scrolls the window back to the list start at 1024px and below', async () => {
      desktop = false;
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1), buildMeeting(2)]);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, this.dataset['testid'] === 'meetings-home-list' ? -300 : 0, 100, 1000);
      });
      windowScrollBy.mockClear();

      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'meeting';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(windowScrollBy).toHaveBeenLastCalledWith({ top: -300 - HEADER_HEIGHT * 2 });
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
      expect(rowTitles(fixture)).toEqual(['Meeting 0', 'Meeting 1']);
    });

    it('shows the empty state for a tab without meetings and hides the search and filters bar', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, []);

      const empty = fixture.debugElement.query(By.css('[data-testid="meetings-home-empty-upcoming"]')).componentInstance;
      expect(empty.size()).toBe('default');
      expect(query(fixture, 'meetings-home-empty-upcoming')?.textContent).toContain('No upcoming meetings');
      expect(query(fixture, 'meetings-home-empty-upcoming')?.textContent).toContain('Meetings from your committees and projects will appear here.');
      expect(query(fixture, 'meetings-redesign-search')).toBeNull();
      expect(query(fixture, 'meetings-home-filters-button')).toBeNull();
      expect(query(fixture, 'meetings-home-list')).toBeNull();

      query(fixture, 'ui-tab-past')?.click();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-empty-past')?.textContent).toContain('No past meetings');
      expect(query(fixture, 'meetings-home-empty-past')?.textContent).toContain('Your past meetings will appear here.');
      expect(query(fixture, 'meetings-home-empty-past')?.querySelector('button')).toBeNull();
    });

    it("lists the Next meeting card's date when the search matches only it", async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0, { title: 'Board Review' }), buildMeeting(1)]);
      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'board';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(rowTitles(fixture)).toEqual(['Board Review']);
      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
      expect(query(fixture, 'meetings-redesign-rail-next-meeting')?.textContent).toContain('Board Review');
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
      expect(query(fixture, 'meetings-home-no-results')?.textContent).toContain('No meetings match your search');
      expect(query(fixture, 'meetings-home-no-results')?.querySelector('[data-testid="ui-empty-state-icon"] i')?.classList).toContain('fa-eyes');
      const reset = button(fixture, 'meetings-home-no-results-reset');
      expect([reset.variant(), reset.size(), reset.icon()]).toEqual(['tertiary-accent', 'large', 'fa-light fa-arrow-rotate-left']);
      // The search and filters stay, so the query can still be changed.
      expect(query(fixture, 'meetings-redesign-search')).toBeTruthy();

      (query(fixture, 'meetings-home-no-results-reset')?.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
      expect(rowTitles(fixture)).toEqual(['Meeting 0', 'Meeting 1']);
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
      expect(rowTitles(fixture)).toEqual(['Meeting 0', 'Board Review', 'Tech Sync']);
      expect(document.activeElement).toBe(query(fixture, 'meetings-home-filters-button')?.querySelector('button'));
      fixture.nativeElement.remove();
    });

    it("lists the Next meeting card's date when the filters match only it", async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0, { title: 'Board Review', created_by: { username: 'viewer', email: 'viewer@example.test' } }), buildMeeting(1)]);
      await applyOrganizedByMe(fixture);

      expect(rowTitles(fixture)).toEqual(['Board Review']);
      expect(query(fixture, 'meetings-home-no-results')).toBeNull();
    });

    it('asks to adjust the filters when only filters match nothing', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, [buildMeeting(0), buildMeeting(1)]);
      await applyOrganizedByMe(fixture);

      expect(rowTitles(fixture)).toEqual([]);
      expect(query(fixture, 'meetings-home-no-results')?.textContent).toContain('No results found');
      expect(query(fixture, 'meetings-home-no-results')?.textContent).toContain('Try adjusting your filter criteria');
    });

    it('clears the filters and the search from the No results reset', async () => {
      const fixture = render();
      await fixture.whenStable();
      await loadFeeds(fixture, meetings());
      await applyOrganizedByMe(fixture);
      const input = query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement;
      input.value = 'sync';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      // A filter with a search reads as a filter miss.
      expect(query(fixture, 'meetings-home-no-results')?.textContent).toContain('No meetings match your filters');

      (query(fixture, 'meetings-home-no-results-reset')?.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(chips(fixture)).toEqual([]);
      expect((query(fixture, 'meetings-redesign-search')?.querySelector('input') as HTMLInputElement).value).toBe('');
      expect(rowTitles(fixture)).toEqual(['Meeting 0', 'Board Review', 'Tech Sync']);
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
