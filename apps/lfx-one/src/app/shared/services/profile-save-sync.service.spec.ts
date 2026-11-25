// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CombinedProfile } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipService } from './mentorship.service';
import { ProfileSaveSyncService } from './profile-save-sync.service';
import { UserService } from './user.service';

const SAVED_USER = { first_name: 'Ada', last_name: 'Lovelace' } as CombinedProfile['user'];

describe('ProfileSaveSyncService', () => {
  let user: {
    user: ReturnType<typeof signal>;
    impersonating: ReturnType<typeof signal<boolean>>;
    uploadedAvatarUrl: ReturnType<typeof signal>;
    applyDisplayName: ReturnType<typeof vi.fn>;
  };
  let queueLfxProfileSync: ReturnType<typeof vi.fn>;
  let service: ProfileSaveSyncService;

  beforeEach(() => {
    user = { user: signal({ sub: 'auth0|ada' }), impersonating: signal(false), uploadedAvatarUrl: signal<string | null>(null), applyDisplayName: vi.fn() };
    queueLfxProfileSync = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: user },
        { provide: MentorshipService, useValue: { queueLfxProfileSync } },
      ],
    });
    service = TestBed.inject(ProfileSaveSyncService);
  });

  it('pushes a new name to the navbar and Mentorship, and a new picture to the shared avatar', () => {
    service.apply({ given_name: 'Augusta', family_name: 'Lovelace', picture: 'https://cdn.example/a.png' }, SAVED_USER);

    expect(user.applyDisplayName).toHaveBeenCalledWith('Augusta', 'Lovelace', true);
    expect(queueLfxProfileSync).toHaveBeenCalledTimes(1);
    expect(user.uploadedAvatarUrl()).toBe('https://cdn.example/a.png');
  });

  it('sends Mentorship nothing when the name is unchanged and no picture was uploaded', () => {
    service.apply({ given_name: 'Ada', family_name: 'Lovelace', city: 'London' }, SAVED_USER);

    expect(queueLfxProfileSync).not.toHaveBeenCalled();
  });

  it('leaves the shared name and Mentorship alone while impersonating', () => {
    user.impersonating.set(true);
    service.apply({ given_name: 'Augusta' }, SAVED_USER);

    expect(user.applyDisplayName).not.toHaveBeenCalled();
    expect(queueLfxProfileSync).not.toHaveBeenCalled();
  });

  it('keeps the shared name when the save has no name in it', () => {
    service.apply({ city: 'Paris' }, SAVED_USER);

    expect(user.applyDisplayName).not.toHaveBeenCalled();
  });
});
