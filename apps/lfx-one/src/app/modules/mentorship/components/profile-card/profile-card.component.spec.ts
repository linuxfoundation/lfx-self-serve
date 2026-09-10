// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LFX_PROFILE_CARD_EDIT_LABEL, LFX_PROFILE_CARD_EMPTY } from '@lfx-one/shared/constants';
import { CombinedProfile, EmailManagementData, EnrichedIdentity } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (testId: string): string | null => element().querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const avatarImage = (): Element | null => element().querySelector('[data-testid="mentorship-profile-card-avatar"] img');

  /** Boots the card against whatever the three profile endpoints return for this spec. */
  const render = (userService: Partial<Record<keyof UserService, unknown>>): void => {
    toast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileCardComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: { add: toast } }, { provide: UserService, useValue: userService }],
    });

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

  it('links a connected account and leaves the unconnected one as a placeholder', () => {
    const github = element().querySelector('[data-testid="mentorship-profile-card-github"] a');

    expect(github?.getAttribute('href')).toBe('https://github.com/ada');
    expect(github?.textContent?.trim()).toBe('github.com/ada');
    expect(text('mentorship-profile-card-linkedin')).toBe(LFX_PROFILE_CARD_EMPTY);
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
    expect(text('mentorship-profile-card-github')).toBe(LFX_PROFILE_CARD_EMPTY);
  });

  it('tells the user editing is not wired up yet rather than failing silently', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-profile-card-edit"] button')?.click();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'info', summary: LFX_PROFILE_CARD_EDIT_LABEL });
  });
});
