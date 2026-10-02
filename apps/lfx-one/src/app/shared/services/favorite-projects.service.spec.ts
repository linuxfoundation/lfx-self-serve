// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FAVORITE_PROJECTS_MAX_VALUES } from '@lfx-one/shared/constants';
import { User } from '@lfx-one/shared/interfaces';
import { NavigationService } from '@services/navigation.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { NEVER, asapScheduler, observeOn, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FavoriteProjectsService } from './favorite-projects.service';

describe('FavoriteProjectsService', () => {
  const user = { sub: 'u1' } as User;

  let service: FavoriteProjectsService;
  let navigationService: {
    getFavoriteProjectsPreference: ReturnType<typeof vi.fn>;
    upsertFavoriteProjectsPreference: ReturnType<typeof vi.fn>;
    deleteFavoriteProjectsPreference: ReturnType<typeof vi.fn>;
  };
  let userService: { user: ReturnType<typeof signal<User | null>> };
  let messageService: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    navigationService = {
      getFavoriteProjectsPreference: vi.fn().mockReturnValue(of(null)),
      upsertFavoriteProjectsPreference: vi.fn().mockReturnValue(of(undefined)),
      deleteFavoriteProjectsPreference: vi.fn().mockReturnValue(of(undefined)),
    };
    userService = { user: signal<User | null>(null) };
    messageService = { add: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        FavoriteProjectsService,
        { provide: NavigationService, useValue: navigationService },
        { provide: UserService, useValue: userService },
        { provide: MessageService, useValue: messageService },
      ],
    });

    service = TestBed.inject(FavoriteProjectsService);
  });

  // Context tracking (toObservable) fires on tick; the promise-backed transport settles on the macrotask flush.
  async function flush(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('loads the favorited uids under the preference name once a user is set', async () => {
    navigationService.getFavoriteProjectsPreference.mockReturnValue(of('["p1","p2"]'));

    userService.user.set(user);
    await flush();

    expect(navigationService.getFavoriteProjectsPreference).toHaveBeenCalled();
    expect([...service.state().data]).toEqual(['p1', 'p2']);
  });

  it('toggles a favorite on optimistically and persists it', async () => {
    userService.user.set(user);
    await flush();

    service.toggleFavorite('p1');
    // Optimistic: the star flips before the write round-trips.
    expect(service.state().data.has('p1')).toBe(true);

    await flush();
    expect(navigationService.upsertFavoriteProjectsPreference).toHaveBeenCalledWith('["p1"]');
  });

  it('deletes the preference row when the last favorite is removed', async () => {
    navigationService.getFavoriteProjectsPreference.mockReturnValue(of('["p1"]'));
    userService.user.set(user);
    await flush();

    service.toggleFavorite('p1');
    await flush();

    expect(service.state().data.has('p1')).toBe(false);
    expect(navigationService.deleteFavoriteProjectsPreference).toHaveBeenCalled();
    expect(navigationService.upsertFavoriteProjectsPreference).not.toHaveBeenCalled();
  });

  it('upserts the remaining ids when one of several favorites is removed', async () => {
    navigationService.getFavoriteProjectsPreference.mockReturnValue(of('["p1","p2"]'));
    userService.user.set(user);
    await flush();

    service.toggleFavorite('p1');
    await flush();

    expect(navigationService.upsertFavoriteProjectsPreference).toHaveBeenCalledWith('["p2"]');
    expect(navigationService.deleteFavoriteProjectsPreference).not.toHaveBeenCalled();
  });

  it('rolls back and toasts the error when the write fails', async () => {
    // The store reconciles a failed write with a re-GET — both must fail for onError to fire.
    navigationService.upsertFavoriteProjectsPreference.mockReturnValue(throwError(() => new Error('write lost')).pipe(observeOn(asapScheduler)));
    userService.user.set(user);
    await flush();
    navigationService.getFavoriteProjectsPreference.mockReturnValue(throwError(() => new Error('read lost')));

    service.toggleFavorite('p1');
    expect(service.state().data.has('p1')).toBe(true);
    await flush();

    expect(service.state().data.has('p1')).toBe(false);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Failed to save favorite',
      detail: 'Could not save the favorite. Please try again.',
    });
  });

  it('rolls back and toasts the error when the delete fails', async () => {
    navigationService.getFavoriteProjectsPreference.mockReturnValue(of('["p1"]'));
    userService.user.set(user);
    await flush();

    navigationService.deleteFavoriteProjectsPreference.mockReturnValue(throwError(() => new Error('delete lost')));
    service.toggleFavorite('p1');
    await flush();

    expect(service.state().data.has('p1')).toBe(true);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Failed to remove favorite',
      detail: 'Could not remove the favorite. Please try again.',
    });
  });

  it('ignores toggles while the initial load is in flight', async () => {
    navigationService.getFavoriteProjectsPreference.mockReturnValue(NEVER);
    userService.user.set(user);
    // Pipeline entered, load pending — loading is true.
    TestBed.inject(ApplicationRef).tick();
    expect(service.state().loading).toBe(true);

    service.toggleFavorite('p1');
    await flush();

    expect(navigationService.upsertFavoriteProjectsPreference).not.toHaveBeenCalled();
    expect(service.state().data.size).toBe(0);
  });

  it('warns and skips the write at the favorites cap', async () => {
    const full = Array.from({ length: FAVORITE_PROJECTS_MAX_VALUES }, (_, i) => `p${i}`);
    navigationService.getFavoriteProjectsPreference.mockReturnValue(of(JSON.stringify(full)));
    userService.user.set(user);
    await flush();

    service.toggleFavorite('new-project');
    await flush();

    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Favorites limit reached',
      detail: `You can favorite up to ${FAVORITE_PROJECTS_MAX_VALUES} foundations/projects.`,
    });
    expect(navigationService.upsertFavoriteProjectsPreference).not.toHaveBeenCalled();
    expect(service.state().data.has('new-project')).toBe(false);
  });

  it('no-ops a toggle before any user is signed in', async () => {
    service.toggleFavorite('p1');
    await flush();

    expect(navigationService.upsertFavoriteProjectsPreference).not.toHaveBeenCalled();
    expect(messageService.add).not.toHaveBeenCalled();
  });

  it('clears favorites when the user signs out', async () => {
    navigationService.getFavoriteProjectsPreference.mockReturnValue(of('["p1"]'));
    userService.user.set(user);
    await flush();
    expect(service.state().data.has('p1')).toBe(true);

    userService.user.set(null);
    await flush();

    expect(service.state().data.size).toBe(0);
  });
});
