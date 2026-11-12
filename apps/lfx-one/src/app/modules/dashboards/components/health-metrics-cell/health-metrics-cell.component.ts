// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_TABLE_DASH } from '@lfx-one/shared/constants';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';

import { HealthMetricsTierIconComponent } from '../health-metrics-tier-icon/health-metrics-tier-icon.component';

import type { HealthMetricsCellLead, HealthMetricsMembersReservedTier } from '@lfx-one/shared/interfaces';

/**
 * A Health Metrics table cell's text: optionally led by an icon tile, a person or a company, a tier icon or a status dot,
 * with a one-line description under it. The `td` sets the weight and ink; "—" turns neutral-400. Chips or badges project after the text.
 */
@Component({
  selector: 'lfx-health-metrics-cell',
  imports: [HealthMetricsTierIconComponent, UiAvatarComponent],
  templateUrl: './health-metrics-cell.component.html',
  host: { class: 'relative flex min-w-0 flex-col gap-[2px]', '[class]': 'indentClass()' },
})
export class HealthMetricsCellComponent {
  public readonly text = input.required<string>();
  /** One line under the value, 12px neutral-500, cut with an ellipsis. */
  public readonly description = input<string>('');
  /** An 11px icon before the description. */
  public readonly descriptionIcon = input<string>('');
  /** A 10px icon after the description. */
  public readonly descriptionEndIcon = input<string>('');
  public readonly lead = input<HealthMetricsCellLead | null>(null);
  /** Draws the 14px tier icon before a Diamond, Platinum, Gold or Silver name. */
  public readonly tier = input<HealthMetricsMembersReservedTier | null>(null);
  /** An 8px status dot before the text, e.g. `bg-emerald-500`. */
  public readonly dotClass = input<string>('');

  protected readonly isDash: Signal<boolean> = computed(() => this.text() === HEALTH_METRICS_TABLE_DASH);
  // Exact px: the icon tile's text indents 38px, a person's 42px; a company's description lines up under its name.
  protected readonly indentClass: Signal<string> = computed(() => {
    const kind = this.lead()?.kind;
    if (kind === 'icon') return 'pl-[38px]';
    if (kind === 'person') return 'pl-[42px]';
    return '';
  });
  protected readonly descriptionIndentClass: Signal<string> = computed(() => (this.lead()?.kind === 'company' ? 'pl-[32px]' : ''));
}
