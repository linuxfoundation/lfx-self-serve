// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { PENDING_PROFILE_SAVE_KEY } from '@lfx-one/shared/constants';
import { CombinedProfile, User } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileLayoutComponent } from './profile-layout.component';

/**
 * Guards the Flow C (management-token re-auth) cold-return read-your-writes fix (LFXV2-3267):
 * on a full-page return the replayed save can resolve before the initial profile GET populates
 * combinedProfile, so the save is stashed and re-applied once a GET lands — an eventually-consistent
 * (pre-save) GET body must never mask the write. Template is overridden empty so the class logic runs
 * without instantiating the edit/visibility/panel children and their service graph.
 */
describe('ProfileLayoutComponent — Flow C cold-return read-your-writes (LFXV2-3267)', () => {
  const STALE_PROFILE = {
    user: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'ada@x.io' },
    profile: { bio: 'OLD BIO', job_title: 'Engineer' },
  } as unknown as CombinedProfile;

  async function setup(queryParams: Record<string, string>, pendingSave?: unknown): Promise<ComponentFixture<ProfileLayoutComponent>> {
    if (pendingSave !== undefined) {
      sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify(pendingSave));
    }

    const getCurrentUserProfile = vi.fn(() => of(STALE_PROFILE));
    const userServiceMock = {
      user: signal({ user_id: 'u1' } as unknown as User),
      impersonating: signal(false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: EMPTY,
      getCurrentUserProfile,
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of([])),
    };

    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    // Empty template: exercise the class without rendering the drawer/panel children.
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('re-applies a stashed save after the initial GET lands, so the pre-save body cannot win', async () => {
    const fixture = await setup({ success: 'profile_token_obtained' }, { savedAt: Date.now(), userMetadata: { bio: 'NEW BIO' } });

    // The replayed save (bio: NEW BIO) resolved before the eventually-consistent GET (bio: OLD BIO);
    // the optimistic override must reflect the write, not the stale refetch.
    expect(fixture.componentInstance.aboutMe()).toBe('NEW BIO');
  });

  it('does not fabricate an override on a normal cold load with no pending save', async () => {
    const fixture = await setup({});

    // No stash → reapply is a no-op and the fetched GET body drives the view.
    expect(fixture.componentInstance.aboutMe()).toBe('OLD BIO');
  });
});
