// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { ProjectService } from '@services/project.service';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import type { Project } from '@lfx-one/shared/interfaces';
import { isFormationStageGate } from '@lfx-one/shared/utils';
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
   * Mirrors `formationProjectEnabledGuard`'s stage gate without its redirect: a queue deep link can
   * name a project that has since left Formation (the queue itself no longer lists post-Formation
   * projects, LFXV2-3386), and an in-place explanation beats bouncing the auditor to that
   * project's overview — which would also switch their context, the very thing this page avoids.
   */
  protected readonly notInFormation = computed(() => {
    const project = this.project();
    return !!project && !isFormationStageGate(project.stage);
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
