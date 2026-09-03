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
import { EMPTY, Observable, of, Subject } from 'rxjs';
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

  // A user-only GET body (no profile record) — merging into it would fabricate a profile.
  const USER_ONLY_PROFILE = {
    user: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'ada@x.io' },
    profile: null,
  } as unknown as CombinedProfile;

  // A later, consistent GET carrying a server-side change the stash never touched.
  const NEWER_PROFILE = {
    user: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'ada@x.io' },
    profile: { bio: 'SERVER BIO', job_title: 'Manager' },
  } as unknown as CombinedProfile;

  async function setup(
    queryParams: Record<string, string>,
    pendingSave?: unknown,
    getProfile?: () => Observable<CombinedProfile>
  ): Promise<ComponentFixture<ProfileLayoutComponent>> {
    if (pendingSave !== undefined) {
      sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify(pendingSave));
    }

    const getCurrentUserProfile = vi.fn(getProfile ?? (() => of(STALE_PROFILE)));
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
    // Deferred GET: the save is stashed during construction and cannot merge until we emit here, so
    // the stash branch is provably the path under test — not a warm merge that happened to race first.
    const profile$ = new Subject<CombinedProfile>();
    const fixture = await setup({ success: 'profile_token_obtained' }, { savedAt: Date.now(), userMetadata: { bio: 'NEW BIO' } }, () =>
      profile$.asObservable()
    );

    // GET has not resolved: the save was stashed (not applied), so nothing shows yet.
    expect(fixture.componentInstance.aboutMe()).toBe('');

    // Stale (pre-save) body lands; reapply must win over it.
    profile$.next(STALE_PROFILE);
    expect(fixture.componentInstance.aboutMe()).toBe('NEW BIO');
    // A field the save didn't touch survives the merge.
    expect(fixture.componentInstance.jobTitle()).toBe('Engineer');
  });

  it('retains the stash across a null-profile GET, applies once, then clears it', async () => {
    const profile$ = new Subject<CombinedProfile>();
    const fixture = await setup({ success: 'profile_token_obtained' }, { savedAt: Date.now(), userMetadata: { bio: 'NEW BIO' } }, () =>
      profile$.asObservable()
    );

    // Null-profile GET: reapply is a no-op (merging would fabricate a profile), stash is retained.
    profile$.next(USER_ONLY_PROFILE);
    expect(fixture.componentInstance.aboutMe()).toBe('');

    // Real profile lands: the retained stash applies and is cleared.
    profile$.next(STALE_PROFILE);
    expect(fixture.componentInstance.aboutMe()).toBe('NEW BIO');
    expect(fixture.componentInstance.jobTitle()).toBe('Engineer');

    // A later GET must not re-apply the cleared stash: the optimistic override persists (Engineer),
    // it does not merge onto the newer body (which would surface Manager).
    profile$.next(NEWER_PROFILE);
    expect(fixture.componentInstance.jobTitle()).toBe('Engineer');
    expect(fixture.componentInstance.aboutMe()).toBe('NEW BIO');
  });

  it('does not fabricate an override on a normal cold load with no pending save', async () => {
    const fixture = await setup({});

    // No stash → reapply is a no-op and the fetched GET body drives the view.
    expect(fixture.componentInstance.aboutMe()).toBe('OLD BIO');
  });
});

/**
 * Guards issue #1935's PROFILE_AUTH_ERROR_MESSAGES lookup: a Flow C error code toasts its own
 * specific message (not the old generic "Authorization failed. Please try again." for every code).
 */
describe('ProfileLayoutComponent — Flow C error message ownership (#1935)', () => {
  async function setup(error: string): Promise<{ add: ReturnType<typeof vi.fn> }> {
    const add = vi.fn();
    const userServiceMock = {
      user: signal({ user_id: 'u1' } as unknown as User),
      impersonating: signal(false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: EMPTY,
      getCurrentUserProfile: vi.fn(() => of({ user: {}, profile: null } as unknown as CombinedProfile)),
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of([])),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({ error }) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    return { add };
  }

  it('toasts the specific message for a mapped Flow C error code', async () => {
    const { add } = await setup('user_mismatch');

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Authorization Error',
        detail: 'You authorized a different account. Please sign in as yourself and try again.',
      })
    );
  });

  it('does not toast an inherited Object.prototype key as an error message', async () => {
    // Regression guard: params['error'] is unvalidated input — a plain-object lookup without
    // an own-property check would resolve 'toString' to Object.prototype.toString (truthy).
    const { add } = await setup('toString');

    expect(add).not.toHaveBeenCalled();
  });
});

/**
 * Guards issue #2177's clearAuthQueryParams fragment loss (PR #2182 review): a Flow C return to
 * /profile/settings?success=...#password must keep the #password fragment after the query string
 * is stripped, so account-settings.component.ts's deep-link scroll still fires.
 */
describe('ProfileLayoutComponent — clearAuthQueryParams preserves the fragment (#2177)', () => {
  async function setup(url: string, queryParams: Record<string, string>): Promise<{ navigateByUrl: ReturnType<typeof vi.fn> }> {
    const navigateByUrl = vi.fn();
    const userServiceMock = {
      user: signal({ user_id: 'u1' } as unknown as User),
      impersonating: signal(false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: EMPTY,
      getCurrentUserProfile: vi.fn(() => of({ user: {}, profile: null } as unknown as CombinedProfile)),
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of([])),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
        { provide: Router, useValue: { url, navigateByUrl } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    return { navigateByUrl };
  }

  it('keeps the fragment on a Flow C success return', async () => {
    const { navigateByUrl } = await setup('/profile/settings?success=profile_token_obtained#password', { success: 'profile_token_obtained' });

    expect(navigateByUrl).toHaveBeenCalledWith('/profile/settings#password', { replaceUrl: true });
  });

  it('keeps the fragment on a Flow C error return', async () => {
    const { navigateByUrl } = await setup('/profile/settings?error=user_mismatch#email-settings', { error: 'user_mismatch' });

    expect(navigateByUrl).toHaveBeenCalledWith('/profile/settings#email-settings', { replaceUrl: true });
  });

  it('drops nothing extra when there is no fragment to preserve', async () => {
    const { navigateByUrl } = await setup('/profile/settings?error=user_mismatch', { error: 'user_mismatch' });

    expect(navigateByUrl).toHaveBeenCalledWith('/profile/settings', { replaceUrl: true });
  });
});
