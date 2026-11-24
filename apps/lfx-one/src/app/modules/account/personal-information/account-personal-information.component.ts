// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AccountCardComponent } from '@components/account-card/account-card.component';
import {
  ALLOWED_AVATAR_MIME_TYPES,
  COUNTRIES,
  MAX_AVATAR_SIZE_BYTES,
  normalizeTShirtSize,
  PENDING_PRIMARY_EMAIL_KEY,
  PENDING_PRIMARY_EMAIL_TTL_MS,
  PENDING_PROFILE_SAVE_KEY,
  PERSONAL_INFORMATION_COPY,
  PERSONAL_INFORMATION_FIELD_LIMITS,
  PROFILE_BIO_MAX_LENGTH,
  TSHIRT_SIZES,
} from '@lfx-one/shared/constants';
import {
  CombinedProfile,
  PendingPrimaryEmail,
  PendingProfileSave,
  PersonalInformationLimitedField,
  UserEmail,
  UserMetadata,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { capCodePointEdit, codePointLength, markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { AccountProfileService } from '@services/account-profile.service';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { UserService } from '@services/user.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChoiceboxGroupComponent } from '@shared/uikit/choicebox/choicebox-group.component';
import { UiChoiceboxComponent } from '@shared/uikit/choicebox/choicebox.component';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { stripAuthPrefixOrNull } from '@shared/utils/strip-auth-prefix.util';
import { catchError, filter, finalize, map, Observable, of, switchMap, take, tap } from 'rxjs';

const LIMITS = PERSONAL_INFORMATION_FIELD_LIMITS;

/**
 * Account & Settings › Personal information (#6072, behind the profile redesign flag). It holds the fields of the hub's Edit
 * profile drawer, which it replaces, and saves them through the header save bar: the profile fields, then the primary email.
 * A new photo uploads at once, as it does today.
 */
@Component({
  selector: 'lfx-account-personal-information',
  imports: [
    ReactiveFormsModule,
    AccountCardComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiChoiceboxGroupComponent,
    UiChoiceboxComponent,
    UiComboboxComponent,
    UiInputComponent,
    UiNoteComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSkeletonComponent,
    UiTextareaComponent,
    UiTooltipDirective,
  ],
  templateUrl: './account-personal-information.component.html',
})
export class AccountPersonalInformationComponent {
  // Private injections
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly accountProfile = inject(AccountProfileService);
  private readonly unsavedChanges = inject(AccountUnsavedChangesService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly avatarInput = viewChild<ElementRef<HTMLInputElement>>('avatarInput');

  // Forms
  // Each limit mirrors the server's; the company is chosen from the work history.
  public readonly form = this.fb.nonNullable.group({
    given_name: ['', [Validators.maxLength(LIMITS.given_name)]],
    family_name: ['', [Validators.maxLength(LIMITS.family_name)]],
    // A code-point cap, not Validators.maxLength (UTF-16 units), to match the auth-service 2000-rune limit.
    bio: ['', [maxCodePointsValidator(PROFILE_BIO_MAX_LENGTH)]],
    organization: ['', [Validators.maxLength(LIMITS.organization)]],
    job_title: ['', [Validators.maxLength(LIMITS.job_title)]],
    country: ['', [Validators.maxLength(LIMITS.country)]],
    state_province: ['', [Validators.maxLength(LIMITS.state_province)]],
    city: ['', [Validators.maxLength(LIMITS.city)]],
    postal_code: ['', [Validators.maxLength(LIMITS.postal_code)]],
    address: ['', [Validators.maxLength(LIMITS.address)]],
    phone_number: ['', [Validators.maxLength(LIMITS.phone_number)]],
    t_shirt_size: [''],
  });

  // Simple WritableSignals
  public readonly saving = signal(false);
  public readonly avatarUploading = signal(false);
  public readonly bioLength = signal(0);
  public readonly loadingEmails = signal(true);
  public readonly emailsFailed = signal(false);
  public readonly loadingCompanies = signal(true);
  /** The primary email as saved, and the one picked on the page. */
  public readonly primaryEmail = signal('');
  public readonly selectedPrimaryEmail = signal('');
  protected readonly companyQuery = signal('');
  protected readonly countryQuery = signal('');
  private readonly formDirty = signal(false);
  private readonly emails = signal<UserEmail[]>([]);
  private readonly workExperiences = signal<WorkExperienceEntry[]>([]);
  // The last bio within the cap, and the bio the form was seeded with, for the cap in the constructor.
  private lastValidBio = '';
  private seededBio = '';

  protected readonly copy = PERSONAL_INFORMATION_COPY;
  protected readonly bioMaxLength = PROFILE_BIO_MAX_LENGTH;
  protected readonly avatarAccept = ALLOWED_AVATAR_MIME_TYPES.join(',');
  protected readonly countryOptions: string[] = COUNTRIES.map((country) => country.label);
  protected readonly tshirtSizeOptions = TSHIRT_SIZES;

  // Complex computed signals
  public readonly impersonating = this.userService.impersonating;
  public readonly profile: Signal<CombinedProfile | null> = this.accountProfile.profile;
  public readonly profileFailed: Signal<boolean> = computed(() => this.accountProfile.failed() && !this.profile());
  public readonly profileLoading: Signal<boolean> = computed(() => !this.profile() && !this.accountProfile.failed());
  public readonly primaryEmailChanged: Signal<boolean> = computed(() => !!this.selectedPrimaryEmail() && this.selectedPrimaryEmail() !== this.primaryEmail());
  /** Unsaved edits anywhere on the page, for the header save bar and the leave guard. */
  public readonly dirty: Signal<boolean> = computed(() => this.formDirty() || this.primaryEmailChanged());
  public readonly username: Signal<string> = computed(() => stripAuthPrefixOrNull(this.profile()?.user.username) ?? '');
  // The shared avatar (an upload, else the sign-in picture), which a fresh upload updates at once; the avatar falls back to initials.
  public readonly avatarUrl = this.userService.effectiveAvatarUrl;
  public readonly avatarInitials: Signal<string> = this.initAvatarInitials();
  public readonly emailOptions: Signal<UserEmail[]> = this.initEmailOptions();
  /** The address shown as primary: the one picked, or the only one offered when the list could not load. */
  public readonly shownPrimaryEmail: Signal<string> = computed(() => this.selectedPrimaryEmail() || this.emailOptions()[0]?.email || '');
  public readonly companyOptions: Signal<string[]> = this.initCompanyOptions();
  protected readonly companyPlaceholder: Signal<string> = computed(() =>
    this.loadingCompanies() || this.companyOptions().length > 0 ? 'Select your company' : 'No work experience added'
  );
  protected readonly companyEmptyText: Signal<string> = computed(() => `No companies match “${this.companyQuery()}”.`);
  protected readonly countryEmptyText: Signal<string> = computed(() => `No countries match “${this.countryQuery()}”.`);
  // Any value, status or touched change, so the field errors below follow the form.
  private readonly formEvents = toSignal(this.form.events);
  /** The error under each field once it is touched: every limited field has only a length limit. */
  protected readonly fieldErrors: Signal<Partial<Record<PersonalInformationLimitedField, string>>> = this.initFieldErrors();

  public constructor() {
    this.unsavedChanges.register({ dirty: this.dirty, saving: this.saving, save: () => this.save(), revert: () => this.revert() }, this.destroyRef);
    this.accountProfile.load();
    this.loadEmails();
    this.loadCompanies();

    // A profile that lands, or changes after a save, seeds the form unless the user is mid-edit.
    toObservable(this.profile)
      .pipe(
        filter((profile): profile is CombinedProfile => profile !== null),
        takeUntilDestroyed()
      )
      .subscribe((profile) => {
        if (!this.form.dirty) this.seed(profile);
        this.syncEnabled();
      });

    // Editing acts on the real account, so the page is read-only while impersonating.
    toObservable(this.impersonating)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncEnabled());

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formDirty.set(this.form.dirty));

    // Caps the bio by code point; an over-cap edit keeps only what fits, clipped where the edit was made.
    this.form.controls.bio.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const bio = value ?? '';
      if (codePointLength(bio) <= this.bioMaxLength) {
        this.lastValidBio = bio;
        this.bioLength.set(codePointLength(bio));
        return;
      }
      const capped = capCodePointEdit(this.lastValidBio, bio, this.bioMaxLength);
      this.form.controls.bio.setValue(capped, { emitEvent: false });
      this.lastValidBio = capped;
      this.bioLength.set(codePointLength(capped));
      // A fully rejected edit leaves the seeded bio, which is not a change.
      if (capped === this.seededBio) this.form.controls.bio.markAsPristine();
      this.formDirty.set(this.form.dirty);
    });
  }

  public save(): void {
    if (this.saving() || this.impersonating() || !this.dirty()) return;
    if (this.form.invalid) {
      markFormControlsAsTouched(this.form);
      return;
    }

    const metadata = this.form.dirty ? this.buildUserMetadataPayload() : null;
    const primary = this.primaryEmailChanged() ? this.selectedPrimaryEmail() : null;
    let savingPrimary = false;

    this.saving.set(true);
    // Locked while saving, so nothing typed now is lost when the saved values become the baseline.
    this.form.disable({ emitEvent: false });
    const saveProfile$: Observable<unknown> = metadata ? this.userService.updateUserProfile({ user_metadata: metadata as UserMetadata }) : of(null);
    saveProfile$
      .pipe(
        tap(() => metadata && this.onProfileSaved(metadata)),
        switchMap(() => {
          if (!primary) return of(null);
          savingPrimary = true;
          return this.userService.setPrimaryEmail(primary).pipe(tap(() => this.primaryEmail.set(primary)));
        }),
        take(1),
        finalize(() => {
          this.saving.set(false);
          this.syncEnabled();
        })
      )
      // Not tied to the page: a save that has started finishes even if the user leaves.
      .subscribe({
        next: () => this.toast.show({ variant: 'dark', message: this.copy.saved }),
        error: (error: HttpErrorResponse) => (savingPrimary ? this.onPrimaryEmailError(error, primary) : this.onProfileError(error, metadata ?? {}, primary)),
      });
  }

  public revert(): void {
    const profile = this.profile();
    if (profile) this.seed(profile);
    this.selectedPrimaryEmail.set(this.primaryEmail());
  }

  protected onSelectPrimaryEmail(email: string | null): void {
    if (email) this.selectedPrimaryEmail.set(email);
  }

  /** Opens the file picker through the hidden input, so the trigger stays a real button. */
  protected triggerAvatarUpload(): void {
    this.avatarInput()?.nativeElement.click();
  }

  protected onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared so choosing the same file again, after a rejected upload, still fires change.
    input.value = '';
    if (!file || this.impersonating()) return;

    if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      this.toast.show({ variant: 'error', message: 'Please choose a PNG, JPEG, or WEBP image.' });
      return;
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      this.toast.show({ variant: 'error', message: 'Image must be 2MB or smaller.' });
      return;
    }

    this.avatarUploading.set(true);
    // Not tied to the page: the upload is what the user asked for, so leaving must not drop it. The service takes one value.
    this.userService
      .uploadProfilePicture(file)
      .pipe(finalize(() => this.avatarUploading.set(false)))
      .subscribe({
        next: (response) => {
          if (!response.public_url) {
            this.toast.show({ variant: 'error', message: 'Failed to upload profile picture. Please try again.' });
            return;
          }
          this.accountProfile.applySaved({ picture: response.public_url });
          this.toast.show({ variant: 'dark', message: 'Profile picture updated' });
        },
        error: (error: HttpErrorResponse) => {
          // Flow C: a File can't survive the redirect, so the user picks it again once back; unsaved field edits go along.
          const pending = this.form.dirty ? { userMetadata: this.buildUserMetadataPayload() } : {};
          if (this.redirectForAuthorization(error, { avatarPending: true, ...pending }, null)) return;
          if (this.toastIfImpersonationReadOnly(error)) return;
          this.toast.show({ variant: 'error', message: 'Failed to upload profile picture. Please try again.' });
        },
      });
  }

  protected retryProfile(): void {
    this.accountProfile.load();
  }

  // Private initializer functions
  private initFieldErrors(): Signal<Partial<Record<PersonalInformationLimitedField, string>>> {
    return computed(() => {
      this.formEvents();
      const errors: Partial<Record<PersonalInformationLimitedField, string>> = {};
      for (const [name, limit] of Object.entries(LIMITS) as [PersonalInformationLimitedField, number][]) {
        const control = this.form.controls[name];
        if (control.invalid && control.touched) errors[name] = `Must be ${limit} characters or fewer`;
      }
      return errors;
    });
  }

  private initAvatarInitials(): Signal<string> {
    return computed(() => {
      const user = this.profile()?.user;
      return user?.first_name?.charAt(0).toUpperCase() || stripAuthPrefixOrNull(user?.username)?.charAt(0).toUpperCase() || 'U';
    });
  }

  // Verified addresses, primary first. With none to choose from, the sign-in address stands alone.
  private initEmailOptions(): Signal<UserEmail[]> {
    return computed(() => {
      const verified = this.emails().filter((email) => email.verified);
      if (verified.length > 0) return verified;
      const signInEmail = this.profile()?.user.email;
      return signInEmail ? [{ email: signInEmail, verified: false }] : [];
    });
  }

  // Companies from the work history, once each ignoring case, with the saved company first when no entry backs it any more.
  private initCompanyOptions(): Signal<string[]> {
    return computed(() => {
      const seen = new Set<string>();
      const options: string[] = [];
      for (const entry of this.workExperiences()) {
        const name = entry.organization?.trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        options.push(name);
      }
      const saved = (this.profile()?.profile?.organization ?? '').trim();
      if (saved && !seen.has(saved.toLowerCase())) options.unshift(saved);
      return options;
    });
  }

  // Private helper methods
  private loadEmails(): void {
    this.userService
      .getUserEmails()
      .pipe(
        map((data) => {
          const alternates = data.alternate_emails.filter((email) => email.email !== data.primary_email);
          return { primary: data.primary_email, emails: [{ email: data.primary_email, verified: true }, ...alternates] };
        }),
        catchError((error: unknown) => {
          console.error('Failed to load email addresses for Personal information:', error);
          this.emailsFailed.set(true);
          this.toast.show({ variant: 'error', message: 'Failed to load email addresses.' });
          return of(null);
        }),
        finalize(() => this.loadingEmails.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (!result) return;
        this.emails.set(result.emails);
        this.primaryEmail.set(result.primary);
        this.selectedPrimaryEmail.set(result.primary);
        this.restorePendingPrimaryEmail();
      });
  }

  // getWorkExperiences shows its own error and returns no entries.
  private loadCompanies(): void {
    this.userService
      .getWorkExperiences()
      .pipe(
        finalize(() => this.loadingCompanies.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((entries) => {
        this.workExperiences.set(entries);
        this.syncCompanyControl();
      });
  }

  private seed(profile: CombinedProfile): void {
    const details = profile.profile;
    this.form.reset(
      {
        given_name: profile.user.first_name || '',
        family_name: profile.user.last_name || '',
        bio: details?.bio || '',
        // Trimmed to match the trimmed company options.
        organization: (details?.organization || '').trim(),
        job_title: details?.job_title || '',
        country: details?.country || '',
        state_province: details?.state_province || '',
        city: details?.city || '',
        postal_code: details?.postal_code || '',
        address: details?.address || '',
        phone_number: details?.phone_number || '',
        t_shirt_size: normalizeTShirtSize(details?.t_shirt_size),
      },
      { emitEvent: false }
    );
    this.seededBio = details?.bio || '';
    this.lastValidBio = this.seededBio;
    this.bioLength.set(codePointLength(this.seededBio));
    this.formDirty.set(false);
    this.syncCompanyControl();
  }

  // Editable once the profile has loaded, and never while impersonating.
  private syncEnabled(): void {
    if (this.impersonating() || !this.profile()) {
      this.form.disable({ emitEvent: false });
      return;
    }
    this.form.enable({ emitEvent: false });
    this.syncCompanyControl();
  }

  // The company list comes only from the work history, so with no companies the field stays disabled. A saved company that
  // differs only in case is matched to its option, so it shows as chosen.
  private syncCompanyControl(): void {
    const control = this.form.controls.organization;
    if (this.impersonating() || !this.profile() || this.companyOptions().length === 0) {
      control.disable({ emitEvent: false });
      return;
    }
    control.enable({ emitEvent: false });
    const current = control.value;
    const match = current ? this.companyOptions().find((option) => option.toLowerCase() === current.toLowerCase()) : undefined;
    if (match && match !== current) control.setValue(match, { emitEvent: false });
  }

  // After a save, the saved values become the form's baseline and reach the rest of the app.
  private onProfileSaved(metadata: Partial<UserMetadata>): void {
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.seededBio = this.form.controls.bio.value;
    this.formDirty.set(false);
    this.accountProfile.applySaved(metadata);
  }

  private onProfileError(error: HttpErrorResponse, metadata: Partial<UserMetadata>, primary: string | null): void {
    if (this.redirectForAuthorization(error, { userMetadata: metadata }, primary)) return;
    if (this.toastIfImpersonationReadOnly(error)) return;
    this.toast.show({ variant: 'error', message: 'Failed to save your personal information. Please try again.' });
  }

  // The fields have saved by now; the email choice stays on the page to try again.
  private onPrimaryEmailError(error: HttpErrorResponse, primary: string | null): void {
    if (this.redirectForAuthorization(error, null, primary)) return;
    if (this.toastIfImpersonationReadOnly(error)) return;
    // The server's reason, such as a change blocked because the meeting-invite address could not be kept.
    this.toast.show({ variant: 'error', message: extractErrorMessage(error, 'Failed to update primary email. Please try again.') });
  }

  /**
   * Flow C: the change needs a management token. Unsaved fields are kept for the account shell to replay and the primary email
   * choice for this page to restore once the user is back, then the browser goes to authorize. Returns false for any other error.
   */
  private redirectForAuthorization(error: HttpErrorResponse, pending: Omit<PendingProfileSave, 'savedAt'> | null, primary: string | null): boolean {
    if (error.status !== 403 || error.error?.error !== 'management_token_required') return false;
    if (isPlatformBrowser(this.platformId)) {
      const savedAt = Date.now();
      if (pending) sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt, ...pending } satisfies PendingProfileSave));
      if (primary) sessionStorage.setItem(PENDING_PRIMARY_EMAIL_KEY, JSON.stringify({ savedAt, email: primary } satisfies PendingPrimaryEmail));
      window.location.href = error.error.authorize_url;
    }
    return true;
  }

  // Picks again a primary email chosen before a Flow C redirect, so Save finishes the change. Only a recent, verified choice counts.
  private restorePendingPrimaryEmail(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const stored = sessionStorage.getItem(PENDING_PRIMARY_EMAIL_KEY);
    if (!stored) return;
    sessionStorage.removeItem(PENDING_PRIMARY_EMAIL_KEY);
    try {
      const pending = JSON.parse(stored) as Partial<PendingPrimaryEmail>;
      const fresh = typeof pending.savedAt === 'number' && Date.now() - pending.savedAt <= PENDING_PRIMARY_EMAIL_TTL_MS;
      if (fresh && !this.impersonating() && this.emailOptions().some((option) => option.email === pending.email)) {
        this.selectedPrimaryEmail.set(pending.email as string);
      }
    } catch {
      return;
    }
  }

  private toastIfImpersonationReadOnly(error: HttpErrorResponse): boolean {
    if (error.status !== 403 || error.error?.code !== 'IMPERSONATION_READ_ONLY') return false;
    this.toast.show({ variant: 'error', message: 'Profile editing is unavailable while impersonating another user.' });
    return true;
  }

  // Free-text fields may be cleared, but only once the stored profile has loaded: with no record, an empty field is left out
  // rather than wiping a value never shown. Names and choices are never cleared. The server derives the company domain.
  private buildUserMetadataPayload(): Partial<UserMetadata> {
    const value = this.form.getRawValue();
    const metadataLoaded = this.profile()?.profile != null;
    const freeText = (text: string): string | undefined => (metadataLoaded ? text : text || undefined);
    return {
      given_name: value.given_name || undefined,
      family_name: value.family_name || undefined,
      job_title: freeText(value.job_title),
      organization: value.organization || undefined,
      country: value.country || undefined,
      state_province: freeText(value.state_province),
      city: freeText(value.city),
      address: freeText(value.address),
      postal_code: freeText(value.postal_code),
      phone_number: freeText(value.phone_number),
      t_shirt_size: value.t_shirt_size || undefined,
      bio: freeText(value.bio),
    };
  }
}
