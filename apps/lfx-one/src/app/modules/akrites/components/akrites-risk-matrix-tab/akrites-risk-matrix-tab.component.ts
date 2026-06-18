// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AkritesScatterPoint, AkritesStatus, AkritesStatusCounts } from '@lfx-one/shared/interfaces';
import { CheckboxComponent } from '@shared/components/checkbox/checkbox.component';

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
  imports: [CheckboxComponent, ReactiveFormsModule],
  templateUrl: './akrites-risk-matrix-tab.component.html',
})
export class AkritesRiskMatrixTabComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  public readonly points = input<AkritesScatterPoint[]>([]);
  public readonly loading = input(false);
  public readonly statusCounts = input<AkritesStatusCounts>(EMPTY_STATUS_COUNTS);
  public readonly packageClick = output<string>();
  public readonly filterChange = output<AkritesStatus[]>();

  protected readonly statusOrder = STATUS_ORDER;

  protected readonly statusFilterForm: FormGroup = this.fb.group(Object.fromEntries(STATUS_ORDER.map((s) => [s, true])));

  protected readonly checkedCount = signal(STATUS_ORDER.length);

  public constructor() {
    this.statusFilterForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((values) => {
      const visible = STATUS_ORDER.filter((s) => !!values[s]);
      this.checkedCount.set(visible.length);
      this.filterChange.emit(visible.length > 0 ? visible : [...STATUS_ORDER]);
    });
  }

  protected isChecked(status: AkritesStatus): boolean {
    return !!this.statusFilterForm.get(status)?.value;
  }

  protected statusCount(status: AkritesStatus): number {
    return this.statusCounts()[status] ?? 0;
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
