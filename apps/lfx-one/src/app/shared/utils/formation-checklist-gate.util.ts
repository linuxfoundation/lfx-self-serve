// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { isFormationStageGate } from '@lfx-one/shared/utils';
import { firstValueFrom } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';
import { ProjectService } from '../services/project.service';

/**
 * The two halves of the Formation checklist route gate, shared by `formationProjectEnabledGuard`
 * (`/project/formation`, CanMatch) and `formationOverviewRedirectGuard` (`/project/overview`,
 * CanActivate) so both routes evaluate the same conjunction and can never disagree — a disagreement
 * would bounce the user between the two routes (#2754).
 *
 * Both take their services as parameters rather than calling `inject()` themselves: the guards
 * `await` these, and `inject()` after the first `await` throws outside the injection context.
 */

/**
 * Resolves `formation-enabled` for a route guard. A locally pinned override decides on its own,
 * before the provider is consulted at all — waiting first would let a readiness timeout answer for
 * it, and a pinned `false` must never be overridden (non-production builds only, see
 * `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`). Otherwise waits for provider readiness via
 * `waitForReady` (reported to RUM on timeout) and resolves `false` when it never arrives — what the
 * caller does with `false` (fail open or closed) is the guard's call, not this helper's, and so is
 * the budget: the default is `FEATURE_FLAG_READY_TIMEOUT_MS`, shared with every guard that goes
 * through `waitForReady`, and a guard that only redirects an already-rendered page passes a shorter
 * `timeoutMs`.
 */
export async function resolveFormationFlag(featureFlagService: FeatureFlagService, guard: string, timeoutMs?: number): Promise<boolean> {
  const override = featureFlagService.getFlagOverride(FORMATION_ENABLED_FLAG);
  if (override !== undefined) {
    return override;
  }

  if (!featureFlagService.providerReady()) {
    const context = { guard, flag: FORMATION_ENABLED_FLAG };
    const ready = timeoutMs === undefined ? await featureFlagService.waitForReady(context) : await featureFlagService.waitForReady(context, timeoutMs);
    if (!ready) {
      return false;
    }
  }

  return featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false)();
}

/**
 * True when the project named by `slug` is in a stage that has a Formation checklist
 * (`isFormationStageGate`). `ProjectService.getProject` is `shareReplay`-cached per slug and maps
 * not-found and transient errors to `null`, so this never rejects and shares one HTTP request with
 * `projectQueryParamGuard` on the same navigation.
 */
export async function isFormationChecklistProject(projectService: ProjectService, slug: string): Promise<boolean> {
  const project = await firstValueFrom(projectService.getProject(slug, false));
  return isFormationStageGate(project?.stage);
}
