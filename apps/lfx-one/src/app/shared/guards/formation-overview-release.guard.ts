// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

import { ProjectContextService } from '../services/project-context.service';

/**
 * CanDeactivate guard for `/project/overview` (#2754): the release half of
 * `formationOverviewRedirectGuard`'s fail-open record. That guard writes
 * `ProjectContextService.formationOverviewAllowedSlug` when it lets a Formation-stage project's
 * dashboard stand, and `SidebarNavService` keeps the full nav while the record names the selected
 * project. The record describes *that dashboard*, so it must not outlive it: this clears it whenever
 * navigation leaves the overview — to another project page, to the checklist by direct link, or to
 * another project's overview (a query-only change re-runs both guards under
 * `runGuardsAndResolvers: 'paramsOrQueryParamsChange'`, and the redirect guard then decides afresh).
 * Without it, a flag that arrived after the guard's budget would leave the full nav in place on
 * pages where the formation experience hides it. Never blocks navigation.
 */
export const formationOverviewReleaseGuard: CanDeactivateFn<unknown> = () => {
  inject(ProjectContextService).setFormationOverviewAllowedSlug(null);
  return true;
};
