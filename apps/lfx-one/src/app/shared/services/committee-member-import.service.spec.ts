// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Service-owned CSV member import runs (#5730), exercised without the import dialog. The dialog suite
// keeps the full chunk/pause/stop/cleanup matrix; this suite covers ownership and lifetime.
// All people and domains are synthetic.

import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommitteeMemberBulkCreateResult, CreateCommitteeMemberRequest, MemberImportRow, MemberImportRunInput } from '@lfx-one/shared/interfaces';
import { Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeMemberImportService } from './committee-member-import.service';
import { CommitteeService } from './committee.service';
import { UserService } from './user.service';

interface PendingBulk {
  committeeUid: string;
  members: CreateCommitteeMemberRequest[];
  response: Subject<CommitteeMemberBulkCreateResult>;
}

function readyRows(count: number, start = 0): MemberImportRow[] {
  return Array.from({ length: count }, (_, i) => {
    const email = `person${start + i}@example.com`;
    return { rowNumber: start + i + 1, email, normalizedEmail: email, cells: { email }, status: 'ready', issues: [], payload: { email } };
  });
}

function input(committeeUid: string, rows: MemberImportRow[], patch: Partial<MemberImportRunInput> = {}): MemberImportRunInput {
  return {
    committeeUid,
    committeeName: `Group ${committeeUid}`,
    rules: { requiresOrganization: false, votingEnabled: false },
    fileName: 'members.csv',
    rows,
    skipNotification: true,
    pendingInviteUidByEmail: {},
    baselineMemberCount: 10,
    ...patch,
  };
}

describe('CommitteeMemberImportService', () => {
  const user = signal<{ sub: string } | null>({ sub: 'synthetic-manager' });
  let pending: PendingBulk[];
  let revokes: Subject<void>[];
  let committeeService: { bulkCreateCommitteeMembers: ReturnType<typeof vi.fn>; revokeCommitteeInvite: ReturnType<typeof vi.fn> };
  let service: CommitteeMemberImportService;

  /** Answers bulk call `call`: every row added unless its index is listed as missing from the response. */
  function respond(call: number, missing: number[] = []): void {
    const results = pending[call].members
      .map((member, index) => ({ index, email: member.email, status: 'added' as const, retryable: false, member_uid: `member-${call}-${index}` }))
      .filter((result) => !missing.includes(result.index));
    pending[call].response.next({ results, added: results.length, skipped: 0, failed: 0 });
    pending[call].response.complete();
  }

  function switchUser(sub: string | null): void {
    user.set(sub ? { sub } : null);
    TestBed.tick();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    user.set({ sub: 'synthetic-manager' });
    pending = [];
    revokes = [];
    committeeService = {
      bulkCreateCommitteeMembers: vi.fn((committeeUid: string, members: CreateCommitteeMemberRequest[]): Observable<CommitteeMemberBulkCreateResult> => {
        const response = new Subject<CommitteeMemberBulkCreateResult>();
        pending.push({ committeeUid, members, response });
        return response;
      }),
      revokeCommitteeInvite: vi.fn((): Observable<void> => {
        const response = new Subject<void>();
        revokes.push(response);
        return response;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { user } },
        { provide: CommitteeService, useValue: committeeService },
      ],
    });
    service = TestBed.inject(CommitteeMemberImportService);
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs every chunk and retains the settled outcome without any dialog', () => {
    expect(service.start(input('group-a', readyRows(30)))).toBe(true);
    expect(service.getRun('group-a')).toMatchObject({
      status: 'importing',
      attempt: 1,
      batchTotal: 30,
      ownerSubject: 'synthetic-manager',
      fileName: 'members.csv',
    });
    expect(pending).toHaveLength(1);

    respond(0);
    expect(pending).toHaveLength(2);
    respond(1);

    const run = service.getRun('group-a');
    expect(run).toMatchObject({ status: 'settled', batchSettled: 30, baselineMemberCount: 10, reconciliationTarget: 40 });
    expect(run?.rows.every((row) => row.status === 'added')).toBe(true);
  });

  it('refuses a second start, an early retry and an active dismissal for the same group, synchronously', () => {
    service.start(input('group-a', readyRows(1)));
    expect(service.start(input('group-a', readyRows(1, 5)))).toBe(false);
    expect(service.retry('group-a')).toBe(false);
    service.dismiss('group-a');
    expect(service.getRun('group-a')?.status).toBe('importing');
    expect(pending).toHaveLength(1);

    respond(0);
    expect(service.retry('group-a')).toBe(false);
    expect(service.start(input('group-a', readyRows(1, 5)))).toBe(false);
    service.dismiss('group-a');
    expect(service.getRun('group-a')).toBeUndefined();
    expect(service.start(input('group-a', readyRows(1, 5)))).toBe(true);
    expect(pending).toHaveLength(2);
  });

  it('keeps runs for different groups isolated', () => {
    service.start(input('group-a', readyRows(1)));
    service.start(input('group-b', readyRows(2, 10)));
    expect(pending.map((call) => call.committeeUid)).toEqual(['group-a', 'group-b']);

    service.stop('group-a');
    respond(1);
    expect(service.getRun('group-b')).toMatchObject({ status: 'settled', stopReason: null, reconciliationTarget: 12 });
    expect(service.getRun('group-a')).toMatchObject({ status: 'importing', stopReason: 'You stopped the import.' });

    respond(0);
    expect(service.getRun('group-a')?.status).toBe('settled');
  });

  it('keeps the original reconciliation baseline across partial settlement and retry', () => {
    vi.useFakeTimers();
    service.start(input('group-a', readyRows(3)));
    respond(0, [2]);
    expect(service.getRun('group-a')).toMatchObject({ status: 'importing', reconciliationTarget: 12, pauseCount: 1 });
    service.stop('group-a');

    const stopped = service.getRun('group-a');
    expect(stopped).toMatchObject({ status: 'settled', baselineMemberCount: 10, reconciliationTarget: 12 });
    expect(stopped?.rows[2]).toMatchObject({ status: 'unknown', uncertain: true });

    expect(service.retry('group-a', { skipNotification: false })).toBe(true);
    expect(pending[1].members.map((member) => member.email)).toEqual(['person2@example.com']);
    expect(service.getRun('group-a')).toMatchObject({ attempt: 2, batchTotal: 1, skipNotification: false });
    respond(1);
    expect(service.getRun('group-a')).toMatchObject({ status: 'settled', baselineMemberCount: 10, reconciliationTarget: 13 });
  });

  it('drops a late response and schedules nothing more after the user changes', () => {
    service.start(input('group-a', readyRows(30)));
    switchUser('synthetic-replacement');
    expect(service.getRun('group-a')).toBeUndefined();

    respond(0);
    expect(pending).toHaveLength(1);
    expect(service.getRun('group-a')).toBeUndefined();

    expect(service.start(input('group-a', readyRows(1, 50)))).toBe(true);
    expect(service.getRun('group-a')?.ownerSubject).toBe('synthetic-replacement');
    expect(pending).toHaveLength(2);
  });

  it('refuses reads and writes before the identity cleanup runs', () => {
    service.start(input('group-a', readyRows(30)));
    user.set({ sub: 'synthetic-replacement' });
    expect(service.getRun('group-a')).toBeUndefined();
    respond(0);
    expect(pending).toHaveLength(1);
    user.set(null);
    expect(service.start(input('group-a', readyRows(1)))).toBe(false);
  });

  it('ends a pause and its cooldown timer on logout without resubmitting', () => {
    vi.useFakeTimers();
    service.start(input('group-a', readyRows(1)));
    pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '5' }) }));
    expect(service.getRun('group-a')).toMatchObject({ pauseCount: 1, retryNotBefore: expect.any(Number) });
    expect(service.getRun('group-a')?.resumeAt).not.toBeNull();

    switchUser(null);
    vi.advanceTimersByTime(600_000);
    expect(pending).toHaveLength(1);
    switchUser('synthetic-manager');
    expect(service.getRun('group-a')).toBeUndefined();
  });

  it('sends no later chunk after the root injector is destroyed mid-run', () => {
    service.start(input('group-a', readyRows(30)));
    TestBed.resetTestingModule();

    respond(0);
    expect(pending).toHaveLength(1);
    expect(service.getRun('group-a')).toBeUndefined();
  });

  it('stops scheduling invitation cleanup after the user changes', () => {
    const rows = readyRows(7);
    const pendingInviteUidByEmail = Object.fromEntries(rows.map((row, index) => [row.normalizedEmail, `invite-${index}`]));
    service.start(input('group-a', rows, { pendingInviteUidByEmail }));
    respond(0);
    expect(revokes).toHaveLength(5);

    switchUser('synthetic-replacement');
    revokes.forEach((revoke) => {
      revoke.next();
      revoke.complete();
    });
    expect(revokes).toHaveLength(5);
    expect(service.getRun('group-a')).toBeUndefined();
  });
});
