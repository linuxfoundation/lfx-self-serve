// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import {
  IDENTITY_LINK_ERROR_MESSAGES,
  LFX_PROFILE_CARD_CONNECT_IMPERSONATING_LABEL,
  LFX_PROFILE_CARD_CONNECT_LABEL,
  LFX_PROFILE_CARD_EDIT_LABEL,
  LFX_PROFILE_CARD_LINK_ALREADY_LINKED_DETAIL,
  LFX_PROFILE_CARD_LINK_ERROR_FALLBACK,
  LFX_PROFILE_CARD_LINK_INCOMPLETE_DETAIL,
  LFX_PROFILE_CARD_LINK_SUCCESS_DETAIL,
  PROFILE_AUTH_ERROR_MESSAGES,
} from '@lfx-one/shared/constants';
import { CombinedProfile, EmailManagementData, EnrichedIdentity } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddAccountDialogComponent } from '../../../profile/components/add-account-dialog/add-account-dialog.component';
import { ProfileCardComponent } from './profile-card.component';

describe('ProfileCardComponent', () => {
  const combined = {
    user: {
      id: 'u_1',
      email: 'ada@example.org',
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    profile: { city: 'London', country: 'United Kingdom', phone_number: '+44 20 7946 0000' },
  } as CombinedProfile;

  const emails: EmailManagementData = {
    primary_email: 'ada@example.org',
    alternate_emails: [{ email: 'ada@work.example', verified: true }],
  };

  const identities = [
    {
      id: 'i_1',
      platform: 'github',
      type: 'username',
      value: 'ada',
      verified: true,
      source: 'cdp',
      icon: '',
      createdAt: '',
      updatedAt: '',
      displayState: 'verified',
      inAuth0: true,
    },
  ] as EnrichedIdentity[];

  let fixture: ComponentFixture<ProfileCardComponent>;
  let toast: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;
  let refreshUserIdentities: ReturnType<typeof vi.fn>;
  /** Stands in for the dialog's `onClose`, so a spec can close it with or without a result. */
  let dialogClose: Subject<unknown>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (testId: string): string | null => element().querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const avatarImage = (): Element | null => element().querySelector('[data-testid="mentorship-profile-card-avatar"] img');

  const clickConnect = (platform: 'github' | 'linkedin'): void => {
    element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-profile-card-${platform}-connect"] button`)?.click();
  };

  /**
   * Boots the card against whatever the three profile endpoints return for this spec.
   * `queryParams` stands in for what the identity-link callback returns the mentor with.
   */
  const render = (userService: Partial<Record<keyof UserService, unknown>>, queryParams: Record<string, string> = {}, platformId: string = 'browser'): void => {
    toast = vi.fn();
    refreshUserIdentities = vi.fn();
    dialogClose = new Subject<unknown>();
    openDialog = vi.fn(() => ({ onClose: dialogClose.asObservable() }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileCardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: MessageService, useValue: { add: toast } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
        // Every spec's fetches run off `identitiesRefresh$`, and the card reads `impersonating`
        // while constructing, so both belong to the harness rather than to each fixture; a spec
        // still overrides any of it by passing the key itself.
        {
          provide: UserService,
          useValue: { identitiesRefresh$: new Subject<void>(), refreshUserIdentities, impersonating: signal(false), ...userService },
        },
      ],
    });
    TestBed.overrideProvider(DialogService, { useValue: { open: openDialog } });

    fixture = TestBed.createComponent(ProfileCardComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    render({
      getCurrentUserProfile: () => of(combined),
      getUserEmails: () => of(emails),
      getIdentities: () => of(identities),
      effectiveAvatarUrl: () => '',
    });
  });

  it('shows the name and phone the profile holds', () => {
    expect(text('mentorship-profile-card-name')).toBe('Ada Lovelace');
    expect(text('mentorship-profile-card-phone')).toBe('+44 20 7946 0000');
  });

  it('renders the mailing address as street then locality', () => {
    const lines = [...element().querySelectorAll('[data-testid="mentorship-profile-card-address"] span')];

    expect(lines.map((line) => line.textContent?.trim())).toEqual(['London, United Kingdom']);
  });

  it('badges only the primary address, so the mentor knows which one programs will use', () => {
    const rows = [...element().querySelectorAll('[data-testid="mentorship-profile-card-emails"] > span')];

    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['ada@example.org Primary', 'ada@work.example']);
  });

  it('links a connected account, and offers to connect the one that is missing', () => {
    const github = element().querySelector('[data-testid="mentorship-profile-card-github"] a');

    expect(github?.getAttribute('href')).toBe('https://github.com/ada');
    expect(github?.textContent?.trim()).toBe('github.com/ada');
    // A placeholder here would be a dead end: connecting LinkedIn is something the mentor can do.
    expect(text('mentorship-profile-card-linkedin')).toBe(LFX_PROFILE_CARD_CONNECT_LABEL);
    expect(element().querySelector('[data-testid="mentorship-profile-card-github-connect"]')).toBeNull();
  });

  it('opens the Add-identity dialog in place, so the mentor keeps the form behind it', () => {
    clickConnect('linkedin');

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog.mock.calls[0][0]).toBe(AddAccountDialogComponent);
    // Tells the dialog GitHub is already linked in this fixture, and LinkedIn is not.
    expect(openDialog.mock.calls[0][1]).toMatchObject({ header: 'Add identity', data: { existingProviders: ['github'] } });
  });

  it('names the platform for a screen reader, since "Connect" alone says nothing', () => {
    const connect = element().querySelector('[data-testid="mentorship-profile-card-linkedin-connect"] button');

    expect(connect?.getAttribute('aria-label')).toBe('Connect your LinkedIn account');
  });

  /**
   * The connect route sits behind `blockDuringImpersonation` inside the `/api` error-handler
   * mount and the dialog reaches it by navigating the whole page, so a click here would replace
   * the registration form with the error JSON. The account could only attach to the impersonator
   * anyway, while the card is showing the impersonated user.
   */
  describe('while impersonating another user', () => {
    beforeEach(() => {
      render({
        getCurrentUserProfile: () => of(combined),
        getUserEmails: () => of(emails),
        getIdentities: () => of([]),
        effectiveAvatarUrl: () => '',
        impersonating: signal(true),
      });
    });

    it('disables Connect and says why, rather than leading the admin to a JSON error page', () => {
      const github = element().querySelector('[data-testid="mentorship-profile-card-github-connect"] button');
      const linkedin = element().querySelector('[data-testid="mentorship-profile-card-linkedin-connect"] button');

      expect(github?.hasAttribute('disabled')).toBe(true);
      expect(linkedin?.hasAttribute('disabled')).toBe(true);
      expect(github?.getAttribute('aria-label')).toBe(`GitHub — ${LFX_PROFILE_CARD_CONNECT_IMPERSONATING_LABEL}`);
      expect(linkedin?.getAttribute('aria-label')).toBe(`LinkedIn — ${LFX_PROFILE_CARD_CONNECT_IMPERSONATING_LABEL}`);
    });

    it('refuses to open the dialog even when called programmatically', () => {
      // A click never reaches `onConnect` on a disabled button — jsdom and the wrapper both
      // swallow it — so the programmatic path is the thing the in-method guard actually covers.
      (fixture.componentInstance as unknown as { onConnect: () => void }).onConnect();

      expect(openDialog).not.toHaveBeenCalled();
    });
  });

  it('re-reads the profile once an identity is linked, rather than leaving a stale row', () => {
    clickConnect('linkedin');

    dialogClose.next({ provider: 'linkedin' });

    expect(refreshUserIdentities).toHaveBeenCalledTimes(1);
  });

  it('leaves the card alone when the mentor dismisses the dialog without linking anything', () => {
    clickConnect('linkedin');

    dialogClose.next(null);

    expect(refreshUserIdentities).not.toHaveBeenCalled();
  });

  it('opens an external profile in a new tab without leaking the referrer', () => {
    const github = element().querySelector('[data-testid="mentorship-profile-card-github"] a');

    expect(github?.getAttribute('target')).toBe('_blank');
    expect(github?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows the profile picture when there is one', () => {
    render({
      getCurrentUserProfile: () => of({ ...combined, profile: { picture: 'https://cdn.example.org/ada.png' } } as CombinedProfile),
      getUserEmails: () => of(emails),
      getIdentities: () => of([]),
      effectiveAvatarUrl: () => '',
    });

    expect(avatarImage()?.getAttribute('src')).toBe('https://cdn.example.org/ada.png');
  });

  it('uses the session avatar when the profile itself holds no picture', () => {
    // Otherwise this card shows a letter for someone whose photo comes from the OIDC
    // claim, while the sidebar two panels away shows the photo.
    render({
      getCurrentUserProfile: () => of(combined),
      getUserEmails: () => of(emails),
      getIdentities: () => of([]),
      effectiveAvatarUrl: () => 'https://sso.example.org/ada.png',
    });

    expect(avatarImage()?.getAttribute('src')).toBe('https://sso.example.org/ada.png');
  });

  it('falls back to the first letter of the name when neither the profile nor the session has a picture', () => {
    expect(avatarImage()).toBeNull();
    expect(text('mentorship-profile-card-avatar')).toBe('A');
  });

  it('falls back to the letter when the picture fails to load', () => {
    render({
      getCurrentUserProfile: () => of({ ...combined, profile: { picture: 'https://cdn.example.org/gone.png' } } as CombinedProfile),
      getUserEmails: () => of(emails),
      getIdentities: () => of([]),
      effectiveAvatarUrl: () => '',
    });

    avatarImage()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(avatarImage()).toBeNull();
    expect(text('mentorship-profile-card-avatar')).toBe('A');
  });

  it('still renders the fields it could load when one endpoint fails', () => {
    render({
      getCurrentUserProfile: () => of(combined),
      getUserEmails: () => throwError(() => new Error('emails unavailable')),
      getIdentities: () => throwError(() => new Error('identities unavailable')),
      effectiveAvatarUrl: () => '',
    });

    expect(element().querySelector('[data-testid="mentorship-profile-card-loading"]')).toBeNull();
    expect(text('mentorship-profile-card-phone')).toBe('+44 20 7946 0000');
    // The signed-in address survives an email outage; the linked accounts cannot.
    expect(text('mentorship-profile-card-emails')).toBe('ada@example.org Primary');
    // An identities outage is indistinguishable from an unconnected account from here, so the
    // row offers Connect either way rather than asserting the account does not exist.
    expect(text('mentorship-profile-card-github')).toBe(LFX_PROFILE_CARD_CONNECT_LABEL);
  });

  it('tells the user editing is not wired up yet rather than failing silently', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-profile-card-edit"] button')?.click();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'info', summary: LFX_PROFILE_CARD_EDIT_LABEL });
  });

  /**
   * The mentorship forms mount under the main layout, so neither the Identities tab nor
   * `ProfileLayoutComponent` is around to read the callback's query params. Without the card
   * doing it, a mentor finishes the Auth0 handshake and is told nothing at all.
   */
  describe('when the identity-link callback returns the mentor here', () => {
    const profile = {
      getCurrentUserProfile: () => of(combined),
      getUserEmails: () => of(emails),
      getIdentities: () => of(identities),
      effectiveAvatarUrl: () => '',
    };

    it('says nothing on an ordinary visit, so the card is silent unless something happened', () => {
      render(profile);

      expect(toast).not.toHaveBeenCalled();
    });

    it('does not toast the callback on the server, so hydration is not left with a duplicate', () => {
      render(profile, { success: 'identity_linked' }, 'server');

      expect(toast).not.toHaveBeenCalled();
      expect(refreshUserIdentities).not.toHaveBeenCalled();
    });

    it('confirms a linked account and re-reads the profile, so the new row is not stale', () => {
      render(profile, { success: 'identity_linked' });

      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success', detail: LFX_PROFILE_CARD_LINK_SUCCESS_DETAIL });
      expect(refreshUserIdentities).toHaveBeenCalledTimes(1);
    });

    describe('and the params are stripped', () => {
      // This is the one spec that moves the shared jsdom URL, so it puts it back — otherwise it
      // leaves every later spec in the file sitting on /mentorship/mentor.
      let originalUrl: string;
      let originalState: unknown;

      beforeEach(() => {
        originalUrl = window.location.href;
        originalState = window.history.state;
      });

      afterEach(() => {
        window.history.replaceState(originalState, '', originalUrl);
      });

      it('drops them from the URL, so a reload does not replay the message', () => {
        window.history.replaceState(window.history.state, '', '/mentorship/mentor?success=identity_linked');

        render(profile, { success: 'identity_linked' });

        expect(window.location.search).toBe('');
        expect(window.location.pathname).toBe('/mentorship/mentor');
      });

      it('keeps the history state it found, rather than nulling what the Router put there', () => {
        window.history.replaceState({ navigationId: 7 }, '', '/mentorship/mentor?success=identity_linked');

        render(profile, { success: 'identity_linked' });

        expect(window.history.state).toEqual({ navigationId: 7 });
      });
    });

    it('names the conflict when the account belongs to another profile, the likeliest real failure', () => {
      render(profile, { error: 'already_linked' });

      // In neither shared map, so a generic fallback here would strand the mentor with no next step.
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: LFX_PROFILE_CARD_LINK_ALREADY_LINKED_DETAIL });
    });

    it('reports an identity-link failure with its own message', () => {
      render(profile, { error: 'social_auth_failed' });

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: IDENTITY_LINK_ERROR_MESSAGES['social_auth_failed'] });
    });

    it('reports a Flow C failure too, since no profile shell mounts here to own those codes', () => {
      render(profile, { error: 'invalid_state' });

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: PROFILE_AUTH_ERROR_MESSAGES['invalid_state'] });
    });

    it('does not read an inherited Object.prototype key as an error message', () => {
      // `error` is unvalidated URL input: an unguarded lookup resolves `toString` to a function.
      render(profile, { error: 'toString' });

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: LFX_PROFILE_CARD_LINK_ERROR_FALLBACK });
    });

    it('does not claim an account was linked when Flow C only minted a token', () => {
      render(profile, { success: 'profile_token_obtained' });

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'info', detail: LFX_PROFILE_CARD_LINK_INCOMPLETE_DETAIL });
      expect(refreshUserIdentities).not.toHaveBeenCalled();
    });
  });
});
