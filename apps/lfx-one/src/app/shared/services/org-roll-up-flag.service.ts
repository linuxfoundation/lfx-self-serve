// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { FEATURE_FLAG_READY_TIMEOUT_MS, ORG_LENS_ROLLUP_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from './feature-flag.service';

/**
 * The `org-lens-rollup-enabled` dark-launch gate (#4132), read as two signals rather than one boolean.
 *
 * `FeatureFlagService.getBooleanFlag` answers `false` both for "off" and for "not known yet", and the
 * second window is real: LaunchDarkly reports READY for the anonymous bootstrap context before the
 * signed-in user is identified, and during SSR it never answers at all. A roll-up restored from the
 * cookie or a `/org/family-…` address must ride that window out — demoting on it would drop a
 * targeted viewer into one organization and overwrite the cookie that said otherwise.
 *
 * Fails closed: past `FEATURE_FLAG_READY_TIMEOUT_MS` without an identified answer the flag counts as
 * settled and off, the same budget the flag-gated route guards give the provider.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgRollUpFlagService {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly flagValue: Signal<boolean> = this.featureFlagService.getBooleanFlag(ORG_LENS_ROLLUP_ENABLED_FLAG, false);
  private readonly waitExpired: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * True once LaunchDarkly has answered for the signed-in viewer, or a value is pinned locally
   * (non-production builds only) — either is an answer on its own.
   */
  private readonly answered: Signal<boolean> = computed(
    () =>
      this.featureFlagService.getFlagOverride(ORG_LENS_ROLLUP_ENABLED_FLAG) !== undefined ||
      (this.featureFlagService.initialized() && this.featureFlagService.providerReady())
  );

  /** True while the flag's value for the signed-in viewer is not known yet — always on the server. */
  public readonly unsettled: Signal<boolean> = computed(() => !this.answered() && !this.waitExpired());

  /** True once the flag is known to be on for this viewer. False while unsettled, and after an expired wait with no answer. */
  public readonly enabled: Signal<boolean> = computed(() => this.answered() && this.flagValue());

  public constructor() {
    // Browser only: a pending timer would hold SSR's render open, and the server never settles anyway.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setTimeout(() => this.waitExpired.set(true), FEATURE_FLAG_READY_TIMEOUT_MS);
      inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    }
  }
}
