// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COUNTRIES, normalizeTShirtSize, TSHIRT_SIZES, US_STATES } from '@lfx-one/shared';
import { CombinedProfile, ProfileUpdateRequest, UserEmail, UserMetadata, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { stripAuthPrefixOrNull } from '@app/shared/utils/strip-auth-prefix.util';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize } from 'rxjs';

@Component({
  selector: 'lfx-profile-edit-dialog',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, ButtonComponent],
  templateUrl: './profile-edit-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileEditDialogComponent {
  // Private injections
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  // Config data
  public readonly combinedProfile: CombinedProfile = this.config.data.combinedProfile;

  // Form state signals
  public readonly saving = signal(false);
  private readonly selectedCountrySignal = signal('');

  // Email signals
  public readonly emails = signal<UserEmail[]>([]);
  public readonly primaryEmail = signal('');
  public readonly loadingEmails = signal(true);
  public readonly selectedPrimaryEmail = signal('');
  public readonly savingPrimaryEmail = signal(false);
  public readonly verifiedEmails: Signal<UserEmail[]> = this.initVerifiedEmails();
  public readonly hasManagedEmails: Signal<boolean> = computed(() => this.verifiedEmails().length > 0);
  public readonly authEmail = this.combinedProfile.user.email;

  // Organization (work-history-derived) signals
  public readonly loadingWorkExperiences = signal(true);
  private readonly workExperiences = signal<WorkExperienceEntry[]>([]);
  public readonly organizationOptions: Signal<{ label: string; value: string }[]> = this.initOrganizationOptions();
  public readonly hasOrganizationOptions: Signal<boolean> = computed(() => this.organizationOptions().length > 0);

  // Country/state options
  public readonly countryOptions = COUNTRIES.map((country: { label: string; value: string }) => ({
    label: country.label,
    value: country.label,
  }));

  public readonly stateOptions = US_STATES.map((state) => ({
    label: state.label,
    value: state.label,
  }));

  public readonly tshirtSizeOptions = TSHIRT_SIZES.map((size) => ({
    label: size.label,
    value: size.value,
  }));

  // Computed
  public readonly isUSA = computed(() => this.selectedCountrySignal() === 'United States');
  public readonly hasChanges = signal(false);

  // Profile edit form
  public profileForm: FormGroup = this.fb.group({
    given_name: ['', [Validators.maxLength(50)]],
    family_name: ['', [Validators.maxLength(50)]],
    username: [{ value: '', disabled: true }],
    country: ['', [Validators.maxLength(50)]],
    state_province: ['', [Validators.maxLength(50)]],
    city: ['', [Validators.maxLength(50)]],
    address: ['', [Validators.maxLength(200)]],
    postal_code: ['', [Validators.maxLength(20)]],
    phone_number: ['', [Validators.maxLength(20)]],
    t_shirt_size: [''],
    job_title: ['', [Validators.maxLength(100)]],
    // Organization is now selected from work-history orgs (a constrained list), so the
    // free-text 100-char limit no longer applies — org names can legitimately be longer.
    organization: [''],
  });

  public constructor() {
    this.populateForm(this.combinedProfile);

    this.profileForm
      .get('country')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((country: string) => {
        this.selectedCountrySignal.set(country || '');
        if (country !== 'United States') {
          this.profileForm.get('state_province')?.setValue('');
        }
      });

    this.profileForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.hasChanges.set(this.profileForm.dirty);
    });

    this.userService
      .getUserEmails()
      .pipe(
        takeUntilDestroyed(),
        finalize(() => this.loadingEmails.set(false))
      )
      .subscribe({
        next: (data) => {
          const primary: UserEmail = { email: data.primary_email, verified: true };
          const alternates = data.alternate_emails.filter((e) => e.email !== data.primary_email);
          this.emails.set([primary, ...alternates]);
          this.primaryEmail.set(data.primary_email);
          this.selectedPrimaryEmail.set(data.primary_email);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to load email addresses.',
          });
        },
      });

    // Load work-history organizations to populate the Organization dropdown.
    this.userService
      .getWorkExperiences()
      .pipe(
        takeUntilDestroyed(),
        finalize(() => this.loadingWorkExperiences.set(false))
      )
      .subscribe({
        next: (experiences) => this.workExperiences.set(experiences),
        // Non-fatal: leave the list empty. Any currently-saved organization still shows
        // as a selectable option via organizationOptions().
        error: () => this.workExperiences.set([]),
      });
  }

  public onSubmit(): void {
    if (this.profileForm.invalid) {
      markFormControlsAsTouched(this.profileForm);
      return;
    }

    this.saving.set(true);
    const formValue = this.profileForm.value;

    const userMetadata: Partial<UserMetadata> = {
      given_name: formValue.given_name || undefined,
      family_name: formValue.family_name || undefined,
      job_title: formValue.job_title || undefined,
      organization: formValue.organization || undefined,
      country: formValue.country || undefined,
      state_province: formValue.state_province || undefined,
      city: formValue.city || undefined,
      address: formValue.address || undefined,
      postal_code: formValue.postal_code || undefined,
      phone_number: formValue.phone_number || undefined,
      t_shirt_size: formValue.t_shirt_size || undefined,
    };

    const updateData: ProfileUpdateRequest = {
      user_metadata: userMetadata as UserMetadata,
    };

    this.userService
      .updateUserProfile(updateData)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Profile updated successfully!',
          });
          // Return the saved metadata so the parent can update its cached profile optimistically.
          // The profile GET is eventually consistent, so an immediate refetch can read stale data.
          this.ref.close(userMetadata);
        },
        error: (error: HttpErrorResponse) => {
          // Flow C: Management token required — save form state and redirect to authorize
          if (error.status === 403 && error.error?.error === 'management_token_required') {
            sessionStorage.setItem('lfx_profile_pending_save', JSON.stringify(this.profileForm.value));
            window.location.href = error.error.authorize_url;
            return;
          }

          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to save profile. Please try again.',
          });
        },
      });
  }

  public onReset(): void {
    this.populateForm(this.combinedProfile);
    this.profileForm.markAsPristine();
    this.profileForm.markAsUntouched();
    this.hasChanges.set(false);
  }

  public onPrimaryEmailChange(email: string): void {
    const previous = this.selectedPrimaryEmail();
    this.selectedPrimaryEmail.set(email);
    this.savingPrimaryEmail.set(true);

    this.userService
      .setPrimaryEmail(email)
      .pipe(finalize(() => this.savingPrimaryEmail.set(false)))
      .subscribe({
        next: () => {
          this.primaryEmail.set(email);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Primary email updated successfully!',
          });
        },
        error: () => {
          this.selectedPrimaryEmail.set(previous);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update primary email. Please try again.',
          });
        },
      });
  }

  private populateForm(profile: CombinedProfile): void {
    const countryValue = profile.profile?.country || '';

    this.profileForm.patchValue({
      given_name: profile.user.first_name || '',
      family_name: profile.user.last_name || '',
      username: stripAuthPrefixOrNull(profile.user.username) ?? '',
      country: countryValue,
      state_province: profile.profile?.state_province || '',
      city: profile.profile?.city || '',
      address: profile.profile?.address || '',
      postal_code: profile.profile?.postal_code || '',
      phone_number: profile.profile?.phone_number || '',
      t_shirt_size: normalizeTShirtSize(profile.profile?.t_shirt_size),
      job_title: profile.profile?.job_title || '',
      organization: profile.profile?.organization || '',
    });

    this.selectedCountrySignal.set(countryValue);
  }

  private initVerifiedEmails(): Signal<UserEmail[]> {
    return computed(() => this.emails().filter((e) => e.verified));
  }

  private initOrganizationOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const seen = new Set<string>();
      const options: { label: string; value: string }[] = [];

      for (const entry of this.workExperiences()) {
        const name = entry.organization?.trim();
        if (!name) {
          continue;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        options.push({ label: name, value: name });
      }

      // Keep the currently-saved organization selectable even if it's no longer backed by a
      // work-history entry (e.g. the entry was deleted). value matches the form control value
      // (patched from the saved metadata) so it stays selected; once the user picks another org
      // it won't be re-added to the list.
      const savedOrgRaw = this.combinedProfile.profile?.organization ?? '';
      const savedOrg = savedOrgRaw.trim();
      if (savedOrg && !seen.has(savedOrg.toLowerCase())) {
        options.unshift({ label: savedOrg, value: savedOrgRaw });
      }

      return options;
    });
  }
}
