// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RsvpButtonGroupComponent } from './rsvp-button-group.component';

// My Meetings reads `my_rsvp` from the cached user-meetings list, so a saved RSVP has to push a
// refetch of that list or its Accepted / Pending RSVP filters and counts keep the pre-RSVP state.
describe('RsvpButtonGroupComponent — user meetings refresh', () => {
  const MEETING = { id: 'meeting-1', uid: 'meeting-1', is_invite_responses_enabled: true } as unknown as Meeting;
  const RSVP = { id: 'rsvp-1', meeting_id: 'meeting-1', response_type: 'accepted', scope: 'all' } as MeetingRsvp;

  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let createMeetingRsvp: ReturnType<typeof vi.fn>;

  function mount(): RsvpButtonGroupComponent {
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { user: signal(null), authenticated: signal(false), refreshUserMeetings } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: MeetingService, useValue: { createMeetingRsvp, getMeetingRsvpForCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // The component re-declares DialogService in its own providers; override so the stub is used.
    TestBed.overrideComponent(RsvpButtonGroupComponent, { set: { providers: [], template: '' } });
    const fixture = TestBed.createComponent(RsvpButtonGroupComponent);
    fixture.componentRef.setInput('meeting', MEETING);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    refreshUserMeetings = vi.fn();
    createMeetingRsvp = vi.fn().mockReturnValue(of(RSVP));
  });

  it('refetches the user meetings after an RSVP is saved', () => {
    mount().handleRsvpClick('accepted');

    expect(createMeetingRsvp).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ response: 'accepted', scope: 'all' }));
    expect(refreshUserMeetings).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when the RSVP fails to save', () => {
    createMeetingRsvp.mockReturnValue(throwError(() => ({ status: 500, error: {} })));

    mount().handleRsvpClick('accepted');

    expect(refreshUserMeetings).not.toHaveBeenCalled();
  });
});
