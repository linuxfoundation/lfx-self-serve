// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { EmailManagementData, EnrichedIdentity, LinuxAliasData, LinuxEmailData, LinuxForwardOption } from '@lfx-one/shared/interfaces';
import { linuxAliasValidator } from '@lfx-one/shared/validators';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, finalize, forkJoin, map, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-profile-linux-email',
  imports: [ReactiveFormsModule, CardComponent, InputTextComponent, SelectComponent, MessageComponent, ButtonComponent, ToastModule],
  templateUrl: './profile-linux-email.component.html',
})
export class ProfileLinuxEmailComponent {
  private readonly userService = inject(UserService);
  // Read-only when impersonating — Linux.com alias mutations act on the real account and are blocked server-side.
  public readonly impersonating = this.userService.impersonating;
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  // Identities passed in from the parent (ProfileIdentitiesComponent) to avoid
  // a duplicate getIdentities() fetch when both panels render on the same page.
  public readonly identities = input<EnrichedIdentity[]>([]);

  // One-shot guard (sessionStorage key) so a tokenless re-auth round-trip can't loop.
  private readonly reauthFlagKey = 'linux-email:forward-reauth-attempted';

  // Set on FORWARD_SET_FAILED so the recovery toast can be shown once the refreshed
  // alias state is known, instead of assuming the refetch lands on 'claimed'.
  private pendingForwardRecoveryToast = false;

  // Refresh mechanism
  private refresh = new BehaviorSubject<void>(undefined);

  // Forms
  public claimForm = new FormGroup({
    alias: new FormControl('', [Validators.required, linuxAliasValidator()]),
    forwardTo: new FormControl('', [Validators.required, Validators.email]),
  });

  public editForm = new FormGroup({
    forwardTo: new FormControl('', [Validators.required, Validators.email]),
  });

  // State signals
  public loading = signal(false);
  public claiming = signal(false);
  public savingForward = signal(false);

  // Tracks the last loaded/saved forward-to value so we can detect unsaved changes.
  private readonly savedForwardTo = signal<string>('');

  // Data signals
  public data: Signal<LinuxEmailData> = this.initData();

  // Derived view state
  public state = computed(() => this.data().alias?.state ?? null);
  public domain = computed(() => this.data().alias?.domain ?? '');
  public email = computed(() => this.data().alias?.email ?? null);

  // True only when the user has changed the forward-to selection from its saved value.
  public forwardDirty: Signal<boolean> = this.initForwardDirty();

  // Verified emails the user can forward to (primary first, default selection).
  // Sourced from the same verified identities shown in the Identities tab —
  // every email-type identity plus the primary. Username identities (e.g.
  // GitHub) are excluded since you can't forward email to them, and the claimed
  // alias is excluded since you can't forward an address to itself.
  public forwardOptions = computed((): LinuxForwardOption[] => {
    const { alias, emails } = this.data();
    const identities = this.identities();

    const aliasEmail = alias?.email?.toLowerCase().trim();
    const seen = new Set<string>();
    const options: LinuxForwardOption[] = [];

    const add = (address: string | undefined, isPrimary: boolean): void => {
      const value = address?.toLowerCase().trim();
      if (!value || value === aliasEmail || seen.has(value)) return;
      seen.add(value);
      // Use the normalized value for the option value so selection matches the
      // (lowercased/trimmed) forward target regardless of source casing.
      options.push({ label: isPrimary ? `${address} (Primary)` : address!, value });
    };

    add(emails?.primary_email, true);
    for (const identity of identities) {
      if (identity.type === 'email' && identity.displayState === 'verified') add(identity.value, false);
    }

    // Preserve a pre-existing external forwarding target so the user still sees it.
    const current = alias?.forwardTo;
    const currentValue = current?.toLowerCase().trim();
    if (current && currentValue && !seen.has(currentValue)) {
      options.push({ label: current, value: currentValue });
    }

    return options;
  });

  // True when at least one forward option differs from what's already saved/selected —
  // a real alternative to switch to. Drives only the edit form's hint text (whether to
  // show "choose one" vs "add another to change this"); the claim form gates on
  // forwardOptions().length so a stale savedForwardTo can never hide its dropdown.
  public hasForwardOptions = computed((): boolean => {
    const saved = this.savedForwardTo();
    return this.forwardOptions().some((option) => option.value !== saved);
  });

  // True only on a failed getUserEmails() fetch, not a genuine lack of a primary
  // email — a successful /api/profile/emails response always has a non-empty
  // primary_email (server-side fallback), so `emails === null` here only ever
  // means the request errored (see initData's catchError).
  public emailsLoadFailed = computed((): boolean => this.data().emails === null);

  // Public methods

  public purchase(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const url = this.data().alias?.purchaseUrl;
    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  }

  public claim(): void {
    if (this.claimForm.invalid) {
      this.claimForm.markAllAsTouched();
      return;
    }

    const alias = this.claimForm.value.alias!.trim().toLowerCase();
    const forwardTo = this.claimForm.value.forwardTo!.trim();
    this.claiming.set(true);

    this.userService
      .claimLinuxAlias({ alias, forwardTo })
      .pipe(finalize(() => this.claiming.set(false)))
      .subscribe({
        next: () => {
          this.claimForm.reset();
          this.refresh.next();
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Your Linux.com alias is active.' });
        },
        error: (err: HttpErrorResponse) => {
          // Partial failure: the alias was claimed but forwarding could not be set. The
          // alias is immutable upstream, so a retry here would just fail with
          // already_claimed — recover into the claimed/edit state instead of stranding
          // the user on the claim form. The recovery toast is deferred until the refetch
          // resolves — see maybeShowForwardRecoveryToast.
          if (err.error?.code === 'FORWARD_SET_FAILED') {
            this.claimForm.reset();
            this.pendingForwardRecoveryToast = true;
            this.refresh.next();
            return;
          }
          this.handleError(err, 'Failed to claim your alias. Please try again.');
        },
      });
  }

  public updateForward(): void {
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const forwardTo = this.editForm.value.forwardTo!.trim();
    this.savingForward.set(true);

    this.userService
      .updateLinuxForward(forwardTo)
      .pipe(finalize(() => this.savingForward.set(false)))
      .subscribe({
        next: () => {
          // Defensive: a successful save isn't the FORWARD_SET_FAILED recovery refetch, so
          // it must not consume a stale pending flag from an earlier claim() failure.
          this.pendingForwardRecoveryToast = false;
          this.refresh.next();
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Forwarding address updated.' });
        },
        error: (err: HttpErrorResponse) => this.handleError(err, 'Failed to update your forwarding address. Please try again.'),
      });
  }

  public retry(): void {
    // Clear the one-shot re-auth guard so a Retry can re-trigger Flow C for the forward target.
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.removeItem(this.reauthFlagKey);
    }
    // Defensive: a user-initiated retry isn't the FORWARD_SET_FAILED recovery refetch, so
    // it must not consume a stale pending flag from an earlier claim() failure.
    this.pendingForwardRecoveryToast = false;
    this.refresh.next();
  }

  // Private methods

  private handleError(err: HttpErrorResponse, fallback: string): void {
    // Flow C: redirect to authorize when a management token is required.
    if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
      if (isPlatformBrowser(this.platformId)) {
        window.location.href = err.error.authorize_url;
      }
      return;
    }
    this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || fallback });
  }

  private initForwardDirty(): Signal<boolean> {
    // Reset coupling: after a successful save, updateForward() → refresh.next() →
    // applyFormDefaults() → patchValue({ forwardTo }, { emitEvent: true }) fires a
    // fresh valueChanges emission that re-runs this map against the now-updated
    // savedForwardTo, hiding the Save button. If patchValue is ever called with
    // { emitEvent: false }, the Save button will stay visible after a successful save.
    return toSignal(this.editForm.controls.forwardTo.valueChanges.pipe(map((value) => (value ?? '').toLowerCase().trim() !== this.savedForwardTo())), {
      initialValue: false,
    });
  }

  private initData(): Signal<LinuxEmailData> {
    return toSignal(
      this.refresh.pipe(
        switchMap(() => {
          this.loading.set(true);
          return forkJoin({
            alias: this.userService
              .getLinuxAlias()
              .pipe(catchError(() => of<LinuxAliasData | null>({ state: 'service_unavailable', domain: '', alias: null, email: null, forwardTo: null }))),
            emails: this.userService.getUserEmails().pipe(catchError(() => of(null))),
          }).pipe(
            tap(({ alias, emails }) => {
              this.applyFormDefaults(alias, emails);
              this.maybeReauthForForward(alias);
              this.maybeShowForwardRecoveryToast(alias);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: { alias: null, emails: null } }
    );
  }

  /**
   * A claimed alias always has a forward target, but the server can only read it
   * with a Flow C management token. When that token is absent the server flags
   * `forwardAuthRequired`; redirect once to load the real target instead of
   * silently showing the primary email. The one-shot guard prevents a loop if the
   * round-trip returns still tokenless (or the user cancels).
   */
  private maybeReauthForForward(alias: LinuxAliasData | null): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (alias?.state !== 'claimed') return;

    if (!alias.forwardAuthRequired) {
      // Token present (or flow disabled) — clear the guard for next time.
      sessionStorage.removeItem(this.reauthFlagKey);
      return;
    }

    if (!alias.authorizeUrl || sessionStorage.getItem(this.reauthFlagKey)) return;
    sessionStorage.setItem(this.reauthFlagKey, '1');
    window.location.href = alias.authorizeUrl;
  }

  /**
   * Shows the FORWARD_SET_FAILED recovery toast once the refreshed alias state is known,
   * so the message matches what actually renders. If the forwards-service is still down
   * (the same outage that likely caused the original failure), the refetch degrades to
   * 'service_unavailable' and the retry panel renders instead of the claimed/edit form —
   * in that case the toast must not tell the user to look for a form "below".
   */
  private maybeShowForwardRecoveryToast(alias: LinuxAliasData | null): void {
    if (!this.pendingForwardRecoveryToast) return;
    this.pendingForwardRecoveryToast = false;

    this.messageService.add({
      severity: 'warn',
      summary: 'Alias claimed',
      detail:
        alias?.state === 'claimed'
          ? 'Your alias is active, but we couldn’t set forwarding. Please set your forwarding address below.'
          : 'Your alias is active, but we couldn’t set forwarding. Please try again once the service is available.',
    });
  }

  /** Default the forward selection to the current target (if any) or the primary email. */
  private applyFormDefaults(alias: LinuxAliasData | null, emails: EmailManagementData | null): void {
    const primary = (emails?.primary_email ?? '').toLowerCase().trim();

    if (alias?.state === 'claimed') {
      // Select only a real forward target. When it hasn't loaded (re-auth pending, or the
      // forwards-service was unreachable), leave the selection empty rather than guessing the
      // primary email — a guessed value could overwrite the real forward on Save. Normalize so
      // the default matches a (normalized) forwardOptions value.
      const forwardTo = (alias.forwardTo ?? '').toLowerCase().trim();
      // Set savedForwardTo BEFORE patching so the valueChanges emission sees the correct baseline.
      this.savedForwardTo.set(forwardTo);
      this.editForm.patchValue({ forwardTo });
    } else if (alias?.state === 'purchased_unclaimed' && primary) {
      this.claimForm.patchValue({ forwardTo: primary });
    }
  }
}
