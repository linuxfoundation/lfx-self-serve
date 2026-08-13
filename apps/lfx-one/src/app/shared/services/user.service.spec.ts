// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { User } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './user.service';

/**
 * Covers the `effectiveAvatarUrl` priority chain (LFXV2-2628): an uploaded avatar must win over
 * the Auth0 `picture` claim even while the claim is stale, since that's exactly the race a
 * successful upload racing a slower post-hydration profile fetch depends on. Also covers the two
 * lines that actually enforce that race guard — the post-hydration clobber guard and the
 * on-user-change reset — not just the pure computed that reads their result.
 */
describe('UserService', () => {
  let service: UserService;
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Benign default so tests that don't care about the post-hydration fetch (most of them) don't
    // crash when afterNextRender's callback happens to fire during an ApplicationRef flush.
    httpGet = vi.fn().mockReturnValue(of({ profile: {} }));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
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

  it('does not let a slower post-hydration profile fetch clobber an upload that already resolved', () => {
    httpGet.mockReturnValue(of({ profile: { picture: 'https://stale-fetch.png' } }));
    service.user.set({ username: 'alice', picture: 'https://cdn.auth0.com/stale.png' } as User);
    // Simulate the upload finishing before the post-hydration fetch's afterNextRender callback runs.
    service.uploadedAvatarUrl.set('https://cdn.example.com/fresh-upload.png');

    TestBed.inject(ApplicationRef).tick();

    expect(httpGet).toHaveBeenCalledWith('/api/profile');
    expect(service.uploadedAvatarUrl()).toBe('https://cdn.example.com/fresh-upload.png');
  });

  it('resets the uploaded avatar when the user changes, so an impersonation swap cannot inherit it', async () => {
    service.user.set({ username: 'alice', picture: 'https://cdn.auth0.com/alice.png' } as User);
    // Flush before setting the upload — otherwise this synchronous test would batch both user.set
    // calls into a single downstream emission and the reset subscription would never see "alice"
    // as a distinct value to transition away from.
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/alice-upload.png');

    service.user.set({ username: 'bob', picture: 'https://cdn.auth0.com/bob.png' } as User);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.uploadedAvatarUrl()).toBeNull();
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.auth0.com/bob.png');
  });
});
