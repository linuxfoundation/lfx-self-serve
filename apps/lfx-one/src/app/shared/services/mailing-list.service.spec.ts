// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { GroupsIOMailingList, MailingListMember } from '@lfx-one/shared/interfaces';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailingListService } from './mailing-list.service';

// Pins the detail-cache contract the writerGuard probe relies on (GH-1567): the probe and the
// manage-page load share one request, writes evict, and a failed fetch must never stick.
describe('MailingListService detail cache', () => {
  const LIST = { uid: 'ml-1' } as unknown as GroupsIOMailingList;

  let service: MailingListService;
  let http: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    http.get.mockReturnValue(of(LIST));
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(MailingListService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('shares one request between the guard probe and the page load within the TTL', () => {
    service.getMailingList('ml-1').subscribe();
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith('/api/mailing-lists/ml-1');
  });

  it('refetches once the TTL has expired', () => {
    vi.useFakeTimers();
    service.getMailingList('ml-1').subscribe();
    vi.setSystemTime(Date.now() + 11_000);
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('skipCache forces a fresh fetch within the TTL', () => {
    service.getMailingList('ml-1').subscribe();
    service.getMailingList('ml-1', { skipCache: true }).subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts on error so the next caller retries instead of serving the failure', () => {
    http.get.mockReturnValueOnce(throwError(() => new Error('boom')));
    service.getMailingList('ml-1').subscribe({ error: vi.fn() });
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the cached detail on updateMailingList', () => {
    http.put.mockReturnValue(of(LIST));
    service.getMailingList('ml-1').subscribe();
    service.updateMailingList('ml-1', {}).subscribe();
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the cached detail on deleteMember', () => {
    http.delete.mockReturnValue(of(void 0));
    service.getMailingList('ml-1').subscribe();
    service.deleteMember('ml-1', 'member-1').subscribe();
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the cached detail on createMember', () => {
    http.post.mockReturnValue(of({} as MailingListMember));
    service.getMailingList('ml-1').subscribe();
    service.createMember('ml-1', { email: 'member@example.com' }).subscribe();
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the cached detail on updateMember', () => {
    http.put.mockReturnValue(of({} as MailingListMember));
    service.getMailingList('ml-1').subscribe();
    service.updateMember('ml-1', 'member-1', {}).subscribe();
    service.getMailingList('ml-1').subscribe();

    expect(http.get).toHaveBeenCalledTimes(2);
  });
});
