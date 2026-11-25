// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { COMMITTEE_DETAIL_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { Committee, CommitteeMember } from '@lfx-one/shared/interfaces';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeService } from './committee.service';

// Pins the slug↔UID alias contract join/leave/update rely on (GH-2072): a vanity-route load
// caches under the slug, writes evict by UID, and both keys must drop together.
describe('CommitteeService detail cache aliases', () => {
  const UID = '7cad5a8d-19d0-41a4-81a6-043453daf9ee';
  const SLUG = 'cncf-toc';
  const COMMITTEE = { uid: UID, sso_group_name: SLUG } as unknown as Committee;

  let service: CommitteeService;
  let http: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    http.get.mockReturnValue(of(COMMITTEE));
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(CommitteeService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('shares one request between a slug load and a later UID load within the TTL', () => {
    service.getCommitteeDetail(SLUG).subscribe();
    service.getCommitteeDetail(UID).subscribe();

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(`/api/committees/${SLUG}`);
  });

  it('hits the slug alias when the next read uses a different case', () => {
    service.getCommitteeDetail(SLUG).subscribe();
    service.getCommitteeDetail('CNCF-TOC').subscribe();

    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('evicts the slug key when leaveCommittee writes by UID', () => {
    http.delete.mockReturnValue(of(void 0));
    service.getCommitteeDetail(SLUG).subscribe();
    service.leaveCommittee(UID).subscribe();
    service.getCommitteeDetail(SLUG).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the slug key when joinCommittee writes by UID', () => {
    http.post.mockReturnValue(of({} as CommitteeMember));
    service.getCommitteeDetail(SLUG).subscribe();
    service.joinCommittee(UID).subscribe();
    service.getCommitteeDetail(SLUG).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the slug key when updateCommittee writes by UID', () => {
    http.put.mockReturnValue(of(COMMITTEE));
    service.getCommitteeDetail(SLUG).subscribe();
    service.updateCommittee(UID, { name: 'Renamed' } as Parameters<CommitteeService['updateCommittee']>[1]).subscribe();
    service.getCommitteeDetail(SLUG).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('skipCache forces a fresh fetch within the TTL', () => {
    service.getCommitteeDetail(SLUG).subscribe();
    service.getCommitteeDetail(SLUG, { skipCache: true }).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('refetches once the TTL has expired', () => {
    vi.useFakeTimers();
    service.getCommitteeDetail(SLUG).subscribe();
    vi.setSystemTime(Date.now() + COMMITTEE_DETAIL_CACHE_TTL_MS);
    service.getCommitteeDetail(SLUG).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts on error so the next caller retries instead of serving the failure', () => {
    http.get.mockReturnValueOnce(throwError(() => new Error('boom')));
    service.getCommitteeDetail(SLUG).subscribe({ error: vi.fn() });
    service.getCommitteeDetail(SLUG).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('caches auditor and non-auditor fetches of the same id as separate entries (GH-2407)', () => {
    service.getCommitteeDetail(SLUG).subscribe();
    service.getCommitteeDetail(SLUG, { auditor: true }).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
    const auditorParams = http.get.mock.calls[1][1]?.params as HttpParams;
    expect(auditorParams.get('auditor')).toBe('true');
  });

  it('shares one request between slug and UID auditor loads within the TTL', () => {
    service.getCommitteeDetail(SLUG, { auditor: true }).subscribe();
    service.getCommitteeDetail(UID, { auditor: true }).subscribe();

    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('evicts the auditor-variant entry when updateCommittee writes by UID', () => {
    http.put.mockReturnValue(of(COMMITTEE));
    service.getCommitteeDetail(SLUG, { auditor: true }).subscribe();
    service.updateCommittee(UID, { name: 'Renamed' } as Parameters<CommitteeService['updateCommittee']>[1]).subscribe();
    service.getCommitteeDetail(SLUG, { auditor: true }).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('sends strict-writer reads to the network without reading or replacing a cached entry (#5731)', () => {
    service.getCommitteeDetail(SLUG).subscribe();
    service.getCommitteeDetail(SLUG, { strictWriter: true }).subscribe();
    service.getCommitteeDetail(SLUG, { strictWriter: true }).subscribe();
    service.getCommitteeDetail(SLUG).subscribe();

    expect(http.get).toHaveBeenCalledTimes(3);
    const strictParams = http.get.mock.calls[1][1]?.params as HttpParams;
    expect(strictParams.get('strict_writer')).toBe('true');
    expect(strictParams.has('auditor')).toBe(false);
  });

  it.each([undefined, { auditor: true }, { strictWriter: true }, { strictWriter: true, auditor: true }])(
    'encodes the detail ID as one URL path segment with options %j',
    (options) => {
      service.getCommitteeDetail('group/with ?#%', options).subscribe();

      expect(http.get.mock.calls[0][0]).toBe('/api/committees/group%2Fwith%20%3F%23%25');
    }
  );

  it('does not cache a failed strict-writer read', () => {
    http.get.mockReturnValueOnce(throwError(() => new Error('access check unavailable')));
    service.getCommitteeDetail(UID, { strictWriter: true }).subscribe({ error: vi.fn() });
    service.getCommitteeDetail(UID).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get.mock.calls[1]).toEqual([`/api/committees/${UID}`]);
  });
});

describe('CommitteeService.bulkCreateCommitteeMembers', () => {
  const UID = '7cad5a8d-19d0-41a4-81a6-043453daf9ee';
  const members = [{ email: 'ada@example.com' }, { email: 'grace@example.com' }];
  const result = { results: [], added: 0, skipped: 0, failed: 0 };

  let service: CommitteeService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(() => of(result)) };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(CommitteeService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('posts the rows to the bulk route without skip_notification by default', () => {
    let received: unknown;
    service.bulkCreateCommitteeMembers(UID, members).subscribe((value) => (received = value));

    expect(http.post).toHaveBeenCalledWith(`/api/committees/${UID}/members/bulk`, { members }, { params: undefined });
    expect(received).toBe(result);
  });

  it('encodes the committee ID as one URL path segment', () => {
    service.bulkCreateCommitteeMembers('group/with ?#', members).subscribe();

    expect(http.post).toHaveBeenCalledWith('/api/committees/group%2Fwith%20%3F%23/members/bulk', { members }, { params: undefined });
  });

  it('sets skip_notification when notifications are off', () => {
    service.bulkCreateCommitteeMembers(UID, members, { skipNotification: true }).subscribe();

    const params = http.post.mock.calls[0][2]?.params as HttpParams;
    expect(params.get('skip_notification')).toBe('true');
  });

  it('evicts the cached committee detail after the write', () => {
    http.get.mockReturnValue(of({ uid: UID } as Committee));
    service.getCommitteeDetail(UID).subscribe();
    service.bulkCreateCommitteeMembers(UID, members).subscribe();
    service.getCommitteeDetail(UID).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });
});

describe('CommitteeService.updateCommitteeDocument', () => {
  let service: CommitteeService;
  let patch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    patch = vi.fn().mockReturnValue(of({ uid: 'doc-1', type: 'link', name: 'Renamed' }));
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch, delete: vi.fn() } }] });
    service = TestBed.inject(CommitteeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('patches the document with the changes, naming its type in the query', () => {
    let result: unknown = null;
    service.updateCommitteeDocument('committee-1', 'doc-1', 'link', { name: 'Renamed' }).subscribe((doc) => (result = doc));

    expect(patch).toHaveBeenCalledTimes(1);
    const [url, body, options] = patch.mock.calls[0];
    expect(url).toBe('/api/committees/committee-1/documents/doc-1');
    expect(body).toEqual({ name: 'Renamed' });
    expect((options.params as HttpParams).get('type')).toBe('link');
    expect(result).toEqual({ uid: 'doc-1', type: 'link', name: 'Renamed' });
  });

  it('encodes the ids it puts in the path', () => {
    service.updateCommitteeDocument('a/b', 'c d?e', 'file', { name: 'Renamed' }).subscribe();

    expect(patch.mock.calls[0][0]).toBe('/api/committees/a%2Fb/documents/c%20d%3Fe');
  });

  it('sends a move to the root as a null folder', () => {
    service.updateCommitteeDocument('committee-1', 'doc-1', 'file', { parent_uid: null }).subscribe();

    expect(patch.mock.calls[0][1]).toEqual({ parent_uid: null });
  });

  it('passes a conflict from the BFF on to the caller', () => {
    patch.mockReturnValue(throwError(() => ({ status: 409 })));
    let error: unknown = null;

    service.updateCommitteeDocument('committee-1', 'doc-1', 'folder', { name: 'Taken' }).subscribe({ error: (err) => (error = err) });

    expect(error).toEqual({ status: 409 });
  });
});
