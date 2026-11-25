// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { AccountCardComponent } from '@components/account-card/account-card.component';
import { ACCOUNT_LINUX_EMAIL_COPY, PENDING_LINUX_FORWARD_KEY, PENDING_LINUX_FORWARD_TTL_MS } from '@lfx-one/shared/constants';
import { PendingLinuxForward } from '@lfx-one/shared/interfaces';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { take } from 'rxjs';

import { ProfileLinuxEmailComponent } from '../../profile/linux-email/profile-linux-email.component';

/**
 * The Linux.com email card of Account & Settings (#6075, behind the profile redesign flag). It keeps the hub tab's loading, claim,
 * forwarding and Flow C handling by extending it, asks before claiming, and saves a new forwarding address through the header save
 * bar instead of an inline Save. When the hub goes (#6094), that logic moves here.
 */
@Component({
  selector: 'lfx-account-linux-email',
  imports: [
    ReactiveFormsModule,
    AccountCardComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiInputComponent,
    UiModalComponent,
    UiNoteComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSkeletonComponent,
  ],
  templateUrl: './account-linux-email.component.html',
})
export class AccountLinuxEmailComponent extends ProfileLinuxEmailComponent {
  private readonly modal = inject(UiModalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly unsavedChanges = inject(AccountUnsavedChangesService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  // A forwarding address kept across Flow C, waiting until it can be chosen again.
  private pendingForward: string | null = this.takePendingForward();
  private readonly claimDialog = viewChild.required<TemplateRef<unknown>>('claimDialog');

  protected readonly copy = ACCOUNT_LINUX_EMAIL_COPY;
  /** The alias and forwarding address the claim dialog asks about. */
  protected readonly pendingClaim = signal<{ address: string; forwardTo: string }>({ address: '', forwardTo: '' });
  protected readonly subtitle: Signal<string> = computed(() => ACCOUNT_LINUX_EMAIL_COPY.subtitle.replace('{domain}', this.domain() || 'linux.com'));
  protected readonly emptyText: Signal<string> = computed(() => ACCOUNT_LINUX_EMAIL_COPY.emptyText.replace('{domain}', this.domain() || 'linux.com'));
  // Any value, status or touched change of the claim form, so its messages follow it.
  private readonly claimFormEvents = toSignal(this.claimForm.events);
  protected readonly aliasError: Signal<string> = this.initAliasError();
  protected readonly claimForwardError: Signal<string> = computed(() => {
    this.claimFormEvents();
    const control = this.claimForm.controls.forwardTo;
    return control.touched && control.invalid ? 'Please choose a forwarding address.' : '';
  });
  protected readonly forwardHint: Signal<string> = this.initForwardHint();
  /** A changed forwarding address the header save bar can save; never while the address can't be read or edited, or reloads. */
  public readonly forwardChanged: Signal<boolean> = computed(
    () => this.state() === 'claimed' && !this.forwardReauthRequired() && !this.impersonating() && !this.loading() && this.forwardDirty()
  );

  public constructor() {
    super();
    this.unsavedChanges.register(
      { dirty: this.forwardChanged, saving: this.savingForward, save: () => this.saveForward(), revert: () => this.revertForward() },
      this.destroyRef
    );

    // A save or the refresh after it writes the select, so it is locked until both are done and an edit made then isn't lost.
    toObservable(computed(() => this.savingForward() || this.loading()))
      .pipe(takeUntilDestroyed())
      .subscribe((busy) => {
        const control = this.editForm.controls.forwardTo;
        if (busy) control.disable({ emitEvent: false });
        else control.enable({ emitEvent: false });
      });

    // Back from Flow C, a forwarding address chosen before it is chosen again, unsaved, once the current one has loaded and the
    // addresses offered, which load separately, include it.
    toObservable(computed(() => ({ editable: this.state() === 'claimed' && !this.forwardReauthRequired(), options: this.forwardOptions() })))
      .pipe(takeUntilDestroyed())
      .subscribe(({ editable, options }) => {
        const pending = this.pendingForward;
        const control = this.editForm.controls.forwardTo;
        if (!pending) return;
        // A choice the user made since returning wins; the kept one is dropped.
        if (control.dirty) {
          this.pendingForward = null;
          return;
        }
        if (!editable || this.impersonating() || !options.some((option) => option.value === pending)) return;
        this.pendingForward = null;
        control.setValue(pending);
      });
  }

  /** Checks the form, then asks before claiming: the alias can't be changed afterwards. */
  protected confirmClaim(): void {
    if (this.claimForm.invalid) {
      this.claimForm.markAllAsTouched();
      return;
    }
    const forwardTo = this.claimForm.value.forwardTo ?? '';
    const label = this.forwardOptions()
      .find((option) => option.value === forwardTo)
      ?.label.replace(/ \(Primary\)$/, '');
    this.pendingClaim.set({ address: `${(this.claimForm.value.alias ?? '').trim().toLowerCase()}@${this.domain()}`, forwardTo: label ?? forwardTo });
    this.modal
      .open<boolean>(this.claimDialog(), { autoFocus: '[data-autofocus] button' })
      .closed.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) this.claim();
      });
  }

  // Flow C goes through the save bar's service, so the browser's leave prompt doesn't fire; a forwarding change is kept and
  // chosen again on return.
  protected override handleError(err: HttpErrorResponse, fallback: string): void {
    if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
      const forwardTo = (this.editForm.getRawValue().forwardTo ?? '').trim();
      if (this.browser && this.forwardChanged() && forwardTo) {
        sessionStorage.setItem(PENDING_LINUX_FORWARD_KEY, JSON.stringify({ savedAt: Date.now(), forwardTo } satisfies PendingLinuxForward));
      }
      this.unsavedChanges.leaveForAuthorization(err.error.authorize_url);
      return;
    }
    super.handleError(err, fallback);
  }

  private initAliasError(): Signal<string> {
    return computed(() => {
      this.claimFormEvents();
      const control = this.claimForm.controls.alias;
      if (!control.touched || control.valid) return '';
      if (control.errors?.['required']) return 'An alias is required.';
      if (control.errors?.['aliasReserved']) return 'That alias is reserved. Please choose another.';
      if (control.errors?.['aliasMaxLength']) return 'Aliases can be at most 64 characters.';
      return 'Use letters, numbers, dots, and hyphens only.';
    });
  }

  private initForwardHint(): Signal<string> {
    return computed(() => {
      if (this.impersonating()) return 'Forwarding details aren’t available while impersonating.';
      if (this.forwardNotSet()) return 'Forwarding isn’t set yet. Choose an address.';
      return ACCOUNT_LINUX_EMAIL_COPY.forwardHint;
    });
  }

  // Reads the kept address once, so a later visit doesn't pick it again. Only a recent one counts.
  private takePendingForward(): string | null {
    if (!this.browser) return null;
    const stored = sessionStorage.getItem(PENDING_LINUX_FORWARD_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(PENDING_LINUX_FORWARD_KEY);
    try {
      const pending = JSON.parse(stored) as Partial<PendingLinuxForward>;
      const fresh = typeof pending.savedAt === 'number' && Date.now() - pending.savedAt <= PENDING_LINUX_FORWARD_TTL_MS;
      return fresh && pending.forwardTo ? pending.forwardTo.toLowerCase().trim() : null;
    } catch {
      return null;
    }
  }

  // The select is locked while a save or reload runs, so there is nothing to save until it is editable again.
  private saveForward(): void {
    if (this.editForm.controls.forwardTo.enabled) this.updateForward();
  }

  private revertForward(): void {
    this.editForm.controls.forwardTo.setValue(this.savedForwardTo());
    this.editForm.markAsUntouched();
  }
}
