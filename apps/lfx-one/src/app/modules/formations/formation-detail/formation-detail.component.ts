// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { ProjectService } from '@services/project.service';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import type { FormationChecklistResponse, FormationDetailPageState } from '@lfx-one/shared/interfaces';
import { isPostFormationStage } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { FormationCardComponent } from '../../dashboards/components/formation-card/formation-card.component';
import { FormationChecklistSectionComponent } from '../../dashboards/components/formation-checklist-section/formation-checklist-section.component';
import { FormationPeopleCardComponent } from '../../dashboards/components/formation-people-card/formation-people-card.component';

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
  imports: [RouterLink, SkeletonModule, EmptyStateComponent, FormationCardComponent, FormationChecklistSectionComponent, FormationPeopleCardComponent],
  templateUrl: './formation-detail.component.html',
  styleUrl: './formation-detail.component.scss',
})
export class FormationDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);

  /** Re-fires the project lookup after a transient failure (`loadFailed` Retry). */
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  private readonly projectSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('projectSlug'))), {
    initialValue: this.route.snapshot.paramMap.get('projectSlug'),
  });
  private readonly state: Signal<FormationDetailPageState> = this.initState();
  protected readonly projectLoading = computed(() => this.state().loading);
  protected readonly loadFailed = computed(() => this.state().error);
  protected readonly project = computed(() => this.state().project);
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

  /**
   * The checklist the section just fetched, which also feeds the sidebar card (#2719). The card
   * cannot resolve itself here the way it does on the project dashboard: `ProjectContextService`
   * describes the *parent foundation* on this page by design, so it would pair the foundation's
   * slug with this child project's checklist. The response carries the child's own name, slug,
   * sub-stage and announcement date, behind the same read that rendered the checklist.
   *
   * Tagged with the slug it was fetched for, and `activeChecklist` below only resolves on a match. The
   * section cannot clear this itself on a project switch the way it does on `/project/formation`:
   * a route-param change here sends `initState` back through its `startWith({ loading: true })`,
   * which tears the whole resolved branch — section included — out of the template, so the
   * remounted section is a fresh instance with nothing to compare against and emits no clear. An
   * untagged copy would then pair the previous child's slug, date and admin-tool link with the new
   * project's heading and loading checklist. The tag also covers a late emit from a section that
   * was already showing a different slug.
   */
  protected readonly checklist = signal<{ slug: string; response: FormationChecklistResponse } | null>(null);
  /**
   * The slug-matched checklist response, or `null` — gates the rail so no blank fixed-width column
   * is reserved while the checklist loads, and hands both rail cards (formation, people — #2724)
   * the CHILD project's response rather than anything context-derived.
   */
  protected readonly activeChecklist = computed(() => {
    const loaded = this.checklist();
    return loaded && loaded.slug === this.project()?.slug ? loaded.response : null;
  });

  public constructor() {
    bindLfxDocumentTitle(computed(() => this.project()?.name));
  }

  protected onRetry(): void {
    this.retry$.next(undefined);
  }

  protected onChecklistLoaded(response: FormationChecklistResponse | null): void {
    const slug = this.project()?.slug;
    this.checklist.set(response && slug ? { slug, response } : null);
  }

  private initState(): Signal<FormationDetailPageState> {
    // Strict slug lookup (`getProjectStrict`, which also never touches ProjectService's global
    // `project` signal): HTTP failures propagate so they can be classified per
    // `newsletter-reader.component.ts`'s pattern — 400/404 is the expected "no such project" path
    // (the not-found branch, matching `projectQueryParamGuard`'s treatment of a bad slug), anything
    // else (gateway 5xx, network) is transient and renders the retryable error state instead of
    // masquerading as a permanent 404. `getProjectStrict` evicts its cache entry on error, so
    // `retry$` genuinely re-fetches.
    return toSignal(
      combineLatest([toObservable(this.projectSlug).pipe(distinctUntilChanged()), this.retry$]).pipe(
        switchMap(([slug]) => {
          if (!slug) {
            return of<FormationDetailPageState>({ loading: false, error: false, project: null });
          }
          return this.projectService.getProjectStrict(slug).pipe(
            map((project): FormationDetailPageState => ({ loading: false, error: false, project })),
            catchError((err: unknown) => {
              const status = (err as { status?: unknown })?.status;
              if (typeof status === 'number' && [400, 404].includes(status)) {
                return of<FormationDetailPageState>({ loading: false, error: false, project: null });
              }
              console.error('[FormationDetail] Failed to load project', err);
              return of<FormationDetailPageState>({ loading: false, error: true, project: null });
            }),
            // Back to the skeleton on every (slug, retry) trigger — without this a retry would
            // leave the error banner up until the re-fetch resolves.
            startWith<FormationDetailPageState>({ loading: true, error: false, project: null })
          );
        })
      ),
      { initialValue: { loading: true, error: false, project: null } }
    );
  }
}
