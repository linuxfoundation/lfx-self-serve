// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RedirectCommand, Router, UrlTree } from '@angular/router';
import { TRANSIENT_RETRY_DELAY_MS } from '@lfx-one/shared/constants';
import { MeetingService } from '@shared/services/meeting.service';
import { ProjectRecoveryService } from '@shared/services/project-recovery.service';
import { defer, firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MEETING_ROUTES } from '@modules/meetings/meetings.routes';
import { authGuard } from './auth.guard';
import { pastMeetingOrganizerGuard } from './past-meeting-organizer.guard';

const PAST_ID = '98765432101-1760000000000';
const STATE_URL = `/project/meetings/${PAST_ID}/details`;

const makeRoute = (id: string): ActivatedRouteSnapshot => ({ paramMap: { get: vi.fn().mockReturnValue(id) } }) as unknown as ActivatedRouteSnapshot;

const httpError = (status: number): HttpErrorResponse => new HttpErrorResponse({ status });

describe('pastMeetingOrganizerGuard', () => {
  let getPastMeetingById: ReturnType<typeof vi.fn>;
  let parseUrl: ReturnType<typeof vi.fn>;
  let createUrlTree: ReturnType<typeof vi.fn>;
  let unavailable: ReturnType<typeof vi.fn>;

  const runGuard = (id = PAST_ID): Promise<boolean | UrlTree | RedirectCommand> => {
    const result = TestBed.runInInjectionContext(() => pastMeetingOrganizerGuard(makeRoute(id), { url: STATE_URL } as never)) as
      | boolean
      | UrlTree
      | RedirectCommand
      | Observable<boolean | UrlTree | RedirectCommand>;
    return isObservable(result) ? firstValueFrom(result) : Promise.resolve(result);
  };

  /** The path a redirect points at, from the fake `UrlTree`s below. */
  const redirectTarget = (result: unknown): unknown =>
    result instanceof RedirectCommand ? (result.redirectTo as unknown as { path: unknown }).path : undefined;

  beforeEach(() => {
    getPastMeetingById = vi.fn().mockReturnValue(of({ id: PAST_ID, meeting_and_occurrence_id: PAST_ID, organizer: true }));
    parseUrl = vi.fn().mockImplementation((path: string) => ({ path }) as unknown as UrlTree);
    createUrlTree = vi.fn().mockImplementation((commands: string[]) => ({ path: commands.join('/') }) as unknown as UrlTree);
    unavailable = vi
      .fn()
      .mockImplementation((url: string) => new RedirectCommand({ path: `unavailable:${url}` } as unknown as UrlTree, { skipLocationChange: true }));

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { getPastMeetingById } },
        { provide: ProjectRecoveryService, useValue: { unavailable } },
        { provide: Router, useValue: { parseUrl, createUrlTree } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('opens the admin page to an organizer, resolved through the detail read', async () => {
    const result = await runGuard();

    expect(getPastMeetingById).toHaveBeenCalledWith(PAST_ID);
    expect(result).toBe(true);
  });

  it('redirects a signed-in non-organizer to the public page', async () => {
    getPastMeetingById.mockReturnValue(of({ id: PAST_ID, meeting_and_occurrence_id: PAST_ID, organizer: false }));

    const result = await runGuard();

    expect(redirectTarget(result)).toBe(`/meetings/${PAST_ID}`);
    // A real navigation, so the address bar shows the page the viewer is on.
    expect((result as RedirectCommand).navigationBehaviorOptions?.skipLocationChange).toBeFalsy();
  });

  it('treats an absent organizer flag as not an organizer', async () => {
    getPastMeetingById.mockReturnValue(of({ id: PAST_ID, meeting_and_occurrence_id: PAST_ID }));

    expect(redirectTarget(await runGuard())).toBe(`/meetings/${PAST_ID}`);
  });

  it('redirects to the composite id when the route was opened by the past meeting uuid', async () => {
    getPastMeetingById.mockReturnValue(of({ id: 'pm-uuid', meeting_and_occurrence_id: PAST_ID, organizer: false }));

    expect(redirectTarget(await runGuard('pm-uuid'))).toBe(`/meetings/${PAST_ID}`);
  });

  it.each([400, 403, 404])('sends a %i to the meeting not-found page', async (status) => {
    getPastMeetingById.mockReturnValue(throwError(() => httpError(status)));

    const result = await runGuard();

    expect(redirectTarget(result)).toBe('/meetings/not-found');
    expect(unavailable).not.toHaveBeenCalled();
  });

  it.each([500, 503])('keeps the admin page closed behind the retry view on a %i, after one retry', async (status) => {
    vi.useFakeTimers();
    getPastMeetingById.mockReturnValue(throwError(() => httpError(status)));

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_DELAY_MS);
    const result = await pending;

    expect(unavailable).toHaveBeenCalledWith(STATE_URL);
    expect(redirectTarget(result)).toBe(`unavailable:${STATE_URL}`);
  });

  it('keeps the admin page closed behind the retry view on a 401, without retrying', async () => {
    getPastMeetingById.mockReturnValue(throwError(() => httpError(401)));

    expect(redirectTarget(await runGuard())).toBe(`unavailable:${STATE_URL}`);
    expect(getPastMeetingById).toHaveBeenCalledTimes(1);
  });

  it('keeps the admin page closed on an error that is not an HTTP response', async () => {
    getPastMeetingById.mockReturnValue(throwError(() => new Error('boom')));

    expect(redirectTarget(await runGuard())).toBe(`unavailable:${STATE_URL}`);
  });

  it('retries a transient failure once before deciding', async () => {
    vi.useFakeTimers();
    let calls = 0;
    getPastMeetingById.mockReturnValue(
      defer(() => {
        calls += 1;
        return calls === 1 ? throwError(() => httpError(503)) : of({ id: PAST_ID, meeting_and_occurrence_id: PAST_ID, organizer: true });
      })
    );

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_DELAY_MS);

    expect(await pending).toBe(true);
    expect(calls).toBe(2);
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('is on the admin route, after authGuard', () => {
    const details = MEETING_ROUTES.find((route) => route.path === ':id/details');

    expect(details?.canActivate).toEqual([authGuard, pastMeetingOrganizerGuard]);
  });
});
