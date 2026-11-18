// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, input, PLATFORM_ID, type Signal, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HEALTH_METRICS_WORLD_MAP_EMPTY_FILL, HEALTH_METRICS_WORLD_MAP_RAMP } from '@lfx-one/shared/constants';
import { buildHealthMetricsWorldMapView, placeHealthMetricsChartTip } from '@lfx-one/shared/utils';
import { WorldGeometryService } from '@services/world-geometry.service';
import { of } from 'rxjs';

import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type {
  HealthMetricsWorldGeometry,
  HealthMetricsWorldMapCountry,
  HealthMetricsWorldMapPath,
  HealthMetricsWorldMapTipPlacement,
  HealthMetricsWorldMapView,
} from '@lfx-one/shared/interfaces';

/**
 * The design's world choropleth: every country filled on a log scale of its value, the chart popup on hover, and a legend
 * under it. The outlines load once in the browser; a visually hidden table lists every country with a value.
 */
@Component({
  selector: 'lfx-health-metrics-world-map',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-world-map.component.html',
  // Escape closes the popup; a resize re-places an open one.
  host: { class: 'block', '(document:keydown.escape)': 'closeTip()', '(window:resize)': 'replaceTip()' },
})
export class HealthMetricsWorldMapComponent {
  private readonly geometryService = inject(WorldGeometryService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');

  public readonly countries = input.required<readonly HealthMetricsWorldMapCountry[]>();
  /** What the value counts, e.g. `Registrations`; it names the popup row, the legend and the map. */
  public readonly label = input.required<string>();
  public readonly testId = input<string>('health-metrics-world-map');

  protected readonly ramp = HEALTH_METRICS_WORLD_MAP_RAMP;
  protected readonly emptyFill = HEALTH_METRICS_WORLD_MAP_EMPTY_FILL;
  protected readonly activeCode = signal<string | null>(null);
  protected readonly tipPlacement = signal<HealthMetricsWorldMapTipPlacement | null>(null);

  /** `undefined` while the outlines load, `null` when they failed, so the map gives way rather than holding a blank box. */
  protected readonly geometry: Signal<HealthMetricsWorldGeometry | null | undefined> = toSignal(
    isPlatformBrowser(this.platformId) ? this.geometryService.getGeometry() : of(undefined),
    { initialValue: undefined }
  );
  protected readonly view: Signal<HealthMetricsWorldMapView | null> = computed(() => {
    const geometry = this.geometry();
    return geometry ? buildHealthMetricsWorldMapView(geometry, this.countries(), this.label()) : null;
  });
  protected readonly activePath: Signal<HealthMetricsWorldMapPath | null> = computed(
    () => this.view()?.paths.find((path) => path.code === this.activeCode()) ?? null
  );
  protected readonly ariaLabel = computed(() => `${this.label()} by country`);
  protected readonly moreLabel = computed(() => `More ${this.label().toLowerCase()}`);
  protected readonly noneLabel = computed(() => `No ${this.label().toLowerCase()}`);

  /** The country under the pointer, kept so a resize can place its popup again. */
  private activeShape: SVGGraphicsElement | null = null;

  protected onEnter(code: string, event: Event): void {
    this.activeShape = event.currentTarget as SVGGraphicsElement;
    this.activeCode.set(code);
    this.tipPlacement.set(this.placeTip(this.activeShape));
  }

  protected onLeave(code: string): void {
    if (this.activeCode() === code) this.closeTip();
  }

  protected closeTip(): void {
    this.activeCode.set(null);
    this.activeShape = null;
  }

  protected replaceTip(): void {
    if (this.activeCode() !== null && this.activeShape) this.tipPlacement.set(this.placeTip(this.activeShape));
  }

  /** Beside the centre of the country's bounding box, 12px off it, as the design places it. */
  private placeTip(shape: SVGGraphicsElement): HealthMetricsWorldMapTipPlacement | null {
    const frame = this.frame()?.nativeElement;
    if (!frame) return null;

    const box = shape.getBoundingClientRect();
    const bounds = frame.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const offsetPct = bounds.width > 0 ? ((centerX - bounds.left) / bounds.width) * 100 : 50;
    const side = placeHealthMetricsChartTip(offsetPct, centerX, document.documentElement.clientWidth);
    return { ...side, top: `${box.top + box.height / 2 - bounds.top}px` };
  }
}
