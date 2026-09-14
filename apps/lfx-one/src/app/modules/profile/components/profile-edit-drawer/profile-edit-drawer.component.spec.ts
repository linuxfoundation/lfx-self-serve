// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CombinedProfile, EmailManagementData, ProfilePictureUploadResponse, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { ProfileEditDrawerComponent } from './profile-edit-drawer.component';
import { ProfileEditDrawerService } from './profile-edit-drawer.service';

/**
 * Guards the impersonation read-only behavior of the profile edit drawer (#2399): the form must stay
 * genuinely disabled — including the organization control, which is re-synced independently of the
 * impersonation subscription on every drawer open (the bug a prior version of this fix missed) — and
 * every mutation handler must no-op while impersonating. Template is overridden empty so the class
 * logic runs without the PrimeNG/lfx wrapper children.
 */
describe('ProfileEditDrawerComponent — impersonation read-only (#2399)', () => {
  const PROFILE: CombinedProfile = {
    user: {
      id: 'u1',
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    profile: null,
  };

  const WORK_EXPERIENCES: WorkExperienceEntry[] = [{ id: 'w1', organization: 'Acme Corp', jobTitle: 'Engineer', startDate: '2020-01-01', source: 'manual' }];

  const EMAILS: EmailManagementData = { primary_email: 'ada@example.com', alternate_emails: [] };

  let fixture: ComponentFixture<ProfileEditDrawerComponent>;
  let comp: ProfileEditDrawerComponent;
  let impersonating: WritableSignal<boolean>;
  let updateUserProfile: Mock;
  let uploadProfilePicture: Mock;
  let setPrimaryEmail: Mock;
  let messageAdd: Mock;

  function fileSelectEvent(): Event {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    return { target: input } as unknown as Event;
  }

  async function setup(opts?: { impersonating?: boolean }): Promise<void> {
    impersonating = signal(opts?.impersonating ?? false);
    updateUserProfile = vi.fn(() => of({}));
    uploadProfilePicture = vi.fn(() => of({ success: true, public_url: 'https://example.com/a.png' } as ProfilePictureUploadResponse));
    setPrimaryEmail = vi.fn(() => of({ message: 'ok' }));
    messageAdd = vi.fn();
    const drawer = new ProfileEditDrawerService();

    TestBed.configureTestingModule({
      imports: [ProfileEditDrawerComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: UserService,
          useValue: {
            impersonating,
            effectiveAvatarUrl: signal(''),
            updateUserProfile,
            uploadProfilePicture,
            getUserEmails: vi.fn(() => of(EMAILS)),
            setPrimaryEmail,
            getWorkExperiences: vi.fn(() => of(WORK_EXPERIENCES)),
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: ProfileEditDrawerService, useValue: drawer },
      ],
    });
    // Empty template: exercise the class without rendering the PrimeNG/lfx wrapper children.
    TestBed.overrideComponent(ProfileEditDrawerComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(ProfileEditDrawerComponent);
    comp = fixture.componentInstance;
    // Opening the drawer with a profile drives the seed + email/work-history reload pipelines.
    drawer.open(PROFILE);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('disables the whole form — including organization once work history loads — while impersonating', async () => {
    await setup({ impersonating: true });

    expect(comp.profileForm.disabled).toBe(true);
    // Regression guard: syncOrganizationControl runs again on the work-experiences response,
    // independently of the impersonation subscription, and must not re-enable the control just
    // because options are now available.
    expect(comp.profileForm.get('organization')!.disabled).toBe(true);
  });

  it('re-enables the form (except username) and re-syncs organization once impersonation stops', async () => {
    await setup({ impersonating: true });

    impersonating.set(false);
    await fixture.whenStable();

    expect(comp.profileForm.get('given_name')!.disabled).toBe(false);
    expect(comp.profileForm.get('username')!.disabled).toBe(true);
    expect(comp.profileForm.get('organization')!.disabled).toBe(false);
  });

  it('onSubmit no-ops while impersonating', async () => {
    await setup({ impersonating: true });

    comp.onSubmit();

    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('onPrimaryEmailChange no-ops while impersonating', async () => {
    await setup({ impersonating: true });

    comp.onPrimaryEmailChange('someone-else@example.com');

    expect(setPrimaryEmail).not.toHaveBeenCalled();
  });

  it('onAvatarFileSelected no-ops while impersonating', async () => {
    await setup({ impersonating: true });

    comp.onAvatarFileSelected(fileSelectEvent());

    expect(uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('toasts the impersonation-specific message on a 403 IMPERSONATION_READ_ONLY profile-save response', async () => {
    await setup({ impersonating: false });
    updateUserProfile.mockReturnValue(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));
    comp.profileForm.get('given_name')!.setValue('Grace');

    comp.onSubmit();
    await fixture.whenStable();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Profile editing is unavailable while impersonating another user.' })
    );
  });

  it('toasts the impersonation-specific message on a 403 IMPERSONATION_READ_ONLY avatar-upload response', async () => {
    await setup({ impersonating: false });
    uploadProfilePicture.mockReturnValue(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));

    comp.onAvatarFileSelected(fileSelectEvent());
    await fixture.whenStable();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Profile editing is unavailable while impersonating another user.' })
    );
  });
});
