// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { User } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './user.service';

/**
 * Covers the `effectiveAvatarUrl` priority chain (LFXV2-2628): an uploaded avatar must win over
 * the Auth0 `picture` claim even while the claim is stale, since that's exactly the race a
 * successful upload racing a slower post-hydration profile fetch depends on.
 */
describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    service = TestBed.inject(UserService);
  });

  it('falls back to the Auth0 picture claim when no avatar has been uploaded', () => {
    service.user.set({ picture: 'https://cdn.auth0.com/stale.png' } as User);
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.auth0.com/stale.png');
  });

  it('prefers the uploaded avatar over the picture claim even when the claim is unchanged', () => {
    service.user.set({ picture: 'https://cdn.auth0.com/stale.png' } as User);
    service.uploadedAvatarUrl.set('https://cdn.example.com/fresh-upload.png');
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/fresh-upload.png');
  });

  it('returns an empty string when neither source is set', () => {
    expect(service.effectiveAvatarUrl()).toBe('');
  });
});
