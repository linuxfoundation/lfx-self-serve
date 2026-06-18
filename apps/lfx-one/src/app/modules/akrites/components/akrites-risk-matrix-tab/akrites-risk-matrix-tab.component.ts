// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, output, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AkritesScatterPoint, AkritesScatterPointVM, AkritesLegendItemVM, AkritesStatus, AkritesStatusCounts } from '@lfx-one/shared/interfaces';
import { AKRITES_STATUS_COLORS, AKRITES_STATUS_LABELS, AKRITES_STATUS_ORDER, AKRITES_EMPTY_STATUS_COUNTS } from '@lfx-one/shared/constants';
import { CheckboxComponent } from '@shared/components/checkbox/checkbox.component';

@Component({
  selector: 'lfx-akrites-risk-matrix-tab',
  imports: [CheckboxComponent, ReactiveFormsModule],
  templateUrl: './akrites-risk-matrix-tab.component.html',
  styleUrl: './akrites-risk-matrix-tab.component.scss',
})
export class AkritesRiskMatrixTabComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  public readonly points = input<AkritesScatterPoint[]>([]);
  public readonly loading = input(false);
  public readonly statusCounts = input<AkritesStatusCounts>(AKRITES_EMPTY_STATUS_COUNTS);
  public readonly packageClick = output<string>();
  public readonly filterChange = output<AkritesStatus[]>();

  protected readonly statusOrder = AKRITES_STATUS_ORDER;

  protected readonly statusFilterForm: FormGroup = this.fb.group(Object.fromEntries(AKRITES_STATUS_ORDER.map((s) => [s, true])));

  protected readonly checkedCount = signal(AKRITES_STATUS_ORDER.length);

  // Pre-compute scatter point view models with all position/color/label calculations
  protected readonly pointVMs = computed<AkritesScatterPointVM[]>(() =>
    this.points().map((p) => ({
      ...p,
      left: `${6 + (p.healthScore ?? 50) * 0.88}%`,
      top: `${6 + (100 - (p.impactScore ?? 50)) * 0.88}%`,
      bg: AKRITES_STATUS_COLORS[p.status].bg,
      borderColor: AKRITES_STATUS_COLORS[p.status].border,
      healthLabel: this.computeHealthLabel(p.healthScore),
      statusLabel: AKRITES_STATUS_LABELS[p.status],
    }))
  );

  // Pre-compute legend items with all color and label calculations
  protected readonly legendItems = computed<AkritesLegendItemVM[]>(() =>
    AKRITES_STATUS_ORDER.map((status) => {
      const c = AKRITES_STATUS_COLORS[status];
      return {
        status,
        bg: c.bg,
        borderColor: c.bg === 'transparent' ? c.border : c.bg,
        label: AKRITES_STATUS_LABELS[status],
        count: this.statusCounts()[status] ?? 0,
      };
    })
  );

  public constructor() {
    this.statusFilterForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((values) => {
      const visible = AKRITES_STATUS_ORDER.filter((s) => !!values[s]);
      this.checkedCount.set(visible.length);
      this.filterChange.emit(visible.length > 0 ? visible : [...AKRITES_STATUS_ORDER]);
    });
  }

  protected isChecked(status: AkritesStatus): boolean {
    return !!this.statusFilterForm.get(status)?.value;
  }

  protected statusCount(status: AkritesStatus): number {
    return this.statusCounts()[status] ?? 0;
  }

  private computeHealthLabel(score: number | null): string {
    if (score === null) return '—';
    if (score >= 70) return 'Healthy';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Concerning';
    return 'Critical';
  }
}
