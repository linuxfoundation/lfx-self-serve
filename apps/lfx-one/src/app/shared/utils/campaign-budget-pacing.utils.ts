// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DAILY_ONLY_BUDGET_CAMPAIGN_PLATFORMS } from '@lfx-one/shared/constants';
import type { CampaignBudgetPacingRead, CampaignServiceSettingsReadback } from '@lfx-one/shared/interfaces';
import { campaignBudgetPacingFromSettings } from '@lfx-one/shared/utils';
import { catchError, map, Observable, of, take } from 'rxjs';

/**
 * Whether campaign-service writes this platform's budget as a DAILY amount only (X), so the budget
 * editor offers no lifetime pacing and the campaign's current pacing is read before it can submit.
 * Shared by every surface that mounts `lfx-campaign-budget-form` (the Optimize tab and the Monitor
 * act dialog), so neither can offer X a lifetime change that upstream always refuses 409.
 */
export function isDailyOnlyBudgetPlatform(platform: unknown): boolean {
  return typeof platform === 'string' && DAILY_ONLY_BUDGET_CAMPAIGN_PLATFORMS.has(platform);
}

/**
 * A daily-only-platform campaign's CURRENT budget pacing, from its live settings readback.
 *
 * A pure read (never persisted, no mutating call), completing after one answer. `daily` or
 * `lifetime` once the platform reported one; a failed read or an unreported pacing is `unknown`,
 * which does NOT block the editor — upstream still refuses a campaign it cannot write, and its
 * refusal is shown in full.
 */
export function readCampaignBudgetPacing(settings: Observable<CampaignServiceSettingsReadback>): Observable<Exclude<CampaignBudgetPacingRead, 'pending'>> {
  return settings.pipe(
    take(1),
    map((readback) => campaignBudgetPacingFromSettings(readback)),
    catchError(() => of('unknown' as const))
  );
}
