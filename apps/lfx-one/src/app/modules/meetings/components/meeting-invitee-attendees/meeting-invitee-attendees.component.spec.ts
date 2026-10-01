// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('logs a failed fetch and renders nothing', async () => {
    const error = new Error('forbidden');
    getMyMeetingRegistrants.mockReturnValue(throwError(() => error));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await fixture.whenStable();

    expect(consoleError).toHaveBeenCalledWith('Failed to fetch my meeting registrants:', error);
    expect(component()['previewPeople']()).toEqual([]);
  });
});
