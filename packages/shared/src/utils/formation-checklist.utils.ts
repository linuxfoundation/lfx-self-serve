// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationItem, FormationItemStatus } from '../interfaces/formation.interface';
import type { FormationReadinessSummary } from '../interfaces/formation-checklist.interface';

const EMPTY_COUNTS: Record<FormationItemStatus, number> = {
  not_started: 0,
  in_progress: 0,
  waiting_on_partner: 0,
  done: 0,
  skipped: 0,
};

/**
 * Client-side stand-in for the readiness strip. TODO(#1957): delete this call site once the
 * backend returns a pre-computed `readiness_summary` — see the doc comment on
 * {@link FormationReadinessSummary}.
 */
export function deriveFormationReadinessSummary(items: FormationItem[]): FormationReadinessSummary {
  const counts = { ...EMPTY_COUNTS };
  let openGatingItems = 0;
  let totalGatingItems = 0;

  for (const item of items) {
    counts[item.status] += 1;
    if (item.is_gating) {
      totalGatingItems += 1;
      if (item.status !== 'done') openGatingItems += 1;
    }
  }

  return {
    segments: items.map((item) => item.status),
    totalItems: items.length,
    counts,
    isActivating: totalGatingItems > 0 && openGatingItems === 0,
    openGatingItems,
    totalGatingItems,
  };
}
