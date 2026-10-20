// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, signal } from '@angular/core';
import { PLATFORM_AUDIENCE_PLATFORM_OPTIONS } from '@lfx-one/shared/constants';
import type { PlatformAudiencePanelPlatform } from '@lfx-one/shared/interfaces';

import { PlatformAudienceComponent } from '../platform-audience/platform-audience.component';

/**
 * The Monitor tab's campaign-service audience section: one panel per ad platform campaign-service
 * serves an audience read for (Meta, LinkedIn, Microsoft Advertising, Reddit, X), behind its own platform
 * picker. Only the picked platform's panel is mounted, so only one live read runs at a time — X's
 * read holds stats jobs on an ad account shared across foundations, and the four together would
 * spend five platforms' quotas on a tab nobody may scroll to (Reddit's read shares a per-account
 * reporting budget with its metrics read and account monitor).
 */
@Component({
  selector: 'lfx-paid-audience-insights',
  imports: [PlatformAudienceComponent],
  templateUrl: './paid-audience-insights.component.html',
  styleUrl: './paid-audience-insights.component.scss',
})
export class PaidAudienceInsightsComponent {
  public readonly projectSlug = input.required<string>();

  protected readonly platformOptions = PLATFORM_AUDIENCE_PLATFORM_OPTIONS;
  protected readonly selectedPlatform = signal<PlatformAudiencePanelPlatform>('meta-ads');
  protected readonly selectedLabel = computed(() => this.platformOptions.find((option) => option.value === this.selectedPlatform())?.label ?? '');

  protected selectPlatform(platform: PlatformAudiencePanelPlatform): void {
    this.selectedPlatform.set(platform);
  }
}
