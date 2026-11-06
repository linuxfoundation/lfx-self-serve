// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, CdkTrapFocus } from '@angular/cdk/a11y';
import { Component, computed, inject, input, linkedSignal, output, Signal, signal, WritableSignal } from '@angular/core';
import { TranscendService } from '@app/shared/services/transcend.service';
import { UiButtonComponent } from '@app/shared/uikit/button/button.component';
import { UiInputComponent } from '@app/shared/uikit/input/input.component';
import { NEWSLETTER_GUEST_LEGAL_LINKS } from '@lfx-one/shared/constants';
import { NewsletterFoundationSummary } from '@lfx-one/shared/interfaces';

/**
 * The signed-out newsletter reader's modal (#5235), over a blurred page with no app chrome. Only three
 * actions: the email, Continue, and Sign in — no close button, so there is no way to the content
 * around it without one of them.
 *
 * - `invite`: an invite or confirmation link. The address is the invited one, shown read-only and masked
 *   (the link may have been forwarded).
 * - `shared`: a shared issue link. The reader types a work email, and is told Continue emails a
 *   confirmation link that subscribes them.
 *
 * The pages using it hide Transcend's automatic consent prompt, so the modal carries the consent line
 * (Privacy Policy, Terms of Use) and a Cookie settings link instead.
 */
@Component({
  selector: 'lfx-newsletter-guest-modal',
  imports: [CdkTrapFocus, UiButtonComponent, UiInputComponent],
  templateUrl: './newsletter-guest-modal.component.html',
})
export class NewsletterGuestModalComponent {
  // === Services ===
  private readonly headingId = inject(_IdGenerator).getId('lfx-newsletter-guest-modal-');
  private readonly transcendService = inject(TranscendService);

  // === Inputs ===
  public readonly mode = input<'invite' | 'shared'>('shared');
  public readonly foundation = input<NewsletterFoundationSummary | null>(null);
  /** The organization whose member companies get the newsletter (the foundation, or The Linux Foundation). */
  public readonly membershipName = input<string>('');
  /** `invite` only: the matched member company. */
  public readonly companyName = input<string>('');
  /** The invited address, masked (`invite`), or a starting value (`shared`). */
  public readonly email = input<string>('');
  public readonly loading = input<boolean>(false);
  /** Shown under the email field. */
  public readonly errorMessage = input<string>('');
  /** The invite can no longer be accepted (expired, invalid, not a member): only Sign in is offered. */
  public readonly blocked = input<boolean>(false);
  public readonly signInHref = input<string>('/login');

  // === Outputs ===
  public readonly continued = output<string>();

  // === Writable Signals ===
  protected readonly emailValue: WritableSignal<string> = linkedSignal(() => this.email());
  /**
   * True while Transcend's consent manager (rendered outside this dialog) is open from Cookie settings:
   * the focus trap and `aria-modal` are released so the manager is operable, and re-armed as soon as
   * focus comes back into the dialog.
   */
  protected readonly preferencesOpen = signal(false);

  // === Computed Signals ===
  protected readonly foundationName: Signal<string> = computed(() => this.foundation()?.name || 'this foundation');
  /** Logo fallback: the foundation's first letter. */
  protected readonly monogram: Signal<string> = computed(() => (this.foundation()?.name?.trim().charAt(0) || 'N').toUpperCase());
  protected readonly description: Signal<string> = this.initDescription();
  protected readonly canContinue: Signal<boolean> = computed(() => !this.blocked() && !this.loading() && this.emailValue().trim().length > 0);
  protected readonly labelledBy = this.headingId;
  protected readonly legalLinks = NEWSLETTER_GUEST_LEGAL_LINKS;

  // === Protected Methods ===
  protected onCookieSettings(): void {
    this.preferencesOpen.set(true);
    this.transcendService.showPreferences();
  }

  protected onDialogFocusIn(): void {
    if (this.preferencesOpen()) this.preferencesOpen.set(false);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canContinue()) return;
    this.continued.emit(this.emailValue().trim());
  }

  // === Private Initializers ===
  private initDescription(): Signal<string> {
    return computed(() => {
      const membership = this.membershipName() || this.foundationName();
      if (this.mode() === 'shared') {
        return `This newsletter is a member benefit for employees of ${membership} member companies. Enter your work email to read it.`;
      }
      const company = this.companyName();
      if (!company) {
        return `Your company is a member of ${membership}, so you get its newsletter as a member benefit, sent right to your inbox.`;
      }
      return `${company} is a member of ${membership}, so as an employee of ${company} you get its newsletter as a member benefit, sent right to your inbox.`;
    });
  }
}
