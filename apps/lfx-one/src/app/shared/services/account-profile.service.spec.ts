// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { CombinedProfile } from '@lfx-one/shared/interfaces';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { AVATAR_UPLOAD_COPY } from '@lfx-one/shared/constants';
import { UiToastService } from '@shared/uikit/toast/toast.service';
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

  it('keeps a save for a user with no profile record, and fetches the record the save created', () => {
    getCurrentUserProfile.mockReturnValueOnce(of({ ...PROFILE, profile: null })).mockReturnValueOnce(of({ ...PROFILE, profile: null }));
    service.load();
    service.applySaved({ job_title: 'Analyst' });

    expect(getCurrentUserProfile).toHaveBeenCalledTimes(2);
    expect(service.profile()?.profile).toBeNull();
    expect(service.savedFields()).toEqual({ job_title: 'Analyst' });

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

describe('AccountProfileService.uploadAvatar', () => {
  const PNG = new File(['x'], 'ada.png', { type: 'image/png' });

  function setup(upload: () => unknown, impersonating = false) {
    const show = vi.fn();
    const uploadProfilePicture = vi.fn(upload);
    TestBed.configureTestingModule({
      providers: [
        AccountProfileService,
        { provide: UserService, useValue: { getCurrentUserProfile: () => of(PROFILE), impersonating: signal(impersonating), uploadProfilePicture } },
        { provide: ProfileSaveSyncService, useValue: { apply: vi.fn() } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
    return { service: TestBed.inject(AccountProfileService), show, uploadProfilePicture };
  }

  const forbidden = (body: Record<string, string>) => () => throwError(() => new HttpErrorResponse({ status: 403, error: body }));

  it('shows the new photo at once', () => {
    const { service, show } = setup(() => of({ public_url: 'https://cdn.example/ada.png' }));

    service.uploadAvatar(PNG, vi.fn());

    expect(service.savedFields()).toEqual({ picture: 'https://cdn.example/ada.png' });
    expect(service.avatarUploading()).toBe(false);
    expect(show).toHaveBeenCalledWith({ variant: 'dark', message: AVATAR_UPLOAD_COPY.updated });
  });

  it('hands a change that needs authorization to the page, with the URL to leave for', () => {
    const { service, show } = setup(forbidden({ error: 'management_token_required', authorize_url: '/api/profile/auth/start?returnTo=%2Fprofile' }));
    const authorize = vi.fn();

    service.uploadAvatar(PNG, authorize);

    expect(authorize).toHaveBeenCalledWith('/api/profile/auth/start?returnTo=%2Fprofile');
    expect(show).not.toHaveBeenCalled();
  });

  it('reports a failure when authorization is asked for without a URL', () => {
    const { service, show } = setup(forbidden({ error: 'management_token_required' }));
    const authorize = vi.fn();

    service.uploadAvatar(PNG, authorize);

    expect(authorize).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith({ variant: 'error', message: AVATAR_UPLOAD_COPY.failed });
  });

  it('uploads nothing while impersonating', () => {
    const { service, uploadProfilePicture } = setup(() => of({ public_url: 'https://cdn.example/ada.png' }), true);

    service.uploadAvatar(PNG, vi.fn());

    expect(uploadProfilePicture).not.toHaveBeenCalled();
  });
});
