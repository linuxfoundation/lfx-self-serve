// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DashboardMeetingCardComponent } from './dashboard-meeting-card.component';

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    created_at: '',
    modified_at: '',
    project_uid: '',
    start_time: '2024-01-04T15:00:00Z',
    duration: 60,
    timezone: 'UTC',
    title: 'LFX Extended Leadership',
    description: '',
    recurrence: null,
    committees: [],
    meeting_type: null,
    visibility: null,
    restricted: null,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: null,
    invited: false,
    occurrences: [],
    ...overrides,
  };
}

describe('DashboardMeetingCardComponent', () => {
  let fixture: ComponentFixture<DashboardMeetingCardComponent>;

  let getPastMeetingRecording: ReturnType<typeof vi.fn>;
  let resendMyMeetingInvitation: ReturnType<typeof vi.fn>;
  let toastAdd: ReturnType<typeof vi.fn>;
  let removedIds: WritableSignal<ReadonlySet<string>>;

  const render = async (
    meeting: Meeting,
    options?: { occurrence?: MeetingOccurrence | null; pastMeeting?: boolean; authenticated?: boolean; removedMeetingIds?: string[] }
  ): Promise<void> => {
    getPastMeetingRecording = vi.fn(() => of(null));
    resendMyMeetingInvitation = vi.fn(() => of({ message: 'Invitation resent successfully' }));
    toastAdd = vi.fn();
    removedIds = signal<ReadonlySet<string>>(new Set(options?.removedMeetingIds ?? []));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DashboardMeetingCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            // The real service derives the join identity from `user` when not impersonating.
            get meetingJoinIdentity() {
              return this.user;
            },
            authenticated: signal(options?.authenticated ?? false),
          },
        },
        {
          provide: MeetingService,
          useValue: {
            getPublicMeetingJoinUrl: vi.fn(() => of(null)),
            getPastMeetingRecording,
            resendMyMeetingInvitation,
            removedRegistrationMeetingIds: removedIds,
          },
        },
        { provide: MessageService, useValue: { add: toastAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardMeetingCardComponent);
    fixture.componentRef.setInput('meeting', meeting);
    if (options?.occurrence !== undefined) {
      fixture.componentRef.setInput('occurrence', options.occurrence);
    }
    if (options?.pastMeeting !== undefined) {
      fixture.componentRef.setInput('pastMeeting', options.pastMeeting);
    }
    fixture.detectChanges();
  };

  it('shows the next occurrence instead of the recurring series origin', async () => {
    await render(
      buildMeeting({
        start_time: '2024-01-04T15:00:00Z',
        next_occurrence_start_time: '2026-10-01T15:00:00Z',
      })
    );

    expect(fixture.componentInstance.meetingStartTime()).toBe('2026-10-01T15:00:00Z');
  });

  it('prefers an explicit occurrence over next_occurrence_start_time', async () => {
    await render(buildMeeting({ next_occurrence_start_time: '2026-10-01T15:00:00Z' }), {
      occurrence: { occurrence_id: 'occ-1', start_time: '2026-10-08T15:00:00Z', duration: 45 },
    });

    expect(fixture.componentInstance.meetingStartTime()).toBe('2026-10-08T15:00:00Z');
  });

  it('keeps a past card on its own start time', async () => {
    await render(buildMeeting({ start_time: '2026-09-01T15:00:00Z', next_occurrence_start_time: '2026-10-01T15:00:00Z' }), {
      pastMeeting: true,
    });

    expect(fixture.componentInstance.meetingStartTime()).toBe('2026-09-01T15:00:00Z');
  });

  it('opens the join window for the next occurrence, not the series origin', async () => {
    const nextStart = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await render(
      buildMeeting({
        start_time: '2024-01-04T15:00:00Z',
        duration: 60,
        next_occurrence_start_time: nextStart,
      })
    );

    expect(fixture.componentInstance.canJoinMeeting()).toBe(true);
  });

  it('does not load a recording for a future occurrence whose series origin is past', async () => {
    const nextStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await render(
      buildMeeting({
        start_time: '2024-01-04T15:00:00Z',
        duration: 60,
        recording_enabled: true,
        next_occurrence_start_time: nextStart,
      })
    );

    expect(getPastMeetingRecording).not.toHaveBeenCalled();
    expect(fixture.componentInstance.recordingShareUrl()).toBeNull();
  });

  it('shows the type chip for a recognized meeting type', async () => {
    await render(buildMeeting({ meeting_type: 'Technical' }));

    const chip = fixture.nativeElement.querySelector('[data-testid="dashboard-meeting-card-type-chip"]');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('Technical');
  });

  it.each([null, 'Unknown'])('hides the type chip when the meeting type is %s', async (meetingType) => {
    await render(buildMeeting({ meeting_type: meetingType }));

    expect(fixture.componentInstance.meetingTypeInfo()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="dashboard-meeting-card-type-chip"]')).toBeNull();
  });

  describe('resend my invitation', () => {
    const RESEND_BUTTON = '[data-testid="dashboard-meeting-card-resend-button"]';

    it('offers the action to a signed-in invitee on an upcoming meeting', async () => {
      await render(buildMeeting({ invited: true }), { authenticated: true });

      expect(fixture.componentInstance.canResendInvite()).toBe(true);
      expect(fixture.nativeElement.querySelector(RESEND_BUTTON)).not.toBeNull();
    });

    it.each([
      ['signed out', buildMeeting({ invited: true }), { authenticated: false }],
      ['not invited', buildMeeting({ invited: false }), { authenticated: true }],
      ['a past meeting', buildMeeting({ invited: true }), { authenticated: true, pastMeeting: true }],
      ['an organizer who is not registered themselves', buildMeeting({ invited: true, organizer: true, my_registrant_ids: [] }), { authenticated: true }],
    ])('does not offer the action when %s', async (_label, meeting, options) => {
      await render(meeting, options);

      expect(fixture.componentInstance.canResendInvite()).toBe(false);
      expect(fixture.nativeElement.querySelector(RESEND_BUTTON)).toBeNull();
    });

    it('offers the action to an organizer who also has a registration of their own', async () => {
      await render(buildMeeting({ invited: true, organizer: true, my_registrant_ids: ['reg-1'] }), { authenticated: true });

      expect(fixture.componentInstance.canResendInvite()).toBe(true);
    });

    it('resends to the viewer, without a confirmation, when clicked', async () => {
      await render(buildMeeting({ invited: true }), { authenticated: true });

      fixture.nativeElement.querySelector(RESEND_BUTTON).click();

      // A one-time meeting has no occurrences to tell apart, so no occurrence is named.
      expect(resendMyMeetingInvitation).toHaveBeenCalledWith('meeting-1', null);
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Invitation Sent' }));
    });

    describe('when only the meeting is passed, as on Groups Overview', () => {
      const NEXT_START = '2030-03-07T15:00:00Z';
      const recurring = { recurrence: { type: 'weekly' } } as unknown as Partial<Meeting>;

      it('names the occurrence of the date the card shows, found in the meeting occurrences', async () => {
        await render(
          buildMeeting({
            ...recurring,
            invited: true,
            next_occurrence_start_time: NEXT_START,
            occurrences: [
              { occurrence_id: 'occ-earlier', start_time: '2030-02-28T15:00:00Z', duration: 60 },
              { occurrence_id: 'occ-next', start_time: NEXT_START, duration: 60 },
            ] as Meeting['occurrences'],
          }),
          { authenticated: true }
        );

        fixture.nativeElement.querySelector(RESEND_BUTTON).click();

        expect(resendMyMeetingInvitation).toHaveBeenCalledWith('meeting-1', 'occ-next');
      });

      it("falls back to the shown start's Unix seconds when the list has no matching occurrence", async () => {
        await render(buildMeeting({ ...recurring, invited: true, next_occurrence_start_time: NEXT_START }), { authenticated: true });

        fixture.nativeElement.querySelector(RESEND_BUTTON).click();

        expect(resendMyMeetingInvitation).toHaveBeenCalledWith('meeting-1', String(Date.parse(NEXT_START) / 1000));
      });
    });

    it('does not offer the action to a non-organizer whose feed shows no active registration, even though invited is true', async () => {
      await render(buildMeeting({ invited: true, my_registrant_ids: [] }), { authenticated: true });

      expect(fixture.componentInstance.canResendInvite()).toBe(false);
      expect(fixture.nativeElement.querySelector(RESEND_BUTTON)).toBeNull();
    });

    it('offers the action to a non-organizer whose feed lists an active registration', async () => {
      await render(buildMeeting({ invited: true, my_registrant_ids: ['reg-1'] }), { authenticated: true });

      expect(fixture.componentInstance.canResendInvite()).toBe(true);
    });

    it('resends for the occurrence the card is showing, so the matching registration is chosen', async () => {
      await render(buildMeeting({ invited: true }), {
        authenticated: true,
        occurrence: { occurrence_id: 'occ-b', start_time: '2026-10-08T15:00:00Z', duration: 45 },
      });

      fixture.nativeElement.querySelector(RESEND_BUTTON).click();

      expect(resendMyMeetingInvitation).toHaveBeenCalledWith('meeting-1', 'occ-b');
    });

    it('does not offer the action when the viewer already removed themselves, even if the cached feed still says invited', async () => {
      await render(buildMeeting({ invited: true }), { authenticated: true, removedMeetingIds: ['meeting-1'] });

      expect(fixture.componentInstance.canResendInvite()).toBe(false);
      expect(fixture.nativeElement.querySelector(RESEND_BUTTON)).toBeNull();
    });

    it('stops offering the action as soon as the viewer removes themselves elsewhere', async () => {
      await render(buildMeeting({ invited: true }), { authenticated: true });
      expect(fixture.nativeElement.querySelector(RESEND_BUTTON)).not.toBeNull();

      removedIds.update((ids) => new Set(ids).add('meeting-1'));
      fixture.detectChanges();

      expect(fixture.componentInstance.canResendInvite()).toBe(false);
      expect(fixture.nativeElement.querySelector(RESEND_BUTTON)).toBeNull();
    });

    it('still offers the action for a different meeting the viewer has not removed themselves from', async () => {
      await render(buildMeeting({ invited: true }), { authenticated: true, removedMeetingIds: ['meeting-2'] });

      expect(fixture.componentInstance.canResendInvite()).toBe(true);
    });

    it('disables the button while a resend is in flight and ignores a second click', async () => {
      const pending$ = new Subject<{ message: string }>();
      await render(buildMeeting({ invited: true }), { authenticated: true });
      resendMyMeetingInvitation.mockReturnValue(pending$);

      const button: HTMLButtonElement = fixture.nativeElement.querySelector(RESEND_BUTTON);
      button.click();
      fixture.detectChanges();

      expect(button.disabled).toBe(true);
      fixture.componentInstance.resendInvite();
      expect(resendMyMeetingInvitation).toHaveBeenCalledTimes(1);

      pending$.next({ message: 'ok' });
      pending$.complete();
      fixture.detectChanges();

      expect(button.disabled).toBe(false);
    });
  });

  describe('when the card shows one date of a recurring meeting', () => {
    const first: MeetingOccurrence = { occurrence_id: 'o1', title: 'Weekly', description: '', start_time: '2026-11-10T15:00:00Z', duration: 30 };
    const later: MeetingOccurrence = { occurrence_id: 'o2', title: 'Weekly', description: '', start_time: '2026-11-17T15:00:00Z', duration: 30 };
    const laterMs = String(new Date(later.start_time).getTime());
    const series = (overrides: Partial<Meeting> = {}): Meeting => buildMeeting({ id: 'series-1', occurrences: [first, later], ...overrides });

    it('names that date in the meeting details link', async () => {
      await render(series(), { occurrence: later });

      expect(fixture.componentInstance.meetingDetailQueryParams()).toEqual({ occurrence: laterMs });
      expect(fixture.componentInstance.meetingDetailHref()).toBe(`/meetings/series-1?occurrence=${laterMs}`);
    });

    it('names that date in the copied link, next to the password', async () => {
      await render(series({ password: 'pass-1' }), { occurrence: later });

      expect(fixture.componentInstance.meetingDetailQueryParams()).toEqual({ password: 'pass-1', occurrence: laterMs });
      expect(fixture.componentInstance.meetingDetailClipboardUrl()).toContain(`occurrence=${laterMs}`);
      expect(fixture.componentInstance.meetingDetailClipboardUrl()).toContain('password=pass-1');
    });

    it('follows the date when the card moves to another one', async () => {
      await render(series(), { occurrence: first });
      expect(fixture.componentInstance.meetingDetailQueryParams()).toEqual({ occurrence: String(new Date(first.start_time).getTime()) });

      fixture.componentRef.setInput('occurrence', later);
      fixture.detectChanges();

      expect(fixture.componentInstance.meetingDetailQueryParams()).toEqual({ occurrence: laterMs });
    });

    it('adds no date for a meeting that does not recur, or when the host passes none', async () => {
      await render(buildMeeting({ id: 'single-1', occurrences: [] }), { occurrence: later });
      expect(fixture.componentInstance.meetingDetailQueryParams()).toEqual({});

      await render(series());
      expect(fixture.componentInstance.meetingDetailQueryParams()).toEqual({});
    });
  });

  describe('join link while the meeting changes', () => {
    const soon = (): string => new Date(Date.now() + 60 * 1000).toISOString();

    it("never shows the previous meeting's link while the next one loads", async () => {
      await render(buildMeeting({ id: 'm1', start_time: soon() }), { authenticated: true });
      const joinUrl = TestBed.inject(MeetingService).getPublicMeetingJoinUrl as unknown as ReturnType<typeof vi.fn>;
      const user = TestBed.inject(UserService).user as unknown as WritableSignal<{ email: string } | null>;
      joinUrl.mockReturnValueOnce(of({ link: 'https://zoom.example/j/1' }));

      user.set({ email: 'viewer@example.test' });
      await fixture.whenStable();
      expect(fixture.componentInstance.joinUrl()).toContain('zoom.example/j/1');

      const second$ = new Subject<{ link: string }>();
      joinUrl.mockReturnValueOnce(second$);
      fixture.componentRef.setInput('meeting', buildMeeting({ id: 'm2', start_time: soon() }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.joinUrl()).toBeNull();

      second$.next({ link: 'https://zoom.example/j/2' });
      second$.complete();
      await fixture.whenStable();

      expect(fixture.componentInstance.joinUrl()).toContain('zoom.example/j/2');
    });
  });

  describe('header pager', () => {
    const pager = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="dashboard-meeting-card-pager"]');
    const button = (kind: 'previous' | 'next'): HTMLButtonElement =>
      fixture.nativeElement.querySelector(`[data-testid="dashboard-meeting-card-pager-${kind}"]`) as HTMLButtonElement;
    const position = (): string => (fixture.nativeElement.querySelector('[data-testid="dashboard-meeting-card-pager-position"]')?.textContent ?? '').trim();
    const configure = (inputs: { pagerIndex?: number; pagerTotal?: number; cardLabel?: string | null }): void => {
      for (const [name, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(name, value);
      }
      fixture.detectChanges();
    };

    it('shows no pager unless the host opts in, so other cards are unchanged', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'LAST MEETING' });

      expect(pager()).toBeNull();
    });

    it('shows no pager for a set of one meeting', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'NEXT MEETING', pagerIndex: 0, pagerTotal: 1 });

      expect(pager()).toBeNull();
    });

    it('shows a one-based position out of the total', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'NEXT MEETING', pagerIndex: 1, pagerTotal: 5 });

      expect(position()).toBe('2 of 5');
      expect(button('previous').getAttribute('aria-label')).toBe('Previous upcoming meeting');
      expect(button('next').getAttribute('aria-label')).toBe('Next upcoming meeting');
    });

    it('disables previous on the first meeting and next on the last', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'NEXT MEETING', pagerIndex: 0, pagerTotal: 3 });
      expect(button('previous').getAttribute('aria-disabled')).toBe('true');
      expect(button('next').getAttribute('aria-disabled')).toBe('false');

      configure({ pagerIndex: 2 });
      expect(button('previous').getAttribute('aria-disabled')).toBe('false');
      expect(button('next').getAttribute('aria-disabled')).toBe('true');
    });

    it('ignores a press on a button that is dimmed at the end of the range', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'NEXT MEETING', pagerIndex: 0, pagerTotal: 3 });
      const previous = vi.fn();
      fixture.componentInstance.pagerPrevious.subscribe(previous);

      button('previous').click();

      expect(previous).not.toHaveBeenCalled();
    });

    it('keeps keyboard focus on the button when the end of the range is reached', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'NEXT MEETING', pagerIndex: 1, pagerTotal: 3 });
      button('next').focus();

      configure({ pagerIndex: 2 });

      expect(button('next').getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(button('next'));
    });

    it('emits when the buttons are used', async () => {
      await render(buildMeeting());
      configure({ cardLabel: 'NEXT MEETING', pagerIndex: 1, pagerTotal: 3 });
      const previous = vi.fn();
      const next = vi.fn();
      fixture.componentInstance.pagerPrevious.subscribe(previous);
      fixture.componentInstance.pagerNext.subscribe(next);

      button('previous').click();
      button('next').click();

      expect(previous).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
