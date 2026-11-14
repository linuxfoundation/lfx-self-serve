// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeetingDayGroup, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeDetailsService } from '../../services/meetings-home-details.service';
import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';
import { MeetingsDayGroupComponent } from './meetings-day-group.component';

const row = (key: string, title: string): MeetingHomeRow =>
  ({ key, title, startTime: '2026-11-03T15:00:00Z', durationMinutes: 60, occurrence: null, occurrenceId: null, meeting: { id: key } }) as MeetingHomeRow;

describe('MeetingsDayGroupComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingOwnInviteResendService, useValue: { isResendingOwn: () => false } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: signal(new Set<string>()) } },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set<string>()) } },
        { provide: UserService, useValue: { authenticated: signal(true), viewerUsername: signal(null) } },
        { provide: MeetingsHomeEditService, useValue: { isChecking: () => false } },
        { provide: MeetingsHomeDeleteService, useValue: {} },
        { provide: MeetingsHomeDetailsService, useValue: {} },
        { provide: MeetingsHomeStore, useValue: { now: signal(new Date()) } },
      ],
    });
  });

  const render = async (group: MeetingDayGroup, stickyTop?: number): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(MeetingsDayGroupComponent);
    fixture.componentRef.setInput('group', group);
    fixture.componentRef.setInput('view', 'upcoming');
    if (stickyTop !== undefined) fixture.componentRef.setInput('stickyTop', stickyTop);
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

  it('sticks the separator at the given offset on a white 24px band', async () => {
    const element = await render({ label: 'Today', count: 1, rows: [row('a', 'Board Review')] }, 132);

    const separator = element.querySelector<HTMLElement>('[data-testid="meetings-home-day-group-separator"]');
    expect(separator?.className).toContain('sticky z-[1] -mt-[20px] flex h-[44px]');
    expect(separator?.className).toContain('pt-[20px]');
    expect(separator?.className).toContain('bg-white');
    expect(separator?.style.top).toBe('132px');
  });
});
