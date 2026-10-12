// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { EMAIL_REGEX } from '@lfx-one/shared/constants';
import { MyNewsletterFoundation, NewsletterInviteDialogData } from '@lfx-one/shared/interfaces';
import { emailDomain, isPersonalEmailDomain } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map } from 'rxjs';

/**
 * Invite a colleague to a foundation's newsletter (#3483). One field: their company email. Personal
 * mailboxes are caught as you type; whether the domain belongs to a member of the foundation's
 * membership (its own, or The Linux Foundation's) is the server's call. After a send the field clears so the next colleague can be invited right away.
 */
@Component({
  selector: 'lfx-newsletter-invite-dialog',
  imports: [AvatarComponent, ButtonComponent, InputTextComponent, ReactiveFormsModule],
  templateUrl: './newsletter-invite-dialog.component.html',
})
export class NewsletterInviteDialogComponent {
  // === Services ===
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<NewsletterInviteDialogData>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly newsletterService = inject(NewsletterService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // === Dialog Data ===
  public readonly foundation: MyNewsletterFoundation = (this.config.data as NewsletterInviteDialogData).foundation;
  protected readonly initial = this.foundation.name.charAt(0).toUpperCase();
  /** Whose member companies can be invited — the card only opens this dialog when the foundation has a newsletter group. */
  protected readonly membershipName = this.foundation.membership_name ?? this.foundation.name;

  // === Forms ===
  public readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_REGEX)]],
  });

  // === Writable Signals ===
  protected readonly sending = signal(false);
  protected readonly serverError = signal('');
  /** Addresses invited in this dialog session, newest first. */
  protected readonly sentTo = signal<string[]>([]);

  // === Computed Signals ===
  private readonly emailValue: Signal<string> = toSignal(this.form.controls.email.valueChanges.pipe(map((value) => value.trim().toLowerCase())), {
    initialValue: '',
  });
  protected readonly personalEmail: Signal<boolean> = computed(() => {
    const domain = emailDomain(this.emailValue());
    return !!domain && EMAIL_REGEX.test(this.emailValue()) && isPersonalEmailDomain(domain);
  });
  protected readonly canSend: Signal<boolean> = computed(() => EMAIL_REGEX.test(this.emailValue()) && !this.personalEmail() && !this.sending());

  // === Constructor ===
  public constructor() {
    this.form.controls.email.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.serverError.set(''));
  }

  // === Protected Methods ===
  protected onSend(): void {
    if (!this.canSend()) {
      this.form.controls.email.markAsTouched();
      return;
    }

    const email = this.emailValue();
    this.sending.set(true);
    this.newsletterService
      // A write: no takeUntilDestroyed — closing the dialog mid-request must not abort the POST
      // (the service's take(1) completes it).
      .sendNewsletterInvite(this.foundation.uid, email)
      .subscribe({
        next: (result) => {
          this.sending.set(false);
          this.sentTo.update((list) => [result.email, ...list.filter((entry) => entry !== result.email)]);
          this.form.reset({ email: '' });
          this.messageService.add({ severity: 'success', summary: 'Invite sent', detail: `We emailed an invitation to ${result.email}.` });
        },
        error: (error: unknown) => {
          this.sending.set(false);
          this.serverError.set(this.inviteErrorMessage(error));
        },
      });
  }

  protected onClose(): void {
    this.ref.close(this.sentTo().length);
  }

  // === Private Helpers ===
  /** Field-level validation messages first (e.g. "acme.example isn't a member company of The Linux Foundation"), then the envelope. */
  private inviteErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const fieldMessage = (error.error as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message;
      if (fieldMessage) return fieldMessage;
    }
    return extractErrorMessage(error, "We couldn't send the invite. Please try again.");
  }
}
