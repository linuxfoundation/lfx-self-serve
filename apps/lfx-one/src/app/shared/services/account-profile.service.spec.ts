// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { CombinedProfile } from '@lfx-one/shared/interfaces';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountProfileService } from './account-profile.service';
import { ProfileSaveSyncService } from './profile-save-sync.service';
import { UserService } from './user.service';

const PROFILE = {
  user: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'ada@example.com' },
  profile: { job_title: 'Engineer', city: 'London' },
} as unknown as CombinedProfile;

describe('AccountProfileService', () => {
  let getCurrentUserProfile: ReturnType<typeof vi.fn>;
  let apply: ReturnType<typeof vi.fn>;
  let service: AccountProfileService;

  beforeEach(() => {
    getCurrentUserProfile = vi.fn(() => of(PROFILE));
    apply = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        AccountProfileService,
        { provide: UserService, useValue: { getCurrentUserProfile } },
        { provide: ProfileSaveSyncService, useValue: { apply } },
      ],
    });
    service = TestBed.inject(AccountProfileService);
  });

  it('holds the fetched profile', () => {
    service.load();

    expect(service.profile()).toEqual(PROFILE);
    expect(service.loading()).toBe(false);
  });

  it('lays every save over the fetched profile, so a stale refetch cannot undo it', () => {
    service.load();
    service.applySaved({ given_name: 'Augusta', job_title: 'Analyst', city: undefined });
    service.load();

    expect(service.profile()?.user.first_name).toBe('Augusta');
    expect(service.profile()?.profile).toEqual(expect.objectContaining({ job_title: 'Analyst', city: 'London' }));
  });

  it('carries a save to the rest of the app with the account as it was before', () => {
    service.load();
    service.applySaved({ given_name: 'Augusta' });

    expect(apply).toHaveBeenCalledWith({ given_name: 'Augusta' }, PROFILE.user);
  });

  it('keeps a save for a user with no profile record until a fetch has one', () => {
    getCurrentUserProfile.mockReturnValueOnce(of({ ...PROFILE, profile: null }));
    service.load();
    service.applySaved({ job_title: 'Analyst' });
    expect(service.profile()?.profile).toBeNull();

    service.load();
    expect(service.profile()?.profile?.job_title).toBe('Analyst');
  });

  it('flags and logs a failed fetch, and keeps the last profile', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.load();
    getCurrentUserProfile.mockReturnValueOnce(throwError(() => new Error('down')));
    service.load();

    expect(service.failed()).toBe(true);
    expect(service.profile()).toEqual(PROFILE);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('drops a fetch still in flight when it loads again', () => {
    const slow = new Subject<CombinedProfile>();
    getCurrentUserProfile.mockReturnValueOnce(slow);
    service.load();
    service.load();
    slow.next({ ...PROFILE, user: { ...PROFILE.user, first_name: 'Stale' } });

    expect(service.profile()?.user.first_name).toBe('Ada');
  });
});
