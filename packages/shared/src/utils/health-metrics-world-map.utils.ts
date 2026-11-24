// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COUNTRIES } from '../constants/countries.constants';
import {
  HEALTH_METRICS_COUNTRY_NAME_EXTRAS,
  HEALTH_METRICS_WORLD_MAP_EMPTY_FILL,
  HEALTH_METRICS_WORLD_MAP_RAMP,
} from '../constants/health-metrics-world-map.constants';

import type { HealthMetricsWorldGeometry, HealthMetricsWorldMapCountry, HealthMetricsWorldMapView } from '../interfaces/health-metrics-world-map.interface';

/**
 * Every country in the geometry, filled on the design's log scale: `floor(log(v) / log(max + 1) × 6)` steps into the ramp,
 * neutral-200 for none. A country the data names with no outline still counts in its totals; it just is not drawn.
 */
export function buildHealthMetricsWorldMapView(
  geometry: HealthMetricsWorldGeometry,
  countries: readonly HealthMetricsWorldMapCountry[],
  label: string
): HealthMetricsWorldMapView {
  const byCode = new Map<string, HealthMetricsWorldMapCountry>();
  for (const country of countries) {
    if (country.code) byCode.set(country.code, country);
  }
  const max = Math.max(0, ...countries.map((country) => country.value));

  return {
    viewBox: `0 0 ${geometry.width} ${geometry.height}`,
    paths: geometry.countries.map((outline) => {
      const country = byCode.get(outline.code);
      const value = country?.value ?? 0;
      const fill = healthMetricsWorldMapFill(value, max);
      return {
        code: outline.code,
        d: outline.d,
        fill,
        tip: {
          title: country?.name ?? outline.name,
          rows: [{ label, value: value > 0 && country ? country.valueLabel : 'None', color: fill, separated: false, inline: true }],
        },
      };
    }),
  };
}

/** A value's fill on the ramp, against the largest value on the map. */
export function healthMetricsWorldMapFill(value: number, max: number): string {
  if (!(value > 0) || !(max > 0)) return HEALTH_METRICS_WORLD_MAP_EMPTY_FILL;

  const steps = HEALTH_METRICS_WORLD_MAP_RAMP.length;
  const step = Math.floor((Math.log(value) / Math.log(max + 1)) * steps);
  return HEALTH_METRICS_WORLD_MAP_RAMP[Math.min(steps - 1, Math.max(0, step))];
}

/** A country's flag as regional-indicator emoji; empty for anything that is not a two-letter code. */
export function formatHealthMetricsCountryFlag(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** Every assigned code's English name, built once: the shared country list, plus the map's extra codes. */
const COUNTRY_NAMES_BY_CODE = new Map<string, string>([
  ...COUNTRIES.map((country) => [country.value, country.label] as const),
  ...Object.entries(HEALTH_METRICS_COUNTRY_NAME_EXTRAS),
]);

/**
 * A country's display name: the standard English name for a known code, else the data's own name read as words, with
 * underscores as spaces and each word capitalised ("united_kingdom" reads "United Kingdom").
 */
export function formatHealthMetricsCountryName(code: string | null, raw: string): string {
  const named = code ? COUNTRY_NAMES_BY_CODE.get(code) : undefined;
  if (named) return named;

  return raw
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
