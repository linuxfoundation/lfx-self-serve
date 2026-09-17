// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { ProjectService } from '@services/project.service';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import type { Project } from '@lfx-one/shared/interfaces';
import { isPostFormationStage } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { distinctUntilChanged, finalize, map, of, switchMap } from 'rxjs';

import { FormationChecklistSectionComponent } from '../../dashboards/components/formation-checklist-section/formation-checklist-section.component';

/**
 * Foundation-lens drill-down for one queue row (`/foundation/formations/:projectSlug`,
 * LFXV2-3386): renders a child project's formation checklist while the project context — sidebar,
 * `?project=` query param, cookie-persisted selections — stays on the parent foundation. The child
 * is addressed purely by the path param (the `/org/projects/:projectSlug` pattern), never via
 * `ProjectContextService`, which is exactly why this page exists instead of linking the queue rows
 * to `/project/formation?project=<child>` (that route's guard chain would switch the whole context).
 */
@Component({
  selector: 'lfx-formation-detail',
  imports: [RouterLink, SkeletonModule, EmptyStateComponent, FormationChecklistSectionComponent],
  templateUrl: './formation-detail.component.html',
  styleUrl: './formation-detail.component.scss',
})
export class FormationDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);

  protected readonly projectLoading = signal(true);

  private readonly projectSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('projectSlug'))), {
    initialValue: this.route.snapshot.paramMap.get('projectSlug'),
  });
  protected readonly project: Signal<Project | null> = this.initProject();
  /**
   * The exact complement of the queue's row predicate (`isPostFormationStage`, LFXV2-3386): every
   * row the queue lists — including `Formation - Disengaged` and unrecognized stages, which the
   * queue deliberately keeps visible (GH-2366 fail-open) — must open here, so only a stale deep
   * link to a project that has actually gone Active/Archived gets the in-place explanation.
   * Deliberately NOT `!isFormationStageGate` (the `/project/formation` guard's gate): that would
   * dead-end Disengaged/unknown-stage rows the queue itself just linked. In-place beats bouncing
   * to the project overview — which would also switch context, the very thing this page avoids.
   */
  protected readonly postFormation = computed(() => {
    const project = this.project();
    return !!project && isPostFormationStage(project.stage);
  });

  public constructor() {
    bindLfxDocumentTitle(computed(() => this.project()?.name));
  }

  private initProject(): Signal<Project | null> {
    // `getProject(slug, current: false)` — `current: false` keeps this lookup out of
    // `ProjectService`'s global `project` signal, so viewing a child's checklist never leaks into
    // the ambient project state. The service maps not-found and transient errors to `null` (the
    // same treatment `projectQueryParamGuard` relies on), which renders the not-found state below.
    return toSignal(
      toObservable(this.projectSlug).pipe(
        distinctUntilChanged(),
        switchMap((slug) => {
          if (!slug) {
            this.projectLoading.set(false);
            return of(null);
          }
          this.projectLoading.set(true);
          return this.projectService.getProject(slug, false).pipe(finalize(() => this.projectLoading.set(false)));
        })
      ),
      { initialValue: null }
    );
  }
}
