// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { map } from 'rxjs';

/** Shared URL state for asset tabs, including deep links and history restoration. */
export function createMktgAssetTab<T extends string>(ids: readonly T[], defaultTab: T) {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const projectContext = inject(ProjectContextService);
  const selected = toSignal(route.queryParamMap.pipe(map((params) => ids.find((id) => id === params.get('tab')) ?? defaultTab)), { initialValue: defaultTab });
  const select = (id: T): Promise<boolean> =>
    router.navigate([], {
      relativeTo: route,
      queryParams: { tab: id === defaultTab ? null : id, project: projectContext.activeContext()?.slug ?? null },
      queryParamsHandling: 'merge',
    });
  return { selected, select };
}
