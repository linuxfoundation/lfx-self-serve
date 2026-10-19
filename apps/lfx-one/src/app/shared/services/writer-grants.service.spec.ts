// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { WriterSummary } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from './project.service';
import { UserService } from './user.service';
import { WriterGrantsService } from './writer-grants.service';

/**
 * Covers the auth gate added for LFXV2-3266: on an anonymous/public route (e.g. a `/meetings/:id`
 * invite page) there's no session, so `getWriterSummary`/`getProjects` would just 401. Both
 * signals default `false`, which is already the correct answer for that visitor, so the gate must
 * skip the calls entirely rather than let them fire and fail closed.
 */
describe('WriterGrantsService', () => {
  let getWriterSummary: ReturnType<typeof vi.fn>;
  let getProjects: ReturnType<typeof vi.fn>;
  let userService: UserService;

  beforeEach(() => {
    getWriterSummary = vi.fn().mockReturnValue(of({ hasWriterFoundation: false, hasWriterProject: false } as WriterSummary));
    getProjects = vi.fn().mockReturnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getWriterSummary, getProjects } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of({})), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    userService = TestBed.inject(UserService);
  });

  it('skips both calls and leaves both signals false when unauthenticated', () => {
    userService.authenticated.set(false);
    const service = TestBed.inject(WriterGrantsService);

    TestBed.inject(ApplicationRef).tick();

    expect(getWriterSummary).not.toHaveBeenCalled();
    expect(getProjects).not.toHaveBeenCalled();
    expect(service.hasWriterFoundation()).toBe(false);
    expect(service.hasWriterProject()).toBe(false);
  });

  it('calls getWriterSummary and widens the signals when authenticated', () => {
    userService.authenticated.set(true);
    getWriterSummary.mockReturnValue(of({ hasWriterFoundation: true, hasWriterProject: false } as WriterSummary));
    const service = TestBed.inject(WriterGrantsService);

    TestBed.inject(ApplicationRef).tick();

    expect(getWriterSummary).toHaveBeenCalledTimes(1);
    expect(service.hasWriterFoundation()).toBe(true);
    expect(service.hasWriterProject()).toBe(false);
  });

  describe('summaryResolved', () => {
    afterEach(() => vi.useRealTimers());

    it('is resolved at once when there is no session', () => {
      userService.authenticated.set(false);
      const service = TestBed.inject(WriterGrantsService);

      TestBed.inject(ApplicationRef).tick();

      expect(service.summaryResolved()).toBe(true);
    });

    it('resolves when the fast path settles, without waiting for the deferred sweep', () => {
      vi.useFakeTimers();
      const summary = new Subject<WriterSummary>();
      getWriterSummary.mockReturnValue(summary);
      getProjects.mockReturnValue(new Subject<never[]>());
      userService.authenticated.set(true);
      const service = TestBed.inject(WriterGrantsService);

      TestBed.inject(ApplicationRef).tick();
      expect(service.summaryResolved()).toBe(false);

      summary.next({ hasWriterFoundation: false, hasWriterProject: false } as WriterSummary);
      summary.complete();
      expect(service.summaryResolved()).toBe(true);

      // The sweep still runs afterwards (and is left in flight here) — it no longer gates resolution.
      vi.runAllTimers();
      expect(getProjects).toHaveBeenCalledTimes(1);
      expect(service.summaryResolved()).toBe(true);
    });
  });
});
