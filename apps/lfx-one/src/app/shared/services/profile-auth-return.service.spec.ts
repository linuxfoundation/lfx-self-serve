// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { PENDING_PROFILE_SAVE_KEY, PROFILE_AUTH_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileAuthReturnService } from './profile-auth-return.service';

describe('ProfileAuthReturnService', () => {
  let add: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let updateUserProfile: ReturnType<typeof vi.fn>;
  let onProfileSaved: ReturnType<typeof vi.fn<(metadata: unknown) => void>>;

  function listen(queryParams: Record<string, string>, platform = 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        ProfileAuthReturnService,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
        { provide: Router, useValue: { url: '/account/identities?success=profile_token_obtained#top', navigateByUrl } },
        { provide: UserService, useValue: { updateUserProfile, user: signal(null), impersonating: signal(false), refreshUserIdentities: vi.fn() } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    TestBed.inject(ProfileAuthReturnService).listen(onProfileSaved);
  }

  const stash = (savedAt: number, userMetadata: Record<string, string> = { job_title: 'Maintainer' }): void =>
    sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt, userMetadata }));

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    add = vi.fn();
    navigateByUrl = vi.fn();
    updateUserProfile = vi.fn(() => of({}));
    onProfileSaved = vi.fn<(metadata: unknown) => void>();
  });

  it('replays a stashed save on a successful return, hands it to the shell and strips the callback query', () => {
    stash(Date.now());

    listen({ success: 'profile_token_obtained' });

    expect(updateUserProfile).toHaveBeenCalledWith({ user_metadata: { job_title: 'Maintainer' } });
    expect(onProfileSaved).toHaveBeenCalledWith({ job_title: 'Maintainer' });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
    expect(navigateByUrl).toHaveBeenCalledWith('/account/identities#top', { replaceUrl: true });
  });

  it('discards a stash older than ten minutes without saving it', () => {
    stash(Date.now() - 11 * 60 * 1000);

    listen({ success: 'profile_token_obtained' });

    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
  });

  it('reports a failed replay without telling the shell it saved', () => {
    stash(Date.now());
    updateUserProfile.mockReturnValue(throwError(() => new Error('upstream')));

    listen({ success: 'profile_token_obtained' });

    expect(onProfileSaved).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Failed to save profile. Please try again.' }));
  });

  it('toasts a known error code and drops any stash, so a later return cannot replay it', () => {
    stash(Date.now());

    listen({ error: 'profile_auth_failed' });

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: PROFILE_AUTH_ERROR_MESSAGES['profile_auth_failed'] }));
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('ignores an inherited key passed as the error code', () => {
    listen({ error: 'toString' });

    expect(add).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('leaves the callback query alone during the server render', () => {
    stash(Date.now());

    listen({ success: 'profile_token_obtained' }, 'server');

    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
