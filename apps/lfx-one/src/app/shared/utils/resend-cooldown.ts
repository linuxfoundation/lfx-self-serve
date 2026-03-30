// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, signal } from '@angular/core';

/**
 * Reusable resend cooldown timer for email verification flows.
 * Returns a readonly cooldown signal and start/clear functions.
 */
export function useResendCooldown(destroyRef: DestroyRef) {
  const cooldown = signal(0);
  let interval: ReturnType<typeof setInterval> | null = null;

  const clear = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  destroyRef.onDestroy(clear);

  const start = (seconds = 60) => {
    clear();
    cooldown.set(seconds);
    interval = setInterval(() => {
      const current = cooldown();
      if (current <= 1) {
        cooldown.set(0);
        clear();
      } else {
        cooldown.set(current - 1);
      }
    }, 1000);
  };

  return { cooldown: cooldown.asReadonly(), start, clear };
}
