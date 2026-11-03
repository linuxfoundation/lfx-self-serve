// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeetingDayGroup, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';
import { MeetingsDayGroupComponent } from './meetings-day-group.component';

const row = (key: string, title: string): MeetingHomeRow =>
  ({ key, title, startTime: '2026-11-03T15:00:00Z', durationMinutes: 60, occurrence: null, occurrenceId: null, meeting: { id: key } }) as MeetingHomeRow;

describe('MeetingsDayGroupComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingInviteResendService, useValue: { isResendingOwn: () => false } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: signal(new Set<string>()) } },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set<string>()) } },
        { provide: UserService, useValue: { authenticated: signal(true) } },
        { provide: MeetingsHomeEditService, useValue: { isChecking: () => false } },
      ],
    });
  });

  const render = async (group: MeetingDayGroup): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(MeetingsDayGroupComponent);
    fixture.componentRef.setInput('group', group);
    fixture.componentRef.setInput('view', 'upcoming');
    await fixture.whenStable();
    return fixture.nativeElement;
  };

  it('renders the label as a heading, the bucket total and the loaded rows', async () => {
    const element = await render({ label: 'Tomorrow', count: 3, rows: [row('a', 'Board Review'), row('b', 'Tech Sync')] });

    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Tomorrow');
    expect(element.querySelector('[data-testid="meetings-home-day-group-count"]')?.textContent?.trim()).toBe('3 meetings');
    expect(Array.from(element.querySelectorAll('[data-testid="meetings-home-day-group-row"]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('Board Review'),
      expect.stringContaining('Tech Sync'),
    ]);
  });

  it('reads a single meeting in the singular', async () => {
    const element = await render({ label: 'Today', count: 1, rows: [row('a', 'Board Review')] });

    expect(element.querySelector('[data-testid="meetings-home-day-group-count"] .sr-only')?.textContent?.trim()).toBe('meeting');
  });
});
