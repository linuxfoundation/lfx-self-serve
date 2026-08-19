// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CanMatchFn } from '@angular/router';

/**
 * CanMatch guard for /project|foundation/mktg-os-agents.
 *
 * TODO(mktg-os GA): flag gate bypassed for now (Joan, 2026-08-19) — the
 * marketplace ships visible while it iterates. Restore the LaunchDarkly
 * `mktg-os-agents-enabled` check (provider-READY wait, fail closed) from git
 * history before GA hardening.
 */
export const mktgOsAgentsEnabledGuard: CanMatchFn = () => true;
