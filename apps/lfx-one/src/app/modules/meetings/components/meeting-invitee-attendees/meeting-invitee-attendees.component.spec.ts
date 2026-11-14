// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingRegistrant, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachRsvpsToRegistrants } from '../../../../../server/helpers/meeting-rsvp.helper';
import { MeetingInviteeAttendeesComponent } from './meeting-invitee-attendees.component';

describe('MeetingInviteeAttendeesComponent', () => {
  let fixture: ComponentFixture<MeetingInviteeAttendeesComponent>;
  let getMyMeetingRegistrants: ReturnType<typeof vi.fn>;

  const meeting = { id: 'm1', title: 'Weekly sync', start_time: new Date().toISOString(), is_invite_responses_enabled: false } as unknown as Meeting;
  const preview = [{ uid: 'r1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' }] as unknown as MeetingRegistrant[];
  const full = [...preview, { uid: 'r2', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' }] as unknown as MeetingRegistrant[];

  beforeEach(async () => {
    getMyMeetingRegistrants = vi.fn((_id: string, _rsvp: boolean, _occ: string | undefined, isPreview: boolean) => of(isPreview ? preview : full));
    // The drawer and guest list need their own providers; this spec covers the fetch flow only.
    TestBed.overrideComponent(MeetingInviteeAttendeesComponent, { set: { imports: [], template: '' } });
    await TestBed.configureTestingModule({
      imports: [MeetingInviteeAttendeesComponent],
      providers: [{ provide: MeetingService, useValue: { getMyMeetingRegistrants } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingInviteeAttendeesComponent);
    fixture.componentRef.setInput('meeting', meeting);
  });

  afterEach(() => vi.restoreAllMocks());

  const component = (): Record<string, any> => fixture.componentInstance as unknown as Record<string, any>;
  const previewCalls = (flag: boolean) => getMyMeetingRegistrants.mock.calls.filter((call) => call[3] === flag);

  it('fetches only the preview roster until the drawer opens', async () => {
    await fixture.whenStable();

    expect(previewCalls(true)).toHaveLength(1);
    expect(previewCalls(false)).toHaveLength(0);
    expect(component()['drawerRegistrants']()).toEqual(preview);
  });

  it.each(['single', 'this_and_following'] as const)('retains older all preview attendance with a newer %s decline and no local overlay', async (scope) => {
    const all = { id: 'all', registrant_id: 'r1', response_type: 'accepted', scope: 'all', modified_at: '2026-01-01T00:00:00Z' } as MeetingRsvp;
    const scoped = {
      ...all,
      id: 'scoped',
      scope,
      response_type: 'declined',
      occurrence_id: '4071031200000',
      modified_at: '2026-02-01T00:00:00Z',
    } as MeetingRsvp;
    const scopedOnly = { ...scoped, registrant_id: 'r2' };
    getMyMeetingRegistrants.mockImplementation((_id, _includeRsvp, occurrenceId, _preview, allDatesOnly) =>
      of(attachRsvpsToRegistrants([...full].reverse(), [all, scoped, scopedOnly], occurrenceId, allDatesOnly))
    );
    fixture.componentRef.setInput('meeting', { ...meeting, is_invite_responses_enabled: true, recurrence: { type: 2, repeat_interval: 1 }, occurrences: [] });
    await fixture.whenStable();

    const current = component();
    expect(current['previewPeople']().map((person: { key: string }) => person.key)).toEqual(['r1', 'r2']);
    expect(current['registrants']().map((row: MeetingRegistrant) => row.rsvp)).toEqual([null, all]);
    expect(getMyMeetingRegistrants).toHaveBeenLastCalledWith('m1', true, undefined, true, true);

    component()['drawerVisible'].set(true);
    await fixture.whenStable();
    expect(getMyMeetingRegistrants).toHaveBeenLastCalledWith('m1', true, undefined, false, true);
    fixture.componentRef.setInput('occurrence', { occurrence_id: '4071031200', start_time: '2099-01-02T10:00:00Z', duration: 30 });
    await fixture.whenStable();
    expect(getMyMeetingRegistrants.mock.calls.slice(-2).every((call) => call[4] === false)).toBe(true);
    expect(current['registrants']().map((row: MeetingRegistrant) => row.rsvp)).toEqual([scopedOnly, scoped]);
  });

  it('fetches the full roster once, on the first drawer open', async () => {
    await fixture.whenStable();

    component()['drawerVisible'].set(true);
    await fixture.whenStable();
    component()['drawerVisible'].set(false);
    await fixture.whenStable();
    component()['drawerVisible'].set(true);
    await fixture.whenStable();

    expect(previewCalls(false)).toHaveLength(1);
    expect(component()['drawerRegistrants']()).toEqual(full);
  });

  it('trusts an empty full roster over the cached preview', async () => {
    getMyMeetingRegistrants.mockImplementation((_id: string, _rsvp: boolean, _occ: string | undefined, isPreview: boolean) => of(isPreview ? preview : []));
    await fixture.whenStable();

    component()['drawerVisible'].set(true);
    await fixture.whenStable();

    expect(component()['drawerRegistrants']()).toEqual([]);
  });

  it('keeps the preview roster when the full fetch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getMyMeetingRegistrants.mockImplementation((_id: string, _rsvp: boolean, _occ: string | undefined, isPreview: boolean) =>
      isPreview ? of(preview) : throwError(() => new Error('boom'))
    );
    await fixture.whenStable();

    component()['drawerVisible'].set(true);
    await fixture.whenStable();

    expect(component()['drawerRegistrants']()).toEqual(preview);
    expect(component()['fullRosterLoading']()).toBe(false);
  });

  it('reports loading as soon as the drawer opens, until the full roster lands', async () => {
    const full$ = new Subject<MeetingRegistrant[]>();
    getMyMeetingRegistrants.mockImplementation((_id: string, _rsvp: boolean, _occ: string | undefined, isPreview: boolean) =>
      isPreview ? of(preview) : full$
    );
    await fixture.whenStable();
    expect(component()['fullRosterLoading']()).toBe(false);

    component()['drawerVisible'].set(true);
    expect(component()['fullRosterLoading']()).toBe(true);

    await fixture.whenStable();
    full$.next(full);
    expect(component()['fullRosterLoading']()).toBe(false);
  });

  it('logs a failed fetch and renders nothing', async () => {
    const error = new Error('forbidden');
    getMyMeetingRegistrants.mockReturnValue(throwError(() => error));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await fixture.whenStable();

    expect(consoleError).toHaveBeenCalledWith('Failed to fetch my meeting registrants:', error);
    expect(component()['previewPeople']()).toEqual([]);
  });
});
