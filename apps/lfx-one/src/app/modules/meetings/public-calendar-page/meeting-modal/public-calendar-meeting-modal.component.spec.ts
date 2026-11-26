// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PublicCalendarMeeting, PublicCalendarMeetingModalData } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { MeetingsHomeDialogsService } from '../../meetings-redesign/services/meetings-home-dialogs.service';
import { PublicCalendarMeetingModalComponent } from './public-calendar-meeting-modal.component';

const START = new Date(Date.now() + 3 * 86_400_000);
START.setHours(10, 0, 0, 0);

const meeting = (over: Partial<PublicCalendarMeeting> = {}): PublicCalendarMeeting => ({
  id: 'series-1',
  title: 'Technical Steering Committee',
  start_time: START.toISOString(),
  duration: 60,
  timezone: 'UTC',
  meeting_type: 'Technical',
  restricted: false,
  recurrence: { type: 2, repeat_interval: 1, weekly_days: String(START.getDay() + 1) },
  description: 'Roadmap review',
  occurrences: [{ occurrence_id: '1790000000', start_time: START.toISOString(), duration: 60 }],
  ...over,
});

/** Exposes where sign-in returns, which the real button hands to `location.assign`. */
@Component({ selector: 'lfx-public-calendar-meeting-modal-state', template: '' })
class SignInUrlComponent extends PublicCalendarMeetingModalComponent {
  public returnUrl(): string {
    return this.signInUrl();
  }
}

describe('PublicCalendarMeetingModalComponent', () => {
  let signedIn: boolean;
  let navigate: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let registerClosed: Subject<unknown>;
  let services: { getPublicMeeting: ReturnType<typeof vi.fn>; getPublicPastMeeting: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    signedIn = false;
    navigate = vi.fn().mockResolvedValue(true);
    show = vi.fn();
    close = vi.fn();
    registerClosed = new Subject();
    services = {
      getPublicMeeting: vi.fn(() => of({ meeting: { invited: false }, project: {}, full_access: true, can_join: false })),
      getPublicPastMeeting: vi.fn(() => of({ meeting: { recording_enabled: true, ai_summary_enabled: false }, project: {}, full_access: false })),
    };
  });

  const configure = (data: Partial<PublicCalendarMeetingModalData> = {}): void => {
    const source = data.meeting ?? meeting();
    const modalData: PublicCalendarMeetingModalData = {
      meeting: source,
      entry: { key: 'series-1-1790000000', title: source.title, type: source.meeting_type, startTime: START.toISOString(), durationMinutes: 60, past: false },
      groups: ['TSC'],
      ...data,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: modalData },
        { provide: DialogRef, useValue: { id: 'modal', close } },
        { provide: Router, useValue: { navigate, url: '/projects/synthetic/calendar?meeting=series-1-1790000000' } },
        { provide: MeetingService, useValue: { ...services, getPastMeetingRecording: vi.fn(), getPastMeetingSummary: vi.fn() } },
        { provide: UserService, useValue: { authenticated: signal(signedIn), user: signal(null) } },
        { provide: UiModalService, useValue: { open: vi.fn(() => ({ closed: registerClosed })) } },
        { provide: UiToastService, useValue: { show } },
        { provide: MeetingsHomeDialogsService, useValue: { openRecording: vi.fn() } },
      ],
    });
  };
  const render = async (data: Partial<PublicCalendarMeetingModalData> = {}): Promise<ComponentFixture<PublicCalendarMeetingModalComponent>> => {
    configure(data);
    const fixture = TestBed.createComponent(PublicCalendarMeetingModalComponent);
    await fixture.whenStable();
    return fixture;
  };
  const text = (fixture: ComponentFixture<PublicCalendarMeetingModalComponent>, testId: string): string =>
    (fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const click = async (fixture: ComponentFixture<PublicCalendarMeetingModalComponent>, testId: string): Promise<void> => {
    fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`)?.click();
    await fixture.whenStable();
  };

  it('shows the type, the date in the viewer zone, the cadence, groups and agenda, with sign-in to register when signed out', async () => {
    const fixture = await render();

    expect(text(fixture, 'public-calendar-modal-type')).toBe('Technical');
    expect(text(fixture, 'public-calendar-modal-when')).toMatch(/^\w{3}, \w{3} \d+ · 10:00 AM \S+ · 60 min$/);
    expect(text(fixture, 'public-calendar-modal-meta')).toContain('Weekly on');
    expect(text(fixture, 'public-calendar-modal-meta')).toContain('TSC');
    expect(text(fixture, 'public-calendar-modal-description')).toBe('Roadmap review');
    expect(fixture.nativeElement.querySelector('[data-testid="public-calendar-modal-add-to-calendar"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="public-calendar-modal-sign-in-register"]')).toBeTruthy();
    expect(services.getPublicMeeting).not.toHaveBeenCalled();
  });

  it('returns from sign-in to the calendar with this meeting open', () => {
    configure();
    const state = TestBed.createComponent(SignInUrlComponent).componentInstance;

    expect(state.returnUrl()).toBe(`/login?returnTo=${encodeURIComponent('/projects/synthetic/calendar?meeting=series-1-1790000000')}`);
  });

  it('marks a signed-in viewer registered after registering, and links the meeting page at this occurrence', async () => {
    signedIn = true;
    const fixture = await render();
    expect(services.getPublicMeeting).toHaveBeenCalledWith('series-1', null);

    await click(fixture, 'public-calendar-modal-register');
    registerClosed.next({ uid: 'registrant' });
    await fixture.whenStable();
    expect(text(fixture, 'public-calendar-modal-badge')).toBe('Registered');

    await click(fixture, 'public-calendar-modal-page');
    expect(close).toHaveBeenCalledWith(true);
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'series-1'], { queryParams: { occurrence: String(START.getTime()) } });
  });

  it('downloads the whole series as an .ics file', async () => {
    const createObjectURL = vi.fn(() => 'blob:ics');
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    onTestFinished(() => {
      Object.assign(URL, original);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = await render();

    await click(fixture, 'public-calendar-modal-add-to-calendar');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(show).toHaveBeenCalledWith({ message: 'Calendar file downloaded', description: 'Technical Steering Committee was added as an .ics file.' });
  });

  it('asks a signed-out visitor to sign in to watch a past recording', async () => {
    const past = meeting();
    const fixture = await render({
      meeting: past,
      entry: { key: 'series-1-1690000000', title: past.title, type: 'Technical', startTime: '2026-01-01T10:00:00Z', durationMinutes: 60, past: true },
    });

    expect(services.getPublicPastMeeting).toHaveBeenCalledWith(`series-1-${Date.parse('2026-01-01T10:00:00Z')}`);
    expect(text(fixture, 'public-calendar-modal-badge')).toBe('Ended');
    expect(fixture.nativeElement.querySelector('[data-testid="public-calendar-modal-sign-in-watch"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="public-calendar-modal-sign-in-summary"]')).toBeNull();
  });

  it('says why a signed-in viewer without access sees no recording or summary', async () => {
    signedIn = true;
    const past = meeting({ restricted: true });
    const fixture = await render({
      meeting: past,
      entry: { key: 'series-1-1690000000', title: past.title, type: 'Technical', startTime: '2026-01-01T10:00:00Z', durationMinutes: 60, past: true },
    });

    expect(text(fixture, 'public-calendar-modal-note')).toBe("Only the meeting's invited guests can see its recording and summary.");
  });

  it('holds the badge and note until the viewer details load, then lets an organizer in with the restricted agenda', async () => {
    signedIn = true;
    const pending = new Subject<unknown>();
    services.getPublicMeeting = vi.fn(() => pending);
    const fixture = await render({ meeting: meeting({ restricted: true, description: undefined }) });
    expect(text(fixture, 'public-calendar-modal-badge')).toBe('');
    expect(text(fixture, 'public-calendar-modal-note')).toBe('');

    pending.next({ meeting: { invited: false, organizer: true, description: 'Budget review' }, project: {}, full_access: true, can_join: false });
    await fixture.whenStable();
    expect(text(fixture, 'public-calendar-modal-badge')).toBe("You're invited");
    expect(text(fixture, 'public-calendar-modal-description')).toBe('Budget review');
  });

  it('says when the viewer details fail to load, without guessing a state', async () => {
    signedIn = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    services.getPublicMeeting = vi.fn(() => throwError(() => new Error('down')));
    const fixture = await render({ meeting: meeting({ restricted: true }) });

    expect(text(fixture, 'public-calendar-modal-note')).toBe("We couldn't load your details for this meeting. Try again in a moment.");
    expect(text(fixture, 'public-calendar-modal-badge')).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="public-calendar-modal-register"]')).toBeNull();
  });

  it('treats an archived row as past and shows its agenda from the lookup', async () => {
    const archived = meeting({ meeting_and_occurrence_id: 'series-1-1790000000000', description: undefined, occurrences: [] });
    services.getPublicPastMeeting = vi.fn(() =>
      of({ meeting: { recording_enabled: false, ai_summary_enabled: true, description: 'Q4 review' }, project: {}, full_access: false })
    );
    const fixture = await render({ meeting: archived });

    expect(services.getPublicPastMeeting).toHaveBeenCalledWith('series-1-1790000000000');
    expect(text(fixture, 'public-calendar-modal-badge')).toBe('Ended');
    expect(text(fixture, 'public-calendar-modal-description')).toBe('Q4 review');
    expect(fixture.nativeElement.querySelector('[data-testid="public-calendar-modal-sign-in-summary"]')).toBeTruthy();
  });
});
