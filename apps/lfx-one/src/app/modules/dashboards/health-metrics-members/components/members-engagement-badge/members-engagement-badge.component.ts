// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';

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
  private readonly destroyRef = inject(DestroyRef);

  public readonly engagement = input.required<HealthMetricsMembersDirectoryEngagementView>();

  protected readonly tipId = this.idGenerator.getId('lfx-members-engagement-tip-');
  // Above the badge, centred, 6px off; below it when there is no room.
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
  ];
  /** Open while the badge or popup is hovered, or the badge has focus; Escape dismisses it until the next hover or focus. */
  protected readonly open = computed(() => this.hovered() || this.focused());

  private readonly hovered = signal(false);
  private readonly focused = signal(false);
  // Milliseconds the pointer may spend crossing from the badge onto the popup, so it can be read up close.
  private readonly graceMs = 120;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => this.cancelHide());
  }

  protected onPointerEnter(): void {
    this.cancelHide();
    this.hovered.set(true);
  }

  /** Leaving the badge or the popup waits a moment, so moving between them keeps it open. */
  protected onPointerLeave(): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hovered.set(false), this.graceMs);
  }

  protected onFocus(): void {
    this.focused.set(true);
  }

  protected onBlur(): void {
    this.focused.set(false);
  }

  protected dismiss(): void {
    this.cancelHide();
    this.hovered.set(false);
    this.focused.set(false);
  }

  protected onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.dismiss();
  }

  protected cancelHide(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
