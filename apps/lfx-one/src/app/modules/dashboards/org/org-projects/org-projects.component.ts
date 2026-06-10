// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_ORG_PROJECTS_PAGE_SIZE,
  DEFAULT_ORG_PROJECTS_SORT_DIR,
  DEFAULT_ORG_PROJECTS_SORT_FIELD,
  DEFAULT_ORG_PROJECTS_WORKSPACE_ID,
  DEFAULT_ORG_PROJECTS_WORKSPACES,
  HEALTH_SCORE_LABELS,
  HEALTH_SCORE_SEVERITY,
  INFLUENCE_BAND_BAR_FILL_CLASS,
  INFLUENCE_BAND_BAR_FILL_CLASS_LIGHT,
  INFLUENCE_BAND_LABELS,
  INFLUENCE_BAND_RANK,
  INFLUENCE_TREND_COLOR,
  ORG_PROJECTS_PAGE_SIZE_OPTIONS,
  VALID_ORG_PROJECTS_SORT_FIELDS,
} from '@lfx-one/shared/constants';
import type {
  HealthScore,
  InfluenceBand,
  OrgLensProject,
  OrgLensProjectsResponse,
  OrgProjectsSortField,
  OrgProjectsWorkspace,
  OrgProjectsWorkspaceId,
  SortDirection,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { downloadCsv } from '@lfx-one/shared/utils';
import { MenuItem } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensProjectsService } from '@shared/services/org-lens-projects.service';

const ALL_FOUNDATIONS = 'all';

@Component({
  selector: 'lfx-org-projects',
  imports: [
    AvatarComponent,
    ButtonComponent,
    CardComponent,
    ChartComponent,
    DialogModule,
    EmptyStateComponent,
    InputTextComponent,
    MenuComponent,
    MultiSelectComponent,
    PopoverModule,
    SelectComponent,
    TableComponent,
    TagComponent,
    TooltipModule,
  ],
  templateUrl: './org-projects.component.html',
})
export class OrgProjectsComponent {
  // Private injections
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly projectsService = inject(OrgLensProjectsService);
  /** Pending hide timer for the health popover (lets the cursor cross into the popover). */
  private healthHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Configuration
  protected readonly pageSizeOptions = [...ORG_PROJECTS_PAGE_SIZE_OPTIONS];
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
    foundation: new FormControl<string>(this.route.snapshot.queryParamMap.get('foundation') ?? ALL_FOUNDATIONS, { nonNullable: true }),
    employees: new FormControl<string[]>(this.readEmployeesFromUrl(), { nonNullable: true }),
  });
  /** Name field for the add / rename workspace dialog. */
  protected readonly workspaceForm = new FormGroup({
    name: new FormControl<string>('', { nonNullable: true }),
  });

  // Writable Signals
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  /** Per-user workspace pin/hide state (client-only; never mutates the foundation catalog). */
  protected readonly pinnedSlugs = signal<ReadonlySet<string>>(new Set());
  protected readonly hiddenSlugs = signal<ReadonlySet<string>>(new Set());
  /** Shared workspaces (seeded presets + user-created); editable via the workspace dropdown. */
  protected readonly workspaces = signal<OrgProjectsWorkspace[]>([...DEFAULT_ORG_PROJECTS_WORKSPACES]);
  /** Workspace being renamed/deleted in the settings dialog; `null` while the dialog adds a new one. */
  protected readonly editingWorkspace = signal<OrgProjectsWorkspace | null>(null);
  protected readonly workspaceDialogOpen = signal(false);
  /** Bumped to re-trigger the demo fetch from the inline error-retry CTA. */
  private readonly reload = signal(0);
  /** Action menu items rebuilt per row when the kebab is opened. */
  protected rowMenuItems: MenuItem[] = [];

  // Computed / toSignal
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly formValue = toSignal(this.filterForm.valueChanges, { initialValue: this.filterForm.getRawValue() });
  private readonly response: Signal<OrgLensProjectsResponse | null> = this.initResponse();

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  /** Project whose health detail is shown in the shared hover popover. */
  protected readonly activeHealthProject = signal<OrgLensProject | null>(null);

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

  // Active workspace comes from the URL (`?workspace=`), validated against the current workspace list.
  protected readonly selectedWorkspaceId = computed<OrgProjectsWorkspaceId>(() => {
    const list = this.workspaces();
    const raw = this.queryParamMap().get('workspace');
    if (raw && list.some((w) => w.id === raw)) {
      return raw;
    }
    if (list.some((w) => w.id === DEFAULT_ORG_PROJECTS_WORKSPACE_ID)) {
      return DEFAULT_ORG_PROJECTS_WORKSPACE_ID;
    }
    return list[0]?.id ?? DEFAULT_ORG_PROJECTS_WORKSPACE_ID;
  });
  protected readonly selectedWorkspaceName = computed<string>(() => this.workspaces().find((w) => w.id === this.selectedWorkspaceId())?.name ?? '');
  protected readonly foundationOptions = this.initFoundationOptions();
  protected readonly employeeOptions = this.initEmployeeOptions();

  /** Workspace preset + foundation filter applied; shared by the table and the Influence Summary. */
  protected readonly filteredProjects = this.initFilteredProjects();
  /** `filteredProjects` ordered by the active sort (pinned rows float to the top). */
  protected readonly sortedProjects = this.initSortedProjects();
  protected readonly totalRecords = computed(() => this.sortedProjects().length);

  public constructor() {
    // Filter changes (foundation / employees) write through to the URL and reset to page 1.
    this.filterForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
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
      queryParams: {
        sort: field === DEFAULT_ORG_PROJECTS_SORT_FIELD ? null : field,
        dir: nextDir === DEFAULT_ORG_PROJECTS_SORT_DIR ? null : nextDir,
        page: null,
      },
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
    this.filterForm.reset({ foundation: ALL_FOUNDATIONS, employees: [] });
    this.selectWorkspace(DEFAULT_ORG_PROJECTS_WORKSPACE_ID);
  }

  // Active sort column shows a solid blue arrow (LFX self-serve pattern); inactive columns a faint grey double-arrow.
  protected sortIcon(field: OrgProjectsSortField): string {
    if (this.sortField() !== field) {
      return 'fa-light fa-sort text-gray-300';
    }
    return this.sortDir() === 'asc' ? 'fa-solid fa-sort-up text-blue-500' : 'fa-solid fa-sort-down text-blue-500';
  }

  protected openFindProject(): void {
    // +Find project opens an add-project modal whose internals ship in a separate ticket.
  }

  protected selectWorkspace(id: OrgProjectsWorkspaceId): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { workspace: id === DEFAULT_ORG_PROJECTS_WORKSPACE_ID ? null : id, page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openAddWorkspace(): void {
    this.editingWorkspace.set(null);
    this.workspaceForm.setValue({ name: '' });
    this.workspaceDialogOpen.set(true);
  }

  protected openWorkspaceSettings(workspace: OrgProjectsWorkspace): void {
    this.editingWorkspace.set(workspace);
    this.workspaceForm.setValue({ name: workspace.name });
    this.workspaceDialogOpen.set(true);
  }

  protected saveWorkspace(): void {
    const name = this.workspaceForm.getRawValue().name.trim();
    if (!name) {
      return;
    }
    const editing = this.editingWorkspace();
    if (editing) {
      this.workspaces.update((list) => list.map((w) => (w.id === editing.id ? { ...w, name } : w)));
    } else {
      const id = this.uniqueWorkspaceId(name);
      this.workspaces.update((list) => [...list, { id, name }]);
      this.selectWorkspace(id);
    }
    this.workspaceDialogOpen.set(false);
  }

  protected deleteWorkspace(): void {
    const editing = this.editingWorkspace();
    // Always keep at least one workspace so the company never ends up with none.
    if (!editing || this.workspaces().length <= 1) {
      return;
    }
    const remaining = this.workspaces().filter((w) => w.id !== editing.id);
    this.workspaces.set(remaining);
    if (this.selectedWorkspaceId() === editing.id) {
      this.selectWorkspace(remaining[0].id);
    }
    this.workspaceDialogOpen.set(false);
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
    const header = ['Project', 'Health Score', 'Technical Influence', 'Ecosystem Influence', 'Influence Trend (1y) %', 'Our Contributors', 'Our Participants'];
    const body = rows.map((p) => [
      p.name,
      HEALTH_SCORE_LABELS[p.health],
      INFLUENCE_BAND_LABELS[p.technicalInfluence],
      INFLUENCE_BAND_LABELS[p.ecosystemInfluence],
      p.trend.deltaPct,
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
  // Signal-strength bars for an influence band: filled count = rank (Leading 4 → Silent 1 → Non-LF 0),
  // colored by band; remaining bars faded. Non-LF (0 filled) gets a diagonal slash from the template.
  // Geometry mirrors the LFX Insights signal-bar icon: 4 evenly spaced, ascending, rounded bars in a 16×16 box.
  protected bandBars(band: InfluenceBand): { x: number; y: number; w: number; h: number; colorClass: string }[] {
    const heights = [5, 8.3, 11.6, 15];
    const barWidth = 2.6;
    const gap = 1.8;
    const filled = INFLUENCE_BAND_RANK[band];
    return heights.map((h, i) => ({
      x: i * (barWidth + gap),
      y: 16 - h,
      w: barWidth,
      h,
      // Filled bars use the band color; unfilled use a lighter tint of the same color (org dashboard design).
      colorClass: i < filled ? INFLUENCE_BAND_BAR_FILL_CLASS[band] : INFLUENCE_BAND_BAR_FILL_CLASS_LIGHT[band],
    }));
  }
  // Explanatory hover for the Technical / Ecosystem influence column headers.
  protected influenceColumnTooltip(): string {
    return `<ul class="flex list-disc flex-col gap-1.5 pl-4 text-left"><li>Technical influence examines code activities (commits, PRs) while ecosystem influence examines non-code collaboration activities (documentation, committees, meetings, events).</li><li>Comparing our company's share of these activities to the project total indicates greater influence in the project.</li></ul>`;
  }
  protected openHealth(event: Event, project: OrgLensProject, popover: Popover): void {
    this.cancelHealthHide();
    this.activeHealthProject.set(project);
    popover.show(event, event.currentTarget as HTMLElement);
  }
  // Delay hide so the cursor can travel from the cell into the popover (keeps the LFX Insights link clickable).
  protected scheduleHealthHide(popover: Popover): void {
    this.cancelHealthHide();
    this.healthHideTimer = setTimeout(() => popover.hide(), 200);
  }
  protected cancelHealthHide(): void {
    if (this.healthHideTimer !== null) {
      clearTimeout(this.healthHideTimer);
      this.healthHideTimer = null;
    }
  }
  protected healthLabel(health: HealthScore): string {
    return HEALTH_SCORE_LABELS[health];
  }
  protected healthSeverity(health: HealthScore): TagSeverity {
    return HEALTH_SCORE_SEVERITY[health];
  }
  // Hover tooltip for the Influence Trend sparkline: combined / technical / ecosystem 1y deltas.
  protected trendTooltip(project: OrgLensProject): string {
    const t = project.trend;
    return `<div class="flex flex-col gap-1 text-left">${this.trendTooltipRow('Combined influence', t.deltaPct)}${this.trendTooltipRow('Technical influence', t.technicalDeltaPct)}${this.trendTooltipRow('Ecosystem influence', t.ecosystemDeltaPct)}</div>`;
  }
  protected trendTooltipRow(label: string, value: number): string {
    const sign = value > 0 ? '+' : '';
    return `<div class="flex items-center justify-between gap-6 whitespace-nowrap"><span class="text-gray-200">${label}</span><span class="font-semibold ${this.pctColorClass(value)}">${sign}${value}%</span></div>`;
  }
  protected pctColorClass(value: number): string {
    if (value > 1) {
      return 'text-emerald-300';
    }
    if (value < -1) {
      return 'text-red-300';
    }
    return 'text-gray-300';
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
          // Demo data is not tied to a real org, so it renders even before an org is selected
          // (local dev / no impersonation). The real integration will key off `account.uid`.
          const uid = account?.uid ?? 'demo-org';
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
      const workspace = this.selectedWorkspaceId();
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
    // Tie-break: participant count desc, then project name asc.
    const participantTie = b.participants.length - a.participants.length;
    return participantTie !== 0 ? participantTie : a.name.localeCompare(b.name);
  }

  private compareByField(a: OrgLensProject, b: OrgLensProject, field: OrgProjectsSortField): number {
    switch (field) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'health':
        return this.healthRank(a.health) - this.healthRank(b.health);
      case 'technicalInfluence':
        return INFLUENCE_BAND_RANK[a.technicalInfluence] - INFLUENCE_BAND_RANK[b.technicalInfluence];
      case 'ecosystemInfluence':
        return INFLUENCE_BAND_RANK[a.ecosystemInfluence] - INFLUENCE_BAND_RANK[b.ecosystemInfluence];
      case 'influenceTrend':
        return a.trend.deltaPct - b.trend.deltaPct;
      case 'contributors':
        return a.contributors.length - b.contributors.length;
      case 'participants':
        return a.participants.length - b.participants.length;
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
      case 'most-active':
        // Active = not archived (excludes the demo "Jenkins" archived row with score 0).
        return project.influenceScore > 0;
      case 'key-projects':
        // "Key" = projects we lead or actively contribute to.
        return project.technicalInfluence === 'leading' || project.technicalInfluence === 'contributing';
      case 'finos':
      case 'cncf':
        // Foundation-scoped workspaces match by foundation slug.
        return project.foundation.slug === workspace;
      case DEFAULT_ORG_PROJECTS_WORKSPACE_ID:
      default:
        // "All Projects with Activities" (and any custom workspace) shows every project with activity.
        return true;
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

  private uniqueWorkspaceId(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'workspace';
    const existing = new Set(this.workspaces().map((w) => w.id));
    if (!existing.has(base)) {
      return base;
    }
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    return `${base}-${suffix}`;
  }

  private readEmployeesFromUrl(): string[] {
    const raw = this.route.snapshot.queryParamMap.get('employees');
    return raw ? raw.split(',').filter(Boolean) : [];
  }
}
