// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MessageComponent } from '@components/message/message.component';
import { TokenRevealDialogComponent } from '@components/token-reveal-dialog/token-reveal-dialog.component';
import { markFormControlsAsTouched } from '@lfx-one/shared';
import { MEETING_INVITE_PRIMARY_SENTINEL } from '@lfx-one/shared/constants';
import { emailsEqual } from '@lfx-one/shared/utils';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { ActivatedRoute } from '@angular/router';
import { useResendCooldown } from '@shared/utils/resend-cooldown';
import { clearPendingProfileSave } from '@shared/utils/pending-profile-save.util';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { ChangePasswordRequest, EmailManagementData, EmailSettingsState, MeetingInviteEmail, PasswordStrength, UserEmail } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, catchError, finalize, forkJoin, Observable, of, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-account-settings',
  host: { class: 'block' },
  imports: [
    NgClass,
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    InputTextComponent,
    MenuComponent,
    MessageComponent,
    OpenIntercomDirective,
    ConfirmDialogModule,
    ToastModule,
    TooltipModule,
    DynamicDialogModule,
  ],
  providers: [ConfirmationService, MessageService, DialogService],
  templateUrl: './account-settings.component.html',
})
export class AccountSettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  // Read-only when impersonating — account mutations act on the real account and are blocked server-side.
  public readonly impersonating = this.userService.impersonating;
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  // Hosted inside the Profile shell (route data `embedded`), which owns the page header.
  public readonly embedded = this.route.snapshot.data['embedded'] === true;

  // ── Refresh mechanisms ──
  private emailRefresh = new BehaviorSubject<void>(undefined);

  // ── Resend cooldown ──
  private resendCooldownUtil = useResendCooldown(this.destroyRef);
  public resendCooldown = this.resendCooldownUtil.cooldown;

  // ── TOC active section ──
  public activeSection = signal('email-settings');
  private scrollSpyObserver?: IntersectionObserver;

  // ══════════════════════════════════════════
  // EMAIL SETTINGS
  // ══════════════════════════════════════════

  // OTP flow state
  public otpStep = signal(false);
  public pendingEmail = signal('');
  public sendingCode = signal(false);
  public verifyingOtp = signal(false);

  // Add email form (step 1: enter email)
  public addEmailForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });

  // OTP form (step 2: enter code)
  public otpForm = new FormGroup({
    otp: new FormControl('', [Validators.required, Validators.pattern(/^\d{6}$/)]),
  });

  // State signals
  public emailLoading = signal(false);

  // Data signals — the address list and the invite preference load as one unit so the row
  // guards never read a half-refreshed pair (see initEmailState).
  private readonly emailState: Signal<EmailSettingsState> = this.initEmailState();

  public emailData: Signal<EmailManagementData | null> = computed(() => this.emailState().emails);

  // Preferred meeting-invitation email (meeting-service). Null address = no override (uses primary).
  public meetingInviteData: Signal<MeetingInviteEmail | null> = computed(() => this.emailState().invite);
  public meetingInviteEmail = computed((): string | null => this.meetingInviteData()?.email ?? null);

  // Inline banner for a meeting-invite validation failure (the address isn't an active, verified
  // record upstream). Held in a signal rather than a toast so it can host a "contact support" link.
  public meetingInviteError = signal<string | null>(null);

  // Serializes meeting-invite writes. The upstream SET can take up to 20s
  // (NATS_CONFIG.MEETING_PREFERENCE_SET_TIMEOUT) — long enough to pick a second row mid-flight and
  // have two independent PUTs land out of order, leaving the losing address selected.
  public savingMeetingInvite = signal(false);

  public allEmails = computed((): UserEmail[] => {
    const data = this.emailData();
    if (!data) return [];
    const primary: UserEmail = { email: data.primary_email, verified: true };
    const alternates = (data.alternate_emails ?? []).filter((e) => !emailsEqual(e.email, data.primary_email));
    return [primary, ...alternates];
  });

  public emailsWithMetadata = computed(() => {
    const inviteEmail = this.meetingInviteEmail();
    const primaryEmail = this.emailData()?.primary_email;
    return this.allEmails().map((email) => {
      const isPrimary = emailsEqual(email.email, primaryEmail);
      // Explicit selection — drives the badge, which only appears once the user has chosen.
      const isMeetingInvite = emailsEqual(email.email, inviteEmail);
      // The primary row's action is "reset to default", which is meaningful whenever an override
      // exists — including one pinned to the primary address, since clearing it lets invitations
      // follow a later primary change. Other rows offer "use this address" until they are the override.
      const canReset = inviteEmail !== null;
      return {
        ...email,
        isPrimary,
        isMeetingInvite,
        canDelete: this.allEmails().length > 1 && !isPrimary && !!email.user_id,
        canSetPrimary: !isPrimary && email.verified,
        canSetMeetingInvite: email.verified && (isPrimary ? canReset : !isMeetingInvite),
      };
    });
  });

  // Per-row action menu (kebab). Keyed by email address so each row resolves its own items.
  public menuItemsMap: Signal<Map<string, MenuItem[]>> = this.initMenuItemsMap();

  // ══════════════════════════════════════════
  // DEVELOPER SETTINGS
  // ══════════════════════════════════════════

  // v2 OIDC session token (audience PCC_AUTH0_AUDIENCE)
  public developerToken = signal('');
  // v1 API Gateway token (audience api-gw.*) — empty when the server did not return one
  public developerV1Token = signal('');
  public loadingToken = signal(true);
  // Tracks which token's Copy button most recently succeeded, so only that button shows "Copied!"
  public tokenCopied = signal<'v2' | 'v1' | null>(null);

  public maskedToken = computed(() => this.maskTokenValue(this.developerToken()));
  public maskedV1Token = computed(() => this.maskTokenValue(this.developerV1Token()));

  // ══════════════════════════════════════════
  // PASSWORD
  // ══════════════════════════════════════════

  // State signals
  public changingPassword = signal(false);
  public sendingReset = signal(false);
  public resetResultMessage = signal('');
  public resetResultSuccess = signal(false);
  public showCurrentPassword = signal(false);
  public showNewPassword = signal(false);
  public showConfirmPassword = signal(false);
  public newPasswordSignal = signal('');

  // Password form
  public passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, this.passwordStrengthValidator()]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator() }
  );

  public passwordStrength = computed(() => this.calculatePasswordStrength(this.newPasswordSignal()));
  public passwordStrengthLabel = computed(() => {
    const labels: Record<string, string> = { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' };
    return labels[this.passwordStrength().label] || '';
  });

  public constructor() {
    this.passwordForm
      .get('newPassword')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: string | null) => {
        this.newPasswordSignal.set(value || '');
      });

    // Skip the developer-token fetch while impersonating — the server suppresses it (403) so the
    // impersonator can't read the target's live bearer token. Clear the loading flag so the UI
    // shows the read-only state instead of an indefinite spinner.
    if (this.impersonating()) {
      this.loadingToken.set(false);
    } else {
      this.loadDeveloperToken();
    }

    afterNextRender(() => {
      this.setupScrollSpy();
    });
  }

  // ══════════════════════════════════════════
  // TOC NAVIGATION
  // ══════════════════════════════════════════

  public scrollToSection(sectionId: string): void {
    this.activeSection.set(sectionId);
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.getElementById(sectionId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ══════════════════════════════════════════
  // EMAIL PUBLIC METHODS
  // ══════════════════════════════════════════

  public sendVerificationCode(): void {
    if (this.addEmailForm.invalid) {
      return;
    }

    const email = this.addEmailForm.value.email!;
    this.sendingCode.set(true);

    this.userService
      .sendEmailVerificationCode(email)
      .pipe(finalize(() => this.sendingCode.set(false)))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.pendingEmail.set(email);
            this.otpStep.set(true);
            this.resendCooldownUtil.start();
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: response.message || 'Failed to send verification code' });
          }
        },
        error: (error) => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: error.error?.message || 'Failed to send verification code' });
        },
      });
  }

  public verifyAndLink(): void {
    if (this.otpForm.invalid) {
      return;
    }

    const otp = this.otpForm.value.otp!;
    this.verifyingOtp.set(true);

    this.userService
      .verifyAndLinkEmail(this.pendingEmail(), otp)
      .pipe(finalize(() => this.verifyingOtp.set(false)))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.cancelOtpStep();
            this.emailRefresh.next();
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Email address added successfully' });
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: response.message || 'Verification failed. Please check your code and try again.',
            });
          }
        },
        error: (error) => {
          if (error.status === 403 && error.error?.error === 'management_token_required') {
            this.redirectToProfileAuth(error.error.authorize_url);
            return;
          }
          this.messageService.add({ severity: 'error', summary: 'Error', detail: error.error?.message || 'Verification failed. Please try again.' });
        },
      });
  }

  public cancelOtpStep(): void {
    this.otpStep.set(false);
    this.pendingEmail.set('');
    this.addEmailForm.reset();
    this.otpForm.reset();
    this.resendCooldownUtil.clear();
  }

  public setPrimary(email: UserEmail): void {
    if (emailsEqual(email.email, this.emailData()?.primary_email) || !email.verified) {
      return;
    }

    this.userService.setPrimaryEmail(email.email).subscribe({
      next: () => {
        this.emailRefresh.next();
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Primary email updated successfully' });
      },
      error: (err: HttpErrorResponse) => {
        if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
          this.redirectToProfileAuth(err.error.authorize_url);
          return;
        }
        this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Failed to update primary email' });
      },
    });
  }

  public setMeetingInvite(email: UserEmail): void {
    // Picking the primary row means "go back to the default". Sending its literal address would
    // instead pin an explicit override that stops following a later primary-email change — the
    // meeting service only clears the override for the sentinel.
    const inviteEmail = this.meetingInviteEmail();
    const isReset = emailsEqual(email.email, this.emailData()?.primary_email);
    // A reset still does work while any override exists, even one pointing at the primary address,
    // so only a non-reset re-pick of the current override is a no-op.
    const isNoop = isReset ? inviteEmail === null : emailsEqual(email.email, inviteEmail);

    if (!email.verified || isNoop || this.savingMeetingInvite()) {
      return;
    }

    this.meetingInviteError.set(null);
    this.savingMeetingInvite.set(true);

    const selection = isReset ? MEETING_INVITE_PRIMARY_SENTINEL : email.email;

    this.userService
      .setMeetingInviteEmail(selection)
      .pipe(finalize(() => this.savingMeetingInvite.set(false)))
      .subscribe({
        next: () => {
          this.emailRefresh.next();
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: isReset ? 'Meeting invitations will now follow your primary email' : 'Meeting invitation email updated successfully',
          });
        },
        error: (err: HttpErrorResponse) => {
          // A 400 means the address exists but isn't an active, verified record upstream — retrying
          // won't help, so surface a persistent banner with a support link instead of a transient toast.
          if (err.status === 400) {
            // The server puts the copy under `error` (and `errors[].message`), not `message` —
            // extractErrorMessage reads both, so the crafted validation text reaches the banner.
            this.meetingInviteError.set(extractErrorMessage(err, 'This email is not an active, verified address on your account yet.'));
            return;
          }
          // Retryable errors (503 sync_pending/unavailable, etc.) also carry copy under `error`, not
          // `message` — use extractErrorMessage so the crafted retry guidance reaches the toast.
          this.messageService.add({ severity: 'error', summary: 'Error', detail: extractErrorMessage(err, 'Failed to update meeting invitation email') });
        },
      });
  }

  public dismissMeetingInviteError(): void {
    this.meetingInviteError.set(null);
  }

  public deleteEmail(email: UserEmail): void {
    if (!email.user_id) {
      return;
    }

    // Defensive guard: never delete the email selected as the meeting-invitation preference.
    // The menu already disables this action; this covers any programmatic call path.
    if (emailsEqual(email.email, this.meetingInviteEmail())) {
      return;
    }

    const userId = email.user_id;

    this.userService
      .getProfileAuthStatus()
      .pipe(take(1))
      .subscribe((status) => {
        if (!status.authorized) {
          this.redirectToProfileAuth('/api/profile/auth/start?returnTo=/profile/settings');
          return;
        }

        this.confirmationService.confirm({
          message: `Are you sure you want to delete ${email.email}? This action cannot be undone.`,
          header: 'Delete Email Address',
          acceptLabel: 'Delete',
          rejectLabel: 'Cancel',
          acceptButtonStyleClass: 'p-button-danger p-button-sm',
          rejectButtonStyleClass: 'p-button-outlined p-button-sm',
          accept: () => {
            const identityId = `auth0:${userId}`;
            this.userService
              .rejectIdentity(identityId, 'email', userId)
              .pipe(take(1))
              .subscribe({
                next: () => {
                  this.emailRefresh.next();
                  this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Email address deleted successfully' });
                },
                error: (err: HttpErrorResponse) => {
                  if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
                    this.redirectToProfileAuth(err.error.authorize_url);
                    return;
                  }
                  this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Failed to delete email address' });
                },
              });
          },
        });
      });
  }

  // ══════════════════════════════════════════
  // PASSWORD PUBLIC METHODS
  // ══════════════════════════════════════════

  public onChangePassword(): void {
    if (this.passwordForm.invalid) {
      markFormControlsAsTouched(this.passwordForm);
      return;
    }

    const formValue = this.passwordForm.value;
    const changeRequest: ChangePasswordRequest = {
      current_password: formValue.currentPassword,
      new_password: formValue.newPassword,
    };

    this.changingPassword.set(true);

    this.userService
      .changePassword(changeRequest)
      .pipe(finalize(() => this.changingPassword.set(false)))
      .subscribe({
        next: (response) => {
          this.passwordForm.reset();
          this.messageService.add({ severity: 'success', summary: 'Success', detail: response.message || 'Password changed successfully!' });
        },
        error: (error: HttpErrorResponse) => {
          if (error.error?.error === 'management_token_required' && error.error?.authorize_url) {
            this.redirectToProfileAuth(error.error.authorize_url);
            return;
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.error?.message || 'Failed to change password. Please try again.',
          });
        },
      });
  }

  public onSendPasswordReset(): void {
    this.sendingReset.set(true);
    this.resetResultMessage.set('');

    this.userService
      .sendPasswordResetEmail()
      .pipe(finalize(() => this.sendingReset.set(false)))
      .subscribe({
        next: (response) => {
          this.resetResultSuccess.set(true);
          this.resetResultMessage.set(response.message || 'Password reset email has been sent to your registered email address!');
        },
        error: (error: HttpErrorResponse) => {
          if (error.error?.error === 'management_token_required' && error.error?.authorize_url) {
            this.redirectToProfileAuth(error.error.authorize_url);
            return;
          }
          this.resetResultSuccess.set(false);
          const msg = typeof error.error === 'string' ? error.error : error.error?.message;
          this.resetResultMessage.set(msg || 'There was a problem sending you a link. Please try again later.');
        },
      });
  }

  public clearPasswordForm(): void {
    this.passwordForm.reset();
    this.passwordForm.markAsUntouched();
  }

  public toggleCurrentPasswordVisibility(): void {
    this.showCurrentPassword.set(!this.showCurrentPassword());
  }

  public toggleNewPasswordVisibility(): void {
    this.showNewPassword.set(!this.showNewPassword());
  }

  public toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.set(!this.showConfirmPassword());
  }

  // ══════════════════════════════════════════
  // DEVELOPER SETTINGS PUBLIC METHODS
  // ══════════════════════════════════════════

  public openTokenPopup(title: string, token: string): void {
    if (!token) return;
    this.dialogService.open(TokenRevealDialogComponent, {
      header: title,
      width: '40rem',
      modal: true,
      draggable: false,
      resizable: false,
      dismissableMask: true,
      style: { maxWidth: '90vw' },
      data: { token },
    });
  }

  public copyToken(token: string, kind: 'v2' | 'v1'): void {
    if (!token || !isPlatformBrowser(this.platformId)) return;

    navigator.clipboard
      .writeText(token)
      .then(() => {
        this.tokenCopied.set(kind);
        this.messageService.add({ severity: 'success', summary: 'Copied', detail: 'Token copied to clipboard' });
        setTimeout(() => this.tokenCopied.set(null), 2000);
      })
      .catch(() => {
        this.messageService.add({ severity: 'error', summary: 'Copy Failed', detail: 'Failed to copy token to clipboard. Please try again.' });
      });
  }

  // ══════════════════════════════════════════
  // PRIVATE INITIALIZERS
  // ══════════════════════════════════════════

  /**
   * Redirect into a profile-auth (Flow C) flow for an email/password operation.
   * Clears any stored profile-edit pending-save first so an abandoned edit
   * authorization can't be silently replayed when this flow returns to the
   * profile shell (these settings now live at /profile/settings).
   */
  private redirectToProfileAuth(url: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    clearPendingProfileSave();
    window.location.href = url;
  }

  /**
   * Loads the address list and the meeting-invitation preference as one unit, behind a single
   * loading flag. Fetching them independently let the list turn interactive while the preference
   * was still in flight, so the badge and the delete guard briefly protected the previous
   * selection — long enough to delete the newly chosen invite address and orphan the preference.
   */
  private initEmailState(): Signal<EmailSettingsState> {
    return toSignal(
      this.emailRefresh.pipe(
        switchMap((): Observable<EmailSettingsState> => {
          this.emailLoading.set(true);
          return forkJoin({
            emails: this.userService.getUserEmails().pipe(catchError(() => of(null))),
            invite: this.userService.getMeetingInviteEmail(),
          }).pipe(finalize(() => this.emailLoading.set(false)));
        })
      ),
      { initialValue: { emails: null, invite: null } }
    );
  }

  private initMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      // Disables the action on every row, not just the one clicked — the guard has to cover the
      // whole set or a second row can still queue a competing write.
      const savingInvite = this.savingMeetingInvite();
      for (const email of this.emailsWithMetadata()) {
        const items: MenuItem[] = [];
        if (email.canSetPrimary) {
          items.push({ label: 'Make Primary', icon: 'fa-light fa-star', command: () => this.setPrimary(email) });
        }
        if (email.canSetMeetingInvite) {
          // On the primary row the action clears the override rather than pinning an address — name it
          // as a reset, since it also shows on a primary row already badged as the current override.
          const label = email.isPrimary ? 'Reset to Default (Primary Email)' : 'Use for Meeting Invitations';
          items.push({
            label,
            icon: 'fa-light fa-envelope',
            disabled: savingInvite,
            command: () => this.setMeetingInvite(email),
          });
        }
        if (email.canDelete) {
          if (email.isMeetingInvite) {
            // Blocked: deleting the meeting-invitation email would orphan the meeting-service preference.
            items.push({
              label: 'Delete',
              icon: 'fa-light fa-trash',
              styleClass: 'text-red-500',
              disabled: true,
              title: 'This email is set for meeting invitations. Choose a different meeting-invitation email before deleting it.',
            });
          } else {
            items.push({ label: 'Delete', icon: 'fa-light fa-trash', styleClass: 'text-red-500', command: () => this.deleteEmail(email) });
          }
        }
        map.set(email.email, items);
      }
      return map;
    });
  }

  private loadDeveloperToken(): void {
    this.loadingToken.set(true);
    this.userService
      .getDeveloperTokenInfo()
      .pipe(finalize(() => this.loadingToken.set(false)))
      .subscribe({
        next: (info) => {
          // Guard the shape at runtime: a non-string (e.g. null on a transient error path) resets
          // to empty rather than leaking a raw value through maskTokenValue.
          this.developerToken.set(typeof info.token === 'string' ? info.token : '');
          this.developerV1Token.set(typeof info.v1Token === 'string' ? info.v1Token : '');
        },
        error: () => {
          this.developerToken.set('');
          this.developerV1Token.set('');
        },
      });
  }

  private maskTokenValue(token: string): string {
    if (!token || token.length <= 8) return token;
    return `${token.slice(0, 4)}${'*'.repeat(11)}${token.slice(-4)}`;
  }

  private calculatePasswordStrength(password: string): PasswordStrength {
    const requirements = {
      minLength: password.length >= 8,
      hasLowercase: /[a-z]/.test(password),
      hasUppercase: /[A-Z]/.test(password),
      hasNumbers: /[0-9]/.test(password),
      hasSpecialChars: /[!@#$%^&*(),.?":{}|<>]/.test(password),
      meetsCriteria: false,
    };

    const typeCount = [requirements.hasLowercase, requirements.hasUppercase, requirements.hasNumbers, requirements.hasSpecialChars].filter(Boolean).length;
    requirements.meetsCriteria = typeCount >= 3;

    let score = 0;
    if (requirements.minLength) score++;
    if (requirements.meetsCriteria) score += 2;
    if (typeCount === 4) score++;

    let label: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
    if (score >= 4) label = 'strong';
    else if (score >= 3) label = 'good';
    else if (score >= 2) label = 'fair';

    return { score, label, requirements };
  }

  private passwordStrengthValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      const strength = this.calculatePasswordStrength(control.value);
      if (!strength.requirements.minLength) return { minLength: true };
      if (!strength.requirements.meetsCriteria) return { weakPassword: true };
      return null;
    };
  }

  private passwordMatchValidator(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const newPassword = group.get('newPassword');
      const confirmPassword = group.get('confirmPassword');
      if (!newPassword || !confirmPassword || !confirmPassword.value) return null;
      return newPassword.value !== confirmPassword.value ? { passwordMismatch: true } : null;
    };
  }

  private setupScrollSpy(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Observe the section heading rows (sentinels) rather than the full section divs.
    // A heading is short enough that at most one fits in the activation band, which
    // avoids two sections being considered active during the transition.
    const sectionIds = ['email-settings', 'password', 'developer-settings'];
    const headingByElement = new Map<Element, string>();
    for (const id of sectionIds) {
      const heading = document.getElementById(`${id}-heading`);
      if (heading) headingByElement.set(heading, id);
    }

    if (headingByElement.size === 0) return;

    const intersecting = new Set<string>();
    const lastSectionId = sectionIds[sectionIds.length - 1];

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = headingByElement.get(entry.target);
          if (!id) continue;
          if (entry.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        const activeId = sectionIds.find((id) => intersecting.has(id));
        if (activeId) this.activeSection.set(activeId);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );
    this.scrollSpyObserver = observer;

    headingByElement.forEach((_, heading) => observer.observe(heading));

    // The last section is short enough that its heading never enters the activation
    // band. Observe an invisible sentinel at the bottom of the content column so we
    // can snap to the last section without a scroll listener or magic pixel values.
    const sentinel = document.getElementById('scroll-end-sentinel');
    const lastHeading = document.getElementById(`${lastSectionId}-heading`);
    const endObserver = new IntersectionObserver(
      ([entry]) => {
        // Only override when the user has actually scrolled past the last heading
        // (its bottom has cleared the 80px header offset). On viewports tall enough
        // to show the whole page without scrolling the sentinel is already intersecting
        // from initial paint — this guard prevents pinning the TOC to the last section
        // before the user has reached it.
        if (entry.isIntersecting && lastHeading && lastHeading.getBoundingClientRect().bottom <= 80) {
          this.activeSection.set(lastSectionId);
        }
      },
      { threshold: 0 }
    );
    if (sentinel) endObserver.observe(sentinel);

    this.destroyRef.onDestroy(() => {
      endObserver.disconnect();
      this.scrollSpyObserver?.disconnect();
    });
  }
}
