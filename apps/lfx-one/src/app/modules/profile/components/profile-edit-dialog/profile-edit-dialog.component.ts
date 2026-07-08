// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COUNTRIES, normalizeTShirtSize, TSHIRT_SIZES, US_STATES } from '@lfx-one/shared';
import { CombinedProfile, ProfileUpdateRequest, UserEmail, UserMetadata, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { OrganizationService } from '@services/organization.service';
import { UserService } from '@services/user.service';
import { stripAuthPrefixOrNull } from '@app/shared/utils/strip-auth-prefix.util';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, finalize, forkJoin, map, of, take } from 'rxjs';

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
  private readonly organizationService = inject(OrganizationService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

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
  // Canonical CDP domain per work-history org, prefetched once the options load, keyed by
  // lowercased org name. An empty-string value means CDP confirmed no domain for that org
  // (found-without-domain, or no match) and is used to clear a stale organization_domain on save.
  // Orgs whose lookup errored are deliberately absent so the save leaves their domain untouched.
  private readonly organizationDomains = signal<Map<string, string>>(new Map());
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
    // Organization is selected from work-history orgs (a constrained list); the only remaining
    // guard mirrors the backend limit (user.service.ts rejects organization > 200 chars).
    organization: ['', [Validators.maxLength(200)]],
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
      // getWorkExperiences() already catches errors (returns []) and surfaces its own toast,
      // so a dedicated error handler here would be unreachable. A currently-saved organization
      // still shows as a selectable option via organizationOptions() when the list is empty.
      .subscribe((experiences) => {
        this.workExperiences.set(experiences);
        this.syncOrganizationControl();
        this.prefetchOrganizationDomains(experiences);
      });
  }

  public onSubmit(): void {
    if (this.profileForm.invalid) {
      markFormControlsAsTouched(this.profileForm);
      return;
    }

    this.saving.set(true);
    const formValue = this.profileForm.value;
    const organizationName = (formValue.organization || '').trim();

    // Resolve the selected org's canonical domain from the prefetched work-history map (no
    // save-time network call). A mapped empty string clears any stale organization_domain when
    // CDP has no domain for the org; an org missing from the map (e.g. a legacy saved org not in
    // work history, or a prefetch still in flight) leaves organization_domain untouched.
    const orgKey = organizationName.toLowerCase();
    const domains = this.organizationDomains();
    const organizationDomain = organizationName && domains.has(orgKey) ? domains.get(orgKey) : undefined;

    const userMetadata: Partial<UserMetadata> = {
      given_name: formValue.given_name || undefined,
      family_name: formValue.family_name || undefined,
      job_title: formValue.job_title || undefined,
      organization: formValue.organization || undefined,
      organization_domain: organizationDomain,
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
      .pipe(
        take(1),
        finalize(() => this.saving.set(false))
      )
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
      // Trim so the form value matches the trimmed option values — otherwise a legacy saved
      // org with stray whitespace would fail to match any option and render an empty selection.
      organization: (profile.profile?.organization || '').trim(),
    });

    this.selectedCountrySignal.set(countryValue);
  }

  private initVerifiedEmails(): Signal<UserEmail[]> {
    return computed(() => this.emails().filter((e) => e.verified));
  }

  /**
   * Prefetch the canonical CDP domain for every unique work-history org so the save flow can read
   * it synchronously (no lookup between selection and the auth-service update). Runs in parallel
   * across the deduplicated org names.
   *
   * A resolved lookup maps to the org's domain, or '' when CDP confirms no domain (found-without-
   * domain or no match) — that '' is the explicit clear value on save. A lookup that errors maps to
   * null and is filtered out entirely, so a transient CDP failure leaves organization_domain
   * untouched rather than destructively clearing a previously-stored valid domain.
   */
  private prefetchOrganizationDomains(experiences: WorkExperienceEntry[]): void {
    const uniqueNames = Array.from(new Set(experiences.map((entry) => entry.organization?.trim()).filter((name): name is string => !!name)));

    if (uniqueNames.length === 0) {
      return;
    }

    forkJoin(
      uniqueNames.map((name) =>
        this.organizationService.lookupOrganizationByName(name).pipe(
          map((org) => [name.toLowerCase(), org?.domain || ''] as const),
          catchError(() => of(null))
        )
      )
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entries) => {
        this.organizationDomains.set(new Map(entries.filter((entry): entry is [string, string] => entry !== null)));
      });
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
      // (patched from the saved metadata) so it stays selected. savedOrg is captured from the
      // CombinedProfile at dialog open and doesn't change during the session, so this option
      // persists for the dialog's lifetime; it's dropped on the next open once the saved org is
      // one of the work-history entries.
      const savedOrg = (this.combinedProfile.profile?.organization ?? '').trim();
      if (savedOrg && !seen.has(savedOrg.toLowerCase())) {
        options.unshift({ label: savedOrg, value: savedOrg });
      }

      return options;
    });
  }
}
