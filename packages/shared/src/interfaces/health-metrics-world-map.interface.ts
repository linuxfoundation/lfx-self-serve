// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsChartTipView } from './health-metrics-l2.interface';

/** One country's outline in the world geometry asset, keyed by ISO 3166-1 alpha-2. */
export interface HealthMetricsWorldGeometryCountry {
  code: string;
  name: string;
  /** SVG path data in the asset's coordinate space. */
  d: string;
}

/** The world geometry asset: an equirectangular projection `width` × `height` units across. */
export interface HealthMetricsWorldGeometry {
  source: string;
  width: number;
  height: number;
  countries: HealthMetricsWorldGeometryCountry[];
}

/** One country's figure for the map. */
export interface HealthMetricsWorldMapCountry {
  /** ISO 3166-1 alpha-2; `null` when the data has no code, so the country is not drawn. */
  code: string | null;
  name: string;
  value: number;
  /** The popup's value, e.g. `1,204 · 12%`. */
  valueLabel: string;
}

/** One drawn country with its fill and popup. */
export interface HealthMetricsWorldMapPath {
  code: string;
  d: string;
  fill: string;
  tip: HealthMetricsChartTipView;
}

/** The map ready to draw. */
export interface HealthMetricsWorldMapView {
  viewBox: string;
  paths: HealthMetricsWorldMapPath[];
}

/** Where the popup sits in the map, as CSS lengths off its edges. */
export interface HealthMetricsWorldMapTipPlacement {
  left: string | null;
  right: string | null;
  top: string;
}
