// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { COUNTRIES, markFormControlsAsTouched, TSHIRT_SIZES, US_STATES } from '@lfx-one/shared';
import { CombinedProfile, ProfileUpdateRequest, UserMetadata } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, finalize, of, switchMap, tap } from 'rxjs';

import { ProfileNavComponent } from '../components/profile-nav/profile-nav.component';

@Component({
  selector: 'lfx-profile-manage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardComponent,
    InputTextComponent,
    MessageComponent,
    SelectComponent,
    ButtonComponent,
    ToastModule,
    TooltipModule,
    ProfileNavComponent,
  ],
  providers: [MessageService],
  templateUrl: './profile-manage.component.html',
})
export class ProfileManageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  // Refresh mechanism
  private refresh = new BehaviorSubject<void>(undefined);

  // Form state signals
  private readonly loadingSignal = signal<boolean>(false);
  private readonly savingSignal = signal<boolean>(false);
  private readonly selectedCountrySignal = signal<string>('');

  public readonly isLoading = computed(() => this.loadingSignal());
  public readonly isSaving = computed(() => this.savingSignal());

  // Data signals using toSignal with refresh
  public profileData: Signal<CombinedProfile | null>;
  public readonly profile = computed(() => this.profileData());

  // T-shirt size options
  public readonly tshirtSizeOptions = TSHIRT_SIZES.map((size) => ({
    label: size.label,
    value: size.value,
  }));

  // Country options - using country names as values for database compatibility
  public readonly countryOptions = COUNTRIES.map((country: { label: string; value: string }) => ({
    label: country.label,
    value: country.label,
  }));

  // US states options - using state names as values for database compatibility
  public readonly stateOptions = US_STATES.map((state) => ({
    label: state.label,
    value: state.label,
  }));

  // Computed property to check if selected country is USA
  public readonly isUSA = computed(() => {
    return this.selectedCountrySignal() === 'United States';
  });

  // Profile form with backend-aligned field names
  public profileForm: FormGroup = this.fb.group({
    // Direct user fields
    username: [{ value: '', disabled: true }, [Validators.required, Validators.minLength(3), Validators.maxLength(30)]],

    // User metadata fields
    given_name: ['', [Validators.maxLength(50)]],
    family_name: ['', [Validators.maxLength(50)]],
    job_title: ['', [Validators.maxLength(100)]],
    organization: ['', [Validators.maxLength(100)]],
    country: ['', [Validators.maxLength(50)]],
    state_province: ['', [Validators.maxLength(50)]],
    city: ['', [Validators.maxLength(50)]],
    address: ['', [Validators.maxLength(200)]],
    postal_code: ['', [Validators.maxLength(20)]],
    phone_number: ['', [Validators.maxLength(20)]],
    t_shirt_size: ['', []],
  });

  public constructor() {
    this.profileData = this.initializeProfileData();
    // Subscribe to country field changes to update the signal
    this.profileForm
      .get('country')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((country: string) => {
        this.selectedCountrySignal.set(country || '');

        // Clear state_province field when country changes to avoid invalid state/country combinations
        if (country !== 'United States') {
          this.profileForm.get('state_province')?.setValue('');
        }
      });
  }

  public ngOnInit(): void {
    // Profile loads automatically via toSignal
  }

  public onSubmit(): void {
    if (this.profileForm.invalid) {
      markFormControlsAsTouched(this.profileForm);
      return;
    }

    const formValue = this.profileForm.value;
    const currentProfile = this.profile();

    if (!currentProfile) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No profile data available',
      });
      return;
    }

    this.savingSignal.set(true);

    // Build user_metadata only if there are fields to update
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

    // Prepare update data - only send user_metadata
    const updateData: ProfileUpdateRequest = {
      user_metadata: userMetadata as UserMetadata,
    };

    // Update profile via unified endpoint
    this.userService
      .updateUserProfile(updateData)
      .pipe(finalize(() => this.savingSignal.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Profile updated successfully!',
          });

          // Reload profile data
          this.refresh.next();
        },
        error: (error) => {
          console.error('Error saving profile:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to save profile. Please try again.',
          });
        },
      });
  }

  public onReset(): void {
    const currentProfile = this.profile();
    if (currentProfile) {
      this.populateForm(currentProfile);
    }
    this.profileForm.markAsUntouched();
  }

  private initializeProfileData(): Signal<CombinedProfile | null> {
    this.loadingSignal.set(true);
    return toSignal(
      this.refresh.pipe(
        switchMap(() =>
          this.userService.getCurrentUserProfile().pipe(
            tap((profile) => {
              this.populateForm(profile);
            }),
            catchError((error) => {
              console.error('Error loading profile:', error);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load profile data. Please try again.',
              });
              return of(null);
            }),
            finalize(() => this.loadingSignal.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private populateForm(profile: CombinedProfile): void {
    const countryValue = profile.profile?.country || '';

    this.profileForm.patchValue({
      given_name: profile.user.first_name || '',
      family_name: profile.user.last_name || '',
      username: profile.user.username || '',
      job_title: profile.profile?.job_title || '',
      organization: profile.profile?.organization || '',
      country: countryValue,
      state_province: profile.profile?.state_province || '',
      city: profile.profile?.city || '',
      address: profile.profile?.address || '',
      postal_code: profile.profile?.postal_code || '',
      phone_number: profile.profile?.phone_number || '',
      t_shirt_size: profile.profile?.t_shirt_size || '',
    });

    // Set the initial country signal value
    this.selectedCountrySignal.set(countryValue);
  }
}
