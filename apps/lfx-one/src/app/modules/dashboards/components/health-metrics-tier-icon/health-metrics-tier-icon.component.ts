// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { HEALTH_METRICS_MEMBERS_TIER_ICONS } from '@lfx-one/shared/constants';

import type { HealthMetricsMembersReservedTier } from '@lfx-one/shared/interfaces';

/** The 14px Diamond, Platinum, Gold or Silver tier icon: a gradient cut to shape by a mask. Decorative; the tier's name sits beside it. */
@Component({
  selector: 'lfx-health-metrics-tier-icon',
  templateUrl: './health-metrics-tier-icon.component.html',
  host: { class: 'inline-block flex-none', 'aria-hidden': 'true' },
})
export class HealthMetricsTierIconComponent {
  public readonly tier = input.required<HealthMetricsMembersReservedTier>();

  protected readonly style = computed(() => {
    const icon = HEALTH_METRICS_MEMBERS_TIER_ICONS[this.tier()];
    return { background: icon.background, 'border-radius': icon.radius, mask: icon.mask, '-webkit-mask': icon.mask };
  });
}
