// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, inject, Signal } from '@angular/core';
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
 * Location.replaceState(). This function subscribes to an access signal and
 * redirects to the lens-appropriate overview when write access is lost.
 *
 * The default predicate is ProjectContextService.canWrite (project-writer-only).
 * Routes whose writerGuard admits additional roles — e.g. meetings, which also
 * authorizes meetingCoordinator and ?committee_uid= committee writers — must
 * pass an `access` signal matching that standard; otherwise a context switch to
 * the entity's project (syncEntityProjectContext) produces a true→false
 * transition and evicts guard-admitted organizers mid-edit.
 *
 * Redirecting to the same lens (foundation→/foundation/overview,
 * project→/project/overview) prevents NavigationService.applyDefaultSelection
 * from overriding the context when the active project does not appear in the
 * foundation items list, which caused a double-redirect to the wrong project.
 *
 * Must be called inside a component constructor (injection context required).
 *
 * skip(1) drops the boot emission — the access signal's value at subscription. That value is
 * false for the default canWrite predicate (pre-load), but caller-built predicates that mirror
 * writerGuard's admission (e.g. MeetingManageComponent.initWriteAccess) are provisionally TRUE
 * while their access legs resolve, so an unresolved leg can never win a race and evict a
 * guard-admitted user mid-edit. Neither boot value is a genuine access-lost signal;
 * the first false after full resolution is the eviction trigger.
 */
export function evictOnWriteAccessLoss(access?: Signal<boolean>): void {
  const router = inject(Router);
  const projectContextService = inject(ProjectContextService);
  const lensService = inject(LensService);
  const destroyRef = inject(DestroyRef);

  toObservable(access ?? projectContextService.canWrite)
    .pipe(
      skip(1),
      filter((hasAccess) => !hasAccess),
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
