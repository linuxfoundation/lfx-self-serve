// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { inject, Injectable, PLATFORM_ID, TransferState } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Stripe } from '@stripe/stripe-js';

import { getRuntimeConfig } from '@app/shared/providers/runtime-config.provider';

// SSR-safe Stripe.js loader — mirrors the Vue useStripe composable; dynamically imported to keep window off the SSR bundle.
@Injectable({
  providedIn: 'root',
})
export class StripeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);

  private stripePromise: Promise<Stripe | null> | null = null;
  private loadedKey = '';

  // Returns the cached Stripe instance (null on server or when publishable key is absent).
  public getStripe(): Promise<Stripe | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve(null);
    }

    const { stripePublishableKey } = getRuntimeConfig(this.transferState);

    if (!stripePublishableKey) {
      return Promise.resolve(null);
    }

    if (!this.stripePromise || this.loadedKey !== stripePublishableKey) {
      this.loadedKey = stripePublishableKey;
      this.stripePromise = import('@stripe/stripe-js')
        .then(({ loadStripe }) => loadStripe(stripePublishableKey))
        .catch((err) => {
          this.stripePromise = null;
          this.loadedKey = '';
          return Promise.reject(err);
        });
    }

    return this.stripePromise;
  }
}
