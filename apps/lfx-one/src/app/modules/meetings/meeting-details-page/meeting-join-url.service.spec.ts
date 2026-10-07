// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MeetingJoinUrlState } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { firstValueFrom, Observable, of, throwError, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingJoinUrlService } from './meeting-join-url.service';

describe('MeetingJoinUrlService', () => {
  function fetch(response: Observable<unknown>): Promise<MeetingJoinUrlState[]> {
    const getPublicMeetingJoinUrl = vi.fn().mockReturnValue(response);
    TestBed.configureTestingModule({ providers: [{ provide: MeetingService, useValue: { getPublicMeetingJoinUrl } }] });
    const service = TestBed.inject(MeetingJoinUrlService);
    return firstValueFrom(service.fetch('99152950841', 'secret', 'ada@acme-motors.example').pipe(toArray()));
  }

  it("fetches V1's way, then hands back the bare link", async () => {
    const states = await fetch(of({ link: 'https://zoom.example/j/99152950841' }));

    expect(states).toEqual([{ status: 'loading' }, { status: 'ready', url: 'https://zoom.example/j/99152950841' }]);
  });

  it.each([['javascript:alert(1)'], ['zoom.example/j/1'], [undefined]])('turns a link that is not absolute http(s) (%s) into an error', async (link) => {
    const states = await fetch(of({ link }));

    expect(states.at(-1)).toEqual({ status: 'error', error: 'Failed to load meeting join URL. Please try again.' });
  });

  it("carries the BFF's message and code", async () => {
    const states = await fetch(throwError(() => ({ error: { error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' } })));

    expect(states.at(-1)).toEqual({ status: 'error', error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' });
  });

  it('falls back to a generic message', async () => {
    const states = await fetch(throwError(() => ({ status: 500 })));

    expect(states.at(-1)).toEqual({ status: 'error', error: 'Failed to load meeting join URL. Please try again.', code: null });
  });
});
