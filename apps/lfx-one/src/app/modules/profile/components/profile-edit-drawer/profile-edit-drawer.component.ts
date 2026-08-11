// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, output, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  ALLOWED_AVATAR_MIME_TYPES,
  COUNTRIES,
  MAX_AVATAR_SIZE_BYTES,
  normalizeTShirtSize,
  PENDING_PROFILE_SAVE_KEY,
  PROFILE_BIO_MAX_LENGTH,
  TSHIRT_SIZES,
  US_STATES,
} from '@lfx-one/shared/constants';
import { CombinedProfile, ProfileUpdateRequest, UserEmail, UserMetadata, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { stripAuthPrefixOrNull } from '@app/shared/utils/strip-auth-prefix.util';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, filter, finalize, of, switchMap } from 'rxjs';

import { ProfileEditDrawerService } from './profile-edit-drawer.service';

/**
 * Right-side Profile & Account edit drawer (LFXV2-2742), replacing the former edit dialog. Opened via
 * {@link ProfileEditDrawerService}; ProfileLayoutComponent hosts one instance and applies the
 * optimistic update from the {@link saved} output. The form and save behaviour are a faithful port of
 * the retired ProfileEditDialogComponent, including the Flow C (management-token) redirect.
 */
@Component({
  selector: 'lfx-profile-edit-drawer',
  imports: [DrawerModule, ReactiveFormsModule, InputTextComponent, SelectComponent, TextareaComponent, ButtonComponent],
  templateUrl: './profile-edit-drawer.component.html',
  styleUrl: './profile-edit-drawer.component.scss',
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

  // Bio length cap, shared with the server validator so the template maxlength stays in sync.
  protected readonly bioMaxLength = PROFILE_BIO_MAX_LENGTH;

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
    bio: ['', [Validators.maxLength(PROFILE_BIO_MAX_LENGTH)]],
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

  // True while any drawer mutation is in flight (profile save, primary-email PUT, or avatar
  // upload). Every dismissal and save path gates on this so an in-flight change can't be
  // interrupted or left stale by a close/reopen — see onVisibleChange and the drawer template.
  public readonly busy = computed(() => this.saving() || this.savingPrimaryEmail() || this.avatarUploading());

  // Avatar signals
  private readonly avatarInput = viewChild<ElementRef<HTMLInputElement>>('avatarInput');
  public readonly avatarUploading = signal(false);
  // The avatar URL that failed to load, if any — mirrors ProfilePanelComponent's fallback pattern
  // so a broken/expired picture URL falls back to initials instead of a broken image icon.
  private readonly avatarErrorUrl = signal<string | null>(null);
  public readonly avatarUrl = computed(() => this.combinedProfile()?.profile?.picture || '');
  public readonly avatarInitials = computed(() => {
    const profile = this.combinedProfile();
    if (!profile) return 'U';
    const cleanUsername = stripAuthPrefixOrNull(profile.user.username);
    return profile.user.first_name?.charAt(0).toUpperCase() || cleanUsername?.charAt(0).toUpperCase() || 'U';
  });
  public readonly showAvatarImage = computed(() => {
    const url = this.avatarUrl();
    return !!url && this.avatarErrorUrl() !== url;
  });

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
    // Fires once per drawer open, with the profile to edit.
    const open$ = toObservable(this.drawer.context).pipe(filter((context): context is CombinedProfile => context !== null));

    // Seed the form synchronously on each open.
    open$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((context) => this.seedForm(context));

    // Reload emails on each open. switchMap cancels a prior open's in-flight request, so a slow
    // earlier response can't overwrite a later one; the state reset also prevents stale rows from
    // lingering when a reload fails.
    open$
      .pipe(
        switchMap(() => {
          this.loadingEmails.set(true);
          this.emails.set([]);
          this.primaryEmail.set('');
          this.selectedPrimaryEmail.set('');
          return this.userService.getUserEmails().pipe(
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load email addresses.' });
              return of(null);
            }),
            finalize(() => this.loadingEmails.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((data) => {
        if (!data) {
          return;
        }
        const primary: UserEmail = { email: data.primary_email, verified: true };
        const alternates = data.alternate_emails.filter((e) => e.email !== data.primary_email);
        this.emails.set([primary, ...alternates]);
        this.primaryEmail.set(data.primary_email);
        this.selectedPrimaryEmail.set(data.primary_email);
      });

    // Reload work-history on each open; switchMap likewise cancels a prior in-flight request.
    // getWorkExperiences() already catches its own errors (returns []) and surfaces its own toast.
    open$
      .pipe(
        switchMap(() => {
          this.loadingWorkExperiences.set(true);
          return this.userService.getWorkExperiences().pipe(finalize(() => this.loadingWorkExperiences.set(false)));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((experiences) => {
        this.workExperiences.set(experiences);
        this.syncOrganizationControl();
      });

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
    // Don't let a dismissal (close icon, backdrop, Esc) close the drawer while any mutation
    // (profile save or primary-email PUT) is in flight.
    if (!visible && !this.busy()) {
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
    const userMetadata = this.buildUserMetadataPayload(this.profileForm.value);

    const updateData: ProfileUpdateRequest = {
      user_metadata: userMetadata as UserMetadata,
    };

    this.userService
      .updateUserProfile(updateData)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false))
      )
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
              // Persist the mapped payload (not the raw form) so the submit-time clear-to-empty decision
              // survives the redirect; the host replays it verbatim (stringify drops undefined keys).
              sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), userMetadata }));
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
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingPrimaryEmail.set(false))
      )
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

  /** Open the OS file picker via the hidden input — keeps the trigger a real, keyboard-operable `<button>`. */
  public triggerAvatarUpload(): void {
    this.avatarInput()?.nativeElement.click();
  }

  /**
   * Validate and upload a newly-selected profile picture. On success, updates the locally-cached
   * profile (so the drawer's own preview reflects the change if reopened) and emits `saved` so the
   * host layout refreshes the avatar shown elsewhere in the Me lens.
   */
  public onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input so re-selecting the same file (e.g. after a rejected upload) still fires change.
    input.value = '';
    if (!file) {
      return;
    }

    if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Please choose a PNG, JPEG, or WEBP image.' });
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Image must be 20MB or smaller.' });
      return;
    }

    this.avatarUploading.set(true);
    // No takeUntilDestroyed here, deliberately: the upload itself (not just its data) is the
    // user-visible operation, and unsubscribing on destroy would abort the underlying HTTP
    // request. uploadProfilePicture() already applies take(1), so this still satisfies the
    // no-bare-subscribe rule without risking a silently-dropped in-flight upload on navigation.
    this.userService
      .uploadProfilePicture(file)
      .pipe(finalize(() => this.avatarUploading.set(false)))
      .subscribe({
        next: (response) => {
          if (!response.public_url) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to upload profile picture. Please try again.' });
            return;
          }

          const url = response.public_url;
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Profile picture updated!' });
          // A null profile means metadata never loaded — merging would fabricate a non-null profile
          // and flip metadataLoaded true, letting a later save wipe unloaded fields. Skip the local
          // preview in that case; the host's own optimistic update (from `saved` below) still refreshes
          // the avatar shown elsewhere in the Me lens.
          this.combinedProfile.update((profile) => (profile?.profile == null ? profile : { ...profile, profile: { ...profile.profile, picture: url } }));
          this.saved.emit({ picture: url });
        },
        error: (error: HttpErrorResponse) => {
          // Flow C: Management token required — redirect to authorize. Unlike onSubmit, the selected
          // File can't be persisted across the full-page redirect (sessionStorage can't hold a File),
          // so the user re-selects and re-uploads after authorizing rather than an auto-resumed upload.
          if (error.status === 403 && error.error?.error === 'management_token_required') {
            if (isPlatformBrowser(this.platformId)) {
              // Stash an avatarPending marker (plus any unsaved text-field edits, mapped the same way
              // onSubmit does) so ProfileLayoutComponent.handleProfileAuthReturn can tell the user to
              // re-select their image once we're back — a toast added here would be wiped by the
              // synchronous window.location.href below before it ever renders. Stashing the mapped
              // payload rather than the raw form keeps clear-to-empty edits intact on replay.
              sessionStorage.setItem(
                PENDING_PROFILE_SAVE_KEY,
                JSON.stringify({
                  savedAt: Date.now(),
                  avatarPending: true,
                  ...(this.profileForm.dirty ? { userMetadata: this.buildUserMetadataPayload(this.profileForm.value) } : {}),
                })
              );
              window.location.href = error.error.authorize_url;
            }
            return;
          }

          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to upload profile picture. Please try again.' });
        },
      });
  }

  /** Handle a failed avatar image load: fall back to initials until the URL changes. */
  public onAvatarError(): void {
    this.avatarErrorUrl.set(this.avatarUrl());
  }

  // Private methods

  // Shared by onSubmit and the avatar-upload Flow C stash above, so both apply the same
  // clear-to-empty rules — stashing the raw form value instead would silently drop intentional
  // clears on replay, since the legacy mapper doesn't know about metadataLoaded/freeText.
  private buildUserMetadataPayload(formValue: Partial<UserMetadata>): Partial<UserMetadata> {
    // Clear-to-empty only applies when the profile metadata loaded — on a failed load (profile ===
    // null) the controls seed empty, so we omit empties rather than wipe unloaded fields with ''.
    const metadataLoaded = this.combinedProfile()?.profile != null;
    const freeText = (value: string | null | undefined): string | undefined => (metadataLoaded ? (value ?? '') : value || undefined);

    // organization_domain is resolved server-side from the organization name, so we only send the
    // organization. Name/selects keep `|| undefined` (empty = unchanged, not clearable per product).
    return {
      given_name: formValue.given_name || undefined,
      family_name: formValue.family_name || undefined,
      job_title: freeText(formValue.job_title),
      organization: formValue.organization || undefined,
      country: formValue.country || undefined,
      state_province: formValue.state_province || undefined,
      city: freeText(formValue.city),
      address: freeText(formValue.address),
      postal_code: freeText(formValue.postal_code),
      phone_number: freeText(formValue.phone_number),
      t_shirt_size: formValue.t_shirt_size || undefined,
      bio: freeText(formValue.bio),
    };
  }

  /** Seed the form from the opened profile and reset its pristine/saving state. */
  private seedForm(profile: CombinedProfile): void {
    this.combinedProfile.set(profile);
    // Clear the prior session's work history so a reopen doesn't surface stale organization options
    // (or enable the control) until the fresh GET lands — mirrors the email reset in the reload pipe.
    this.workExperiences.set([]);
    this.populateForm(profile);
    this.profileForm.markAsPristine();
    this.profileForm.markAsUntouched();
    this.hasChanges.set(false);
    this.saving.set(false);
    this.avatarUploading.set(false);
    this.avatarErrorUrl.set(null);
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
        bio: profile.profile?.bio || '',
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
