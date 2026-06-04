// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter, skip, take } from 'rxjs';

import { LensService } from '../services/lens.service';
import { ProjectContextService } from '../services/project-context.service';

/**
 * Reactive eviction helper for write-route manage components.
 *
 * Guards are CanActivateFn and only run at navigation time; they do not
 * re-run when the project-context selector switches context via
 * Location.replaceState(). This function subscribes to canWrite and
 * redirects to the lens-appropriate overview when write access is lost.
 *
 * Redirecting to the same lens (foundation→/foundation/overview,
 * project→/project/overview) prevents NavigationService.applyDefaultSelection
 * from overriding the context when the active project does not appear in the
 * foundation items list, which caused a double-redirect to the wrong project.
 *
 * Must be called inside a component constructor (injection context required).
 *
 * skip(1) is safe here because canWrite has initialValue: false and Angular
 * signal dedup collapses consecutive identical values, so the first emission
 * is always the pre-load false — not a genuine access-lost signal.
 */
export function evictOnWriteAccessLoss(): void {
  const router = inject(Router);
  const projectContextService = inject(ProjectContextService);
  const lensService = inject(LensService);
  const destroyRef = inject(DestroyRef);

  toObservable(projectContextService.canWrite)
    .pipe(
      skip(1),
      filter((canWrite) => !canWrite),
      take(1),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe(() => {
      const slug = projectContextService.activeContext()?.slug;
      const lens = lensService.activeLens();
      const overviewPath = lens === 'project' ? '/project/overview' : '/foundation/overview';
      const url = slug ? router.createUrlTree([overviewPath], { queryParams: { project: slug } }) : router.parseUrl(overviewPath);
      router.navigateByUrl(url);
    });
}
