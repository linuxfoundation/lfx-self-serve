// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Opening, reopening and authorizing the Members-tab CSV import views (#5731). The runner is faked: this
// suite proves the opener never writes, re-checks access freshly, and ignores stale answers. Synthetic data only.

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router } from '@angular/router';
import { ImportMembersDialogComponent } from '@app/modules/committees/components/import-members-dialog/import-members-dialog.component';
import { Committee, MemberImportDialogData, MemberImportRun } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeMemberImportDialogService } from './committee-member-import-dialog.service';
import { CommitteeMemberImportService } from './committee-member-import.service';
import { CommitteeService } from './committee.service';

const GROUP = { uid: 'group-a', name: 'Docs Working Group', writer: true } as Committee;

interface FakeDialog {
  onClose: Subject<unknown>;
  onDestroy: Subject<void>;
  close: ReturnType<typeof vi.fn>;
}

describe('CommitteeMemberImportDialogService', () => {
  const owner = signal<string | null>('synthetic-manager');
  const runs = signal(new Map<string, MemberImportRun>());
  let details: Subject<Committee>[];
  let dialogs: FakeDialog[];
  let routerEvents: Subject<unknown>;
  let toast: ReturnType<typeof vi.fn>;
  let importService: {
    viewerSubject: typeof owner;
    getRun: (uid: string) => MemberImportRun | undefined;
    revoke: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  let committeeService: { getCommitteeDetail: ReturnType<typeof vi.fn> };
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let service: CommitteeMemberImportDialogService;

  function retain(uid = GROUP.uid, runId = 'member-import-1'): void {
    runs.update((current) =>
      new Map(current).set(uid, { committeeUid: uid, committeeName: GROUP.name, runId, ownerSubject: 'synthetic-manager' } as MemberImportRun)
    );
  }

  function answer(index: number, committee: Partial<Committee> = {}): void {
    details[index].next({ ...GROUP, ...committee });
    details[index].complete();
  }

  function fail(index: number, status: number): void {
    details[index].error(new HttpErrorResponse({ status }));
  }

  function openedData(index = 0): MemberImportDialogData {
    return dialogService.open.mock.calls[index][1].data;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    owner.set('synthetic-manager');
    runs.set(new Map());
    details = [];
    dialogs = [];
    routerEvents = new Subject();
    toast = vi.fn();
    importService = {
      viewerSubject: owner,
      getRun: (uid) => {
        const run = runs().get(uid);
        return run && run.ownerSubject === owner() ? run : undefined;
      },
      revoke: vi.fn((uid: string) =>
        runs.update((current) => {
          const next = new Map(current);
          next.delete(uid);
          return next;
        })
      ),
      start: vi.fn(),
    };
    committeeService = {
      getCommitteeDetail: vi.fn(() => {
        const response = new Subject<Committee>();
        details.push(response);
        return response;
      }),
    };
    dialogService = {
      open: vi.fn(() => {
        const dialog: FakeDialog = { onClose: new Subject(), onDestroy: new Subject(), close: vi.fn(() => dialog.onClose.next(undefined)) };
        dialogs.push(dialog);
        return dialog;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: CommitteeMemberImportService, useValue: importService },
        { provide: CommitteeService, useValue: committeeService },
        { provide: DialogService, useValue: dialogService },
        { provide: MessageService, useValue: { add: toast } },
        { provide: Router, useValue: { events: routerEvents } },
      ],
    });
    service = TestBed.inject(CommitteeMemberImportDialogService);
    TestBed.tick();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('openNew', () => {
    it('opens one preview with backdrop dismissal and PrimeNG Escape handling off (the dialog owns Escape)', () => {
      const data = { committee: GROUP, existingMembers: [], existingInvites: [] };
      service.openNew(data);
      service.openNew(data);

      expect(dialogService.open).toHaveBeenCalledExactlyOnceWith(
        ImportMembersDialogComponent,
        expect.objectContaining({ closable: false, closeOnEscape: false, dismissableMask: false, data: { ...data, attach: false } })
      );
    });

    it("reopens the group's retained run instead of starting a second preview", () => {
      retain();
      service.openNew({ committee: GROUP, existingMembers: [], existingInvites: [] });

      expect(committeeService.getCommitteeDetail).toHaveBeenCalledExactlyOnceWith(GROUP.uid, { strictWriter: true });
      answer(0);
      expect(openedData().attach).toBe(true);
    });
  });

  describe('openRun', () => {
    it('reattaches after a fresh access check without snapshots or a write', () => {
      retain();
      service.openRun(GROUP.uid);
      expect(dialogService.open).not.toHaveBeenCalled();

      answer(0);
      expect(openedData()).toEqual({ committee: GROUP, existingMembers: [], existingInvites: [], attach: true });
      expect(importService.start).not.toHaveBeenCalled();
      expect(service.accessByUid().get(GROUP.uid)).toBe('authorized');
    });

    it('deduplicates double clicks and an already open view, and releases the handle on close', () => {
      retain();
      service.openRun(GROUP.uid);
      service.openRun(GROUP.uid);
      expect(committeeService.getCommitteeDetail).toHaveBeenCalledTimes(1);
      answer(0);
      service.openRun(GROUP.uid);
      expect(committeeService.getCommitteeDetail).toHaveBeenCalledTimes(1);
      expect(dialogService.open).toHaveBeenCalledTimes(1);

      dialogs[0].onClose.next(undefined);
      service.openRun(GROUP.uid);
      answer(1);
      expect(dialogService.open).toHaveBeenCalledTimes(2);
    });

    it('does nothing without a retained run', () => {
      service.openRun(GROUP.uid);
      expect(committeeService.getCommitteeDetail).not.toHaveBeenCalled();
    });

    it.each([
      ['a completed strict check without writer access', (): void => answer(0, { writer: false })],
      ['a forbidden group', (): void => fail(0, 403)],
      ['a missing group', (): void => fail(0, 404)],
    ])('discards the private report on %s and stops its future writes', (_label, deny) => {
      retain();
      service.openRun(GROUP.uid);
      deny();

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(importService.revoke).toHaveBeenCalledExactlyOnceWith(GROUP.uid);
      expect(service.accessByUid().has(GROUP.uid)).toBe(false);
      expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ severity: 'error', summary: 'Import Unavailable' }));
    });

    it('keeps results after a transient failure and allows another attempt', () => {
      retain();
      service.openRun(GROUP.uid);
      fail(0, 503);

      expect(importService.revoke).not.toHaveBeenCalled();
      expect(service.accessByUid().get(GROUP.uid)).toBe('error');
      expect(toast).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ summary: 'Unable to Open Import', detail: expect.stringContaining('results are kept') })
      );

      service.openRun(GROUP.uid);
      answer(1);
      expect(dialogService.open).toHaveBeenCalledTimes(1);
    });

    it('ignores a late answer after the observed user changes', () => {
      retain();
      service.openRun(GROUP.uid);
      owner.set('synthetic-replacement');
      TestBed.tick();
      answer(0, { writer: false });

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(importService.revoke).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(service.accessByUid().size).toBe(0);
    });

    it('abandons a pending open on navigation and closes open views without stopping the run', () => {
      retain();
      retain('group-b', 'member-import-2');
      service.openRun('group-b');
      answer(0, { uid: 'group-b' });
      service.openRun(GROUP.uid);

      routerEvents.next(new NavigationStart(1, '/groups'));
      expect(details[1].observed).toBe(false);
      expect(dialogs[0].close).toHaveBeenCalled();
      expect(importService.revoke).not.toHaveBeenCalled();
      expect(dialogService.open).toHaveBeenCalledTimes(1);
    });

    describe.each(['dismissed', 'replaced'] as const)('a %s run during an access check', (change) => {
      it.each(['authorized', 'denied', 403, 404, 503] as const)('ignores a stale %s result without notifications or revocation', (result) => {
        retain();
        service.openRun(GROUP.uid);
        if (change === 'dismissed') {
          runs.set(new Map());
        } else {
          retain(GROUP.uid, 'member-import-2');
        }
        if (typeof result === 'number') {
          fail(0, result);
        } else {
          answer(0, { writer: result === 'authorized' });
        }

        expect(dialogService.open).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
        expect(importService.revoke).not.toHaveBeenCalled();
        expect(service.accessByUid().size).toBe(0);
        if (change === 'replaced') {
          expect(importService.getRun(GROUP.uid)?.runId).toBe('member-import-2');
          service.openRun(GROUP.uid);
          expect(details).toHaveLength(2);
          answer(1);
          expect(dialogService.open).toHaveBeenCalledOnce();
          expect(openedData().attach).toBe(true);
        } else {
          expect(importService.getRun(GROUP.uid)).toBeUndefined();
        }
      });
    });
  });

  describe('probeAccess', () => {
    it('reveals nothing while pending, deduplicates concurrent probes, and records authorization', () => {
      retain();
      const first = service.probeAccess([GROUP.uid, 'group-without-run']).subscribe();
      const second = service.probeAccess([GROUP.uid]).subscribe();

      expect(committeeService.getCommitteeDetail).toHaveBeenCalledExactlyOnceWith(GROUP.uid, { strictWriter: true });
      expect(service.accessByUid().get(GROUP.uid)).toBe('pending');
      answer(0);
      expect(service.accessByUid().get(GROUP.uid)).toBe('authorized');
      first.unsubscribe();
      second.unsubscribe();
    });

    it('hides previously authorized status as soon as a fresh probe or reopen is subscribed', () => {
      retain();
      service.probeAccess([GROUP.uid]).subscribe();
      answer(0);
      expect(service.accessByUid().get(GROUP.uid)).toBe('authorized');

      const probe = service.probeAccess([GROUP.uid]);
      expect(service.accessByUid().get(GROUP.uid)).toBe('authorized');
      probe.subscribe();
      expect(service.accessByUid().get(GROUP.uid)).toBe('pending');
      answer(1);
      service.openRun(GROUP.uid);
      expect(service.accessByUid().get(GROUP.uid)).toBe('pending');
      answer(2);
      expect(service.accessByUid().get(GROUP.uid)).toBe('authorized');
      expect(dialogs).toHaveLength(1);
    });

    it('shares a current probe with reopening without resetting its in-flight result', () => {
      retain();
      service.probeAccess([GROUP.uid]).subscribe();
      service.openRun(GROUP.uid);
      expect(details).toHaveLength(1);
      answer(0);
      expect(dialogs).toHaveLength(1);
    });

    it('does not reuse authorization or an in-flight probe for a replacement run', () => {
      retain();
      service.probeAccess([GROUP.uid]).subscribe();
      answer(0);
      service.probeAccess([GROUP.uid]).subscribe();
      retain(GROUP.uid, 'member-import-2');
      expect(service.accessByUid().has(GROUP.uid)).toBe(false);
      service.probeAccess([GROUP.uid]).subscribe();
      expect(details).toHaveLength(3);
      expect(service.accessByUid().get(GROUP.uid)).toBe('pending');
      answer(1, { writer: false });
      expect(importService.revoke).not.toHaveBeenCalled();
      expect(service.accessByUid().get(GROUP.uid)).toBe('pending');
      answer(2);
      expect(service.accessByUid().get(GROUP.uid)).toBe('authorized');
    });

    it('cancels a probe once every surface stops observing it, then probes afresh', () => {
      retain();
      const subscription = service.probeAccess([GROUP.uid]).subscribe();
      subscription.unsubscribe();
      expect(details[0].observed).toBe(false);

      service.probeAccess([GROUP.uid]).subscribe();
      expect(committeeService.getCommitteeDetail).toHaveBeenCalledTimes(2);
    });

    it('closes an open view when a later probe is denied', () => {
      retain();
      service.openRun(GROUP.uid);
      answer(0);
      service.probeAccess([GROUP.uid]).subscribe();
      answer(1, { writer: false });

      expect(dialogs[0].close).toHaveBeenCalled();
      expect(importService.revoke).toHaveBeenCalledExactlyOnceWith(GROUP.uid);
    });

    it.each([500, 502, 503])('keeps the retained run and reveals nothing when the strict writer check fails with %s (#5731)', (status) => {
      retain();
      service.probeAccess([GROUP.uid]).subscribe();
      fail(0, status);

      expect(importService.revoke).not.toHaveBeenCalled();
      expect(service.accessByUid().get(GROUP.uid)).toBe('error');
      expect(importService.getRun(GROUP.uid)).toBeDefined();
    });

    it('ignores a result for a replaced run', () => {
      retain();
      service.probeAccess([GROUP.uid]).subscribe();
      retain(GROUP.uid, 'member-import-2');
      answer(0, { writer: false });

      expect(importService.revoke).not.toHaveBeenCalled();
      expect(service.accessByUid().has(GROUP.uid)).toBe(false);
    });

    it('drops every access result when the observed user changes', () => {
      retain();
      service.probeAccess([GROUP.uid]).subscribe();
      answer(0);
      owner.set('synthetic-replacement');
      TestBed.tick();

      expect(service.accessByUid().size).toBe(0);
    });
  });
});
