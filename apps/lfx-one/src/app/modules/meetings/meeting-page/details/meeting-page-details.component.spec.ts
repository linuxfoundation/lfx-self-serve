// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { MEETING_PAGE_GUEST_FORM_STATE, MEETING_PAGE_LEGACY_STATE } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeRow, MeetingOccurrence, MeetingRsvp, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsBodyComponent } from '../../meetings-redesign/components/meeting-details-drawer/body/meeting-details-body.component';
import { MeetingDetailsContext } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.context';
import { MeetingDetailsSource } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.source';
import { MeetingPageDataService } from '../../services/meeting-page-data.service';
import { MeetingPageDetailsComponent, MeetingPageRowHost } from './meeting-page-details.component';

const PAST_ROW = {
  key: '123-1700000000000',
  meeting: { id: '123-1700000000000', meeting_id: '123', meeting_and_occurrence_id: '123-1700000000000', title: 'Review' } as PastMeeting,
  occurrence: null,
  title: 'Review',
  occurrenceId: null,
  startTime: '2023-11-14T22:13:20.000Z',
  durationMinutes: 30,
} as MeetingHomeRow;

const date = (id: string, start: string): MeetingOccurrence => ({ occurrence_id: id, start_time: start, duration: 30 }) as MeetingOccurrence;
const SERIES = {
  id: '123',
  title: 'Review',
  recurrence: { type: 2, repeat_interval: 1 },
  invited: true,
  occurrences: [date('1', '2030-01-01T10:00:00Z'), date('2', '2030-01-08T10:00:00Z'), date('3', '2030-01-15T10:00:00Z'), date('4', '2030-01-22T10:00:00Z')],
  cancelled_occurrences: ['3'],
} as unknown as Meeting;
const UPCOMING_ROW = {
  key: '123:2',
  meeting: SERIES,
  occurrence: SERIES.occurrences![1],
  title: 'Review',
  occurrenceId: '2',
  startTime: '2030-01-08T10:00:00Z',
  durationMinutes: 30,
} as MeetingHomeRow;

describe('MeetingPageDetailsComponent', () => {
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let claimJoinOnLoad: ReturnType<typeof vi.fn>;
  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getMeetingRsvpForCurrentUser: ReturnType<typeof vi.fn>;
  let confirmed: ReturnType<typeof signal<MeetingRsvp[]>>;
  let route: { snapshot: { paramMap: ReturnType<typeof convertToParamMap>; queryParamMap: ReturnType<typeof convertToParamMap> } };
  let occurrence: ReturnType<typeof signal<MeetingOccurrence | null>>;
  let row: ReturnType<typeof signal<MeetingHomeRow | null>>;
  let pastMeetingId: ReturnType<typeof signal<string | null>>;

  const source = (): MeetingDetailsSource => {
    const fixture = TestBed.createComponent(MeetingPageDetailsComponent);
    return fixture.debugElement.query(By.css('lfx-meeting-details-body')).injector.get(MeetingDetailsSource);
  };

  const urlPassword = signal<string | null>(null);

  beforeEach(() => {
    urlPassword.set(null);
    navigateByUrl = vi.fn().mockResolvedValue(true);
    navigate = vi.fn().mockResolvedValue(true);
    refresh = vi.fn();
    claimJoinOnLoad = vi.fn().mockReturnValue(true);
    getMeetingDetail = vi.fn();
    getMeetingRsvpForCurrentUser = vi.fn().mockReturnValue(of(null));
    confirmed = signal<MeetingRsvp[]>([]);
    route = { snapshot: { paramMap: convertToParamMap({ id: '123' }), queryParamMap: convertToParamMap({}) } };
    occurrence = signal<MeetingOccurrence | null>(null);
    row = signal<MeetingHomeRow | null>(PAST_ROW);
    pastMeetingId = signal<string | null>(PAST_ROW.key);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { url: '/meetings/123', navigateByUrl, navigate } },
        { provide: ActivatedRoute, useValue: route },
        { provide: MeetingPageRowHost, useValue: { row } },
        {
          provide: MeetingPageDataService,
          useValue: {
            clock: signal(Date.parse('2026-01-01T00:00:00Z')),
            refresh,
            claimJoinOnLoad,
            reloadOnNextLoad: vi.fn(),
            loadedViaPastMeetingId: signal(false),
            liveMeetingFullAccess: signal(true),
            pastMeetingFullAccess: signal(true),
            urlPassword,
          },
        },
        { provide: MeetingService, useValue: { getMeetingDetail, getMeetingRsvpForCurrentUser } },
        { provide: UserService, useValue: { authenticated: signal(true), confirmedMeetingRsvps: () => confirmed() } },
      ],
    });
    TestBed.overrideComponent(MeetingPageDetailsComponent, {
      remove: { imports: [MeetingDetailsBodyComponent], providers: [MeetingDetailsContext] },
      add: {
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [{ provide: MeetingDetailsContext, useValue: { pastMeetingId, occurrence, shownRow: () => row() } }],
      },
    });
  });

  it('gives the details the host row and the page clock, with no dialog or list', () => {
    const page = source();

    expect(page.row).toBe(PAST_ROW);
    expect(page.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(page.hostRef).toBeNull();
    expect(page.upcomingRows()).toEqual([]);
    expect(page.fullAccess).toBe(true);
  });

  it('opens a past row at its {id}-{ms} page', () => {
    source().open(PAST_ROW);

    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/123-1700000000000');
  });

  it('opens an upcoming date of a series at its occurrence', () => {
    const start = '2030-01-08T10:00:00.000Z';
    source().open({ ...PAST_ROW, meeting: { id: '123' } as Meeting, occurrenceId: 'occ-2', startTime: start });

    expect(navigateByUrl).toHaveBeenCalledWith(`/meetings/123?occurrence=${Date.parse(start)}`);
  });

  it('keeps the passcode from the address bar when opening another date of a series', () => {
    urlPassword.set('secret');
    const start = '2030-01-08T10:00:00.000Z';
    source().open({ ...PAST_ROW, meeting: { id: '123' } as Meeting, occurrenceId: 'occ-2', startTime: start });

    expect(navigateByUrl).toHaveBeenCalledWith(`/meetings/123?occurrence=${Date.parse(start)}&password=secret`);
  });

  it('gives another past date picked in place its own page', () => {
    const fixture = TestBed.createComponent(MeetingPageDetailsComponent);
    TestBed.tick();
    expect(navigateByUrl).not.toHaveBeenCalled();

    occurrence.set(date('1700604800', '2023-11-21T22:13:20.000Z'));
    pastMeetingId.set('123-1700604800000');
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/123-1700604800000');
    fixture.destroy();
  });

  it('lets Join open Zoom on load as the page allows, and joins with another email on the legacy page', () => {
    const page = source();

    expect(page.claimJoinOnLoad?.()).toBe(true);
    page.joinWithOtherEmail?.();
    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/123', {
      skipLocationChange: true,
      onSameUrlNavigation: 'reload',
      state: { [MEETING_PAGE_LEGACY_STATE]: true, [MEETING_PAGE_GUEST_FORM_STATE]: true },
    });
  });

  it('flips an upcoming date to ended in place instead of opening its past record', () => {
    row.set(UPCOMING_ROW);
    occurrence.set(UPCOMING_ROW.occurrence);
    pastMeetingId.set(null);
    const fixture = TestBed.createComponent(MeetingPageDetailsComponent);
    TestBed.tick();

    pastMeetingId.set(`123-${Date.parse(UPCOMING_ROW.startTime)}`);
    TestBed.tick();

    expect(navigateByUrl).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('gives another coming date picked in place its own ?occurrence= page', () => {
    row.set(UPCOMING_ROW);
    occurrence.set(UPCOMING_ROW.occurrence);
    pastMeetingId.set(null);
    const fixture = TestBed.createComponent(MeetingPageDetailsComponent);
    TestBed.tick();
    expect(navigateByUrl).not.toHaveBeenCalled();

    occurrence.set(SERIES.occurrences![3]);
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledWith(`/meetings/123?occurrence=${Date.parse('2030-01-22T10:00:00Z')}`);
    fixture.destroy();
  });

  describe("the viewer's answer", () => {
    const answer = (response: 'accepted' | 'declined', updated: string): MeetingRsvp =>
      ({ id: response, response_type: response, scope: 'all', updated_at: updated }) as MeetingRsvp;

    it('loads the saved answer for the shown date and overlays one saved on the page', () => {
      row.set(UPCOMING_ROW);
      getMeetingRsvpForCurrentUser.mockReturnValue(of(answer('accepted', '2029-01-01T00:00:00Z')));
      const page = source();
      TestBed.tick();

      expect(getMeetingRsvpForCurrentUser).toHaveBeenCalledWith('123', '2');
      expect(page.upcomingRows()[0]).toMatchObject({ key: '123:2', myRsvp: { response_type: 'accepted' } });

      confirmed.set([answer('declined', '2029-06-01T00:00:00Z')]);
      expect(page.upcomingRows()[0].myRsvp?.response_type).toBe('declined');
    });

    it('loads none for a past row', () => {
      expect(source().upcomingRows()).toEqual([]);
      expect(getMeetingRsvpForCurrentUser).not.toHaveBeenCalled();
    });

    it('asks no server for a viewer who is not invited, but shows an answer saved after registering here', () => {
      row.set({ ...UPCOMING_ROW, meeting: { ...SERIES, invited: false } });
      const page = source();
      TestBed.tick();

      expect(getMeetingRsvpForCurrentUser).not.toHaveBeenCalled();
      expect(page.upcomingRows()[0].myRsvp).toBeNull();
      confirmed.set([answer('accepted', '2029-06-01T00:00:00Z')]);
      expect(page.upcomingRows()[0].myRsvp?.response_type).toBe('accepted');
    });
  });

  describe('after a date is cancelled', () => {
    it('shows the next active date of the series at ?occurrence=, without a history entry', () => {
      source().occurrenceCancelled?.(SERIES, SERIES.occurrences![1]);

      expect(navigate).toHaveBeenCalledWith(['/meetings', '123'], {
        queryParams: { occurrence: String(Date.parse('2030-01-22T10:00:00Z')) },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    it('drops ?occurrence= when no date follows', () => {
      route.snapshot.queryParamMap = convertToParamMap({ occurrence: String(Date.parse('2030-01-22T10:00:00Z')) });
      source().occurrenceCancelled?.(SERIES, SERIES.occurrences![3]);

      expect(navigate).toHaveBeenCalledWith(['/meetings', '123'], expect.objectContaining({ queryParams: { occurrence: null } }));
    });

    it('reloads the meeting when the URL would not change', () => {
      source().occurrenceCancelled?.(SERIES, SERIES.occurrences![3]);

      expect(navigate).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalled();
    });
  });

  describe('after an edit is saved', () => {
    const save = (): void => {
      TestBed.createComponent(MeetingPageDetailsComponent);
      TestBed.tick();
      TestBed.inject(MeetingComposerService).notifySaved();
      TestBed.tick();
    };

    it('follows a moved date to its new start', () => {
      row.set(UPCOMING_ROW);
      getMeetingDetail.mockReturnValue(of({ ...SERIES, occurrences: [date('2', '2030-01-09T12:00:00Z')] }));
      save();

      expect(getMeetingDetail).toHaveBeenCalledWith('123', { skipCache: true });
      expect(navigate).toHaveBeenCalledWith(
        ['/meetings', '123'],
        expect.objectContaining({ queryParams: { occurrence: String(Date.parse('2030-01-09T12:00:00Z')) } })
      );
    });

    it('reloads the meeting for a one-time meeting', () => {
      row.set({ ...UPCOMING_ROW, key: '123', meeting: { ...SERIES, recurrence: null }, occurrence: null, occurrenceId: null });
      save();

      expect(getMeetingDetail).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalled();
    });
  });
});
