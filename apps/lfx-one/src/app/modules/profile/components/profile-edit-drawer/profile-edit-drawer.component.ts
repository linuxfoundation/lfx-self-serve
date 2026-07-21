// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, output, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COUNTRIES, normalizeTShirtSize, PENDING_PROFILE_SAVE_KEY, TSHIRT_SIZES, US_STATES } from '@lfx-one/shared/constants';
import { CombinedProfile, ProfileUpdateRequest, UserEmail, UserMetadata, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { stripAuthPrefixOrNull } from '@app/shared/utils/strip-auth-prefix.util';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { filter, finalize } from 'rxjs';

import { ProfileEditDrawerService } from './profile-edit-drawer.service';

/**
 * Right-side Profile & Account edit drawer (LFXV2-2742), replacing the former edit dialog. Opened via
 * {@link ProfileEditDrawerService}; ProfileLayoutComponent hosts one instance and applies the
 * optimistic update from the {@link saved} output. The form and save behaviour are a faithful port of
 * the retired ProfileEditDialogComponent, including the Flow C (management-token) redirect.
 */
@Component({
  selector: 'lfx-profile-edit-drawer',
  imports: [DrawerModule, ReactiveFormsModule, InputTextComponent, SelectComponent, ButtonComponent],
  templateUrl: './profile-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileEditDrawerComponent {
  // Private injections
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly drawer = inject(ProfileEditDrawerService);

  // Emits the saved metadata so the host layout can apply an optimistic profile update.
  public readonly saved = output<Partial<UserMetadata>>();

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
    // Organization is selected from work-history orgs (a constrained list); the only remaining
    // guard mirrors the backend limit (user.service.ts rejects organization > 200 chars).
    organization: ['', [Validators.maxLength(200)]],
  });

  // The profile currently being edited (seeded on each open). A signal so the computeds that read it
  // (authEmail, organizationOptions) recompute when a new profile is opened.
  private readonly combinedProfile = signal<CombinedProfile | null>(null);

  // Form state signals
  public readonly saving = signal(false);
  public readonly hasChanges = signal(false);
  private readonly selectedCountrySignal = signal('');

  // Email signals
  public readonly emails = signal<UserEmail[]>([]);
  public readonly primaryEmail = signal('');
  public readonly loadingEmails = signal(true);
  public readonly selectedPrimaryEmail = signal('');
  public readonly savingPrimaryEmail = signal(false);
  public readonly verifiedEmails: Signal<UserEmail[]> = computed(() => this.emails().filter((e) => e.verified));
  public readonly hasManagedEmails: Signal<boolean> = computed(() => this.verifiedEmails().length > 0);
  public readonly authEmail = computed(() => this.combinedProfile()?.user.email ?? '');

  // Organization (work-history-derived) signals
  public readonly loadingWorkExperiences = signal(true);
  private readonly workExperiences = signal<WorkExperienceEntry[]>([]);
  public readonly organizationOptions: Signal<{ label: string; value: string }[]> = this.initOrganizationOptions();
  public readonly hasOrganizationOptions: Signal<boolean> = computed(() => this.organizationOptions().length > 0);

  // Country/state/t-shirt options
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

  public readonly isUSA = computed(() => this.selectedCountrySignal() === 'United States');

  public constructor() {
    // Seed and (re)load whenever the drawer opens with a fresh profile context.
    toObservable(this.drawer.context)
      .pipe(
        filter((context): context is CombinedProfile => context !== null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((context) => this.onOpen(context));

    this.profileForm
      .get('country')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((country: string) => {
        this.selectedCountrySignal.set(country || '');
        if (country !== 'United States') {
          this.profileForm.get('state_province')?.setValue('');
        }
      });

    this.profileForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.hasChanges.set(this.profileForm.dirty);
    });
  }

  public onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.drawer.close();
    }
  }

  public onCancel(): void {
    this.drawer.close();
  }

  public onSubmit(): void {
    if (this.profileForm.invalid) {
      markFormControlsAsTouched(this.profileForm);
      return;
    }

    this.saving.set(true);
    const formValue = this.profileForm.value;

    // organization_domain is resolved server-side from the organization name on every save path,
    // so the drawer only needs to send the selected organization here.
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
          // Hand the saved metadata to the host so it can update its cached profile optimistically.
          // The profile GET is eventually consistent, so an immediate refetch can read stale data.
          this.saved.emit(userMetadata);
          this.drawer.close();
        },
        error: (error: HttpErrorResponse) => {
          // Flow C: Management token required — save form state and redirect to authorize.
          if (error.status === 403 && error.error?.error === 'management_token_required') {
            // Guard the browser-only APIs for SSR safety. This handler only runs on a user-initiated
            // save (browser), but the guard keeps the reference SSR-safe per .claude/rules/ssr-safety.md.
            if (isPlatformBrowser(this.platformId)) {
              // Stamp with a timestamp so the host shell can discard a stale pending-save if this
              // authorization is abandoned (see ProfileLayoutComponent.handleProfileAuthReturn TTL guard).
              sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), form: this.profileForm.value }));
              window.location.href = error.error.authorize_url;
            }
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

  // Private methods

  /** Seed the form from the opened profile and (re)load emails + work-history each open. */
  private onOpen(profile: CombinedProfile): void {
    this.combinedProfile.set(profile);
    this.populateForm(profile);
    this.profileForm.markAsPristine();
    this.profileForm.markAsUntouched();
    this.hasChanges.set(false);
    this.saving.set(false);
    this.loadEmails();
    this.loadWorkExperiences();
  }

  private loadEmails(): void {
    this.loadingEmails.set(true);
    this.userService
      .getUserEmails()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
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
  }

  private loadWorkExperiences(): void {
    this.loadingWorkExperiences.set(true);
    // getWorkExperiences() already catches errors (returns []) and surfaces its own toast,
    // so a dedicated error handler here would be unreachable. A currently-saved organization
    // still shows as a selectable option via organizationOptions() when the list is empty.
    this.userService
      .getWorkExperiences()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingWorkExperiences.set(false))
      )
      .subscribe((experiences) => {
        this.workExperiences.set(experiences);
        this.syncOrganizationControl();
      });
  }

  private populateForm(profile: CombinedProfile): void {
    const countryValue = profile.profile?.country || '';

    // emitEvent: false — the country control's valueChanges handler (which clears state_province for
    // non-US countries) is already wired, so a plain patch would wipe a just-seeded state value.
    this.profileForm.patchValue(
      {
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
        // Trim so the form value matches the trimmed option values — otherwise a legacy saved
        // org with stray whitespace would fail to match any option and render an empty selection.
        organization: (profile.profile?.organization || '').trim(),
      },
      { emitEvent: false }
    );

    this.selectedCountrySignal.set(countryValue);
    this.syncOrganizationControl();
  }

  /**
   * Once work-history options are known, align the organization control to them:
   * - if there are options, enable the control and reconcile the saved value's casing to the
   *   matching option (the saved value may differ only in case, which would otherwise leave the
   *   select with no matching option and render blank);
   * - if there are none, disable the control via the reactive form (rather than a [disabled]
   *   attribute, which warns when combined with formControlName).
   */
  private syncOrganizationControl(): void {
    const control = this.profileForm.get('organization');
    if (!control) {
      return;
    }

    if (!this.hasOrganizationOptions()) {
      control.disable({ emitEvent: false });
      return;
    }

    control.enable({ emitEvent: false });

    const current = control.value;
    if (current) {
      const match = this.organizationOptions().find((option) => option.value.toLowerCase() === current.toLowerCase());
      if (match && match.value !== current) {
        control.setValue(match.value, { emitEvent: false });
      }
    }
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
      // (patched from the saved metadata) so it stays selected.
      const savedOrg = (this.combinedProfile()?.profile?.organization ?? '').trim();
      if (savedOrg && !seen.has(savedOrg.toLowerCase())) {
        options.unshift({ label: savedOrg, value: savedOrg });
      }

      return options;
    });
  }
}
