// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_ORG_PROJECTS_PAGE_SIZE,
  DEFAULT_ORG_PROJECTS_SORT_DIR,
  DEFAULT_ORG_PROJECTS_SORT_FIELD,
  DEFAULT_ORG_PROJECTS_WORKSPACE_ID,
  HEALTH_SCORE_LABELS,
  HEALTH_SCORE_SEVERITY,
  INFLUENCE_BAND_LABELS,
  INFLUENCE_BAND_RANK,
  INFLUENCE_BAND_SEVERITY,
  INFLUENCE_TREND_COLOR,
  ORG_PROJECTS_AVATAR_STACK_LIMIT,
  ORG_PROJECTS_PAGE_SIZE_OPTIONS,
  ORG_PROJECTS_WORKSPACE_OPTIONS,
  VALID_ORG_PROJECTS_SORT_FIELDS,
  VALID_ORG_PROJECTS_WORKSPACE_IDS,
} from '@lfx-one/shared/constants';
import type {
  HealthScore,
  InfluenceBand,
  InfluenceTrendDirection,
  OrgLensProject,
  OrgLensProjectPerson,
  OrgLensProjectsResponse,
  OrgProjectsSortField,
  OrgProjectsWorkspaceId,
  SortDirection,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { downloadCsv, formatRelativeTime } from '@lfx-one/shared/utils';
import { MenuItem } from 'primeng/api';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensProjectsService } from '@shared/services/org-lens-projects.service';

import { InfluenceSummaryComponent } from './components/influence-summary/influence-summary.component';

const ALL_FOUNDATIONS = 'all';

@Component({
  selector: 'lfx-org-projects',
  imports: [
    AvatarComponent,
    ButtonComponent,
    CardComponent,
    ChartComponent,
    EmptyStateComponent,
    InfluenceSummaryComponent,
    MenuComponent,
    MultiSelectComponent,
    NgTemplateOutlet,
    SelectComponent,
    TableComponent,
    TagComponent,
  ],
  templateUrl: './org-projects.component.html',
})
export class OrgProjectsComponent {
  // Private injections
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly projectsService = inject(OrgLensProjectsService);

  // Configuration
  protected readonly workspaceOptions = [...ORG_PROJECTS_WORKSPACE_OPTIONS];
  protected readonly pageSizeOptions = [...ORG_PROJECTS_PAGE_SIZE_OPTIONS];
  protected readonly avatarStackLimit = ORG_PROJECTS_AVATAR_STACK_LIMIT;
  // Minimal Chart.js line config for the Influence Trend sparkline (no axes, points, legend, or tooltip).
  protected readonly sparklineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.4 } },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
  };

  // Forms
  protected readonly filterForm = new FormGroup({
    workspace: new FormControl<OrgProjectsWorkspaceId>(this.readWorkspaceFromUrl(), { nonNullable: true }),
    foundation: new FormControl<string>(this.route.snapshot.queryParamMap.get('foundation') ?? ALL_FOUNDATIONS, { nonNullable: true }),
    employees: new FormControl<string[]>(this.readEmployeesFromUrl(), { nonNullable: true }),
  });

  // Writable Signals
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  /** Per-user workspace pin/hide state (client-only; never mutates the foundation catalog). */
  protected readonly pinnedSlugs = signal<ReadonlySet<string>>(new Set());
  protected readonly hiddenSlugs = signal<ReadonlySet<string>>(new Set());
  /** Bumped to re-trigger the demo fetch from the inline error-retry CTA. */
  private readonly reload = signal(0);
  /** Action menu items rebuilt per row when the kebab is opened. */
  protected rowMenuItems: MenuItem[] = [];

  // Computed / toSignal
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly formValue = toSignal(this.filterForm.valueChanges, { initialValue: this.filterForm.getRawValue() });
  private readonly response: Signal<OrgLensProjectsResponse | null> = this.initResponse();

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly freshnessLabel = computed(() => {
    const updatedAt = this.response()?.dataUpdatedAt;
    return updatedAt ? `Data updated ${formatRelativeTime(new Date(updatedAt))}` : '';
  });

  protected readonly sortField = computed<OrgProjectsSortField>(() => {
    const raw = this.queryParamMap().get('sort');
    return raw && VALID_ORG_PROJECTS_SORT_FIELDS.has(raw as OrgProjectsSortField) ? (raw as OrgProjectsSortField) : DEFAULT_ORG_PROJECTS_SORT_FIELD;
  });
  protected readonly sortDir = computed<SortDirection>(() => (this.queryParamMap().get('dir') === 'asc' ? 'asc' : DEFAULT_ORG_PROJECTS_SORT_DIR));
  protected readonly pageSize = computed<number>(() => {
    const raw = Number(this.queryParamMap().get('size'));
    return ORG_PROJECTS_PAGE_SIZE_OPTIONS.includes(raw) ? raw : DEFAULT_ORG_PROJECTS_PAGE_SIZE;
  });
  protected readonly pageFirst = computed<number>(() => {
    const page = Math.max(1, Number(this.queryParamMap().get('page')) || 1);
    return (page - 1) * this.pageSize();
  });

  protected readonly workspaceId = computed<OrgProjectsWorkspaceId>(() => this.formValue().workspace ?? DEFAULT_ORG_PROJECTS_WORKSPACE_ID);
  protected readonly foundationOptions = this.initFoundationOptions();
  protected readonly employeeOptions = this.initEmployeeOptions();

  /** Workspace preset + foundation filter applied; shared by the table and the Influence Summary. */
  protected readonly filteredProjects = this.initFilteredProjects();
  /** `filteredProjects` ordered by the active sort (pinned rows float to the top). */
  protected readonly sortedProjects = this.initSortedProjects();
  protected readonly totalRecords = computed(() => this.sortedProjects().length);

  public constructor() {
    // Filter changes (workspace / foundation / employees) write through to the URL and reset to page 1.
    this.filterForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          workspace: value.workspace === DEFAULT_ORG_PROJECTS_WORKSPACE_ID ? null : value.workspace,
          foundation: value.foundation === ALL_FOUNDATIONS ? null : value.foundation,
          employees: value.employees && value.employees.length ? value.employees.join(',') : null,
          page: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  // Public methods
  public retry(): void {
    this.reload.update((n) => n + 1);
  }

  // Protected methods
  protected toggleSort(field: OrgProjectsSortField): void {
    const nextDir: SortDirection = this.sortField() === field && this.sortDir() === 'desc' ? 'asc' : 'desc';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sort: field === DEFAULT_ORG_PROJECTS_SORT_FIELD ? null : field, dir: nextDir === DEFAULT_ORG_PROJECTS_SORT_DIR ? null : nextDir, page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onPage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.pageSize();
    const page = Math.floor((event.first ?? 0) / rows) + 1;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page <= 1 ? null : page, size: rows === DEFAULT_ORG_PROJECTS_PAGE_SIZE ? null : rows },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected resetFilters(): void {
    this.filterForm.reset({ workspace: DEFAULT_ORG_PROJECTS_WORKSPACE_ID, foundation: ALL_FOUNDATIONS, employees: [] });
  }

  protected sortIcon(field: OrgProjectsSortField): string {
    if (this.sortField() !== field) {
      return 'fa-light fa-sort';
    }
    return this.sortDir() === 'asc' ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
  }

  protected openFindProject(): void {
    // +Find project opens an add-project modal whose internals ship in a separate ticket.
  }

  protected openRowMenu(menu: MenuComponent, project: OrgLensProject, event: Event): void {
    this.rowMenuItems = this.buildRowMenu(project);
    menu.toggle(event);
  }

  protected openDetail(project: OrgLensProject): void {
    // Project Detail sub-page is delivered in LFXV2-1885; navigation target wired there.
    void this.router.navigate([], { relativeTo: this.route, queryParams: { project: project.slug }, queryParamsHandling: 'merge' });
  }

  protected exportCsv(): void {
    const rows = this.sortedProjects();
    if (!rows.length) {
      return;
    }
    const header = [
      'Project',
      'Foundation',
      'Health Score',
      'Technical Influence',
      'Ecosystem Influence',
      'Influence Trend (1y) %',
      'Our Maintainers',
      'Our Contributors',
      'Our Participants',
    ];
    const body = rows.map((p) => [
      p.name,
      p.foundation.name,
      HEALTH_SCORE_LABELS[p.health],
      INFLUENCE_BAND_LABELS[p.technicalInfluence],
      INFLUENCE_BAND_LABELS[p.ecosystemInfluence],
      p.trend.deltaPct,
      p.maintainers.length,
      p.contributors.length,
      p.participants.length,
    ]);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const slug = this.response()?.orgSlug ?? 'org';
    downloadCsv(`org-lens-projects-${slug}-${date}.csv`, [header, ...body]);
  }

  // Template display helpers
  protected bandLabel(band: InfluenceBand): string {
    return INFLUENCE_BAND_LABELS[band];
  }
  protected bandSeverity(band: InfluenceBand): TagSeverity {
    return INFLUENCE_BAND_SEVERITY[band];
  }
  protected healthLabel(health: HealthScore): string {
    return HEALTH_SCORE_LABELS[health];
  }
  protected healthSeverity(health: HealthScore): TagSeverity {
    return HEALTH_SCORE_SEVERITY[health];
  }
  protected trendClass(direction: InfluenceTrendDirection): string {
    if (direction === 'up') {
      return 'text-emerald-600';
    }
    if (direction === 'down') {
      return 'text-red-600';
    }
    return 'text-gray-500';
  }
  protected stackVisible(people: OrgLensProjectPerson[]): OrgLensProjectPerson[] {
    return people.slice(0, this.avatarStackLimit);
  }
  protected stackOverflow(people: OrgLensProjectPerson[]): number {
    return Math.max(0, people.length - this.avatarStackLimit);
  }
  protected isPinned(slug: string): boolean {
    return this.pinnedSlugs().has(slug);
  }
  protected sparklineData(project: OrgLensProject): { labels: string[]; datasets: { data: number[]; borderColor: string; fill: boolean }[] } {
    return {
      labels: project.trend.series.map((_, i) => String(i)),
      datasets: [{ data: project.trend.series, borderColor: INFLUENCE_TREND_COLOR[project.trend.direction], fill: false }],
    };
  }

  // Private initializers
  private initResponse(): Signal<OrgLensProjectsResponse | null> {
    const account$ = toObservable(computed(() => ({ account: this.accountContext.selectedAccount(), _reload: this.reload() })));
    return toSignal(
      account$.pipe(
        switchMap(({ account }) => {
          const uid = account?.uid;
          if (!uid) {
            this.loading.set(false);
            this.error.set(false);
            return of(null);
          }
          this.loading.set(true);
          this.error.set(false);
          return this.projectsService.getProjects(uid, account?.accountName ?? '').pipe(
            catchError(() => {
              this.error.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initFoundationOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.response()?.projects ?? [];
      const bySlug = new Map<string, string>();
      for (const project of projects) {
        bySlug.set(project.foundation.slug, project.foundation.name);
      }
      const options = [...bySlug.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Foundations', value: ALL_FOUNDATIONS }, ...options];
    });
  }

  private initEmployeeOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.response()?.projects ?? [];
      const byId = new Map<string, string>();
      for (const project of projects) {
        for (const person of [...project.maintainers, ...project.contributors, ...project.participants]) {
          byId.set(person.id, person.name);
        }
      }
      return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    });
  }

  private initFilteredProjects(): Signal<OrgLensProject[]> {
    return computed(() => {
      const all = this.response()?.projects ?? [];
      const workspace = this.workspaceId();
      const foundation = this.formValue().foundation ?? ALL_FOUNDATIONS;
      const hidden = this.hiddenSlugs();
      return all
        .filter((p) => !hidden.has(p.slug))
        .filter((p) => this.matchesWorkspace(p, workspace))
        .filter((p) => foundation === ALL_FOUNDATIONS || p.foundation.slug === foundation);
    });
  }

  private initSortedProjects(): Signal<OrgLensProject[]> {
    return computed(() => {
      const projects = [...this.filteredProjects()];
      const field = this.sortField();
      const dir = this.sortDir();
      const pinned = this.pinnedSlugs();
      projects.sort((a, b) => {
        const aPinned = pinned.has(a.slug);
        const bPinned = pinned.has(b.slug);
        if (aPinned !== bPinned) {
          return aPinned ? -1 : 1;
        }
        return this.compareProjects(a, b, field, dir);
      });
      return projects;
    });
  }

  private compareProjects(a: OrgLensProject, b: OrgLensProject, field: OrgProjectsSortField, dir: SortDirection): number {
    const primary = this.compareByField(a, b, field);
    const directed = dir === 'asc' ? primary : -primary;
    if (directed !== 0) {
      return directed;
    }
    // Tie-break: Technical Influence band desc, then project name asc.
    const bandTie = INFLUENCE_BAND_RANK[b.technicalInfluence] - INFLUENCE_BAND_RANK[a.technicalInfluence];
    return bandTie !== 0 ? bandTie : a.name.localeCompare(b.name);
  }

  private compareByField(a: OrgLensProject, b: OrgLensProject, field: OrgProjectsSortField): number {
    switch (field) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'foundation':
        return a.foundation.name.localeCompare(b.foundation.name);
      case 'health':
        return this.healthRank(a.health) - this.healthRank(b.health);
      case 'technicalInfluence':
        return INFLUENCE_BAND_RANK[a.technicalInfluence] - INFLUENCE_BAND_RANK[b.technicalInfluence];
      case 'ecosystemInfluence':
        return INFLUENCE_BAND_RANK[a.ecosystemInfluence] - INFLUENCE_BAND_RANK[b.ecosystemInfluence];
      case 'influenceTrend':
        return a.trend.deltaPct - b.trend.deltaPct;
      default:
        return 0;
    }
  }

  private healthRank(health: HealthScore): number {
    if (health === 'excellent') {
      return 2;
    }
    return health === 'healthy' ? 1 : 0;
  }

  private matchesWorkspace(project: OrgLensProject, workspace: OrgProjectsWorkspaceId): boolean {
    switch (workspace) {
      case 'all-projects':
        return true;
      case 'most-influential':
        return project.technicalInfluence === 'leading' || project.technicalInfluence === 'contributing';
      case 'where-we-lead':
        return project.technicalInfluence === 'leading';
      case 'most-active':
      default:
        // Active = not archived (excludes the demo "Jenkins" archived row with score 0).
        return project.influenceScore > 0;
    }
  }

  private buildRowMenu(project: OrgLensProject): MenuItem[] {
    const pinned = this.isPinned(project.slug);
    return [
      {
        label: pinned ? 'Unpin from top' : 'Pin to top',
        icon: pinned ? 'fa-light fa-thumbtack-slash' : 'fa-light fa-thumbtack',
        command: () => this.togglePin(project.slug),
      },
      { label: 'Open detail', icon: 'fa-light fa-arrow-up-right-from-square', command: () => this.openDetail(project) },
      { label: 'Add to workspace', icon: 'fa-light fa-plus', command: () => this.addToWorkspace() },
      { label: 'Hide from this workspace', icon: 'fa-light fa-eye-slash', command: () => this.hideFromWorkspace(project.slug) },
    ];
  }

  private togglePin(slug: string): void {
    this.pinnedSlugs.update((set) => {
      const next = new Set(set);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  private hideFromWorkspace(slug: string): void {
    this.hiddenSlugs.update((set) => new Set(set).add(slug));
  }

  private addToWorkspace(): void {
    // Add-to-workspace writes to the per-user workspace project list; CRUD flow is a separate ticket.
  }

  private readWorkspaceFromUrl(): OrgProjectsWorkspaceId {
    const raw = this.route.snapshot.queryParamMap.get('workspace');
    return raw && VALID_ORG_PROJECTS_WORKSPACE_IDS.has(raw as OrgProjectsWorkspaceId) ? (raw as OrgProjectsWorkspaceId) : DEFAULT_ORG_PROJECTS_WORKSPACE_ID;
  }

  private readEmployeesFromUrl(): string[] {
    const raw = this.route.snapshot.queryParamMap.get('employees');
    return raw ? raw.split(',').filter(Boolean) : [];
  }
}
