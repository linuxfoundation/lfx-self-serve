// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Meeting, MeetingRsvp, PastMeeting, User } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './user.service';

/**
 * Covers the `effectiveAvatarUrl` priority chain (LFXV2-2628): an uploaded avatar must win over
 * the Auth0 `picture` claim even while the claim is stale, since that's exactly the race a
 * successful upload racing a slower post-hydration profile fetch depends on. Also covers the two
 * lines that actually enforce that race guard — the post-hydration clobber guard and the
 * on-user-change reset — not just the pure computed that reads their result.
 */
describe('UserService', () => {
  let service: UserService;
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Benign default so tests that don't care about the post-hydration fetch (most of them) don't
    // crash when afterNextRender's callback happens to fire during an ApplicationRef flush.
    httpGet = vi.fn().mockReturnValue(of({ profile: {} }));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    service = TestBed.inject(UserService);
  });

  it.each([
    [{ 'https://sso.linuxfoundation.org/claims/username': 'canonical' }, 'canonical'],
    [{ username: 'display-alias', 'https://sso.linuxfoundation.org/claims/username': 'canonical' }, 'canonical'],
    [{ username: 'alias-only' }, 'alias-only'],
    [{}, null],
    [null, null],
  ])('resolves meeting comparison identity from %j', (user, expected) => {
    service.user.set(user as User | null);
    expect(service.viewerUsername()).toBe(expected);
  });

  it('updates meeting comparison identity when the canonical claim resolves late', () => {
    service.user.set({ username: 'display-alias' } as User);
    expect(service.viewerUsername()).toBe('display-alias');

    service.user.set({ username: 'display-alias', 'https://sso.linuxfoundation.org/claims/username': 'canonical' } as User);
    expect(service.viewerUsername()).toBe('canonical');
  });

  it.each([undefined, 'unchanged-alias'])('isolates all personal meeting feeds when canonical identity changes with alias %s', async (username) => {
    const feeds = [
      ['/api/user/meetings', () => service.getUserMeetings()],
      ['/api/user/past-meetings', () => service.getUserPastMeetings()],
      ['/api/user/latest-past-meetings', () => service.getUserLatestPastMeetings()],
    ] as const;
    service.user.set({ username, 'https://sso.linuxfoundation.org/claims/username': 'synthetic-a' } as User);
    await TestBed.inject(ApplicationRef).whenStable();

    const previousRequests = new Map<string, Subject<PastMeeting[]>>(feeds.map(([url]) => [url, new Subject<PastMeeting[]>()]));
    httpGet.mockImplementation((url: string) => previousRequests.get(url) ?? of({ profile: {} }));
    const priorRows = feeds.map(() => [] as string[]);
    const previousSubscriptions = feeds.map(([, getFeed], index) => getFeed().subscribe((rows) => priorRows[index].push(...rows.map((row) => row.id))));
    for (const request of previousRequests.values()) request.next([{ id: 'synthetic-a-meeting' } as PastMeeting]);

    service.user.set({ username, 'https://sso.linuxfoundation.org/claims/username': 'synthetic-b' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    for (const request of previousRequests.values()) request.next([{ id: 'synthetic-late-a-meeting' } as PastMeeting]);
    expect(priorRows).toEqual(feeds.map(() => ['synthetic-a-meeting']));

    httpGet.mockImplementation((url: string) => of(url.startsWith('/api/user/') ? [{ id: 'synthetic-b-meeting' }] : { profile: {} }));
    for (const [, getFeed] of feeds) {
      let rows: string[] = [];
      const subscription = getFeed().subscribe((meetings) => (rows = meetings.map((meeting) => meeting.id)));
      expect(rows).toEqual(['synthetic-b-meeting']);
      subscription.unsubscribe();
    }
    previousSubscriptions.forEach((subscription) => subscription.unsubscribe());
  });

  it('refetches a primed personal feed on return after an inactive-lens response without fetching while inactive', () => {
    const pending = { id: 'synthetic-meeting', is_invite_responses_enabled: true, my_rsvp: null } as Meeting;
    const accepted = { ...pending, my_rsvp: { response_type: 'accepted', scope: 'all' } } as Meeting;
    let currentRows = [pending];
    httpGet.mockImplementation((url: string) => of(url === '/api/user/meetings' ? currentRows : { profile: {} }));
    const first = service.getUserMeetings().subscribe();
    first.unsubscribe();
    currentRows = [accepted];
    httpGet.mockClear();

    service.refreshUserMeetings(false);
    expect(httpGet).not.toHaveBeenCalled();

    let returnedRows: Meeting[] = [];
    const returning = service.getUserMeetings().subscribe((rows) => (returnedRows = rows));
    expect(returnedRows.find((meeting) => meeting.id === pending.id)?.my_rsvp?.response_type).toBe('accepted');
    expect(returnedRows.filter((meeting) => meeting.is_invite_responses_enabled && !meeting.my_rsvp)).toEqual([]);
    returning.unsubscribe();
  });

  it('keeps a late confirmation under the dispatch subject instead of the current impersonation subject', async () => {
    const pending = { id: 'synthetic-meeting', is_invite_responses_enabled: true, my_rsvp: null } as Meeting;
    httpGet.mockImplementation((url: string) => of(url === '/api/user/meetings' ? [pending] : { profile: {} }));
    service.user.set({ sub: 'synthetic-a', username: 'unchanged-alias' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    const primed = service.getUserMeetings().subscribe();
    primed.unsubscribe();

    service.user.set({ sub: 'synthetic-b', username: 'unchanged-alias' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    let otherRows: Meeting[] = [];
    const other = service.getUserMeetings().subscribe((rows) => (otherRows = rows));
    service.recordConfirmedMeetingRsvp(
      {
        id: 'synthetic-response',
        meeting_id: pending.id,
        registrant_id: 'synthetic-registrant',
        username: 'unchanged-alias',
        email: 'synthetic@example.com',
        response_type: 'accepted',
        scope: 'all',
        created_at: '2026-10-12T10:00:00Z',
      } as MeetingRsvp,
      'synthetic-a'
    );
    expect(otherRows[0].my_rsvp).toBeNull();

    service.user.set({ sub: 'synthetic-a', username: 'unchanged-alias' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    let returningRows: Meeting[] = [];
    const returning = service.getUserMeetings().subscribe((rows) => (returningRows = rows));
    expect(returningRows[0].my_rsvp?.response_type).toBe('accepted');
    expect(pending.my_rsvp).toBeNull();
    other.unsubscribe();
    returning.unsubscribe();
  });

  it('falls back to the Auth0 picture claim when no avatar has been uploaded', () => {
    service.user.set({ picture: 'https://cdn.auth0.com/stale.png' } as User);
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.auth0.com/stale.png');
  });

  it('prefers the uploaded avatar over the picture claim even when the claim is unchanged', () => {
    service.user.set({ picture: 'https://cdn.auth0.com/stale.png' } as User);
    service.uploadedAvatarUrl.set('https://cdn.example.com/fresh-upload.png');
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/fresh-upload.png');
  });

  it('returns an empty string when neither source is set', () => {
    expect(service.effectiveAvatarUrl()).toBe('');
  });

  it('does not let a slower post-hydration profile fetch clobber an upload that already resolved', () => {
    httpGet.mockReturnValue(of({ profile: { picture: 'https://stale-fetch.png' } }));
    service.user.set({ username: 'alice', picture: 'https://cdn.auth0.com/stale.png' } as User);
    // Simulate the upload finishing before the post-hydration fetch's afterNextRender callback runs.
    service.uploadedAvatarUrl.set('https://cdn.example.com/fresh-upload.png');

    TestBed.inject(ApplicationRef).tick();

    expect(httpGet).toHaveBeenCalledWith('/api/profile');
    expect(service.uploadedAvatarUrl()).toBe('https://cdn.example.com/fresh-upload.png');
  });

  it('retains an uploaded avatar when the same subject gains its canonical LFID', async () => {
    service.user.set({ sub: 'synthetic-subject', username: 'display-alias', picture: 'https://cdn.example.com/claim.png' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/upload.png');

    service.user.update((user) => ({ ...user!, 'https://sso.linuxfoundation.org/claims/username': 'canonical' }));
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.viewerUsername()).toBe('canonical');
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/upload.png');
  });

  it('clears the uploaded avatar when the subject changes with unchanged LFID claims', async () => {
    service.user.set({ sub: 'synthetic-a', username: 'alias', 'https://sso.linuxfoundation.org/claims/username': 'canonical' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/upload.png');

    service.user.update((user) => ({ ...user!, sub: 'synthetic-b', picture: 'https://cdn.example.com/other.png' }));
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.uploadedAvatarUrl()).toBeNull();
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/other.png');
  });

  it('resets the uploaded avatar when the user changes, so an impersonation swap cannot inherit it', async () => {
    service.user.set({ username: 'alice', picture: 'https://cdn.auth0.com/alice.png' } as User);
    // Flush before setting the upload — otherwise this synchronous test would batch both user.set
    // calls into a single downstream emission and the reset subscription would never see "alice"
    // as a distinct value to transition away from.
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/alice-upload.png');

    service.user.set({ username: 'bob', picture: 'https://cdn.auth0.com/bob.png' } as User);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.uploadedAvatarUrl()).toBeNull();
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.auth0.com/bob.png');
  });
});
