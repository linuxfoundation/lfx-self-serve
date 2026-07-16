// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, computed, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatableProject, Project } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { ProjectService } from '@services/project.service';
import { map } from 'rxjs';

/**
 * Decides whether the rail "Create" quick-link (and which artifact types) is
 * offered to the current user, and which projects/foundations they may target.
 *
 * Eligibility is the intersection of two independent grants:
 *  - the project `writer` grant — the same signal `writerGuard` enforces.
 *    `GET /api/projects` batch access-checks every visible project and returns
 *    `writer` per project, so this reflects real per-project authorization
 *    rather than inferring it from a persona.
 *  - a lens the user's persona holds. `ProjectContextService.activeContext` is
 *    lens-gated, so the create page can only resolve a selection whose lens can
 *    be aligned. Offering a project outside the user's lenses would dead-end at
 *    "Create". These grants are independent — a pure ED holds no `project` lens
 *    yet may hold `writer` on subprojects — so both must hold.
 *
 * Everything resolves to `[]` while loading and on error, keeping the rail button
 * hidden until eligibility is proven — fail closed. The error half of that relies on
 * `ProjectService.getProjects()` catching internally and emitting `[]`; there is no
 * local `catchError` because one on this stream would be unreachable.
 *
 * Granularity note: `writer` is not the whole story upstream. Meetings are broader
 * (`meeting_coordinator` and committee-writer also qualify), so users holding only
 * those roles are under-shown, as are EDs whose only writable projects fall outside
 * their lenses. This is a UX affordance only — the create routes' `writerGuard`
 * remains authoritative for non-ED personas, so the button never grants access, it
 * only advertises it. A `GET /api/projects/creatable` endpoint encoding the per-type
 * grants would make the list exact and let the create flows resolve their target
 * without the lens, removing that constraint.
 */
@Injectable({
  providedIn: 'root',
})
export class CreatePermissionService {
  private readonly projectService = inject(ProjectService);
  private readonly lensService = inject(LensService);
  private readonly destroyRef = inject(DestroyRef);

  /** Projects the user holds `writer` on, before the lens intersection. */
  private readonly writerProjects = signal<CreatableProject[]>([]);

  /**
   * Projects the user may create on — `writer` intersected with lens reach (see class doc).
   * A `computed` rather than a filter applied at fetch time, so it re-evaluates when persona
   * data resolves and widens the available lenses.
   */
  public readonly creatableProjects: Signal<CreatableProject[]> = computed(() => {
    const lenses = this.lensService.availableLenses();
    return this.writerProjects().filter((project) => lenses.some((lens) => lens.id === (project.isFoundation ? 'foundation' : 'project')));
  });

  /** Artifact types offered to the user — all types when they can create anywhere, else none. */
  public readonly creatableTypes: Signal<CreatableArtifactType[]> = computed(() =>
    this.creatableProjects().length > 0 ? CREATABLE_ARTIFACTS.map((artifact) => artifact.type) : []
  );

  /** True when the user can create on at least one project. */
  public readonly canShowCreateButton: Signal<boolean> = computed(() => this.creatableProjects().length > 0);

  public constructor() {
    // Fetch after hydration, not at construction. Two reasons: the endpoint paginates every
    // visible project and batch access-checks them, so a pending task would block SSR
    // serialization on TTFB for every page; and `profile-affiliations` already issues this exact
    // request during SSR, so the transfer cache would resolve it synchronously here and render
    // the button on the client's first pass while the server rendered it absent — a hydration
    // mismatch. `afterNextRender` runs browser-only, once the first render is committed.
    afterNextRender(() => {
      this.projectService
        .getProjects()
        .pipe(
          map((projects) => projects.filter((project) => project.writer === true).map(toCreatableProject)),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((projects) => this.writerProjects.set(projects));
    });
  }
}

function toCreatableProject(project: Project): CreatableProject {
  return {
    uid: project.uid,
    slug: project.slug,
    name: project.name,
    // Derived from the project's own attributes, so it stays correct regardless of the
    // viewer's persona — it dispatches the selection to the foundation vs project slot.
    isFoundation: computeIsFoundation(project),
    parent_uid: project.parent_uid,
    logoUrl: project.logo_url,
  };
}
