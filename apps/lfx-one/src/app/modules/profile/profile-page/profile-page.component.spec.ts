// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ACCOUNT_PERSONAL_INFORMATION_PATH, AVATAR_UPLOAD_COPY, PENDING_PROFILE_SAVE_KEY, PROFILE_PAGE_COPY } from '@lfx-one/shared/constants';
import { CombinedProfile, EnrichedIdentity } from '@lfx-one/shared/interfaces';
import { AccountProfileService } from '@services/account-profile.service';
import { ProfileAuthReturnService } from '@services/profile-auth-return.service';
import { ProfileSaveSyncService } from '@services/profile-save-sync.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { MessageService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileVisibilityDrawerService } from '../components/profile-visibility-drawer/profile-visibility-drawer.service';
import { ProfilePageComponent } from './profile-page.component';

const PROFILE = {
  user: { first_name: 'Ada', last_name: 'Lovelace', username: 'auth0|ada', email: 'ada@example.com', created_at: '2013-03-14T10:00:00Z' },
  profile: { job_title: 'Engineer', organization: 'Acme Motors', city: 'Lisbon', country: 'Portugal', bio: 'I build compilers.' },
} as unknown as CombinedProfile;

const EMPTY_PROFILE = { user: PROFILE.user, profile: {} } as unknown as CombinedProfile;

const GITHUB = { platform: 'github', value: 'ada', inAuth0: true } as EnrichedIdentity;

/** State-only: no template, so these tests cost no render. Providers are not inherited, so the page's own are repeated. */
@Component({ selector: 'lfx-test-profile-page', template: '', providers: [AccountProfileService, ProfileAuthReturnService, ProfileVisibilityDrawerService] })
class StateProfilePageComponent extends ProfilePageComponent {}

describe('ProfilePageComponent', () => {
  function setup(
    options: {
      profile?: () => Observable<CombinedProfile>;
      identities?: EnrichedIdentity[];
      upload?: () => Observable<unknown>;
      avatar?: string;
      impersonating?: boolean;
      wide?: boolean;
    } = {}
  ) {
    const show = vi.fn();
    const apply = vi.fn();
    const userService = {
      user: signal({ name: 'Ada L' }),
      impersonating: signal(options.impersonating ?? false),
      uploadedAvatarUrl: signal<string | null>(null),
      effectiveAvatarUrl: signal(options.avatar ?? ''),
      identitiesRefresh$: of(),
      getCurrentUserProfile: vi.fn(options.profile ?? (() => of(PROFILE))),
      getIdentities: vi.fn(() => of(options.identities ?? [GITHUB])),
      getWorkHistoryLogo: vi.fn(() => of('https://cdn.example/acme.png')),
      getProfileVisibility: vi.fn(() => of({ isPublic: false, sections: {} })),
      uploadProfilePicture: vi.fn(options.upload ?? (() => of({ public_url: 'https://cdn.example/ada.png' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: UserService, useValue: userService },
        { provide: ProfileSaveSyncService, useValue: { apply } },
        { provide: UiToastService, useValue: { show } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: options.wide ?? true, breakpoints: {} }) } },
      ],
    });
    return { show, apply, userService };
  }

  async function render() {
    const fixture = TestBed.createComponent(ProfilePageComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('shows the name, role, company logo, location, bio and full join date', async () => {
    setup();
    const { query } = await render();

    expect(query('profile-hero-name')?.textContent?.trim()).toBe('Ada Lovelace');
    expect(query('profile-hero-role')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Engineer at Acme Motors');
    expect(query('profile-hero-company-logo')?.getAttribute('src')).toBe('https://cdn.example/acme.png');
    expect(query('profile-hero-location')?.textContent?.trim()).toBe('Lisbon, Portugal');
    expect(query('profile-hero-bio')?.textContent).toBe('I build compilers.');
    expect(query('profile-hero-member-since')?.textContent?.trim()).toBe('Member since: March 14, 2013');
    expect(query('profile-hero-add-title')).toBeNull();
    expect(query('profile-hero-no-bio')).toBeNull();
  });

  it('links a linked GitHub account by its handle', async () => {
    setup();
    const { query } = await render();
    const github = query('profile-hero-github')?.querySelector('a');

    expect(github?.getAttribute('href')).toBe('https://github.com/ada');
    expect(github?.getAttribute('aria-label')).toBe('GitHub: ada');
  });

  it('pins the openprofile rail to the right on a wide screen, below the impersonation banner', async () => {
    setup({ impersonating: true });
    const { query } = await render();
    const rail = query('profile-aside-rail');

    expect(rail?.classList).toContain('fixed');
    expect(rail?.style.top).toBe('36px');
    expect(query('profile-openprofile-link')?.textContent).toContain('ada');
  });

  it('leaves the rail out on a narrow screen, so it reads nothing for it', async () => {
    const { userService } = setup({ wide: false });
    const { query } = await render();

    expect(query('profile-aside-rail')).toBeNull();
    expect(userService.getProfileVisibility).not.toHaveBeenCalled();
  });

  it('leaves GitHub out when no owned account is linked', async () => {
    setup({ identities: [{ ...GITHUB, inAuth0: false }] });
    const { query } = await render();

    expect(query('profile-hero-github')).toBeNull();
  });

  it('asks an owner with no title, company or bio to add them on Personal information', async () => {
    setup({ profile: () => of(EMPTY_PROFILE) });
    const { query } = await render();

    expect(query('profile-hero-add-title')?.querySelector('a')?.getAttribute('href')).toBe(ACCOUNT_PERSONAL_INFORMATION_PATH);
    expect(query('profile-hero-no-bio')?.textContent).toContain(PROFILE_PAGE_COPY.noBio);
    expect(query('profile-hero-add-bio')?.querySelector('a')?.getAttribute('href')).toBe(ACCOUNT_PERSONAL_INFORMATION_PATH);
    expect(query('profile-hero-location')).toBeNull();
  });

  it('falls back to the person icon with no photo, and offers a first photo', async () => {
    setup();
    const { query } = await render();

    expect(query('profile-hero-avatar-fallback')).not.toBeNull();
    expect(query('profile-hero-avatar-upload')?.querySelector('button')?.getAttribute('aria-label')).toBe(PROFILE_PAGE_COPY.uploadPhoto);
  });

  it('shows the photo, and offers a new one', async () => {
    setup({ avatar: 'https://cdn.example/ada.png' });
    const { query } = await render();

    expect(query('profile-hero-avatar-image')?.getAttribute('src')).toBe('https://cdn.example/ada.png');
    expect(query('profile-hero-avatar-upload')?.querySelector('button')?.getAttribute('aria-label')).toBe(PROFILE_PAGE_COPY.uploadNewPhoto);
  });

  it('shows the photo from its own profile load before the shared one catches up', async () => {
    setup({ profile: () => of({ ...PROFILE, profile: { ...PROFILE.profile, picture: 'https://cdn.example/stored.png' } } as CombinedProfile) });
    const { query } = await render();

    expect(query('profile-hero-avatar-image')?.getAttribute('src')).toBe('https://cdn.example/stored.png');
  });

  it('holds the empty prompts back when no stored record came back, which a failed read also gives', async () => {
    setup({ profile: () => of({ user: PROFILE.user, profile: null } as unknown as CombinedProfile) });
    const { query } = await render();

    expect(query('profile-hero-add-title')).toBeNull();
    expect(query('profile-hero-no-bio')).toBeNull();
  });

  it('offers no upload while impersonating', async () => {
    setup({ impersonating: true });
    const { query } = await render();

    expect(query('profile-hero-avatar-controls')).toBeNull();
  });

  it('says when the profile could not load, and tries again', async () => {
    const { userService } = setup({ profile: () => throwError(() => new HttpErrorResponse({ status: 502 })) });
    const { fixture, query } = await render();
    expect(query('profile-load-error')?.textContent).toContain(PROFILE_PAGE_COPY.loadFailed);

    userService.getCurrentUserProfile.mockImplementation(() => of(PROFILE));
    query('profile-load-retry')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(query('profile-load-error')).toBeNull();
    expect(query('profile-hero-bio')?.textContent).toBe('I build compilers.');
  });

  describe('photo upload', () => {
    const pick = (page: ProfilePageComponent, file: File) => page['onAvatarFileSelected']({ target: { files: [file], value: 'x' } } as unknown as Event);

    async function state() {
      const fixture = TestBed.createComponent(StateProfilePageComponent);
      await fixture.whenStable();
      return fixture.componentInstance;
    }

    it('uploads a photo and shows it at once', async () => {
      const { show, apply } = setup();
      const page = await state();

      pick(page, new File(['x'], 'ada.png', { type: 'image/png' }));

      expect(apply).toHaveBeenCalledWith({ picture: 'https://cdn.example/ada.png' }, expect.anything());
      expect(show).toHaveBeenCalledWith({ variant: 'dark', message: AVATAR_UPLOAD_COPY.updated });
    });

    it('turns down a file of the wrong type or over 2MB', async () => {
      const { show, userService } = setup();
      const page = await state();

      pick(page, new File(['x'], 'ada.gif', { type: 'image/gif' }));
      pick(page, new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'ada.png', { type: 'image/png' }));

      expect(userService.uploadProfilePicture).not.toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith({ variant: 'error', message: AVATAR_UPLOAD_COPY.wrongType });
      expect(show).toHaveBeenCalledWith({ variant: 'error', message: AVATAR_UPLOAD_COPY.tooLarge });
    });

    it('leaves for authorization and asks for the photo again on return', async () => {
      setup({
        upload: () => throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'management_token_required', authorize_url: '#authorize' } })),
      });
      const page = await state();

      pick(page, new File(['x'], 'ada.png', { type: 'image/png' }));

      expect(JSON.parse(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY) ?? '{}').avatarPending).toBe(true);
      expect(window.location.hash).toBe('#authorize');
      sessionStorage.removeItem(PENDING_PROFILE_SAVE_KEY);
    });

    it('reports a failure, and why while impersonating', async () => {
      const { show } = setup({ upload: () => throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })) });
      const page = await state();

      pick(page, new File(['x'], 'ada.png', { type: 'image/png' }));

      expect(show).toHaveBeenCalledWith({ variant: 'error', message: AVATAR_UPLOAD_COPY.impersonating });
    });
  });
});
