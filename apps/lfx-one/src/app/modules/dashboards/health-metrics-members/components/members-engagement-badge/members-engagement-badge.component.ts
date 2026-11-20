// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, inject, input, signal } from '@angular/core';

import { HealthMetricsChartTipComponent } from '../../../components/health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsMembersDirectoryEngagementView } from '@lfx-one/shared/interfaces';

/** The All members Engagement badge: "{Level} {score}", opening its chart-style popup above it on hover or keyboard focus. */
@Component({
  selector: 'lfx-members-engagement-badge',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, HealthMetricsChartTipComponent],
  templateUrl: './members-engagement-badge.component.html',
  host: { class: 'inline-flex' },
})
export class MembersEngagementBadgeComponent {
  private readonly idGenerator = inject(_IdGenerator);

  public readonly engagement = input.required<HealthMetricsMembersDirectoryEngagementView>();

  protected readonly tipId = this.idGenerator.getId('lfx-members-engagement-tip-');
  // Above the badge, centred, 6px off; below it when there is no room.
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
  ];
  protected readonly open = signal(false);
}
