// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
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
});
