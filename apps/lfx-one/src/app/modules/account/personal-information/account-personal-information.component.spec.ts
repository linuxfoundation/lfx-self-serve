// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PENDING_PRIMARY_EMAIL_KEY, PENDING_PROFILE_SAVE_KEY, PERSONAL_INFORMATION_COPY, PROFILE_BIO_MAX_LENGTH } from '@lfx-one/shared/constants';
import { CombinedProfile, EmailManagementData, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { AccountProfileService } from '@services/account-profile.service';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { ProfileSaveSyncService } from '@services/profile-save-sync.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountPersonalInformationComponent } from './account-personal-information.component';

const PROFILE = {
  user: { first_name: 'Ada', last_name: 'Lovelace', username: 'auth0|ada', email: 'ada@example.com' },
  profile: {
    bio: 'Hello',
    organization: 'acme motors ',
    job_title: 'Engineer',
    country: 'United Kingdom',
    city: 'London',
    t_shirt_size: 'Straight-Cut Medium',
  },
} as unknown as CombinedProfile;

const EMAILS: EmailManagementData = {
  primary_email: 'ada@example.com',
  alternate_emails: [
    { email: 'ada@work.example', verified: true },
    { email: 'pending@example.com', verified: false },
  ],
} as EmailManagementData;

const EXPERIENCES = [{ organization: 'Acme Motors' }, { organization: 'ACME MOTORS' }, { organization: 'Vendor Corp' }] as WorkExperienceEntry[];

/** State-only: no template, so these tests cost no render. */
@Component({ selector: 'lfx-test-personal-information', template: '' })
class StatePageComponent extends AccountPersonalInformationComponent {}

describe('AccountPersonalInformationComponent', () => {
  let impersonating: ReturnType<typeof signal<boolean>>;
  let userService: Record<string, ReturnType<typeof vi.fn> | ReturnType<typeof signal>>;
  let register: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  let apply: ReturnType<typeof vi.fn>;

  const forbidden = (body: Record<string, string>) => throwError(() => new HttpErrorResponse({ status: 403, error: body }));

  function configure(overrides: Record<string, () => Observable<unknown>> = {}): void {
    impersonating = signal(false);
    register = vi.fn();
    show = vi.fn();
    apply = vi.fn();
    userService = {
      impersonating,
      effectiveAvatarUrl: signal(''),
      getCurrentUserProfile: vi.fn(overrides['getCurrentUserProfile'] ?? (() => of(PROFILE))),
      getUserEmails: vi.fn(overrides['getUserEmails'] ?? (() => of(EMAILS))),
      getWorkExperiences: vi.fn(overrides['getWorkExperiences'] ?? (() => of(EXPERIENCES))),
      updateUserProfile: vi.fn(overrides['updateUserProfile'] ?? (() => of({}))),
      setPrimaryEmail: vi.fn(overrides['setPrimaryEmail'] ?? (() => of({ message: 'ok' }))),
      uploadProfilePicture: vi.fn(overrides['uploadProfilePicture'] ?? (() => of({ public_url: 'https://cdn.example/a.png' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        AccountProfileService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: userService },
        { provide: ProfileSaveSyncService, useValue: { apply } },
        { provide: AccountUnsavedChangesService, useValue: { register } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
  }

  async function createState(overrides: Record<string, () => Observable<unknown>> = {}) {
    configure(overrides);
    const fixture = TestBed.createComponent(StatePageComponent);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  afterEach(() => sessionStorage.clear());

  describe('state', () => {
    it('seeds the fields, username, bio count and primary email from the profile', async () => {
      const page = await createState();

      expect(page.form.getRawValue()).toEqual(
        expect.objectContaining({ given_name: 'Ada', job_title: 'Engineer', city: 'London', state_province: '', t_shirt_size: 'Straight-Cut Medium' })
      );
      expect(page.username()).toBe('ada');
      expect(page.bioLength()).toBe(5);
      expect(page.selectedPrimaryEmail()).toBe('ada@example.com');
      expect(page.dirty()).toBe(false);
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ dirty: page.dirty, saving: page.saving }), expect.anything());
    });

    it('offers verified emails only, primary first', async () => {
      const page = await createState();

      expect(page.emailOptions().map((option) => option.email)).toEqual(['ada@example.com', 'ada@work.example']);
    });

    it('offers each work-history company once, and matches the saved company to its option', async () => {
      const page = await createState();

      expect(page.companyOptions()).toEqual(['Acme Motors', 'Vendor Corp']);
      expect(page.form.controls.organization.value).toBe('Acme Motors');
      expect(page.form.controls.organization.enabled).toBe(true);
    });

    it('disables the company field when the work history has none', async () => {
      const page = await createState({ getWorkExperiences: () => of([]), getCurrentUserProfile: () => of({ ...PROFILE, profile: { city: 'London' } }) });

      expect(page.companyOptions()).toEqual([]);
      expect(page.form.controls.organization.disabled).toBe(true);
    });

    it('is dirty after an edit or a new primary email, and Revert puts both back', async () => {
      const page = await createState();
      page.form.controls.job_title.setValue('Maintainer');
      page.form.controls.job_title.markAsDirty();
      page.form.updateValueAndValidity();
      expect(page.dirty()).toBe(true);

      page.selectedPrimaryEmail.set('ada@work.example');
      page.revert();

      expect(page.form.controls.job_title.value).toBe('Engineer');
      expect(page.selectedPrimaryEmail()).toBe('ada@example.com');
      expect(page.dirty()).toBe(false);
    });

    it('caps the bio at the limit by code point', async () => {
      const page = await createState();
      page.form.controls.bio.setValue('😀'.repeat(PROFILE_BIO_MAX_LENGTH + 5));

      expect(page.bioLength()).toBe(PROFILE_BIO_MAX_LENGTH);
    });

    it('shows a length error under a field once it is touched', async () => {
      const page = await createState();
      page.form.controls.city.setValue('x'.repeat(51));
      expect(page['fieldErrors']().city).toBeUndefined();

      page.form.controls.city.markAsTouched();
      expect(page['fieldErrors']().city).toBe('Must be 50 characters or fewer');
    });

    it('offers only the sign-in address, unchangeable, when the email list fails to load', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const page = await createState({ getUserEmails: () => throwError(() => new Error('down')) });

      expect(page.emailsFailed()).toBe(true);
      expect(page.shownPrimaryEmail()).toBe('ada@example.com');
      expect(page.dirty()).toBe(false);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it('picks again a primary email chosen before a Flow C redirect', async () => {
      sessionStorage.setItem(PENDING_PRIMARY_EMAIL_KEY, JSON.stringify({ savedAt: Date.now(), email: 'ada@work.example' }));
      const page = await createState();

      expect(page.selectedPrimaryEmail()).toBe('ada@work.example');
      expect(page.dirty()).toBe(true);
      expect(sessionStorage.getItem(PENDING_PRIMARY_EMAIL_KEY)).toBeNull();
    });

    it('ignores a stale or unverified kept primary email', async () => {
      sessionStorage.setItem(PENDING_PRIMARY_EMAIL_KEY, JSON.stringify({ savedAt: Date.now(), email: 'pending@example.com' }));
      const page = await createState();

      expect(page.selectedPrimaryEmail()).toBe('ada@example.com');
    });

    it('shows the saved company in its option case while read-only', async () => {
      configure();
      impersonating.set(true);
      const fixture = TestBed.createComponent(StatePageComponent);
      await fixture.whenStable();

      expect(fixture.componentInstance.form.controls.organization.value).toBe('Acme Motors');
      expect(fixture.componentInstance.form.controls.organization.disabled).toBe(true);
    });

    it('is read-only while impersonating', async () => {
      const page = await createState();
      impersonating.set(true);
      TestBed.tick();

      expect(page.form.disabled).toBe(true);
    });
  });

  describe('saving', () => {
    const editJobTitle = (page: AccountPersonalInformationComponent, value: string) => {
      page.form.controls.job_title.setValue(value);
      page.form.controls.job_title.markAsDirty();
      page.form.updateValueAndValidity();
    };

    it('saves the fields, clears a free-text field, and makes the saved values the baseline', async () => {
      const page = await createState();
      editJobTitle(page, '');
      page.save();

      expect(userService['updateUserProfile']).toHaveBeenCalledWith({
        user_metadata: expect.objectContaining({ job_title: '', given_name: 'Ada', city: 'London' }),
      });
      expect(userService['setPrimaryEmail']).not.toHaveBeenCalled();
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ job_title: '' }), PROFILE.user);
      expect(show).toHaveBeenCalledWith({ variant: 'dark', message: PERSONAL_INFORMATION_COPY.saved });
      expect(page.dirty()).toBe(false);
    });

    it('saves only the primary email when that is the only change', async () => {
      const page = await createState();
      page.selectedPrimaryEmail.set('ada@work.example');
      page.save();

      expect(userService['updateUserProfile']).not.toHaveBeenCalled();
      expect(userService['setPrimaryEmail']).toHaveBeenCalledWith('ada@work.example');
      expect(page.primaryEmail()).toBe('ada@work.example');
      expect(page.dirty()).toBe(false);
    });

    it('keeps a failed primary email change on the page after the fields saved, with the reason', async () => {
      const page = await createState({
        setPrimaryEmail: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Invite email is pinned' } })),
      });
      editJobTitle(page, 'Maintainer');
      page.selectedPrimaryEmail.set('ada@work.example');
      page.save();

      expect(show).toHaveBeenCalledWith({ variant: 'error', message: 'Invite email is pinned' });
      expect(page.form.dirty).toBe(false);
      expect(page.dirty()).toBe(true);
      expect(page.saving()).toBe(false);
    });

    it('keeps the edit and goes to authorize when the save needs Flow C', async () => {
      const page = await createState({ updateUserProfile: () => forbidden({ error: 'management_token_required', authorize_url: '#authorize' }) });
      editJobTitle(page, 'Maintainer');
      page.save();

      const pending = JSON.parse(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY) ?? '{}');
      expect(pending.userMetadata).toEqual(expect.objectContaining({ job_title: 'Maintainer' }));
      expect(show).not.toHaveBeenCalled();
    });

    it('locks the fields while a save is in flight', async () => {
      const pending = new Subject<unknown>();
      const page = await createState({ updateUserProfile: () => pending });
      editJobTitle(page, 'Maintainer');
      page.save();
      expect(page.form.disabled).toBe(true);

      pending.next({});
      pending.complete();
      expect(page.form.enabled).toBe(true);
      expect(page.form.controls.job_title.value).toBe('Maintainer');
    });

    it('keeps the fields locked when the companies land mid-save', async () => {
      const companies = new Subject<WorkExperienceEntry[]>();
      const pending = new Subject<unknown>();
      const page = await createState({ getWorkExperiences: () => companies, updateUserProfile: () => pending });
      editJobTitle(page, 'Maintainer');
      page.save();

      companies.next(EXPERIENCES);
      expect(page.form.controls.organization.disabled).toBe(true);

      pending.next({});
      pending.complete();
      expect(page.form.controls.organization.enabled).toBe(true);
    });

    it('keeps the fields locked until the primary email change after them ends', async () => {
      const email = new Subject<{ message: string }>();
      const page = await createState({ setPrimaryEmail: () => email });
      editJobTitle(page, 'Maintainer');
      page.selectedPrimaryEmail.set('ada@work.example');
      page.save();
      TestBed.tick();

      expect(page.form.disabled).toBe(true);
      email.next({ message: 'ok' });
      email.complete();
      expect(page.form.enabled).toBe(true);
    });

    it('reverts to a save even when the profile has no record yet', async () => {
      const page = await createState({ getCurrentUserProfile: () => of({ ...PROFILE, profile: null }) });
      editJobTitle(page, 'Maintainer');
      page.save();
      TestBed.tick();
      page.form.controls.city.setValue('Paris');
      page.revert();

      expect(page.form.controls.job_title.value).toBe('Maintainer');
      expect(page.form.controls.city.value).toBe('');
    });

    it('keeps the email choice and goes to authorize when the primary email change needs Flow C', async () => {
      const page = await createState({ setPrimaryEmail: () => forbidden({ error: 'management_token_required', authorize_url: '#authorize' }) });
      page.selectedPrimaryEmail.set('ada@work.example');
      page.save();

      expect(JSON.parse(sessionStorage.getItem(PENDING_PRIMARY_EMAIL_KEY) ?? '{}').email).toBe('ada@work.example');
      expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).toBeNull();
      expect(show).not.toHaveBeenCalled();
    });

    it('keeps both the fields and the email choice when the fields need Flow C first', async () => {
      const page = await createState({ updateUserProfile: () => forbidden({ error: 'management_token_required', authorize_url: '#authorize' }) });
      editJobTitle(page, 'Maintainer');
      page.selectedPrimaryEmail.set('ada@work.example');
      page.save();

      expect(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY)).not.toBeNull();
      expect(JSON.parse(sessionStorage.getItem(PENDING_PRIMARY_EMAIL_KEY) ?? '{}').email).toBe('ada@work.example');
      expect(userService['setPrimaryEmail']).not.toHaveBeenCalled();
    });

    it('says so when the fields fail to save', async () => {
      const page = await createState({ updateUserProfile: () => throwError(() => new HttpErrorResponse({ status: 500 })) });
      editJobTitle(page, 'Maintainer');
      page.save();

      expect(show).toHaveBeenCalledWith({ variant: 'error', message: 'Failed to save your personal information. Please try again.' });
      expect(page.dirty()).toBe(true);
    });

    it('does not save an invalid form', async () => {
      const page = await createState();
      editJobTitle(page, 'x'.repeat(101));
      page.save();

      expect(userService['updateUserProfile']).not.toHaveBeenCalled();
      expect(page.form.controls.job_title.touched).toBe(true);
    });
  });
  describe('photo', () => {
    const choose = (page: AccountPersonalInformationComponent, file: File) =>
      page['onAvatarFileSelected']({ target: { files: [file], value: '' } } as unknown as Event);
    const image = (type = 'image/png', size = 3) => new File(['x'.repeat(size)], 'me.png', { type });

    it('uploads a new photo at once and carries it to the rest of the app', async () => {
      const page = await createState();
      choose(page, image());

      expect(userService['uploadProfilePicture']).toHaveBeenCalled();
      expect(apply).toHaveBeenCalledWith({ picture: 'https://cdn.example/a.png' }, PROFILE.user);
      expect(show).toHaveBeenCalledWith({ variant: 'dark', message: 'Profile picture updated' });
    });

    it('turns down a file of the wrong type or over 2MB', async () => {
      const page = await createState();
      choose(page, image('application/pdf'));
      choose(page, image('image/png', 2 * 1024 * 1024 + 1));

      expect(userService['uploadProfilePicture']).not.toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith({ variant: 'error', message: 'Please choose a PNG, JPEG, or WEBP image.' });
      expect(show).toHaveBeenCalledWith({ variant: 'error', message: 'Image must be 2MB or smaller.' });
    });

    it('keeps unsaved fields and asks for the photo again after Flow C', async () => {
      const page = await createState({ uploadProfilePicture: () => forbidden({ error: 'management_token_required', authorize_url: '#authorize' }) });
      page.form.controls.city.setValue('Paris');
      page.form.controls.city.markAsDirty();
      choose(page, image());

      const pending = JSON.parse(sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY) ?? '{}');
      expect(pending.avatarPending).toBe(true);
      expect(pending.userMetadata).toEqual(expect.objectContaining({ city: 'Paris' }));
    });

    it('keeps an unsaved primary email choice when the photo needs Flow C', async () => {
      const page = await createState({ uploadProfilePicture: () => forbidden({ error: 'management_token_required', authorize_url: '#authorize' }) });
      page.selectedPrimaryEmail.set('ada@work.example');
      choose(page, image());

      expect(JSON.parse(sessionStorage.getItem(PENDING_PRIMARY_EMAIL_KEY) ?? '{}').email).toBe('ada@work.example');
    });
  });
});

describe('AccountPersonalInformationComponent — render', () => {
  it('shows the four cards, the bio count and the Primary badge on the chosen email', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        AccountProfileService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: UserService,
          useValue: {
            impersonating: signal(false),
            effectiveAvatarUrl: signal(''),
            getCurrentUserProfile: () => of(PROFILE),
            getUserEmails: () => of(EMAILS),
            getWorkExperiences: () => of(EXPERIENCES),
          },
        },
        { provide: ProfileSaveSyncService, useValue: { apply: vi.fn() } },
        { provide: AccountUnsavedChangesService, useValue: { register: vi.fn() } },
        { provide: UiToastService, useValue: { show: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountPersonalInformationComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim();

    expect(text('account-personal-info-details-title')).toBe('Personal information');
    expect(text('account-personal-info-email-title')).toBe('Primary email address');
    expect(text('account-personal-info-location-title')).toBe('Location');
    expect(text('account-personal-info-tshirt-title')).toBe('T-shirt size');
    expect(text('account-personal-info-bio-count')).toBe(`5 / ${PROFILE_BIO_MAX_LENGTH}`);
    expect(text('account-personal-info-email-ada@example.com')).toContain('Primary');
    expect(text('account-personal-info-email-ada@work.example')).not.toContain('Primary');
    expect(host.querySelector('[data-testid="account-personal-info-email-pending@example.com"]')).toBeNull();
  });
});
