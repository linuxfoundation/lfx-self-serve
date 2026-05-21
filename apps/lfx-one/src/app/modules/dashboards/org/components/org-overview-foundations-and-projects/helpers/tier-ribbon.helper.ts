// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MembershipTierClass, OrgLensRowKind } from '@lfx-one/shared/interfaces';

/**
 * Tier-ribbon pill palette.
 *
 * Rank-banded mapping into 4 LFX semantic families:
 * - Top-4 (premium):    Platinum / Premier / Founding / Strategic → violet
 * - Mid (sponsor):      Gold / Steering / Silver                  → amber
 * - Standard:           General / Associate                       → blue
 * - Free / observer:    End User / Academic / Contributor / Other → gray
 * - Non-member LF row:                                            → amber outline
 * - Outside LF row:                                               → gray
 *
 * Every class string resolves through `lfxColors` via the Tailwind
 * theme extension (apps/lfx-one/tailwind.config.js wires `theme.extend
 * .colors = lfxColors`). NO raw hex; NO non-LFX palettes.
 */
export function tierRibbonClasses(tierClass: MembershipTierClass | null | undefined, rowKind: OrgLensRowKind): string {
  if (rowKind === 'outside_lf') {
    return 'bg-gray-100 text-gray-600';
  }

  if (rowKind === 'non_member') {
    return 'bg-amber-50 text-amber-700 border border-amber-200';
  }

  switch (tierClass) {
    case 'Platinum':
    case 'Premier':
    case 'Founding':
    case 'Strategic':
      return 'bg-violet-100 text-violet-700';
    case 'Gold':
    case 'Steering':
    case 'Silver':
      return 'bg-amber-100 text-amber-700';
    case 'General':
    case 'Associate':
      return 'bg-blue-100 text-blue-700';
    case 'End User':
    case 'Academic':
    case 'Contributor':
    case 'Other':
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
