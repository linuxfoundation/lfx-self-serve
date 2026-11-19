// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';

/** The map's log-scale fill, fewest to most: blue-200 to blue-700. */
export const HEALTH_METRICS_WORLD_MAP_RAMP: readonly string[] = [
  lfxColors.blue[200],
  lfxColors.blue[300],
  lfxColors.blue[400],
  lfxColors.blue[500],
  lfxColors.blue[600],
  lfxColors.blue[700],
];

/** A country with nothing to show. */
export const HEALTH_METRICS_WORLD_MAP_EMPTY_FILL = lfxColors.gray[200];

/** The geometry asset, loaded once on first use. */
export const HEALTH_METRICS_WORLD_GEOMETRY_URL = '/assets/health-metrics/world-countries-110m.json';

/** Names for the codes the map keys a country by that the shared country list does not hold. */
export const HEALTH_METRICS_COUNTRY_NAME_EXTRAS: Readonly<Record<string, string>> = { XK: 'Kosovo' };
