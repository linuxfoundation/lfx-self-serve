// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { StatCardDeltaDirection } from '../interfaces/stat-card.interface';

/** Arrow icon per period-over-period delta direction, shared by stat cards and org-lens trend/influence rows. */
export const DELTA_DIRECTION_ICON: Record<StatCardDeltaDirection, string> = {
  up: 'fa-light fa-arrow-up',
  down: 'fa-light fa-arrow-down',
  flat: 'fa-light fa-minus',
};

/** Text color per period-over-period delta direction, shared by stat cards and org-lens trend/influence rows. */
export const DELTA_DIRECTION_TEXT_CLASS: Record<StatCardDeltaDirection, string> = {
  up: 'text-emerald-700',
  down: 'text-red-600',
  flat: 'text-gray-500',
};
