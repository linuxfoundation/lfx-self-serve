// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { COUNTRIES, TSHIRT_SIZES, US_STATES } from '@lfx-one/shared';
import { CombinedProfile, UpdateProfileDetailsRequest, UpdateUserProfileRequest } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { InputTextComponent } from '@shared/components/input-text/input-text.component';
import { MessageComponent } from '@shared/components/message/message.component';
import { SelectComponent } from '@shared/components/select/select.component';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, finalize, forkJoin, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-profile-edit',
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
  ],
  providers: [MessageService],
  templateUrl: './profile-edit.component.html',
})
export class ProfileEditComponent implements OnInit {
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

  // Profile form
  public profileForm: FormGroup = this.fb.group({
    // User table fields
    first_name: ['', [Validators.maxLength(50)]],
    last_name: ['', [Validators.maxLength(50)]],
    username: [{ value: '', disabled: true }, [Validators.required, Validators.minLength(3), Validators.maxLength(30)]],

    // Profile table fields
    title: ['', [Validators.maxLength(100)]],
    organization: ['', [Validators.maxLength(100)]],
    country: ['', [Validators.maxLength(50)]],
    state: ['', [Validators.maxLength(50)]],
    city: ['', [Validators.maxLength(50)]],
    address: ['', [Validators.maxLength(200)]],
    zipcode: ['', [Validators.maxLength(20)]],
    phone_number: ['', [Validators.maxLength(20)]],
    tshirt_size: ['', []],
  });

  public constructor() {
    this.profileData = this.initializeProfileData();
    // Subscribe to country field changes to update the signal
    this.profileForm
      .get('country')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((country: string) => {
        this.selectedCountrySignal.set(country || '');

        // Clear state field when country changes to avoid invalid state/country combinations
        if (country !== 'United States') {
          this.profileForm.get('state')?.setValue('');
        }
      });
  }

  public ngOnInit(): void {
    // Profile loads automatically via toSignal
  }

  public onSubmit(): void {
    if (this.profileForm.invalid) {
      this.markFormGroupTouched(this.profileForm);
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

    // Prepare user update data
    const userUpdate: UpdateUserProfileRequest = {
      first_name: formValue.first_name || null,
      last_name: formValue.last_name || null,
      username: formValue.username || null,
    };

    // Prepare profile update data
    const profileUpdate: UpdateProfileDetailsRequest = {
      title: formValue.title || null,
      organization: formValue.organization || null,
      country: formValue.country || null,
      state: formValue.state || null,
      city: formValue.city || null,
      address: formValue.address || null,
      zipcode: formValue.zipcode || null,
      phone_number: formValue.phone_number || null,
      tshirt_size: formValue.tshirt_size || null,
    };

    // Update both user and profile data in parallel using forkJoin
    forkJoin([this.userService.updateUserInfo(userUpdate), this.userService.updateProfileDetails(profileUpdate)])
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
      // User fields
      first_name: profile.user.first_name || '',
      last_name: profile.user.last_name || '',
      username: profile.user.username || '',

      // Profile fields
      title: profile.profile?.title || '',
      organization: profile.profile?.organization || '',
      country: countryValue,
      state: profile.profile?.state || '',
      city: profile.profile?.city || '',
      address: profile.profile?.address || '',
      zipcode: profile.profile?.zipcode || '',
      phone_number: profile.profile?.phone_number || '',
      tshirt_size: profile.profile?.tshirt_size || '',
    });

    // Set the initial country signal value
    this.selectedCountrySignal.set(countryValue);
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((field) => {
      const control = formGroup.get(field);
      control?.markAsTouched({ onlySelf: true });
    });
  }
}
