// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MENTION_IDS_MAX_VALUES } from '@lfx-one/shared/constants';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';
import { NEVER, asapScheduler, observeOn, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentionBookmarkService } from './mention-bookmark.service';

describe('MentionBookmarkService', () => {
  const ctx = { userId: 'u1', projectId: 'p1' };
  const preferenceName = 'Social Listening Bookmarks - p1';

  let service: MentionBookmarkService;
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
        MentionBookmarkService,
        { provide: SocialListeningService, useValue: socialListeningService },
        { provide: MessageService, useValue: messageService },
      ],
    });

    service = TestBed.inject(MentionBookmarkService);
  });

  // Effects (toObservable) fire on tick; the promise-backed transport settles on the macrotask flush.
  async function flush(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('loads the bookmark set under the PCC preference name for the context', async () => {
    socialListeningService.getPreference.mockReturnValue(of('["m1","m2"]'));

    service.setContext(ctx);
    await flush();

    expect(socialListeningService.getPreference).toHaveBeenCalledWith(preferenceName);
    expect([...service.state().data]).toEqual(['m1', 'm2']);
  });

  it('toggles a bookmark on optimistically and toasts on success', async () => {
    service.setContext(ctx);
    await flush();

    service.toggleBookmark('m1');
    // Optimistic: the icon flips before the write round-trips.
    expect(service.state().data.has('m1')).toBe(true);

    await flush();
    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, '["m1"]');
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'success', summary: 'Bookmarked', detail: 'Mention added to your bookmarks.' });
  });

  it('deletes the preference row when the last bookmark is removed', async () => {
    socialListeningService.getPreference.mockReturnValue(of('["m1"]'));
    service.setContext(ctx);
    await flush();

    service.toggleBookmark('m1');
    await flush();

    expect(service.state().data.has('m1')).toBe(false);
    expect(socialListeningService.deletePreference).toHaveBeenCalledWith(preferenceName);
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'success', summary: 'Bookmark removed', detail: 'Mention removed from your bookmarks.' });
  });

  it('upserts the remaining ids when one of several bookmarks is removed', async () => {
    socialListeningService.getPreference.mockReturnValue(of('["m1","m2"]'));
    service.setContext(ctx);
    await flush();

    service.toggleBookmark('m1');
    await flush();

    expect(socialListeningService.upsertPreference).toHaveBeenCalledWith(preferenceName, '["m2"]');
    expect(socialListeningService.deletePreference).not.toHaveBeenCalled();
  });

  it('rolls back and toasts the error when the write fails', async () => {
    // The store reconciles a failed write with a re-GET — both must fail for onError to fire.
    // The failure is delivered asynchronously so the optimistic state is observable before the rollback (HTTP never fails synchronously).
    socialListeningService.upsertPreference.mockReturnValue(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)));
    service.setContext(ctx);
    await flush();
    socialListeningService.getPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.toggleBookmark('m1');
    expect(service.state().data.has('m1')).toBe(true);
    await flush();

    expect(service.state().data.has('m1')).toBe(false);
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'error', summary: 'Could not save bookmark', detail: 'Please try again.' });
  });

  it('rolls back and toasts the error when the delete fails', async () => {
    socialListeningService.getPreference.mockReturnValue(of('["m1"]'));
    service.setContext(ctx);
    await flush();

    socialListeningService.deletePreference.mockReturnValue(throwError(() => new Error('delete lost')));
    service.toggleBookmark('m1');
    await flush();

    expect(service.state().data.has('m1')).toBe(true);
    expect(messageService.add).toHaveBeenCalledWith({ severity: 'error', summary: 'Could not remove bookmark', detail: 'Please try again.' });
  });

  it('ignores toggles while the initial load is in flight', async () => {
    socialListeningService.getPreference.mockReturnValue(NEVER);
    service.setContext(ctx);
    // Pipeline entered, load pending — loading is true.
    TestBed.inject(ApplicationRef).tick();
    expect(service.state().loading).toBe(true);

    service.toggleBookmark('m1');
    await flush();

    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(service.state().data.size).toBe(0);
  });

  it('warns and skips the write at the bookmark cap', async () => {
    const full = Array.from({ length: MENTION_IDS_MAX_VALUES }, (_, i) => `m${i}`);
    socialListeningService.getPreference.mockReturnValue(of(JSON.stringify(full)));
    service.setContext(ctx);
    await flush();

    service.toggleBookmark('new-mention');
    await flush();

    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Bookmark limit reached',
      detail: `You can bookmark up to ${MENTION_IDS_MAX_VALUES} mentions per project.`,
    });
    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(service.state().data.has('new-mention')).toBe(false);
  });

  it('no-ops a toggle before any context is set', async () => {
    service.toggleBookmark('m1');
    await flush();

    expect(socialListeningService.upsertPreference).not.toHaveBeenCalled();
    expect(messageService.add).not.toHaveBeenCalled();
  });
});
