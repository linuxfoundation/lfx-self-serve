// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal } from '@angular/core';
import { AkritesScatterPoint, AkritesStatus, AkritesStatusCounts } from '@lfx-one/shared/interfaces';

const STATUS_COLORS: Record<AkritesStatus, { bg: string; border: string }> = {
  unassigned: { bg: '#62748e', border: '#fff' },
  open: { bg: '#009aff', border: '#fff' },
  assessing: { bg: '#7c3aed', border: '#fff' },
  active: { bg: '#22c55e', border: '#fff' },
  needs_attention: { bg: '#f97316', border: '#fff' },
  escalated: { bg: '#e5484d', border: '#fff' },
  blocked: { bg: 'transparent', border: '#e5484d' },
  inactive: { bg: 'transparent', border: '#90a1b9' },
};

const STATUS_LABELS: Record<AkritesStatus, string> = {
  unassigned: 'Unassigned',
  needs_attention: 'Needs attention',
  escalated: 'Escalated',
  blocked: 'Blocked',
  inactive: 'Inactive',
  open: 'Open',
  assessing: 'Assessing',
  active: 'Active',
};

const STATUS_ORDER: AkritesStatus[] = ['unassigned', 'needs_attention', 'escalated', 'blocked', 'inactive', 'open', 'assessing', 'active'];

const DEFAULT_HIDDEN = new Set<AkritesStatus>();

const EMPTY_STATUS_COUNTS: AkritesStatusCounts = {
  all: 0,
  unassigned: 0,
  open: 0,
  assessing: 0,
  active: 0,
  needs_attention: 0,
  escalated: 0,
  blocked: 0,
  inactive: 0,
};

@Component({
  selector: 'lfx-akrites-risk-matrix-tab',
  imports: [],
  templateUrl: './akrites-risk-matrix-tab.component.html',
})
export class AkritesRiskMatrixTabComponent {
  public readonly points = input<AkritesScatterPoint[]>([]);
  public readonly loading = input(false);
  public readonly statusCounts = input<AkritesStatusCounts>(EMPTY_STATUS_COUNTS);
  public readonly packageClick = output<string>();

  protected readonly statusOrder = STATUS_ORDER;
  protected readonly hiddenStatuses = signal<Set<AkritesStatus>>(new Set(DEFAULT_HIDDEN));

  protected readonly visiblePoints = computed(() => {
    const hidden = this.hiddenStatuses();
    return this.points().filter((p) => !hidden.has(p.status));
  });

  protected statusCount(status: AkritesStatus): number {
    return this.statusCounts()[status];
  }

  protected toggleStatus(status: AkritesStatus): void {
    const current = new Set(this.hiddenStatuses());
    if (current.has(status)) {
      current.delete(status);
    } else {
      current.add(status);
    }
    this.hiddenStatuses.set(current);
  }

  protected isStatusVisible(status: AkritesStatus): boolean {
    return !this.hiddenStatuses().has(status);
  }

  protected dotLeft(healthScore: number | null): string {
    return `${6 + (healthScore ?? 50) * 0.88}%`;
  }

  protected dotTop(impactScore: number | null): string {
    return `${6 + (100 - (impactScore ?? 50)) * 0.88}%`;
  }

  protected dotBg(status: AkritesStatus): string {
    return STATUS_COLORS[status].bg;
  }

  protected dotBorderColor(status: AkritesStatus): string {
    return STATUS_COLORS[status].border;
  }

  protected legendDotBg(status: AkritesStatus): string {
    return STATUS_COLORS[status].bg;
  }

  protected legendDotBorderColor(status: AkritesStatus): string {
    const c = STATUS_COLORS[status];
    return c.bg === 'transparent' ? c.border : c.bg;
  }

  protected statusLabel(status: AkritesStatus): string {
    return STATUS_LABELS[status];
  }

  protected getHealthLabel(score: number | null): string {
    if (score === null) return '—';
    if (score >= 70) return 'Healthy';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Concerning';
    return 'Critical';
  }
}
