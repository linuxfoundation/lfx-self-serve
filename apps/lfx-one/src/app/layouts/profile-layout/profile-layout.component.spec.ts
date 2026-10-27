// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import {
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_SUMMARY,
  EMAIL_CALLBACK_RETRY_MESSAGE,
  IDENTITY_ALREADY_CONNECTED_STATUS,
  OPEN_PROFILE_BANNER_LINK_CLICKED,
  PENDING_PROFILE_SAVE_KEY,
} from '@lfx-one/shared/constants';
import { CombinedProfile, EnrichedIdentity, User } from '@lfx-one/shared/interfaces';
import { DataDogRumService } from '@services/datadog-rum.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
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
 * Guards the controller-to-panel wiring for member-since (#2837): mapToHeaderData's
 * `createdAt: profile.user.created_at || ''` mapping feeds the `memberSince` computed. The
 * formatter itself is covered in date-time.utils.spec.ts; this only asserts the plumbing between
 * a fetched profile and the exposed signal isn't silently dropped by a future refactor.
 */
describe('ProfileLayoutComponent — member-since wiring (#2837)', () => {
  async function setup(user: Partial<CombinedProfile['user']>): Promise<ComponentFixture<ProfileLayoutComponent>> {
    const profile = {
      user: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'ada@x.io', ...user },
      profile: null,
    } as unknown as CombinedProfile;

    const userServiceMock = {
      user: signal({ user_id: 'u1' } as unknown as User),
      impersonating: signal(false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: EMPTY,
      getCurrentUserProfile: vi.fn(() => of(profile)),
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of([])),
    };

    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
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

  it('reflects a fetched created_at as a formatted memberSince', async () => {
    const fixture = await setup({ created_at: '2023-03-15T10:00:00Z' } as unknown as Partial<CombinedProfile['user']>);

    expect(fixture.componentInstance.memberSince()).toBe('Mar 2023');
  });

  it('leaves memberSince empty when created_at is absent', async () => {
    const fixture = await setup({});

    expect(fixture.componentInstance.memberSince()).toBe('');
  });
});

/**
 * Guards issue #1935's PROFILE_AUTH_ERROR_MESSAGES lookup: a Flow C error code toasts its own
 * specific message (not the old generic "Authorization failed. Please try again." for every code).
 */
describe('ProfileLayoutComponent — Flow C error message ownership (#1935)', () => {
  async function setup(error: string, pendingSave?: unknown): Promise<{ add: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> }> {
    if (pendingSave !== undefined) {
      sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify(pendingSave));
    }

    const add = vi.fn();
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
        { provide: ActivatedRoute, useValue: { queryParams: of({ error }) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    return { add, navigateByUrl };
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

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

  // Regression guard: invalid_state/no_code used to be excluded from PROFILE_AUTH_ERROR_MESSAGES
  // so only ProfileIdentitiesComponent toasted them — producing no toast, a stuck ?error= param,
  // and a leftover stash on every other /profile/* route. The layout now owns them too.
  it.each([
    ['invalid_state', 'Security validation failed. Please try again.'],
    ['no_code', 'Authorization did not complete. Please try again.'],
  ])('toasts, clears the URL, and clears the stash for %s', async (error, detail) => {
    const { add, navigateByUrl } = await setup(error, { savedAt: Date.now(), userMetadata: { bio: 'x' } });

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Authorization Error', detail }));
    expect(navigateByUrl).toHaveBeenCalledWith('/profile', { replaceUrl: true });
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
  });

  it('toasts impersonation_read_only, the code the auth callbacks emit when blocked (#1936)', async () => {
    sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ stale: true }));

    const { add } = await setup('impersonation_read_only');

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Authorization Error',
        detail: 'This action is not available while impersonating a user.',
      })
    );
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
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

// The banner button is inert in-app (the support-side launcher owns the click), so a dropped
// addAction delegation would break the click count silently. Class-level, like the suites above.
describe('ProfileLayoutComponent — profile help link click tracking (#2986)', () => {
  const addAction = vi.fn();

  beforeEach(() => {
    addAction.mockClear();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            impersonating: signal(false),
            uploadedAvatarUrl: signal<string | null>(null),
            effectiveAvatarUrl: computed(() => ''),
            identitiesRefresh$: EMPTY,
            getCurrentUserProfile: vi.fn(() => EMPTY),
            getIdentities: vi.fn(() => of([])),
          },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DataDogRumService, useValue: { addAction } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });
  });

  it('emits the profile-help click action', async () => {
    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.trackOpenProfileBannerClick();

    expect(addAction).toHaveBeenCalledWith(OPEN_PROFILE_BANNER_LINK_CLICKED);
  });
});

// Guards the Intercom custom-launcher re-scan on mount (#2986): the help link is router-mounted,
// so on client-side navigation into /profile/* it enters the DOM after Intercom's boot scan —
// without an update the launcher binds only on full-page loads. The service itself is mocked;
// its boot/window gating is covered in intercom.service.spec.ts.
describe('ProfileLayoutComponent — Intercom launcher re-scan on mount (#2986)', () => {
  const update = vi.fn();

  beforeEach(() => {
    update.mockClear();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            impersonating: signal(false),
            uploadedAvatarUrl: signal<string | null>(null),
            effectiveAvatarUrl: computed(() => ''),
            identitiesRefresh$: EMPTY,
            getCurrentUserProfile: vi.fn(() => EMPTY),
            getIdentities: vi.fn(() => of([])),
          },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: IntercomService, useValue: { update } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });
  });

  it('notifies Intercom to re-scan for the launcher after the view renders', async () => {
    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('ProfileLayoutComponent — primary email and identity notifications (#4123)', () => {
  function makeIdentity(overrides: Partial<EnrichedIdentity> & Pick<EnrichedIdentity, 'id' | 'value'>): EnrichedIdentity {
    return {
      platform: 'email',
      type: 'email',
      verified: false,
      source: 'cdp',
      icon: 'fa-light fa-envelope',
      createdAt: '',
      updatedAt: '',
      displayState: 'unverified',
      inAuth0: false,
      ...overrides,
    };
  }

  async function setup(identities: EnrichedIdentity[], refresh$ = new Subject<void>()): Promise<ComponentFixture<ProfileLayoutComponent>> {
    const userServiceMock = {
      user: signal({ user_id: 'u1' } as unknown as User),
      impersonating: signal(false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: refresh$,
      getCurrentUserProfile: vi.fn(() =>
        of({ user: { username: 'dev-user', email: 'old-primary@example.org', first_name: 'Old' }, profile: { given_name: 'Old' } } as CombinedProfile)
      ),
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of(identities)),
      applyDisplayName: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
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

  it('shows the identities primary instead of a stale profile email', async () => {
    const fixture = await setup([makeIdentity({ id: 'primary-email', value: 'new-primary@example.org', isPrimary: true })]);

    expect(fixture.componentInstance.emailInfo()).toBe('new-primary@example.org');
  });

  it('falls back to the profile email when identities have no primary row', async () => {
    const fixture = await setup([makeIdentity({ id: 'other-email', value: 'other@example.org' })]);

    expect(fixture.componentInstance.emailInfo()).toBe('old-primary@example.org');
  });

  it('refreshes the sidebar primary without losing optimistic profile edits', async () => {
    const refresh$ = new Subject<void>();
    const fixture = await setup([makeIdentity({ id: 'old-primary', value: 'old-primary@example.org', isPrimary: true })], refresh$);
    fixture.componentInstance.onProfileSaved({ given_name: 'Saved' });
    expect(fixture.componentInstance.emailInfo()).toBe('old-primary@example.org');
    const getIdentities = vi.mocked(TestBed.inject(UserService).getIdentities);
    getIdentities.mockReturnValue(of([makeIdentity({ id: 'new-primary', value: 'new-primary@example.org', isPrimary: true })]));

    refresh$.next();
    await fixture.whenStable();

    expect(getIdentities).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.emailInfo()).toBe('new-primary@example.org');
    expect(fixture.componentInstance.profileData()?.firstName).toBe('Saved');
  });

  it('keeps the dot off for a lone unverified primary email', async () => {
    const fixture = await setup([makeIdentity({ id: 'primary-email', value: 'dev@example.com', isPrimary: true })]);

    expect(fixture.componentInstance.tabNotifications().get('identities')).toBe(false);
  });

  it('still lights the dot for another unverified identity', async () => {
    const fixture = await setup([
      makeIdentity({ id: 'primary-email', value: 'dev@example.com', isPrimary: true }),
      makeIdentity({ id: 'cdp-other', value: 'other@example.org' }),
    ]);

    expect(fixture.componentInstance.tabNotifications().get('identities')).toBe(true);
  });
});

/**
 * Guards #4253: the Flow C callback reports a replayed pending email verification as
 * `email_status=already_connected|retry_required` next to `success=profile_token_obtained`. The
 * layout owns that notice so it shows once on whichever /profile/* tab the return lands.
 */
describe('ProfileLayoutComponent — pending email outcome on Flow C return (#4253)', () => {
  async function setup(
    url: string,
    queryParams: Record<string, string>,
    platform = 'browser'
  ): Promise<{ add: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn>; refreshUserIdentities: ReturnType<typeof vi.fn> }> {
    const add = vi.fn();
    const navigateByUrl = vi.fn();
    const refreshUserIdentities = vi.fn();
    const userServiceMock = {
      user: signal({ user_id: 'u1' } as unknown as User),
      impersonating: signal(false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: EMPTY,
      getCurrentUserProfile: vi.fn(() => of({ user: {}, profile: null } as unknown as CombinedProfile)),
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of([])),
      refreshUserIdentities,
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
        { provide: Router, useValue: { url, navigateByUrl } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    return { add, navigateByUrl, refreshUserIdentities };
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows one already-connected notice, refreshes identities, and keeps the email-settings fragment', async () => {
    const { add, navigateByUrl, refreshUserIdentities } = await setup(
      '/profile/settings?success=profile_token_obtained&email_status=already_connected#email-settings',
      { success: 'profile_token_obtained', email_status: 'already_connected' }
    );

    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'success', summary: EMAIL_ALREADY_CONNECTED_SUMMARY, detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
    expect(refreshUserIdentities).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith('/profile/settings#email-settings', { replaceUrl: true });
  });

  it('shows fixed retry guidance without claiming success or touching identity state', async () => {
    const { add, navigateByUrl, refreshUserIdentities } = await setup('/profile/settings?success=profile_token_obtained&email_status=retry_required', {
      success: 'profile_token_obtained',
      email_status: 'retry_required',
    });

    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'warn', summary: 'Email not verified', detail: EMAIL_CALLBACK_RETRY_MESSAGE });
    expect(refreshUserIdentities).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith('/profile/settings', { replaceUrl: true });
  });

  it('infers no email outcome from an ordinary authorization return', async () => {
    const { add, navigateByUrl, refreshUserIdentities } = await setup('/profile/settings?success=profile_token_obtained', {
      success: 'profile_token_obtained',
    });

    expect(add).not.toHaveBeenCalled();
    expect(refreshUserIdentities).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith('/profile/settings', { replaceUrl: true });
  });

  it.each(['linked', 'toString', ''])('ignores an unknown email_status value %j but still clears the query', async (status) => {
    const { add, navigateByUrl, refreshUserIdentities } = await setup('/profile/identities?success=profile_token_obtained', {
      success: 'profile_token_obtained',
      email_status: status,
    });

    expect(add).not.toHaveBeenCalled();
    expect(refreshUserIdentities).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith('/profile/identities', { replaceUrl: true });
  });

  it('ignores an email_status that arrives without the authorization-success flag', async () => {
    const { add, navigateByUrl, refreshUserIdentities } = await setup('/profile/settings?email_status=already_connected', {
      email_status: 'already_connected',
    });

    expect(add).not.toHaveBeenCalled();
    expect(refreshUserIdentities).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('still replays a pending profile save alongside the email notice', async () => {
    sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), avatarPending: true }));

    const { add } = await setup('/profile/settings?success=profile_token_obtained&email_status=already_connected', {
      success: 'profile_token_obtained',
      email_status: 'already_connected',
    });

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Authorization complete' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: EMAIL_ALREADY_CONNECTED_SUMMARY }));
    expect(add).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
  });

  it.each(['already_connected', 'retry_required'])('preserves callback markers and pending saves during SSR for %s', async (status) => {
    const pendingSave = JSON.stringify({ savedAt: Date.now(), avatarPending: true });
    sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, pendingSave);

    const { add, navigateByUrl, refreshUserIdentities } = await setup(
      `/profile/settings?success=profile_token_obtained&email_status=${status}#email-settings`,
      {
        success: 'profile_token_obtained',
        email_status: status,
      },
      'server'
    );

    expect(add).not.toHaveBeenCalled();
    expect(refreshUserIdentities).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBe(pendingSave);
  });

  // #4327: the social already-connected marker belongs to the Identities tab (or the mentorship
  // card), never to this layout — a second toast or refresh here would duplicate the child's notice.
  it.each(['browser', 'server'])('leaves the social already-connected marker to the child consumer (%s)', async (platform) => {
    const pendingSave = JSON.stringify({ savedAt: Date.now(), avatarPending: true });
    sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, pendingSave);

    const { add, navigateByUrl, refreshUserIdentities } = await setup(
      `/profile/identities?success=${IDENTITY_ALREADY_CONNECTED_STATUS}`,
      { success: IDENTITY_ALREADY_CONNECTED_STATUS },
      platform
    );

    expect(add).not.toHaveBeenCalled();
    expect(refreshUserIdentities).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBe(pendingSave);
  });
});

/**
 * Guards the nav-name sync: a saved first/last name is pushed into the shared UserService.user (which the
 * navbar reads) without re-triggering the eventually-consistent profile GET over the optimistic merge.
 */
describe('ProfileLayoutComponent — nav name sync after a profile save', () => {
  const PROFILE = {
    user: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'ada@example.com' },
    profile: { bio: 'OLD BIO', job_title: 'Engineer' },
  } as unknown as CombinedProfile;

  async function setup(impersonating = false): Promise<{
    fixture: ComponentFixture<ProfileLayoutComponent>;
    user: WritableSignal<User | null>;
    getCurrentUserProfile: ReturnType<typeof vi.fn>;
    applyDisplayName: ReturnType<typeof vi.fn>;
  }> {
    const user = signal<User | null>({ sub: 'auth0|u1', name: 'Ada Lovelace' } as unknown as User);
    const getCurrentUserProfile = vi.fn(() => of(PROFILE));
    const userServiceMock = {
      user,
      impersonating: signal(impersonating),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: computed(() => ''),
      identitiesRefresh$: EMPTY,
      getCurrentUserProfile,
      updateUserProfile: vi.fn(() => of({})),
      getIdentities: vi.fn(() => of([])),
      // Mirrors UserService.applyDisplayName: the user object is only replaced when the name changes.
      applyDisplayName: vi.fn((first: string, last: string) =>
        user.update((current) => {
          const name = `${first} ${last}`.trim();
          return current && current.name !== name ? { ...current, name } : current;
        })
      ),
    };

    TestBed.configureTestingModule({
      imports: [ProfileLayoutComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: { url: '/profile', navigateByUrl: vi.fn() } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(ProfileLayoutComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, user, getCurrentUserProfile, applyDisplayName: userServiceMock.applyDisplayName };
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('updates the shared user name after a name save', async () => {
    const { fixture, user } = await setup();

    fixture.componentInstance.onProfileSaved({ given_name: 'Ada', family_name: 'Byron' });

    expect(user()?.name).toBe('Ada Byron');
  });

  it('marks the name as saved so the post-hydration fetch cannot overwrite it', async () => {
    const { fixture, applyDisplayName } = await setup();

    fixture.componentInstance.onProfileSaved({ given_name: 'Ada', family_name: 'Byron' });

    expect(applyDisplayName).toHaveBeenCalledWith('Ada', 'Byron', true);
  });

  it('does not refetch the profile or lose the saved values after the name sync', async () => {
    const { fixture, getCurrentUserProfile } = await setup();
    expect(getCurrentUserProfile).toHaveBeenCalledTimes(1);

    fixture.componentInstance.onProfileSaved({ given_name: 'Ada', family_name: 'Byron', bio: 'NEW BIO' });
    await fixture.whenStable();

    expect(getCurrentUserProfile).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.aboutMe()).toBe('NEW BIO');
  });

  it('leaves the shared user untouched for a save with no name fields', async () => {
    const { fixture, user } = await setup();
    const before = user();

    fixture.componentInstance.onProfileSaved({ bio: 'NEW BIO' });

    expect(user()).toBe(before);
  });

  it('leaves the shared user untouched when the name did not change, but still latches the save', async () => {
    const { fixture, user, applyDisplayName } = await setup();
    const before = user();

    fixture.componentInstance.onProfileSaved({ given_name: 'Ada', family_name: 'Lovelace' });

    expect(user()).toBe(before);
    expect(applyDisplayName).toHaveBeenCalledWith('Ada', 'Lovelace', true);
  });

  it('leaves the shared user untouched while impersonating', async () => {
    const { fixture, user, applyDisplayName } = await setup(true);

    fixture.componentInstance.onProfileSaved({ given_name: 'Ada', family_name: 'Byron' });

    expect(user()?.name).toBe('Ada Lovelace');
    expect(applyDisplayName).not.toHaveBeenCalled();
  });
});
