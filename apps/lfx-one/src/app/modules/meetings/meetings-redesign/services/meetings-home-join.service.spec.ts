// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Meeting, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeJoinService } from './meetings-home-join.service';

function buildRow(minutesFromNow: number, overrides: Partial<Meeting> = {}): MeetingHomeRow {
  const startTime = new Date(Date.now() + minutesFromNow * 60_000).toISOString();
  const meeting = { id: 'm-1', password: 'pw', restricted: false, invited: true, start_time: startTime, duration: 30, ...overrides } as Meeting;
  return { key: 'm-1', meeting, occurrence: null, title: 'Synthetic sync', occurrenceId: null, startTime, durationMinutes: 30 };
}

describe('MeetingsHomeJoinService', () => {
  let service: MeetingsHomeJoinService;
  let navigate: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let getPublicMeetingJoinUrl: ReturnType<typeof vi.fn>;
  const now = signal(new Date());
  const identity = signal<{ name: string; email: string } | null>(null);

  beforeEach(() => {
    identity.set({ name: 'Real Viewer', email: 'real@example.test' });
    navigate = vi.fn().mockResolvedValue(true);
    open = vi.fn();
    getPublicMeetingJoinUrl = vi.fn(() => of({ link: 'https://zoom.example.test/j/1' }));
    vi.stubGlobal('open', open);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: MeetingService, useValue: { getPublicMeetingJoinUrl } },
        {
          provide: UserService,
          useValue: { authenticated: signal(true), meetingJoinIdentity: identity },
        },
      ],
    });
    service = TestBed.inject(MeetingsHomeJoinService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<[string, MeetingHomeRow | null, boolean]>([
    ['inside the join window', buildRow(5), true],
    ['before the join window', buildRow(3 * 60), false],
    ['for a restricted meeting the viewer is not invited to', buildRow(5, { restricted: true, invited: false }), false],
    ['for an invited restricted meeting', buildRow(5, { restricted: true, invited: true }), true],
    ['without a row', null, false],
  ])('checks joinability %s', (_label, row, joinable) => {
    expect(service.joinable(signal(row), now)()).toBe(joinable);
  });

  it('builds the join link for the real viewer, and none when the request fails', () => {
    const injector = TestBed.inject(Injector);
    const url = runInInjectionContext(injector, () => service.joinUrl(signal(buildRow(5)), signal(true)));
    TestBed.tick();
    expect(getPublicMeetingJoinUrl).toHaveBeenCalledWith('m-1', 'pw', { email: 'real@example.test' });
    expect(url()).toMatch(/^https:\/\/zoom\.example\.test\/j\/1\?uname=Real%20Viewer/);

    getPublicMeetingJoinUrl.mockReturnValue(throwError(() => new Error('upstream down')));
    const failed = runInInjectionContext(injector, () => service.joinUrl(signal(buildRow(5)), signal(true)));
    TestBed.tick();
    expect(failed()).toBeNull();
  });

  it('keeps the reason and code of a failed join link, with a fallback message', () => {
    const injector = TestBed.inject(Injector);
    getPublicMeetingJoinUrl.mockReturnValue(throwError(() => ({ error: { error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' } })));
    const link = runInInjectionContext(injector, () => service.joinLink(signal(buildRow(5)), signal(true)));
    TestBed.tick();
    expect(link()).toEqual({ url: null, error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' });

    getPublicMeetingJoinUrl.mockReturnValue(throwError(() => new Error('upstream down')));
    const fallback = runInInjectionContext(injector, () => service.joinLink(signal(buildRow(5)), signal(true)));
    TestBed.tick();
    expect(fallback()).toEqual({ url: null, error: 'Failed to load the join link', code: null });

    getPublicMeetingJoinUrl.mockReturnValue(of({ link: '' }));
    const empty = runInInjectionContext(injector, () => service.joinLink(signal(buildRow(5)), signal(true)));
    TestBed.tick();
    expect(empty()).toEqual({ url: null, error: 'Join link unavailable', code: null });

    identity.set(null);
    const noIdentity = runInInjectionContext(injector, () => service.joinLink(signal(buildRow(5)), signal(true)));
    TestBed.tick();
    expect(noIdentity()).toEqual({ url: null, error: 'No email to join with', code: null });
  });

  it('opens the join link in a new tab, or the meeting page with its password without one', () => {
    const { meeting } = buildRow(5);

    service.join(meeting, 'https://zoom.example.test/j/1');
    expect(open).toHaveBeenCalledWith('https://zoom.example.test/j/1', '_blank', 'noopener,noreferrer');

    service.join(meeting, null);
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'm-1'], { queryParams: { password: 'pw' } });
  });
});
