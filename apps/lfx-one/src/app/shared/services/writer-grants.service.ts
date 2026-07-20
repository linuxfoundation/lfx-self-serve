// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, computed, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CreatableProject, Project } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { ProjectService } from '@services/project.service';
import { map } from 'rxjs';

/**
 * The user's per-project `writer` grants — the same signal `writerGuard` enforces.
 *
 * `GET /api/projects` batch access-checks every visible project and returns `writer` per
 * project, so this reflects real authorization rather than inferring it from a persona.
 * Owned here rather than in a consumer because two independent consumers need it and must
 * not depend on each other:
 *  - {@link LensService} widens the allowed lens set to cover projects the user can write
 *    to (LFXV2-2754) — a `writer` grant is authority over that project, so the lens that
 *    reaches it must be available regardless of which persona was detected.
 *  - {@link CreatePermissionService} scopes the create quick-link to the same grants.
 *
 * Dependency direction matters: this service injects only `ProjectService` (which injects
 * only `HttpClient`), so `LensService` can consume it without a cycle.
 *
 * Resolves to `[]` while loading and on error — callers fail closed. The error half relies
 * on `ProjectService.getProjects()` catching internally and emitting `[]`; a local
 * `catchError` here would be unreachable.
 */
@Injectable({
  providedIn: 'root',
})
export class WriterGrantsService {
  private readonly projectService = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly grants = signal<CreatableProject[]>([]);

  /** Projects the user holds `writer` on. Empty until the post-hydration fetch resolves. */
  public readonly writerProjects: Signal<CreatableProject[]> = this.grants.asReadonly();

  /** True once at least one writer-held project satisfies `computeIsFoundation`. */
  public readonly hasWriterFoundation: Signal<boolean> = computed(() => this.grants().some((project) => project.isFoundation));

  /** True once at least one writer-held project is a non-foundation project. */
  public readonly hasWriterProject: Signal<boolean> = computed(() => this.grants().some((project) => !project.isFoundation));

  public constructor() {
    // Fetch after hydration, not at construction. The endpoint paginates every visible project
    // and batch access-checks them, so a pending task would block SSR serialization on TTFB for
    // every page. `afterNextRender` runs browser-only, once the first render is committed, so the
    // server and the client's first pass agree and the widened lens set lands as a normal state
    // update rather than a hydration mismatch.
    afterNextRender(() => {
      this.projectService
        .getProjects()
        .pipe(
          map((projects) => projects.filter((project) => project.writer === true).map(toCreatableProject)),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((projects) => this.grants.set(projects));
    });
  }
}

/**
 * Project a raw `Project` down to the fields the create picker and lens derivation need.
 *
 * `isFoundation` is computed from the project's own attributes rather than read from any
 * viewer-scoped field, so it stays correct regardless of the caller's persona — it decides both
 * which lens the project requires and which slot a selection is dispatched to.
 */
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
