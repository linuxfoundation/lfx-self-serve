// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Service-owned CSV member import runs (#5730), exercised without the import dialog. The dialog suite
// keeps the full chunk/pause/stop/cleanup matrix; this suite covers ownership, lifetime and the
// background-run surfaces: summaries, once-per-attempt settlements, revocation and the leave warning (#5731).
// All people and domains are synthetic.

import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CommitteeMember,
  CommitteeMemberBulkCreateResult,
  CreateCommitteeMemberRequest,
  ImpersonationTransition,
  MemberImportRow,
  MemberImportRunInput,
  MemberImportSettlement,
  MemberImportStagedRunInput,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeMemberImportService } from './committee-member-import.service';
import { CommitteeService } from './committee.service';
import { ImpersonationService } from './impersonation.service';
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
  const transition = signal<ImpersonationTransition | null>(null);
  let pending: PendingBulk[];
  let revokes: Subject<void>[];
  let committeeService: { bulkCreateCommitteeMembers: ReturnType<typeof vi.fn>; revokeCommitteeInvite: ReturnType<typeof vi.fn> };
  let service: CommitteeMemberImportService;
  let toast: ReturnType<typeof vi.fn>;

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
    transition.set(null);
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
    toast = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { user } },
        { provide: CommitteeService, useValue: committeeService },
        { provide: ImpersonationService, useValue: { transition } },
        { provide: MessageService, useValue: { add: toast } },
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

  it('unsubscribes the in-flight chunk and sends nothing later when the root injector is destroyed', () => {
    service.start(input('group-a', readyRows(30)));
    expect(pending[0].response.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(pending[0].response.observed).toBe(false);

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

  describe('impersonation transitions', () => {
    it.each(['starting', 'switching', 'stopping'] as const)('blocks reads and later writes immediately when %s, even if reload never happens', (state) => {
      const settled = vi.fn();
      service.settlements$.subscribe(settled);
      service.start(input('group-a', readyRows(30)));
      transition.set(state);

      // No render or subject update yet: the response must not send the next chunk.
      expect(service.viewerSubject()).toBeNull();
      expect(service.getRun('group-a')).toBeUndefined();
      expect(service.summaries().size).toBe(0);
      expect(service.start(input('group-b', readyRows(1)))).toBe(false);
      expect(service.retry('group-a')).toBe(false);
      respond(0);
      expect(pending).toHaveLength(1);
      expect(settled).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();

      TestBed.tick();
      transition.set(null);
      TestBed.tick();
      expect(service.getRun('group-a')).toBeUndefined();
      expect(service.start(input('group-a', readyRows(1, 50)))).toBe(true);
      expect(pending).toHaveLength(2);
    });

    it('retires paused runs and cooldown timers without resubmitting or restoring reports on a failed transition', () => {
      vi.useFakeTimers();
      service.start(input('group-a', readyRows(1)));
      pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '5' }) }));
      expect(service.getSummary('group-a')?.phase).toBe('paused');
      transition.set('starting');
      TestBed.tick();
      transition.set(null);
      TestBed.tick();
      vi.advanceTimersByTime(600_000);
      expect(pending).toHaveLength(1);
      expect(service.getRun('group-a')).toBeUndefined();
      expect(service.summaries().size).toBe(0);
      expect(toast).not.toHaveBeenCalled();
    });

    it('does not schedule more invitation cleanup after an impersonation transition begins', () => {
      const rows = readyRows(7);
      const pendingInviteUidByEmail = Object.fromEntries(rows.map((row, index) => [row.normalizedEmail, `invite-${index}`]));
      service.start(input('group-a', rows, { pendingInviteUidByEmail }));
      respond(0);
      expect(revokes).toHaveLength(5);
      transition.set('switching');
      revokes.forEach((revoke) => {
        revoke.next();
        revoke.complete();
      });
      expect(revokes).toHaveLength(5);
      expect(service.getRun('group-a')).toBeUndefined();
      expect(toast).not.toHaveBeenCalled();
    });

    it('does not warn against the impersonation reload before listener cleanup runs', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      service.start(input('group-a', readyRows(30)));
      TestBed.tick();
      const handler = add.mock.calls.find(([type]) => type === 'beforeunload')?.[1] as (event: BeforeUnloadEvent) => void;
      expect(handler).toBeDefined();
      transition.set('stopping');
      const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
      handler(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.returnValue).toBeUndefined();
      TestBed.tick();
      expect(remove).toHaveBeenCalledWith('beforeunload', handler);
      expect(service.getRun('group-a')).toBeUndefined();
    });
  });

  describe('background surfaces (#5731)', () => {
    let settled: MemberImportSettlement[];

    beforeEach(() => {
      settled = [];
      service.settlements$.subscribe((settlement) => settled.push(settlement));
    });

    it('projects counts-only summaries through importing, paused, stopping and settled', () => {
      vi.useFakeTimers();
      service.start(input('group-a', readyRows(30)));
      expect(service.getSummary('group-a')).toMatchObject({ phase: 'importing', batchTotal: 30, batchSettled: 0, added: 0, committeeName: 'Group group-a' });
      expect(service.getSummary('group-a')).not.toHaveProperty('rows');

      pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '5' }) }));
      expect(service.getSummary('group-a')?.phase).toBe('paused');
      vi.advanceTimersByTime(5_000);
      expect(service.getSummary('group-a')?.phase).toBe('importing');

      service.stop('group-a');
      expect(service.getSummary('group-a')?.phase).toBe('stopping');
      respond(1);
      expect(service.getSummary('group-a')).toMatchObject({ phase: 'settled', added: 25, notSubmitted: 5, retryable: 5, reconciliationTarget: 35 });
    });

    it('announces each settled attempt exactly once with its identity and retained target', () => {
      vi.useFakeTimers();
      service.start(input('group-a', readyRows(3)));
      respond(0, [2]);
      service.stop('group-a');
      expect(settled.map(({ key }) => key)).toEqual(['member-import-1:1']);
      expect(settled[0].summary).toMatchObject({ phase: 'settled', added: 2, unknown: 1, baselineMemberCount: 10, reconciliationTarget: 12 });

      service.retry('group-a');
      respond(1);
      expect(settled.map(({ key }) => key)).toEqual(['member-import-1:1', 'member-import-1:2']);
      expect(settled[1].summary).toMatchObject({ added: 3, reconciliationTarget: 13 });
      expect(toast).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        'clean',
        (): void => respond(0),
        { severity: 'success', summary: 'Import Complete', detail: '2 members added to Group group-a. New members may take a moment to appear.' },
      ],
      [
        'partial',
        (): void => {
          pending[0].response.next({
            results: [
              { index: 0, email: 'person0@example.com', status: 'added', retryable: false, member_uid: 'member-0' },
              { index: 1, email: 'person1@example.com', status: 'failed', reason: 'invalid', retryable: false, message: 'Rejected.' },
            ],
            added: 1,
            skipped: 0,
            failed: 1,
          });
          pending[0].response.complete();
        },
        {
          severity: 'warn',
          summary: 'Import Partly Complete',
          detail: expect.stringContaining('Import into Group group-a finished: 1 member added, 1 not added.'),
        },
      ],
      [
        'stopped',
        (): void => {
          pending[0].response.error(new HttpErrorResponse({ status: 403 }));
        },
        {
          severity: 'warn',
          summary: 'Import Stopped',
          detail: expect.stringContaining('Import into Group group-a stopped: 0 members added, 2 not yet submitted.'),
        },
      ],
      [
        'rejected',
        (): void => {
          pending[0].response.error(new HttpErrorResponse({ status: 400 }));
        },
        { severity: 'error', summary: 'Import Failed', detail: expect.stringContaining('Import into Group group-a finished: no members added, 2 not added.') },
      ],
      [
        'all-failed',
        (): void => {
          pending[0].response.next({
            results: [
              { index: 0, email: 'person0@example.com', status: 'failed', reason: 'invalid', retryable: false, message: 'Rejected.' },
              { index: 1, email: 'person1@example.com', status: 'failed', reason: 'invalid', retryable: false, message: 'Rejected.' },
            ],
            added: 0,
            skipped: 0,
            failed: 2,
          });
          pending[0].response.complete();
        },
        { severity: 'error', summary: 'Import Failed', detail: expect.stringContaining('no members added, 2 not added.') },
      ],
      [
        'all-skipped',
        (): void => {
          pending[0].response.next({
            results: [
              { index: 0, email: 'person0@example.com', status: 'skipped', reason: 'already_member', retryable: false },
              { index: 1, email: 'person1@example.com', status: 'skipped', reason: 'duplicate_in_request', retryable: false },
            ],
            added: 0,
            skipped: 2,
            failed: 0,
          });
          pending[0].response.complete();
        },
        {
          severity: 'info',
          summary: 'Import Finished',
          detail: "Import into Group group-a finished: no members added. Open the report from the group's Members tab.",
        },
      ],
    ] as const)('names the group and distinguishes a %s outcome in one root toast', (_label, finish, notice) => {
      service.start(input('group-a', readyRows(2)));
      finish();

      expect(toast).toHaveBeenCalledExactlyOnceWith({ ...notice, life: 8000 });
      expect(settled).toHaveLength(1);
    });

    it('reports an unknown outcome distinctly', () => {
      vi.useFakeTimers();
      service.start(input('group-a', readyRows(2)));
      respond(0, [1]);
      service.stop('group-a');

      expect(toast).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          severity: 'warn',
          summary: 'Import Outcome Unknown',
          detail: expect.stringContaining('1 member added, 1 with an unknown outcome'),
        })
      );
    });

    it('keeps a settled report until it is explicitly dismissed', () => {
      service.start(input('group-a', readyRows(1)));
      respond(0);
      expect(service.getSummary('group-a')?.phase).toBe('settled');
      expect(service.getSummary('group-a')?.phase).toBe('settled');

      service.dismiss('group-a');
      expect(service.getSummary('group-a')).toBeUndefined();
      expect(service.summaries().size).toBe(0);
    });

    it('revokes a run on lost access: no later chunk, no settlement and no retained details', () => {
      service.start(input('group-a', readyRows(30)));
      service.revoke('group-a');
      expect(service.getRun('group-a')).toBeUndefined();

      respond(0);
      expect(pending).toHaveLength(1);
      expect(settled).toHaveLength(0);
      expect(toast).not.toHaveBeenCalled();
    });

    it.each([1, 30])('revokes a paused %s-row run without another POST or a settlement', (count) => {
      vi.useFakeTimers();
      service.start(input('group-a', readyRows(count)));
      pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '5' }) }));
      expect(service.getSummary('group-a')?.phase).toBe('paused');

      service.revoke('group-a');
      vi.advanceTimersByTime(60_000);
      expect(service.getRun('group-a')).toBeUndefined();
      expect(pending).toHaveLength(1);
      expect(settled).toHaveLength(0);
      expect(toast).not.toHaveBeenCalled();
    });

    it("never exposes or announces another subject's run", () => {
      service.start(input('group-a', readyRows(1)));
      user.set({ sub: 'synthetic-replacement' });
      expect(service.summaries().size).toBe(0);
      respond(0);
      expect(settled).toHaveLength(0);
      expect(toast).not.toHaveBeenCalled();
    });

    it('installs the leave warning only while a run is writing', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const beforeUnload = (spy: typeof add): unknown[][] => spy.mock.calls.filter(([type]) => type === 'beforeunload');

      service.start(input('group-a', readyRows(1)));
      TestBed.tick();
      expect(beforeUnload(add)).toHaveLength(1);
      const handler = beforeUnload(add)[0][1] as (event: BeforeUnloadEvent) => void;
      const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
      handler(event);
      expect(event.preventDefault).toHaveBeenCalled();

      respond(0);
      TestBed.tick();
      expect(beforeUnload(remove)).toEqual([['beforeunload', handler]]);

      service.dismiss('group-a');
      service.start(input('group-a', readyRows(1, 5)));
      TestBed.tick();
      expect(beforeUnload(add)).toHaveLength(2);
      switchUser('synthetic-replacement');
      expect(beforeUnload(remove)).toHaveLength(2);
    });
  });

  describe('runStaged (wizard, #5529)', () => {
    let settled: MemberImportSettlement[];
    let delivered: MemberImportRow[][];
    let completed: boolean;

    function staged(
      count: number,
      patch: Partial<MemberImportStagedRunInput> = {},
      inviteUids: (index: number) => string[] = () => []
    ): MemberImportStagedRunInput {
      return {
        committeeUid: 'group-a',
        committeeName: 'Group group-a',
        skipNotification: false,
        members: Array.from({ length: count }, (_, index) => ({ payload: { email: `staged${index}@example.com` }, pendingInviteUids: inviteUids(index) })),
        ...patch,
      };
    }

    function run(stagedInput: MemberImportStagedRunInput): void {
      service.runStaged(stagedInput).subscribe({ next: (rows) => delivered.push(rows), complete: () => (completed = true) });
    }

    beforeEach(() => {
      settled = [];
      delivered = [];
      completed = false;
      service.settlements$.subscribe((settlement) => settled.push(settlement));
    });

    it('sends chunks of 25 one request at a time, then emits every settled row once and completes', () => {
      run(staged(30));
      expect(pending).toHaveLength(1);
      expect(pending[0].members).toHaveLength(25);
      expect(delivered).toHaveLength(0);

      respond(0);
      expect(pending).toHaveLength(2);
      expect(pending[1].members).toHaveLength(5);
      respond(1);

      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toHaveLength(30);
      expect(delivered[0].every((row) => row.status === 'added')).toBe(true);
      expect(completed).toBe(true);
    });

    it('does not start before subscription', () => {
      const run$ = service.runStaged(staged(1));
      expect(pending).toHaveLength(0);
      run$.subscribe();
      expect(pending).toHaveLength(1);
    });

    it('passes the notification choice through and carries the created member', () => {
      run(staged(1, { skipNotification: true }));
      expect(committeeService.bulkCreateCommitteeMembers).toHaveBeenCalledWith('group-a', [{ email: 'staged0@example.com' }], { skipNotification: true });
      const member = { uid: 'member-0', email: 'staged0@example.com' } as CommitteeMember;
      pending[0].response.next({
        results: [{ index: 0, email: 'staged0@example.com', status: 'added', retryable: false, member_uid: 'member-0', member }],
        added: 1,
        skipped: 0,
        failed: 0,
      });
      pending[0].response.complete();
      expect(delivered[0][0]).toMatchObject({ status: 'added', member });
    });

    it("revokes each of a row's pending invitations and keeps it added when one revoke fails", () => {
      run(staged(1, {}, () => ['invite-1', 'invite-2']));
      respond(0);
      expect(committeeService.revokeCommitteeInvite).toHaveBeenCalledTimes(1);
      revokes[0].error(new HttpErrorResponse({ status: 500 }));
      expect(committeeService.revokeCommitteeInvite).toHaveBeenNthCalledWith(2, 'group-a', 'invite-2');
      revokes[1].next();
      revokes[1].complete();

      expect(committeeService.revokeCommitteeInvite).toHaveBeenNthCalledWith(1, 'group-a', 'invite-1');
      expect(delivered[0][0]).toMatchObject({ status: 'added', cleanupWarning: expect.stringContaining('could not be revoked') });
    });

    it.each(['subject', 'transition', 'discarded'] as const)('stops queued row and invitation cleanup after ownership loss (%s)', (change) => {
      run(staged(7, {}, (index) => [`invite-${index}-a`, `invite-${index}-b`]));
      respond(0);
      expect(revokes).toHaveLength(5);
      if (change === 'transition') {
        transition.set('switching');
      } else {
        user.set({ sub: 'synthetic-replacement' });
      }
      if (change === 'discarded') TestBed.tick();
      for (const revoke of [...revokes]) {
        revoke.next();
        revoke.complete();
      }
      expect(revokes).toHaveLength(5);
      expect(delivered).toHaveLength(0);
      TestBed.tick();
      expect(completed).toBe(true);
    });

    it('pauses on a 429 and resubmits the throttled rows', () => {
      vi.useFakeTimers();
      run(staged(2));
      pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '1' }) }));
      expect(pending).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(pending).toHaveLength(2);
      expect(pending[1].members).toHaveLength(2);
      respond(1);
      expect(delivered[0].map((row) => row.status)).toEqual(['added', 'added']);
    });

    it('retains a long cooldown across notification groups and manual saves until its exact expiry', () => {
      vi.useFakeTimers();
      run(staged(1));
      pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '300' }) }));
      expect(completed).toBe(true);
      expect(delivered[0][0].status).toBe('not_submitted');

      run(staged(1, { skipNotification: true }));
      expect(pending).toHaveLength(1);
      expect(delivered[1][0]).toMatchObject({ status: 'not_submitted', reason: expect.stringContaining('cooldown') });
      vi.advanceTimersByTime(299_999);
      run(staged(1));
      expect(pending).toHaveLength(1);
      vi.advanceTimersByTime(1);
      run(staged(1));
      expect(pending).toHaveLength(2);
      respond(1);
      expect(delivered[3][0].status).toBe('added');
    });

    it('scopes retained wizard cooldowns to the group and initiating subject', () => {
      vi.useFakeTimers();
      run(staged(1));
      pending[0].response.error(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '300' }) }));
      run(staged(1, { committeeUid: 'group-b' }));
      expect(pending).toHaveLength(2);
      respond(1);
      switchUser('synthetic-replacement');
      run(staged(1));
      expect(pending).toHaveLength(3);
      respond(2);
    });

    it('stops later chunks after a 403 and reports their rows unsent', () => {
      run(staged(30));
      pending[0].response.error(new HttpErrorResponse({ status: 403 }));
      expect(pending).toHaveLength(1);
      expect(delivered[0]).toHaveLength(30);
      expect(delivered[0].every((row) => row.status === 'not_submitted')).toBe(true);
      expect(completed).toBe(true);
    });

    it('reports a lost response that resubmission finds already a member as skipped with its member UID', () => {
      vi.useFakeTimers();
      run(staged(1));
      pending[0].response.error(new HttpErrorResponse({ status: 0 }));
      vi.advanceTimersByTime(600_000);
      expect(pending).toHaveLength(2);
      pending[1].response.next({
        results: [{ index: 0, email: 'staged0@example.com', status: 'skipped', reason: 'already_member', retryable: false, member_uid: 'existing-0' }],
        added: 0,
        skipped: 1,
        failed: 0,
      });
      pending[1].response.complete();
      expect(delivered[0][0]).toMatchObject({ status: 'skipped', conflict: true, memberUid: 'existing-0' });
    });

    it('preserves uncertainty supplied by a manual wizard retry', () => {
      const input = staged(1);
      input.members[0].uncertain = true;
      run(input);
      pending[0].response.next({
        results: [{ index: 0, email: 'staged0@example.com', status: 'skipped', reason: 'already_member', retryable: false, member_uid: 'existing-0' }],
        added: 0,
        skipped: 1,
        failed: 0,
      });
      pending[0].response.complete();
      expect(delivered[0][0]).toMatchObject({ status: 'skipped', conflict: true, unconfirmedAddition: true });
      expect(delivered[0][0].reason).toContain('Review pending invitations');
    });

    it('never announces a wizard run or shows it as the group report', () => {
      run(staged(1));
      expect(service.summaries().size).toBe(0);
      expect(service.getRun('group-a')).toBeUndefined();
      respond(0);
      expect(settled).toHaveLength(0);
      expect(toast).not.toHaveBeenCalled();
      expect(service.getRun('group-a')).toBeUndefined();
    });

    it('neither blocks nor is blocked by a Members-tab import of the same group', () => {
      run(staged(1));
      expect(service.start(input('group-a', readyRows(1)))).toBe(true);
      expect(service.summaries().get('group-a')).toMatchObject({ phase: 'importing' });
      run(staged(1));
      expect(pending).toHaveLength(3);

      respond(0);
      respond(2);
      expect(delivered).toHaveLength(2);
      expect(service.getRun('group-a')).toMatchObject({ status: 'importing' });
      respond(1);
      expect(service.getRun('group-a')).toMatchObject({ status: 'settled' });
    });

    it('installs the leave warning while a wizard run is writing', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      run(staged(1));
      TestBed.tick();
      const handler = add.mock.calls.find(([type]) => type === 'beforeunload')?.[1];
      expect(handler).toBeDefined();
      respond(0);
      TestBed.tick();
      expect(remove).toHaveBeenCalledWith('beforeunload', handler);
    });

    it('completes without emitting when the user changes mid-run, and sends nothing without a user', () => {
      run(staged(30));
      switchUser('synthetic-replacement');
      expect(completed).toBe(true);
      respond(0);
      expect(pending).toHaveLength(1);
      expect(delivered).toHaveLength(0);

      switchUser(null);
      completed = false;
      run(staged(1));
      expect(completed).toBe(true);
      expect(pending).toHaveLength(1);
      expect(delivered).toHaveLength(0);
    });
  });
});
