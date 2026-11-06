// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkConnectedOverlay, OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Meeting, MeetingHomeAttendance, MeetingHomeRow, MeetingRegistrant, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingHomeAttendancePopupComponent } from './meeting-home-attendance-popup.component';

const UPCOMING: MeetingHomeAttendance = {
  label: '1 of 2 attending · 50%',
  ariaLabel: 'Yes 1, Maybe 0, No 0, No response 1',
  segments: [{ kind: 'yes', percent: 50 }],
  answers: [],
  noResponse: 1,
  poor: false,
};

const PAST: MeetingHomeAttendance = {
  label: '1 of 4 attended · 25%',
  ariaLabel: '1 of 4 attended · 25%',
  segments: [],
  answers: [],
  noResponse: null,
  poor: true,
};

const REGISTRANTS = [
  { uid: 'r-1', first_name: 'Ada', last_name: 'Doe', email: 'ada@example.org', rsvp: { response_type: 'accepted' } },
  { uid: 'r-2', first_name: 'Bo', last_name: 'Doe', email: 'bo@example.org', rsvp: null },
] as unknown as MeetingRegistrant[];

function buildRow(meeting: Partial<PastMeeting>, overrides: Partial<MeetingHomeRow> = {}): MeetingHomeRow {
  return {
    key: 'm-1',
    meeting: { id: 'm-1', title: 'Sync', ...meeting } as Meeting,
    occurrence: null,
    title: 'Sync',
    occurrenceId: null,
    startTime: '2026-11-10T15:00:00Z',
    durationMinutes: 60,
    ...overrides,
  };
}

describe('MeetingHomeAttendancePopupComponent', () => {
  let registrants$: Subject<MeetingRegistrant[]>;
  let participants$: Subject<PastMeetingParticipant[]>;
  let meetingService: { getMeetingRegistrants: ReturnType<typeof vi.fn>; getPastMeetingParticipants: ReturnType<typeof vi.fn> };
  let overlay: HTMLElement;

  beforeEach(() => {
    registrants$ = new Subject();
    participants$ = new Subject();
    meetingService = {
      getMeetingRegistrants: vi.fn(() => registrants$),
      getPastMeetingParticipants: vi.fn(() => participants$),
    };
    TestBed.configureTestingModule({ providers: [{ provide: MeetingService, useValue: meetingService }] });
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  const render = async (row: MeetingHomeRow, attendance = UPCOMING, past = false): Promise<ComponentFixture<MeetingHomeAttendancePopupComponent>> => {
    const fixture = TestBed.createComponent(MeetingHomeAttendancePopupComponent);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('attendance', attendance);
    fixture.componentRef.setInput('past', past);
    await fixture.whenStable();
    return fixture;
  };
  const trigger = (fixture: ComponentFixture<MeetingHomeAttendancePopupComponent>): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="meetings-home-attendance-trigger"]');
  const popup = (): HTMLElement | null => overlay.querySelector('[data-testid="meetings-home-attendance-popup"]');
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const hover = async (fixture: ComponentFixture<MeetingHomeAttendancePopupComponent>, type: 'pointerenter' | 'pointerleave', pointerType = 'mouse') => {
    trigger(fixture).dispatchEvent(new PointerEvent(type, { pointerType }));
    // Past the hover delay before the popup opens.
    if (type === 'pointerenter') await wait(200);
    await fixture.whenStable();
  };

  it('names the trigger with the counts and the poor note', async () => {
    expect(trigger(await render(buildRow({}))).getAttribute('aria-label')).toBe('1 of 2 attending · 50%. Yes 1, Maybe 0, No 0, No response 1');
    expect(trigger(await render(buildRow({}), PAST, true)).getAttribute('aria-label')).toBe('1 of 4 attended · 25%. This meeting was poorly attended');
  });

  it("loads the date's registrants on the first hover, shows a spinner, then the grid without View all", async () => {
    const fixture = await render(buildRow({ recurrence: {} as Meeting['recurrence'] }, { occurrenceId: 'o-1' }));
    expect(meetingService.getMeetingRegistrants).not.toHaveBeenCalled();

    await hover(fixture, 'pointerenter');
    expect(meetingService.getMeetingRegistrants).toHaveBeenCalledWith('m-1', true, 'o-1', false, undefined, false, false);
    expect(popup()?.querySelector('[data-testid="meetings-home-attendance-popup-loading"]')).not.toBeNull();
    expect(trigger(fixture).getAttribute('aria-describedby')).toBe(popup()?.id);

    registrants$.next(REGISTRANTS);
    await fixture.whenStable();
    expect(popup()?.querySelectorAll('[data-testid="meeting-attendee-grid-person"]')).toHaveLength(2);
    expect(popup()?.querySelector('[data-testid="meeting-attendee-grid-stats"]')).not.toBeNull();
    expect(popup()?.querySelector('[data-testid="meeting-attendee-grid-view-all"]')).toBeNull();
  });

  it('closes after the pointer leaves and reuses the loaded people on the next open', async () => {
    const fixture = await render(buildRow({}));
    await hover(fixture, 'pointerenter');
    registrants$.next(REGISTRANTS);
    await hover(fixture, 'pointerleave');
    await wait(150);
    await fixture.whenStable();
    expect(popup()).toBeNull();

    await hover(fixture, 'pointerenter');
    expect(popup()?.querySelectorAll('[data-testid="meeting-attendee-grid-person"]')).toHaveLength(2);
    expect(meetingService.getMeetingRegistrants).toHaveBeenCalledTimes(1);
  });

  it('opens on focus, closes on Escape and when focus leaves', async () => {
    const fixture = await render(buildRow({}));
    trigger(fixture).dispatchEvent(new FocusEvent('focus'));
    registrants$.next(REGISTRANTS);
    await fixture.whenStable();
    expect(popup()).not.toBeNull();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(popup()).toBeNull();

    trigger(fixture).dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(popup()).not.toBeNull();
    trigger(fixture).dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }));
    await fixture.whenStable();
    expect(popup()).toBeNull();
  });

  it('stays open under keyboard focus when the pointer leaves', async () => {
    const fixture = await render(buildRow({}));
    trigger(fixture).dispatchEvent(new FocusEvent('focus'));
    registrants$.next(REGISTRANTS);
    await hover(fixture, 'pointerleave');
    await wait(150);
    await fixture.whenStable();

    expect(popup()).not.toBeNull();
  });

  it('places the popup again when the people load and when any container scrolls', async () => {
    const fixture = await render(buildRow({}));
    await hover(fixture, 'pointerenter');
    const overlayRef = fixture.debugElement.queryAllNodes(By.directive(CdkConnectedOverlay))[0].injector.get(CdkConnectedOverlay).overlayRef;
    const update = vi.spyOn(overlayRef, 'updatePosition');

    registrants$.next(REGISTRANTS);
    await fixture.whenStable();
    expect(update).toHaveBeenCalledTimes(1);

    const column = document.body.appendChild(document.createElement('div'));
    column.dispatchEvent(new Event('scroll'));
    expect(update).toHaveBeenCalledTimes(2);
    column.remove();
  });

  it("loads a past meeting's participants by its occurrence id", async () => {
    const fixture = await render(buildRow({ meeting_and_occurrence_id: 'm-1-o-9' }), PAST, true);
    await hover(fixture, 'pointerenter');

    expect(meetingService.getPastMeetingParticipants).toHaveBeenCalledWith('m-1-o-9');
    expect(meetingService.getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('closes quietly on a failed load and tries again on the next open', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await render(buildRow({}));
    await hover(fixture, 'pointerenter');
    registrants$.error(new Error('boom'));
    await fixture.whenStable();
    expect(popup()).toBeNull();
    expect(trigger(fixture).hasAttribute('aria-describedby')).toBe(false);

    await hover(fixture, 'pointerenter');
    expect(meetingService.getMeetingRegistrants).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('loads nothing when the pointer passes over without stopping', async () => {
    const fixture = await render(buildRow({}));
    trigger(fixture).dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await hover(fixture, 'pointerleave');
    await wait(200);

    expect(meetingService.getMeetingRegistrants).not.toHaveBeenCalled();
    expect(popup()).toBeNull();
  });

  it('stays open when focus moves from the block into the popup', async () => {
    const fixture = await render(buildRow({}));
    trigger(fixture).dispatchEvent(new FocusEvent('focus'));
    registrants$.next(REGISTRANTS);
    await fixture.whenStable();
    trigger(fixture).dispatchEvent(new FocusEvent('focusout', { relatedTarget: popup() }));
    await fixture.whenStable();

    expect(popup()).not.toBeNull();
  });

  it('ignores touch hover', async () => {
    const fixture = await render(buildRow({}));
    await hover(fixture, 'pointerenter', 'touch');

    expect(meetingService.getMeetingRegistrants).not.toHaveBeenCalled();
    expect(popup()).toBeNull();
  });
});
