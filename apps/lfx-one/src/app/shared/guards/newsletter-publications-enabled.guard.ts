// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { NEWSLETTER_ENHANCED_EDITOR_DEFAULT, NEWSLETTER_ENHANCED_EDITOR_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * Keeps the publication form behind the enhanced-editor flag (#4349). SSR defers to the browser
 * because LaunchDarkly is unavailable there, and the browser fails closed if the provider is slow.
 */
export const newsletterPublicationsEnabledGuard: CanMatchFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }
  const featureFlagService = inject(FeatureFlagService);
  const override = featureFlagService.getFlagOverride(NEWSLETTER_ENHANCED_EDITOR_FLAG);
  if (override !== undefined) {
    return override;
  }
  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'newsletterPublicationsEnabledGuard', flag: NEWSLETTER_ENHANCED_EDITOR_FLAG });
    if (!ready) return false;
  }
  return featureFlagService.getBooleanFlag(NEWSLETTER_ENHANCED_EDITOR_FLAG, NEWSLETTER_ENHANCED_EDITOR_DEFAULT)();
};
