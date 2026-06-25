// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { lfxColors } from '@lfx-one/shared/constants';
import { DonutRing, ResolvedDonutRing } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-donut-chart',
  templateUrl: './donut-chart.component.html',
  styleUrl: './donut-chart.component.scss',
})
export class DonutChartComponent {
  /** Rings ordered from outermost to innermost, each with a value (0–100) and color. */
  public readonly rings = input.required<DonutRing[]>();
  /** Diameter of the chart in px. */
  public readonly size = input<number>(74);
  /** Ring stroke thickness in px. */
  public readonly strokeWidth = input<number>(4);
  /** Track (background ring) color. */
  public readonly trackColor = input<string>(lfxColors.gray[200]);
  /** Gap between ring radii in px — accounts for stroke widths on both rings plus a visual gap. */
  public readonly ringSpacing = input<number>(10);

  protected readonly center = computed(() => this.size() / 2);

  protected readonly resolvedRings = computed<ResolvedDonutRing[]>(() => {
    const sw = this.strokeWidth();
    const c = this.center();
    // sw + 1 ensures at least 1px clearance so the stroke doesn't clip the SVG edge.
    const outerRadius = c - sw / 2 - (sw + 1);
    const spacing = this.ringSpacing();

    return this.rings().map((ring, i) => {
      const r = Math.max(1, outerRadius - i * spacing);
      const circumference = 2 * Math.PI * r;
      const clampedValue = Math.min(100, Math.max(0, ring.value));
      const dash = circumference * (clampedValue / 100);
      return { ...ring, r, circumference, dash };
    });
  });
}
