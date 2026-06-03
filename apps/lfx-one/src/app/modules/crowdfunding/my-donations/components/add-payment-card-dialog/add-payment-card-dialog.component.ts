// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { afterNextRender, Component, computed, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { StripeCardCvcElement, StripeCardExpiryElement, StripeCardNumberElement } from '@stripe/stripe-js';

import { ButtonComponent } from '@components/button/button.component';
import { STRIPE_ELEMENT_STYLE } from '@lfx-one/shared/constants';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { StripeService } from '@services/stripe.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';

@Component({
  selector: 'lfx-add-payment-card-dialog',
  imports: [ButtonComponent],
  templateUrl: './add-payment-card-dialog.component.html',
  styleUrl: './add-payment-card-dialog.component.scss',
})
export class AddPaymentCardDialogComponent implements OnDestroy {
  // ─── Private injections ──────────────────────────────────────────────────
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly stripeService = inject(StripeService);
  private readonly crowdfundingService = inject(CrowdfundingService);

  // ─── Template refs ───────────────────────────────────────────────────────
  protected readonly cardNumberContainer = viewChild<ElementRef<HTMLElement>>('cardNumberContainer');
  protected readonly cardExpiryContainer = viewChild<ElementRef<HTMLElement>>('cardExpiryContainer');
  protected readonly cardCvcContainer = viewChild<ElementRef<HTMLElement>>('cardCvcContainer');

  // Guards mountStripeElements from running on an already-destroyed view.
  private destroyed = false;

  // ─── Stripe element instances (not signals — not reactive values) ─────────
  private cardNumberEl: StripeCardNumberElement | null = null;
  private cardExpiryEl: StripeCardExpiryElement | null = null;
  private cardCvcEl: StripeCardCvcElement | null = null;

  // ─── Per-field focus state ────────────────────────────────────────────────
  protected readonly cardNumberFocused = signal(false);
  protected readonly cardExpiryFocused = signal(false);
  protected readonly cardCvcFocused = signal(false);

  // ─── Per-field error messages ─────────────────────────────────────────────
  protected readonly cardNumberError = signal('');
  protected readonly cardExpiryError = signal('');
  protected readonly cardCvcError = signal('');

  // ─── Per-field completion flags ───────────────────────────────────────────
  private readonly cardNumberComplete = signal(false);
  private readonly cardExpiryComplete = signal(false);
  private readonly cardCvcComplete = signal(false);

  // ─── Submission state ─────────────────────────────────────────────────────
  protected readonly stripeError = signal('');
  protected readonly submitting = signal(false);
  protected readonly elementsReady = signal(false);
  protected readonly formReady = computed(() => this.elementsReady() && this.cardNumberComplete() && this.cardExpiryComplete() && this.cardCvcComplete());

  public constructor() {
    // afterNextRender runs only in the browser, after the view is available — SSR safe.
    afterNextRender(() => {
      void this.mountStripeElements();
    });
  }

  public ngOnDestroy(): void {
    this.destroyed = true;
    this.destroyElements();
  }

  // ─── Public methods ───────────────────────────────────────────────────────

  protected async onSubmit(): Promise<void> {
    if (!this.cardNumberEl || !this.allComplete()) {
      return;
    }

    this.stripeError.set('');
    this.submitting.set(true);

    try {
      const stripe = await this.stripeService.getStripe();

      if (!stripe) {
        this.stripeError.set('Stripe is not available. Please try again.');
        return;
      }

      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: this.cardNumberEl,
      });

      if (error) {
        this.stripeError.set(error.message ?? 'Failed to process card. Please try again.');
        return;
      }

      const saved = await firstValueFrom(this.crowdfundingService.savePaymentMethod(paymentMethod.id));

      this.dialogRef.close({ added: true, paymentMethod: saved });
    } catch (err) {
      this.stripeError.set(extractErrorMessage(err, 'Failed to save payment method. Please try again.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private allComplete(): boolean {
    return this.cardNumberComplete() && this.cardExpiryComplete() && this.cardCvcComplete();
  }

  private async mountStripeElements(): Promise<void> {
    try {
      const stripe = await this.stripeService.getStripe();

      if (this.destroyed) return;

      const numberEl = this.cardNumberContainer()?.nativeElement;
      const expiryEl = this.cardExpiryContainer()?.nativeElement;
      const cvcEl = this.cardCvcContainer()?.nativeElement;

      if (!stripe || !numberEl || !expiryEl || !cvcEl) {
        if (!stripe) {
          this.stripeError.set('Payment fields are unavailable. Please refresh the page or try again later.');
        }
        return;
      }

      const elements = stripe.elements();

      this.cardNumberEl = elements.create('cardNumber', { style: STRIPE_ELEMENT_STYLE, placeholder: '1234 5678 9012 3456' });
      this.cardExpiryEl = elements.create('cardExpiry', { style: STRIPE_ELEMENT_STYLE });
      this.cardCvcEl = elements.create('cardCvc', { style: STRIPE_ELEMENT_STYLE });

      this.cardNumberEl.mount(numberEl);
      this.cardExpiryEl.mount(expiryEl);
      this.cardCvcEl.mount(cvcEl);

      this.cardNumberEl.on('change', (e) => {
        this.cardNumberComplete.set(e.complete);
        this.cardNumberError.set(e.error?.message ?? '');
      });
      this.cardNumberEl.on('focus', () => this.cardNumberFocused.set(true));
      this.cardNumberEl.on('blur', () => this.cardNumberFocused.set(false));

      this.cardExpiryEl.on('change', (e) => {
        this.cardExpiryComplete.set(e.complete);
        this.cardExpiryError.set(e.error?.message ?? '');
      });
      this.cardExpiryEl.on('focus', () => this.cardExpiryFocused.set(true));
      this.cardExpiryEl.on('blur', () => this.cardExpiryFocused.set(false));

      this.cardCvcEl.on('change', (e) => {
        this.cardCvcComplete.set(e.complete);
        this.cardCvcError.set(e.error?.message ?? '');
      });
      this.cardCvcEl.on('focus', () => this.cardCvcFocused.set(true));
      this.cardCvcEl.on('blur', () => this.cardCvcFocused.set(false));

      this.elementsReady.set(true);
    } catch (err) {
      this.stripeError.set(extractErrorMessage(err, 'Failed to mount Stripe elements. Please try again.'));
    }
  }

  private destroyElements(): void {
    this.elementsReady.set(false);
    this.cardNumberEl?.destroy();
    this.cardExpiryEl?.destroy();
    this.cardCvcEl?.destroy();
    this.cardNumberEl = null;
    this.cardExpiryEl = null;
    this.cardCvcEl = null;
  }
}
