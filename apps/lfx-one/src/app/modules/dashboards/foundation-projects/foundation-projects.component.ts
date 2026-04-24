// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import { DEFAULT_FOUNDATION_PROJECTS_DETAIL } from '@lfx-one/shared/constants';
import { buildLensAwareInsightsUrl } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, finalize, map, of, startWith, switchMap } from 'rxjs';

import type { FoundationProjectsDetailResponse, ProjectTableRow, StatCardItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-foundation-projects',
  imports: [DecimalPipe, ReactiveFormsModule, InputTextComponent, StatCardGridComponent, TableComponent],
  templateUrl: './foundation-projects.component.html',
  styleUrl: './foundation-projects.component.scss',
})
export class FoundationProjectsComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectService = inject(ProjectService);
  private readonly lensService = inject(LensService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  // === Forms ===
  protected readonly searchForm: FormGroup = this.fb.group({
    query: [''],
  });

  // === Simple WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed/toSignal Signals ===
  protected readonly foundationSlug: Signal<string> = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  protected readonly foundationName: Signal<string> = computed(() => this.projectContextService.selectedFoundation()?.name ?? 'The Linux Foundation');
  private readonly rawData: Signal<FoundationProjectsDetailResponse> = this.initRawData();
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly allProjects: Signal<ProjectTableRow[]> = computed(() => this.rawData().projects);
  protected readonly totalProjects: Signal<number> = computed(() => this.allProjects().length);
  protected readonly summaryCards: Signal<StatCardItem[]> = this.initSummaryCards();
  protected readonly filteredProjects: Signal<ProjectTableRow[]> = this.initFilteredProjects();
  // Canonical project-service UIDs keyed by slug, resolved once per foundation change.
  // Used by openProjectLens so lens switching uses the proper upstream UID instead of
  // Snowflake's PROJECT_ID, which may be a Salesforce ID for some foundations per
  // ProjectTableRow JSDoc. `startWith(new Map())` inside the inner switchMap clears
  // any stale map from the previous foundation while the new request is in flight.
  private readonly subProjectUidBySlug: Signal<Map<string, string>> = this.initSubProjectUidBySlug();

  // === Protected Methods ===
  protected getInsightsUrl(slug: string): string {
    return buildLensAwareInsightsUrl(slug, false);
  }

  protected openProjectLens(project: ProjectTableRow): void {
    // Prefer the canonical project-service UID resolved from the foundation's
    // sub-project listing; fall back to Snowflake's PROJECT_ID only if the
    // sub-projects response hasn't landed or the slug isn't in the map. The
    // resolved UID is the identifier committee/mailing-list tagging uses, so
    // lens switching consistently lands on the right project instead of
    // tripping on Salesforce-vs-UUID ambiguity.
    const resolvedUid = this.subProjectUidBySlug().get(project.projectSlug) ?? project.projectId;
    if (!resolvedUid) {
      return;
    }
    this.projectContextService.setProject({
      uid: resolvedUid,
      name: project.projectName,
      slug: project.projectSlug,
    });
    this.lensService.setLens('project');
    this.router.navigate(['/project/overview']);
  }

  // === Private Initializers ===
  private initRawData(): Signal<FoundationProjectsDetailResponse> {
    return toSignal(
      toObservable(this.foundationSlug).pipe(
        switchMap((slug) => {
          // Handle the empty-slug case inside switchMap (not via an upstream `filter`)
          // so that clearing the foundation also cancels any in-flight request for the
          // previous slug — otherwise the old fetch could complete and overwrite
          // rawData after the UI switched to the "no foundation selected" state.
          if (!slug) {
            this.loading.set(false);
            return of(DEFAULT_FOUNDATION_PROJECTS_DETAIL);
          }
          // Set loading inside switchMap so that on rapid slug changes the order is:
          // old inner's `finalize(false)` (switchMap cancels it) → new inner's `loading.set(true)`.
          // Putting `loading.set(true)` in an outer `tap` would make the ordering
          // implementation-dependent when new slugs arrive while a request is in flight.
          this.loading.set(true);
          // Error handling lives in AnalyticsService.getFoundationProjectsDetail,
          // which returns `{ projects: [], totalCount: 0 }` on failure and evicts
          // the failed slug from its cache. No component-level catchError needed.
          return this.analyticsService.getFoundationProjectsDetail(slug).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: DEFAULT_FOUNDATION_PROJECTS_DETAIL }
    );
  }

  private initSearchQuery(): Signal<string> {
    return toSignal(this.searchForm.get('query')!.valueChanges, { initialValue: '' });
  }

  private initSummaryCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => {
      const projects = this.allProjects();
      const activeCount = projects.filter((p) => p.commitsLast90Days > 0).length;
      const totalContributors = projects.reduce((sum, p) => sum + (p.activeContributors ?? 0), 0);
      return [
        {
          value: this.totalProjects(),
          label: 'Total Projects',
          icon: 'fa-light fa-diagram-project',
          iconContainerClass: 'bg-gray-200 text-gray-500',
        },
        {
          value: activeCount,
          label: 'Active (90d)',
          icon: 'fa-light fa-bolt',
          iconContainerClass: 'bg-emerald-100 text-emerald-600',
        },
        {
          value: totalContributors,
          label: 'Active Contributors (90d)',
          icon: 'fa-light fa-users',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
      ];
    });
  }

  private initFilteredProjects(): Signal<ProjectTableRow[]> {
    return computed(() => {
      const query = this.searchQuery().toLowerCase().trim();
      if (!query) {
        return this.allProjects();
      }
      return this.allProjects().filter((project) => project.projectName.toLowerCase().includes(query));
    });
  }

  // Resolve slug → project-service UID for every sub-project of the current foundation.
  // Snowflake's PROJECT_ID is foundation-specific and may be a Salesforce ID rather
  // than the canonical project-service UUID used by committee/mailing-list tagging,
  // so we fetch the sub-projects once per foundation change and build an authoritative
  // slug→uid map. `startWith(new Map())` inside the inner switchMap clears the map
  // when a new slug arrives so a stale mapping from the previous foundation can't
  // leak through if slugs happen to overlap.
  private initSubProjectUidBySlug(): Signal<Map<string, string>> {
    return toSignal(
      toObservable(this.foundationSlug).pipe(
        switchMap((slug) => {
          if (!slug) {
            return of(new Map<string, string>());
          }
          const foundationUid = this.projectContextService.selectedFoundation()?.uid;
          if (!foundationUid) {
            return of(new Map<string, string>());
          }
          const params = new HttpParams().set('parent', `project:${foundationUid}`);
          return this.projectService.getProjects(params).pipe(
            map((subProjects) => {
              const slugToUid = new Map<string, string>();
              for (const sub of subProjects) {
                if (sub.slug && sub.uid) slugToUid.set(sub.slug, sub.uid);
              }
              return slugToUid;
            }),
            startWith(new Map<string, string>()),
            catchError(() => of(new Map<string, string>()))
          );
        })
      ),
      { initialValue: new Map<string, string>() }
    );
  }
}
