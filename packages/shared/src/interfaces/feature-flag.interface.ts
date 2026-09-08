// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Identifies the guard and flag waiting on provider readiness, for the RUM error reported on timeout. */
export interface FeatureFlagGuardContext extends Record<string, unknown> {
  guard: string;
  flag: string;
}
