// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY_READ_STATE, MAX_READ_IDS } from '@lfx-one/shared/constants';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';
import { NEVER, asapScheduler, observeOn, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentionReadStateService } from './mention-read-state.service';

import type { ReadStateData } from '@lfx-one/shared/interfaces';

describe('MentionReadStateService', () => {
  const ctx = { userId: 'u1', projectId: 'p1' };
  const preferenceName = 'Social Listening Read State - p1';
  const TS = '2026-03-01 12:00:00';
  const CUTOFF = '2026-02-01 00:00:00';

  let service: MentionReadStateService;
  let socialListeningService: {
    getPreference: ReturnType<typeof vi.fn>;
    upsertPreference: ReturnType<typeof vi.fn>;
    deletePreference: ReturnType<typeof vi.fn>;
  };
  let messageService: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    socialListeningService = {
      getPreference: vi.fn().mockReturnValue(of(null)),
      upsertPreference: vi.fn().mockReturnValue(of(undefined)),
      deletePreference: vi.fn().mockReturnValue(of(undefined)),
    };
    messageService = { add: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        MentionReadStateService,
        { provide: SocialListeningService, useValue: socialListeningService },
        { provide: MessageService, useValue: messageService },
      ],
    });

    service = TestBed.inject(MentionReadStateService);
  });

  // Effects (toObservable) fire on tick; the promise-backed transport settles on the macrotask flush.
  async function flush(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function storedDoc(doc: Partial<ReadStateData>): string {
    return JSON.stringify({ readBeforeTs: null, readIds: [], unreadIds: [], ...doc });
  }

  it('loads and parses the read-state doc under the PCC preference name for the context', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readBeforeTs: CUTOFF, readIds: ['m1'] })));

    service.setContext(ctx);
    await flush();

    expect(socialListeningService.getPreference).toHaveBeenCalledWith(preferenceName);
    expect(service.state().data).toEqual({ readBeforeTs: CUTOFF, readIds: ['m1'], unreadIds: [] });
    expect(service.state().loading).toBe(false);
  });

  it('parses a corrupt stored doc to the empty state so the user can rewrite over it', async () => {
    socialListeningService.getPreference.mockReturnValue(of('{not json'));

    service.setContext(ctx);
    await flush();

    expect(service.state().data).toEqual(EMPTY_READ_STATE);
    expect(service.state().readOnly).toBe(false);
  });

  it('toggles read optimistically and persists the override', async () => {
    service.setContext(ctx);
    await flush();

    service.toggleRead('m1', TS);
    // Optimistic: the card dims before the write round-trips.
    expect(service.isRead('m1', TS)).toBe(true);

    await flush();
    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, storedDoc({ readIds: ['m1'] }));
    expect(messageService.add).not.toHaveBeenCalled();
  });

  it('resolves reads through the cutoff and toggles a cutoff-covered mention into unreadIds and back', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readBeforeTs: CUTOFF })));
    service.setContext(ctx);
    await flush();

    expect(service.isRead('m1', '2026-01-15 10:00:00')).toBe(true); // covered by the cutoff
    expect(service.isRead('m2', '2026-03-15 10:00:00')).toBe(false); // published after it

    service.toggleRead('m1', '2026-01-15 10:00:00');
    expect(service.state().data.unreadIds).toEqual(['m1']);
    expect(service.isRead('m1', '2026-01-15 10:00:00')).toBe(false);

    await flush();
    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, storedDoc({ readBeforeTs: CUTOFF, unreadIds: ['m1'] }));

    service.toggleRead('m1', '2026-01-15 10:00:00');
    // Re-reading drops the override instead of adding a redundant readIds entry.
    expect(service.state().data.unreadIds).toEqual([]);
    expect(service.state().data.readIds).toEqual([]);
  });

  it('rolls back only the failed toggle, preserving a later queued one', async () => {
    service.setContext(ctx);
    await flush();

    // The store reconciles a failed write with a re-GET — both must fail for onError to fire; m2's write succeeds.
    // The failure is delivered asynchronously so both toggles land optimistically before the rollback (HTTP never fails synchronously).
    socialListeningService.upsertPreference
      .mockReturnValueOnce(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)))
      .mockReturnValue(of(undefined));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.toggleRead('m1', TS);
    service.toggleRead('m2', TS);
    expect(service.state().data.readIds).toEqual(['m1', 'm2']);

    await flush();

    expect(service.state().data.readIds).toEqual(['m2']);
    expect(messageService.add).toHaveBeenCalledTimes(1);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Read state failed',
      detail: 'Could not save read state. Please try again.',
    });
  });

  it('keeps a succeeded bulk mark-all-as-read when an earlier queued toggle fails', async () => {
    service.setContext(ctx);
    await flush();

    // The toggle's write and its reconcile re-GET both fail; the queued bulk write succeeds.
    // The failure is delivered asynchronously so the bulk commit lands optimistically before the toggle's rollback runs.
    socialListeningService.upsertPreference
      .mockReturnValueOnce(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)))
      .mockReturnValue(of(undefined));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.toggleRead('m1', TS);
    service.markAllAsRead(TS);
    await flush();

    // The toggle's rollback must not resurrect m1 as unread over the persisted bulk cutoff.
    expect(service.state().data).toEqual({ readBeforeTs: TS, readIds: [], unreadIds: [] });
    expect(service.isRead('m1', TS)).toBe(true);
    expect(messageService.add).toHaveBeenCalledTimes(1);
  });

  it('keeps a succeeded bulk mark-all-as-unread when an earlier queued toggle fails', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readBeforeTs: CUTOFF })));
    service.setContext(ctx);
    await flush();

    // The toggle's write and its reconcile re-GET both fail; the queued bulk reset succeeds.
    // The failure is delivered asynchronously so the bulk commit lands optimistically before the toggle's rollback runs.
    socialListeningService.upsertPreference
      .mockReturnValueOnce(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)))
      .mockReturnValue(of(undefined));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    // m1 predates the cutoff, so the toggle marks it unread; the bulk reset then supersedes it.
    service.toggleRead('m1', '2026-01-15 10:00:00');
    service.markAllAsUnread();
    await flush();

    expect(service.state().data).toEqual(EMPTY_READ_STATE);
    expect(service.isRead('m1', '2026-01-15 10:00:00')).toBe(false);
  });

  it('gates toggles and mark-all actions while the initial load is in flight', async () => {
    socialListeningService.getPreference.mockReturnValue(NEVER);
    service.setContext(ctx);
    // Pipeline entered, load pending — loading is true.
    TestBed.inject(ApplicationRef).tick();
    expect(service.state().loading).toBe(true);

    service.toggleRead('m1', TS);
    service.markAllAsRead(TS);
    service.markAllAsUnread();
    await flush();

    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(service.state().data).toEqual(EMPTY_READ_STATE);
  });

  it('warns once per context when readIds nears the cap', async () => {
    const nearCap = Array.from({ length: MAX_READ_IDS * 0.9 }, (_, i) => `m${i}`);
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readIds: nearCap })));
    service.setContext(ctx);
    await flush();

    service.toggleRead('new-1', TS);
    await flush();
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Many mentions marked as read',
      detail: "You've read many mentions — use 'Mark all as read' to keep your read state accurate.",
    });

    service.toggleRead('new-2', TS);
    await flush();
    expect(messageService.add).toHaveBeenCalledTimes(1);
  });

  it('resets the overflow latch when the context changes', async () => {
    const nearCap = Array.from({ length: MAX_READ_IDS * 0.9 }, (_, i) => `m${i}`);
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readIds: nearCap })));
    service.setContext(ctx);
    await flush();

    service.toggleRead('new-1', TS);
    await flush();
    expect(messageService.add).toHaveBeenCalledTimes(1);

    service.setContext({ userId: 'u1', projectId: 'p2' });
    await flush();

    service.toggleRead('new-2', TS);
    await flush();
    expect(messageService.add).toHaveBeenCalledTimes(2);
  });

  it('markAllAsRead commits the newest loaded timestamp as the cutoff with both arrays cleared', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readIds: ['m1'], unreadIds: ['m2'] })));
    service.setContext(ctx);
    await flush();

    service.markAllAsRead(TS);
    await flush();

    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, storedDoc({ readBeforeTs: TS }));
    expect(service.state().data).toEqual({ readBeforeTs: TS, readIds: [], unreadIds: [] });
  });

  it('markAllAsRead no-ops on a null cutoff — never falls back to wall-clock', async () => {
    service.setContext(ctx);
    await flush();

    service.markAllAsRead(null);
    await flush();

    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(service.state().data).toEqual(EMPTY_READ_STATE);
  });

  it('markAllAsUnread writes the empty state instead of deleting the row', async () => {
    socialListeningService.getPreference.mockReturnValue(of(storedDoc({ readBeforeTs: CUTOFF, readIds: ['m1'] })));
    service.setContext(ctx);
    await flush();

    service.markAllAsUnread();
    await flush();

    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, storedDoc({}));
    expect(socialListeningService.deletePreference).not.toHaveBeenCalled();
    expect(service.state().data).toEqual(EMPTY_READ_STATE);
  });

  it('a failed mark-all does not roll back over a later superseding bulk action', async () => {
    socialListeningService.getPreference.mockReturnValueOnce(of(storedDoc({ readBeforeTs: CUTOFF })));
    service.setContext(ctx);
    await flush();

    // Bulk 1's write and reconcile re-GET both fail; bulk 2's write succeeds. Failures land asynchronously
    // so both bulk commits are queued (and bulk 2's optimistic state applied) before rollback 1 runs.
    socialListeningService.upsertPreference
      .mockReturnValueOnce(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)))
      .mockReturnValue(of(undefined));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.markAllAsRead(TS);
    service.markAllAsUnread();
    await flush();

    // Bulk 1's rollback is superseded: it must not restore the old cutoff over bulk 2's optimistic reset,
    // which is also what bulk 2 persisted server-side.
    expect(socialListeningService.upsertPreference).toHaveBeenNthCalledWith(1, preferenceName, storedDoc({ readBeforeTs: TS }));
    expect(socialListeningService.upsertPreference).toHaveBeenNthCalledWith(2, preferenceName, storedDoc({}));
    expect(service.state().data).toEqual(EMPTY_READ_STATE);
    expect(messageService.add).toHaveBeenCalledTimes(1);
  });

  it('restores the pre-chain state when every queued bulk write fails', async () => {
    socialListeningService.getPreference.mockReturnValueOnce(of(storedDoc({ readBeforeTs: CUTOFF })));
    service.setContext(ctx);
    await flush();

    socialListeningService.upsertPreference.mockReturnValue(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.markAllAsRead(TS);
    service.markAllAsUnread();
    await flush();

    // Bulk 2's captured "previous" was bulk 1's optimistic cutoff, which never persisted — the rollback
    // must restore the pre-chain doc instead.
    expect(service.state().data).toEqual({ readBeforeTs: CUTOFF, readIds: [], unreadIds: [] });
    expect(messageService.add).toHaveBeenCalledTimes(2);
  });

  it('rolls a failed later bulk back to the earlier bulk state once that write persisted', async () => {
    socialListeningService.getPreference.mockReturnValueOnce(of(storedDoc({ readBeforeTs: CUTOFF })));
    service.setContext(ctx);
    await flush();

    // Bulk 1 succeeds; bulk 2's write and reconcile re-GET both fail.
    socialListeningService.upsertPreference
      .mockReturnValueOnce(of(undefined))
      .mockReturnValueOnce(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.markAllAsRead(TS);
    service.markAllAsUnread();
    await flush();

    // Bulk 1's cutoff persisted, so it is the correct restore target for bulk 2's failure.
    expect(service.state().data).toEqual({ readBeforeTs: TS, readIds: [], unreadIds: [] });
    expect(messageService.add).toHaveBeenCalledTimes(1);
  });

  it('restores the persisted earlier bulk state when a mid-chain bulk also fails', async () => {
    socialListeningService.getPreference.mockReturnValueOnce(of(storedDoc({ readBeforeTs: CUTOFF })));
    service.setContext(ctx);
    await flush();

    // Bulk 1 succeeds; bulks 2 and 3 fail (write + reconcile re-GET). Bulk 3's captured `previous` is
    // bulk 2's optimistic empty doc, which never persisted — the rollback must restore bulk 1's cutoff.
    socialListeningService.upsertPreference
      .mockReturnValueOnce(of(undefined))
      .mockReturnValue(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)));
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.markAllAsRead(TS);
    service.markAllAsUnread();
    service.markAllAsRead(CUTOFF);
    await flush();

    expect(service.state().data).toEqual({ readBeforeTs: TS, readIds: [], unreadIds: [] });
    expect(messageService.add).toHaveBeenCalledTimes(2);
  });

  it('no-ops commits before any context is set', async () => {
    service.toggleRead('m1', TS);
    service.markAllAsRead(TS);
    service.markAllAsUnread();
    await flush();

    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(messageService.add).not.toHaveBeenCalled();
  });
});
