// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, model, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DEFAULT_ORG_PROJECTS_PAGE_SIZE,
  DEFAULT_ORG_PROJECTS_SORT_DIR,
  DEFAULT_ORG_PROJECTS_SORT_FIELD,
  DEFAULT_ORG_PROJECTS_WORKSPACE_ID,
  DEFAULT_ORG_PROJECTS_WORKSPACE_NAME,
  DEFAULT_ORG_PROJECTS_WORKSPACES,
  HEALTH_SCORE_BADGE,
  HEALTH_SCORE_LABELS,
  INFLUENCE_BAND_BAR_FILL_CLASS,
  INFLUENCE_BAND_BAR_FILL_CLASS_LIGHT,
  INFLUENCE_BAND_LABELS,
  INFLUENCE_BAND_RANK,
  INFLUENCE_TREND_ARROW_BADGE_CLASS,
  INFLUENCE_TREND_ARROW_ICON,
  INFLUENCE_TREND_COLOR,
  INFLUENCE_TREND_TEXT_CLASS,
  ORG_PROJECTS_ALL_FOUNDATIONS_FILTER,
  ORG_PROJECTS_PAGE_SIZE_OPTIONS,
  ORG_PROJECTS_SEARCH_MIN_LENGTH,
  VALID_ORG_PROJECTS_SORT_FIELDS,
} from '@lfx-one/shared/constants';
import type {
  AddableProjectOption,
  HealthScore,
  InfluenceBand,
  OrgLensProject,
  OrgLensProjectSearchResult,
  OrgLensProjectsResponse,
  OrgProjectsAriaSort,
  OrgProjectsEmptyAction,
  OrgProjectsEmptyState,
  OrgProjectsSignalBar,
  OrgProjectsSortField,
  OrgProjectsTableRow,
  OrgProjectsWorkspace,
  OrgProjectsWorkspaceId,
  SortDirection,
} from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, downloadCsv } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { Popover, PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, concat, distinctUntilChanged, finalize, firstValueFrom, map, of, skip, switchMap, tap } from 'rxjs';

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
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import { OrgLensProjectsService } from '@shared/services/org-lens-projects.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { PersonaService } from '@shared/services/persona.service';

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
    RouterLink,
    SelectComponent,
    SkeletonModule,
    TableComponent,
    TooltipModule,
  ],
  templateUrl: './org-projects.component.html',
  styleUrl: './org-projects.component.scss',
})
export class OrgProjectsComponent {
  // Private injections
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly projectsService = inject(OrgLensProjectsService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly messageService = inject(MessageService);
  /** Pending hide timer for the health popover (lets the cursor cross into the popover). */
  private healthHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Configuration
  protected readonly pageSizeOptions = [...ORG_PROJECTS_PAGE_SIZE_OPTIONS];
  // Static explanatory hover for the Technical / Ecosystem influence column headers.
  protected readonly influenceColumnTooltipHtml = `<ul class="flex list-disc flex-col gap-1.5 pl-4 text-left"><li>Technical influence examines code activities (commits, PRs) while ecosystem influence examines non-code collaboration activities (documentation, committees, meetings, events).</li><li>Comparing our company's share of these activities to the project total indicates greater influence in the project.</li></ul>`;
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
    foundation: new FormControl<string>(this.route.snapshot.queryParamMap.get('foundation') ?? ORG_PROJECTS_ALL_FOUNDATIONS_FILTER, { nonNullable: true }),
    employees: new FormControl<string[]>(this.readEmployeesFromUrl(), { nonNullable: true }),
  });
  /** Name field for the add / rename workspace dialog. */
  protected readonly workspaceForm = new FormGroup({
    name: new FormControl<string>('', { nonNullable: true }),
  });
  /** Selected project slugs and search query for the "Add project(s)" dialog. */
  protected readonly addProjectsForm = new FormGroup({
    projects: new FormControl<string[]>([], { nonNullable: true }),
    search: new FormControl<string>('', { nonNullable: true }),
  });
  protected readonly addableProjectOptions = signal<AddableProjectOption[]>([]);
  private readonly selectedAddableProjectOptions = signal<AddableProjectOption[]>([]);

  // Writable Signals
  private readonly workspaceLoading = signal(false);
  private readonly projectsLoading = signal(false);
  protected readonly loading = computed(() => this.workspaceLoading() || this.projectsLoading());
  protected readonly workspaceError = signal(false);
  protected readonly projectsError = signal(false);
  protected readonly error = computed(() => this.workspaceError() || this.projectsError());
  protected readonly addProjectsSearchLoading = signal(false);
  protected readonly addProjectsSearchError = signal(false);
  protected readonly addProjectsSaving = signal(false);
  protected readonly addProjectsSaveError = signal(false);
  protected readonly workspaceNameError = signal<string | null>(null);
  protected readonly workspaceDialogError = signal<'save' | 'delete' | null>(null);
  protected readonly workspaceDialogAction = signal<'save' | 'delete' | null>(null);
  protected readonly workspaceDialogPending = computed(() => this.workspaceDialogAction() !== null);
  protected readonly workspaceDialogErrorMessage = computed(() => this.initWorkspaceDialogErrorMessage());
  /** Shared workspaces (seeded presets + user-created); editable via the workspace dropdown. */
  protected readonly workspaces = signal<OrgProjectsWorkspace[]>([...DEFAULT_ORG_PROJECTS_WORKSPACES]);
  /** Workspace being renamed/deleted in the settings dialog; `null` while the dialog adds a new one. */
  protected readonly editingWorkspace = signal<OrgProjectsWorkspace | null>(null);
  /** Two-way visibility for the workspace add/settings dialog (`[(visible)]`). */
  protected readonly workspaceDialogOpen = model(false);
  /** Two-way visibility for the "Add project(s)" dialog (`[(visible)]`). */
  protected readonly addProjectsDialogOpen = model(false);
  private readonly reload = signal(0);
  private readonly workspaceReload = signal(0);
  private addableProjectsSearchRequestId = 0;
  private addableProjectsSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Action menu items rebuilt per row when the kebab is opened. */
  protected rowMenuItems: MenuItem[] = [];

  // Computed / toSignal
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly formValue = toSignal(this.filterForm.valueChanges, { initialValue: this.filterForm.getRawValue() });
  private readonly addProjectsFormValue = toSignal(this.addProjectsForm.valueChanges, { initialValue: this.addProjectsForm.getRawValue() });

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount()?.uid);
  protected readonly hasNoOrgAccess = computed(
    () => this.orgRoleGrants.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );
  protected readonly orgContextLoaded = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigation.loaded() && this.orgRoleGrants.loaded() && this.personaService.personaLoaded())
  );
  /** Project whose health detail is shown in the shared hover popover. */
  protected readonly activeHealthProject = signal<OrgProjectsTableRow | null>(null);

  protected readonly sortField = computed<OrgProjectsSortField>(() => this.initSortField());
  protected readonly sortDir = computed<SortDirection>(() => (this.queryParamMap().get('dir') === 'asc' ? 'asc' : DEFAULT_ORG_PROJECTS_SORT_DIR));
  protected readonly sortIconMap = computed<Record<OrgProjectsSortField, string>>(() => this.initSortIconMap());
  protected readonly ariaSortMap = computed<Record<OrgProjectsSortField, OrgProjectsAriaSort>>(() => this.initAriaSortMap());
  protected readonly pageSize = computed<number>(() => this.initPageSize());
  protected readonly pageFirst = computed<number>(() => this.initPageFirst());

  // Active workspace comes from the URL (`?workspace=`), validated against the current workspace list.
  protected readonly selectedWorkspaceId = computed<OrgProjectsWorkspaceId>(() => this.initSelectedWorkspaceId());
  private readonly selectedWorkspace = computed<OrgProjectsWorkspace | null>(() => this.workspaces().find((w) => w.id === this.selectedWorkspaceId()) ?? null);
  protected readonly selectedWorkspaceName = computed<string>(() => this.selectedWorkspace()?.name ?? '');
  private readonly workspacesResponse = this.initWorkspaces();
  private readonly response: Signal<OrgLensProjectsResponse | null> = this.initResponse();
  protected readonly foundationOptions = this.initFoundationOptions();
  protected readonly employeeOptions = this.initEmployeeOptions();

  /** Workspace preset + foundation filter applied; shared by the table and the Influence Summary. */
  protected readonly filteredProjects = this.initFilteredProjects();
  /** `filteredProjects` ordered by the active sort (pinned rows float to the top). */
  protected readonly sortedProjects = this.initSortedProjects();
  /** Table rows: sorted projects enriched with precomputed bar geometry + tooltip HTML (keeps logic out of the template). */
  protected readonly rows = this.initRows();
  protected readonly totalRecords = computed(() => this.sortedProjects().length);
  protected readonly canAddProjects = computed(() => this.hasCompany() && !!this.selectedWorkspace() && !this.loading() && !this.error());
  protected readonly addProjectDisabledReason = computed(() => this.initAddProjectDisabledReason());
  protected readonly selectedAddProjectCount = computed(() => this.addProjectsFormValue().projects?.length ?? 0);
  protected readonly addProjectSelectOptions = computed(() =>
    this.mergeAddableOptions([...this.selectedAddableProjectOptions(), ...this.addableProjectOptions()])
  );
  protected readonly addProjectsSearchEmptyTitle = computed(() => this.initAddProjectsSearchEmptyTitle());
  protected readonly tableEmptyState = computed<OrgProjectsEmptyState>(() => this.initTableEmptyState());
  protected readonly canDeleteEditingWorkspace = computed(() => {
    const editing = this.editingWorkspace();
    return !!editing && !this.isCanonicalDefaultWorkspace(editing);
  });

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account?.uid ?? null),
    distinctUntilChanged()
  );

  public constructor() {
    // Filter changes (foundation / employees) write through to the URL and reset to page 1.
    this.filterForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          foundation: value.foundation === ORG_PROJECTS_ALL_FOUNDATIONS_FILTER ? null : value.foundation,
          employees: value.employees && value.employees.length ? value.employees.join(',') : null,
          page: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    this.addProjectsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.syncSelectedAddableProjectOptions();
    });

    this.addProjectsForm.controls.search.valueChanges.pipe(takeUntilDestroyed()).subscribe((query) => {
      this.searchAddableProjects(query);
    });

    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => {
      this.workspaceDialogOpen.set(false);
      this.addProjectsDialogOpen.set(false);
      this.editingWorkspace.set(null);
    });

    this.workspaceForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value.name?.trim()) {
        this.workspaceNameError.set(null);
      }
    });

    // Clear any pending health-popover hide timer on teardown so it can't fire after destroy.
    inject(DestroyRef).onDestroy(() => {
      this.cancelHealthHide();
      if (this.addableProjectsSearchDebounceTimer) {
        clearTimeout(this.addableProjectsSearchDebounceTimer);
      }
    });
  }

  // Public methods
  public retry(): void {
    this.workspaceError.set(false);
    this.projectsError.set(false);
    this.workspaceReload.update((n) => n + 1);
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
    this.filterForm.reset({ foundation: ORG_PROJECTS_ALL_FOUNDATIONS_FILTER, employees: [] });
    this.selectWorkspace(DEFAULT_ORG_PROJECTS_WORKSPACE_ID);
  }

  protected openAddProjects(): void {
    if (!this.canAddProjects()) {
      return;
    }
    this.addProjectsForm.setValue({ projects: [], search: '' }, { emitEvent: false });
    this.addableProjectOptions.set([]);
    this.selectedAddableProjectOptions.set([]);
    this.addProjectsSearchError.set(false);
    this.addProjectsSaveError.set(false);
    this.addProjectsDialogOpen.set(true);
    void this.runAddableProjectsSearch('');
  }

  protected handleEmptyStateAction(action: OrgProjectsEmptyAction | undefined): void {
    if (action === 'addProject') {
      this.openAddProjects();
    } else if (action === 'resetFilters') {
      this.resetFilters();
    } else if (action === 'retry') {
      this.retry();
    }
  }

  protected retryAddableProjectsSearch(): void {
    void this.runAddableProjectsSearch(this.addProjectsForm.controls.search.value);
  }

  protected async confirmAddProjects(): Promise<void> {
    const slugs = this.addProjectsForm.getRawValue().projects;
    const account = this.accountContext.selectedAccount();
    const workspace = this.selectedWorkspace();
    if (!account?.uid || !workspace || !slugs.length) {
      this.addProjectsDialogOpen.set(false);
      return;
    }
    const accountUid = account.uid;
    this.addProjectsSaving.set(true);
    this.addProjectsSaveError.set(false);
    try {
      const { workspace: updated } = await firstValueFrom(this.projectsService.addProjectsToWorkspace(accountUid, workspace.id, slugs));
      if (!this.isStillSelectedAccount(accountUid)) {
        return;
      }
      this.mergeWorkspace({ ...updated, name: updated.name || workspace.name });
      this.reload.update((n) => n + 1);
      this.addProjectsDialogOpen.set(false);
    } catch {
      this.addProjectsSaveError.set(true);
      this.workspaceReload.update((n) => n + 1);
      this.reload.update((n) => n + 1);
    } finally {
      this.addProjectsSaving.set(false);
    }
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
    this.workspaceNameError.set(null);
    this.workspaceDialogError.set(null);
    this.workspaceDialogOpen.set(true);
  }

  protected openWorkspaceSettings(workspace: OrgProjectsWorkspace): void {
    this.editingWorkspace.set(workspace);
    this.workspaceForm.setValue({ name: workspace.name });
    this.workspaceNameError.set(null);
    this.workspaceDialogError.set(null);
    this.workspaceDialogOpen.set(true);
  }

  protected async saveWorkspace(): Promise<void> {
    if (this.workspaceDialogPending()) {
      return;
    }
    const name = this.workspaceForm.getRawValue().name.trim();
    if (!name) {
      this.workspaceNameError.set('Workspace name is required.');
      return;
    }
    const account = this.accountContext.selectedAccount();
    if (!account?.uid) {
      return;
    }
    const accountUid = account.uid;
    const editing = this.editingWorkspace();
    this.workspaceDialogAction.set('save');
    this.workspaceNameError.set(null);
    this.workspaceDialogError.set(null);
    try {
      if (editing) {
        const { workspace } = await firstValueFrom(this.projectsService.renameWorkspace(accountUid, editing.id, name));
        if (!this.isStillSelectedAccount(accountUid)) {
          return;
        }
        this.mergeWorkspace({
          ...workspace,
          name,
          projectSlugs: workspace.projectSlugs.length ? workspace.projectSlugs : editing.projectSlugs,
        });
      } else {
        const { workspace } = await firstValueFrom(this.projectsService.createWorkspace(accountUid, name));
        if (!this.isStillSelectedAccount(accountUid)) {
          return;
        }
        this.workspaces.update((list) => [...list, workspace]);
        this.selectWorkspace(workspace.id);
      }
      this.workspaceDialogOpen.set(false);
    } catch {
      this.workspaceDialogError.set('save');
    } finally {
      this.workspaceDialogAction.set(null);
    }
  }

  protected async deleteWorkspace(): Promise<void> {
    if (this.workspaceDialogPending()) {
      return;
    }
    const editing = this.editingWorkspace();
    const account = this.accountContext.selectedAccount();
    if (!editing || !account?.uid || this.isCanonicalDefaultWorkspace(editing)) {
      return;
    }
    const accountUid = account.uid;
    this.workspaceDialogAction.set('delete');
    this.workspaceDialogError.set(null);
    try {
      await firstValueFrom(this.projectsService.deleteWorkspace(accountUid, editing.id));
      if (!this.isStillSelectedAccount(accountUid)) {
        return;
      }
      const wasActive = this.selectedWorkspaceId() === editing.id;
      const remaining = this.workspaces().filter((w) => w.id !== editing.id);
      this.workspaceLoading.set(true);
      this.workspaces.set(remaining.length > 0 ? remaining : [...DEFAULT_ORG_PROJECTS_WORKSPACES]);
      this.workspaceReload.update((n) => n + 1);
      if (wasActive && remaining.length > 0) {
        this.selectWorkspace(remaining[0].id);
      } else if (wasActive) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { workspace: null, page: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
      this.workspaceDialogOpen.set(false);
      this.reload.update((n) => n + 1);
    } catch {
      this.workspaceDialogError.set('delete');
    } finally {
      this.workspaceDialogAction.set(null);
    }
  }

  protected openRowMenu(menu: MenuComponent, project: OrgLensProject, event: Event): void {
    this.rowMenuItems = this.buildRowMenu(project);
    menu.toggle(event);
  }

  protected exportCsv(): void {
    const rows = this.sortedProjects();
    if (!rows.length) {
      return;
    }
    const header = ['Project', 'Health Score', 'Technical Influence', 'Ecosystem Influence', 'Influence Trend (1y) %', 'Our Contributors', 'Our Participants'];
    const body = rows.map((p) => [
      p.name,
      HEALTH_SCORE_LABELS[this.normalizeHealth(p.health)],
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

  // Signal-strength bars for an influence band: filled count = rank (Leading 4 → Silent 1 → Non-LF 0),
  // colored by band; remaining bars faded. Non-LF (0 filled) gets a diagonal slash from the template.
  // Geometry mirrors the LFX Insights signal-bar icon: 4 evenly spaced, ascending, rounded bars in a 16×16 box.
  protected bandBars(band: InfluenceBand): OrgProjectsSignalBar[] {
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
  protected openHealth(event: Event, project: OrgProjectsTableRow, popover: Popover): void {
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
  // Hover tooltip for the Influence Trend sparkline: combined / technical / ecosystem 1y deltas.
  protected trendTooltip(project: OrgLensProject): string {
    const t = project.trend;
    return `<div class="flex flex-col gap-1 text-left">${this.trendTooltipRow('Combined influence', t.deltaPct)}${this.trendTooltipRow('Technical influence', t.technicalDeltaPct)}${this.trendTooltipRow('Ecosystem influence', t.ecosystemDeltaPct)}</div>`;
  }
  protected trendTooltipRow(label: string, value: number): string {
    const sign = value > 0 ? '+' : '';
    return `<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><span class="truncate text-gray-200">${label}</span><span class="font-semibold ${this.pctColorClass(value)}">${sign}${value}%</span></div>`;
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

  // Plain-text trend summary for screen readers / keyboard focus on the sparkline.
  protected trendAriaLabel(project: OrgLensProject): string {
    const t = project.trend;
    const fmt = (v: number): string => `${v > 0 ? '+' : ''}${v}%`;
    return `Influence trend over the past year — combined ${fmt(t.deltaPct)}, technical ${fmt(t.technicalDeltaPct)}, ecosystem ${fmt(t.ecosystemDeltaPct)}.`;
  }
  // Full health summary (rating + sub-scores) so keyboard/screen-reader users get the popover's content without a mouse.
  protected healthAriaLabel(project: OrgLensProject): string {
    const metrics = project.healthMetrics.map((m) => `${m.label} ${m.value}`).join(', ');
    return `Health: ${HEALTH_SCORE_LABELS[this.normalizeHealth(project.health)]}. ${metrics}.`;
  }
  protected searchAddableProjects(query: string): void {
    if (this.addableProjectsSearchDebounceTimer) {
      clearTimeout(this.addableProjectsSearchDebounceTimer);
    }
    this.addableProjectsSearchDebounceTimer = setTimeout(() => {
      void this.runAddableProjectsSearch(query);
    }, 300);
  }

  private formatTrendDeltaPct(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    if (Math.abs(rounded) <= 1) {
      if (rounded < 0) {
        const abs = Math.abs(rounded);
        const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
        return `−${body}%`;
      }
      const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${body}%`;
    }
    const sign = rounded > 0 ? '+' : '−';
    const abs = Math.abs(rounded);
    const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
    return `${sign}${body}%`;
  }

  private async runAddableProjectsSearch(query: string): Promise<void> {
    const account = this.accountContext.selectedAccount();
    const trimmed = query.trim();
    const requestId = ++this.addableProjectsSearchRequestId;
    if (!account?.uid || (trimmed.length > 0 && trimmed.length < ORG_PROJECTS_SEARCH_MIN_LENGTH)) {
      this.addableProjectOptions.set([]);
      this.addProjectsSearchError.set(false);
      this.addProjectsSearchLoading.set(false);
      return;
    }

    this.addProjectsSearchLoading.set(true);
    this.addProjectsSearchError.set(false);
    try {
      const excludeSlugs = [...new Set(this.selectedWorkspace()?.projectSlugs ?? [])];
      const { results } = await firstValueFrom(this.projectsService.searchProjects(account.uid, trimmed, excludeSlugs));
      if (requestId !== this.addableProjectsSearchRequestId) {
        return;
      }
      this.addableProjectOptions.set(this.mapAddableOptions(results));
    } catch (err) {
      if (requestId !== this.addableProjectsSearchRequestId) {
        return;
      }
      console.error('Failed to search addable org projects', err);
      this.addableProjectOptions.set([]);
      this.addProjectsSearchError.set(true);
    } finally {
      if (requestId === this.addableProjectsSearchRequestId) {
        this.addProjectsSearchLoading.set(false);
      }
    }
  }

  // Private initializers
  private initWorkspaces(): Signal<unknown> {
    const account$ = toObservable(computed(() => ({ account: this.accountContext.selectedAccount(), _reload: this.workspaceReload() })));
    return toSignal(
      account$.pipe(
        switchMap(({ account }) => {
          if (!account?.uid) {
            this.workspaces.set([...DEFAULT_ORG_PROJECTS_WORKSPACES]);
            this.workspaceError.set(false);
            return of(null);
          }
          this.workspaceLoading.set(true);
          this.workspaceError.set(false);
          return this.projectsService.getWorkspaces(account.uid).pipe(
            tap((response) => {
              this.workspaces.set(response.workspaces.length ? response.workspaces : [...DEFAULT_ORG_PROJECTS_WORKSPACES]);
            }),
            catchError((err) => {
              console.error('Failed to load org project workspaces', err);
              this.workspaceError.set(true);
              return of(null);
            }),
            finalize(() => this.workspaceLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initResponse(): Signal<OrgLensProjectsResponse | null> {
    const account$ = toObservable(
      computed(() => ({
        account: this.accountContext.selectedAccount(),
        workspace: this.selectedWorkspace(),
        workspaceError: this.workspaceError(),
        workspaceLoading: this.workspaceLoading(),
        _workspaces: this.workspacesResponse(),
        _reload: this.reload(),
      }))
    );
    return toSignal(
      account$.pipe(
        switchMap(({ account, workspace, workspaceError, workspaceLoading, _workspaces }) => {
          if (!account?.uid || !workspace || workspaceError || workspaceLoading || _workspaces === null) {
            this.projectsLoading.set(false);
            return of(null);
          }
          if (workspace.projectSlugs.length === 0) {
            this.projectsLoading.set(false);
            this.projectsError.set(false);
            return of(this.emptyProjectsResponse(account.accountName ?? '', account.uid));
          }
          this.projectsLoading.set(true);
          this.projectsError.set(false);
          return concat(
            of(null),
            this.projectsService.getProjects(account.uid, account.accountName ?? '', workspace.projectSlugs).pipe(
              catchError((err) => {
                console.error('Failed to load org projects', err);
                this.projectsError.set(true);
                return of(null);
              }),
              finalize(() => this.projectsLoading.set(false))
            )
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initFoundationOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => this.buildFoundationOptions());
  }

  private initEmployeeOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => this.buildEmployeeOptions());
  }

  private initFilteredProjects(): Signal<OrgLensProject[]> {
    return computed(() => this.buildFilteredProjects());
  }

  private initSortedProjects(): Signal<OrgLensProject[]> {
    return computed(() => this.buildSortedProjects());
  }

  // Enrich each sorted project with presentation values so the template only reads properties (no in-template logic).
  private initRows(): Signal<OrgProjectsTableRow[]> {
    return computed(() =>
      this.sortedProjects().map((project) => ({
        ...project,
        insightsUrl: buildInsightsUrl(`/project/${project.slug}`),
        technicalBars: this.bandBars(project.technicalInfluence),
        ecosystemBars: this.bandBars(project.ecosystemInfluence),
        technicalBandLabel: INFLUENCE_BAND_LABELS[project.technicalInfluence],
        ecosystemBandLabel: INFLUENCE_BAND_LABELS[project.ecosystemInfluence],
        healthLabel: HEALTH_SCORE_LABELS[this.normalizeHealth(project.health)],
        healthBadge: HEALTH_SCORE_BADGE[this.normalizeHealth(project.health)],
        sparklineDataset: {
          labels: project.trend.series.map((_, i) => String(i)),
          datasets: [{ data: project.trend.series, borderColor: INFLUENCE_TREND_COLOR[project.trend.direction], fill: false }],
        },
        trendTooltipHtml: this.trendTooltip(project),
        trendAriaLabel: this.trendAriaLabel(project),
        trendDeltaLabel: this.formatTrendDeltaPct(project.trend.deltaPct),
        showTrendArrow: Math.abs(project.trend.deltaPct) > 1,
        trendArrowIcon: INFLUENCE_TREND_ARROW_ICON[project.trend.direction],
        trendDeltaTextClass: INFLUENCE_TREND_TEXT_CLASS[project.trend.direction],
        trendArrowBadgeClass: INFLUENCE_TREND_ARROW_BADGE_CLASS[project.trend.direction],
        healthAriaLabel: this.healthAriaLabel(project),
      }))
    );
  }

  private initWorkspaceDialogErrorMessage(): string | null {
    const error = this.workspaceDialogError();
    if (error === 'delete') {
      return 'Could not delete this workspace. Try again.';
    }
    if (error === 'save') {
      return this.editingWorkspace() ? 'Could not save workspace changes. Try again.' : 'Could not create this workspace. Try again.';
    }
    return null;
  }

  private initSortField(): OrgProjectsSortField {
    const raw = this.queryParamMap().get('sort');
    return raw && VALID_ORG_PROJECTS_SORT_FIELDS.has(raw as OrgProjectsSortField) ? (raw as OrgProjectsSortField) : DEFAULT_ORG_PROJECTS_SORT_FIELD;
  }

  private initSortIconMap(): Record<OrgProjectsSortField, string> {
    const field = this.sortField();
    const active = this.sortDir() === 'asc' ? 'fa-solid fa-sort-up text-blue-500' : 'fa-solid fa-sort-down text-blue-500';
    const inactive = 'fa-light fa-sort text-gray-300';
    return {
      name: field === 'name' ? active : inactive,
      health: field === 'health' ? active : inactive,
      technicalInfluence: field === 'technicalInfluence' ? active : inactive,
      ecosystemInfluence: field === 'ecosystemInfluence' ? active : inactive,
      influenceTrend: field === 'influenceTrend' ? active : inactive,
      contributors: field === 'contributors' ? active : inactive,
      participants: field === 'participants' ? active : inactive,
    };
  }

  private initAriaSortMap(): Record<OrgProjectsSortField, OrgProjectsAriaSort> {
    const field = this.sortField();
    const active: OrgProjectsAriaSort = this.sortDir() === 'asc' ? 'ascending' : 'descending';
    return {
      name: field === 'name' ? active : 'none',
      health: field === 'health' ? active : 'none',
      technicalInfluence: field === 'technicalInfluence' ? active : 'none',
      ecosystemInfluence: field === 'ecosystemInfluence' ? active : 'none',
      influenceTrend: field === 'influenceTrend' ? active : 'none',
      contributors: field === 'contributors' ? active : 'none',
      participants: field === 'participants' ? active : 'none',
    };
  }

  private initPageSize(): number {
    const raw = Number(this.queryParamMap().get('size'));
    return ORG_PROJECTS_PAGE_SIZE_OPTIONS.includes(raw) ? raw : DEFAULT_ORG_PROJECTS_PAGE_SIZE;
  }

  private initPageFirst(): number {
    const page = Math.max(1, Number(this.queryParamMap().get('page')) || 1);
    return (page - 1) * this.pageSize();
  }

  private initSelectedWorkspaceId(): OrgProjectsWorkspaceId {
    const list = this.workspaces();
    const raw = this.queryParamMap().get('workspace');
    if (raw && list.some((w) => w.id === raw)) {
      return raw;
    }
    const defaultWorkspace = list.find((w) => w.id === DEFAULT_ORG_PROJECTS_WORKSPACE_ID || w.name === DEFAULT_ORG_PROJECTS_WORKSPACE_NAME);
    if (defaultWorkspace) {
      return defaultWorkspace.id;
    }
    return list[0]?.id ?? DEFAULT_ORG_PROJECTS_WORKSPACE_ID;
  }

  private initAddProjectDisabledReason(): string | undefined {
    if (!this.hasCompany()) return 'Select an organization first';
    if (this.loading()) return 'Projects are still loading';
    if (this.error()) return 'Resolve the loading error first';
    if (!this.selectedWorkspace()) return 'No workspace is selected';
    return undefined;
  }

  private initAddProjectsSearchEmptyTitle(): string {
    const query = this.addProjectsForm.controls.search.value.trim();
    if (query.length > 0 && query.length < ORG_PROJECTS_SEARCH_MIN_LENGTH) {
      return `Type at least ${ORG_PROJECTS_SEARCH_MIN_LENGTH} characters to search projects.`;
    }
    return query ? 'No projects match your search.' : 'No projects available to add.';
  }

  private initTableEmptyState(): OrgProjectsEmptyState {
    const workspace = this.selectedWorkspace();
    if (workspace && !this.isCanonicalDefaultWorkspace(workspace) && workspace.projectSlugs.length === 0) {
      return {
        icon: 'fa-light fa-folder-plus',
        title: 'No projects in this workspace yet',
        subtitle: 'Add projects from your organization catalog to start tracking this workspace.',
        ctaLabel: 'Add Project',
        ctaIcon: 'fa-light fa-plus',
        action: 'addProject',
      };
    }

    if ((this.response()?.projects.length ?? 0) === 0) {
      if (workspace && workspace.projectSlugs.length > 0) {
        return {
          icon: 'fa-light fa-triangle-exclamation',
          title: 'Could not load projects for this workspace',
          subtitle: 'Your saved project list did not match any catalog rows. Retry or add projects again.',
          ctaLabel: 'Retry',
          ctaIcon: 'fa-light fa-rotate-right',
          action: 'retry',
        };
      }
      return {
        icon: 'fa-light fa-folder-open',
        title: 'No projects with activity yet',
        subtitle: 'Projects will appear here once this organization has activity in the catalog.',
      };
    }

    return {
      icon: 'fa-light fa-filter-slash',
      title: 'No results for filters',
      subtitle: 'Try a different workspace or clear your filters.',
      ctaLabel: 'Reset filters',
      ctaIcon: 'fa-light fa-rotate-left',
      action: 'resetFilters',
    };
  }

  private isStillSelectedAccount(accountUid: string): boolean {
    return this.accountContext.selectedAccount()?.uid === accountUid;
  }

  private isCanonicalDefaultWorkspace(workspace: Pick<OrgProjectsWorkspace, 'id' | 'name'>): boolean {
    return workspace.id === DEFAULT_ORG_PROJECTS_WORKSPACE_ID || workspace.name === DEFAULT_ORG_PROJECTS_WORKSPACE_NAME;
  }

  private buildFoundationOptions(): { label: string; value: string }[] {
    const bySlug = new Map<string, string>();
    for (const project of this.response()?.projects ?? []) {
      bySlug.set(project.foundation.slug, project.foundation.name);
    }
    const options = [...bySlug.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    return [{ label: 'All Foundations', value: ORG_PROJECTS_ALL_FOUNDATIONS_FILTER }, ...options];
  }

  private buildEmployeeOptions(): { label: string; value: string }[] {
    const byId = new Map<string, string>();
    for (const project of this.response()?.projects ?? []) {
      for (const person of [...project.maintainers, ...project.contributors, ...project.participants]) {
        byId.set(person.id, person.name);
      }
    }
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  private buildFilteredProjects(): OrgLensProject[] {
    const all = this.response()?.projects ?? [];
    const foundation = this.formValue().foundation ?? ORG_PROJECTS_ALL_FOUNDATIONS_FILTER;
    const validEmployeeIds = new Set(this.employeeOptions().map((option) => option.value));
    const employees = (this.formValue().employees ?? []).filter((id) => validEmployeeIds.has(id));
    return all
      .filter((p) => foundation === ORG_PROJECTS_ALL_FOUNDATIONS_FILTER || p.foundation.slug === foundation)
      .filter((p) => employees.length === 0 || [...p.maintainers, ...p.contributors, ...p.participants].some((person) => employees.includes(person.id)));
  }

  private buildSortedProjects(): OrgLensProject[] {
    const projects = [...this.filteredProjects()];
    projects.sort((a, b) => this.compareProjects(a, b, this.sortField(), this.sortDir()));
    return projects;
  }

  private compareProjects(a: OrgLensProject, b: OrgLensProject, field: OrgProjectsSortField, dir: SortDirection): number {
    if (field === 'health') {
      const availability = this.compareHealthAvailability(a.health, b.health);
      if (availability !== 0) {
        return availability;
      }
    }
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

  private normalizeHealth(health: HealthScore): HealthScore {
    return Object.prototype.hasOwnProperty.call(HEALTH_SCORE_BADGE, health) ? health : 'unavailable';
  }

  private compareHealthAvailability(a: OrgLensProject['health'], b: OrgLensProject['health']): number {
    const aUnavailable = this.normalizeHealth(a) === 'unavailable';
    const bUnavailable = this.normalizeHealth(b) === 'unavailable';
    if (aUnavailable === bUnavailable) {
      return 0;
    }
    return aUnavailable ? 1 : -1;
  }

  private healthRank(health: OrgLensProject['health']): number {
    switch (this.normalizeHealth(health)) {
      case 'excellent':
        return 5;
      case 'healthy':
        return 4;
      case 'stable':
        return 3;
      case 'unsteady':
        return 2;
      case 'critical':
        return 1;
      default:
        return 0;
    }
  }

  private buildRowMenu(project: OrgLensProject): MenuItem[] {
    return [{ label: 'Hide project from workspace', icon: 'fa-light fa-eye-slash', command: () => this.hideFromWorkspace(project.slug) }];
  }

  private async hideFromWorkspace(slug: string): Promise<void> {
    const account = this.accountContext.selectedAccount();
    const workspace = this.selectedWorkspace();
    if (!account?.uid || !workspace) {
      return;
    }
    try {
      const { workspace: updated } = await firstValueFrom(this.projectsService.removeProjectFromWorkspace(account.uid, workspace.id, slug));
      this.mergeWorkspace({ ...updated, name: updated.name || workspace.name });
      this.reload.update((n) => n + 1);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not update workspace',
        detail: 'The project was not hidden from this workspace. Please try again.',
      });
    }
  }

  private mergeWorkspace(workspace: OrgProjectsWorkspace): void {
    this.workspaces.update((list) => list.map((item) => (item.id === workspace.id ? workspace : item)));
  }

  private mapAddableOptions(results: OrgLensProjectSearchResult[]): AddableProjectOption[] {
    const inWorkspace = new Set(this.selectedWorkspace()?.projectSlugs ?? []);
    return results
      .filter((project) => !inWorkspace.has(project.slug))
      .map((project) => ({ value: project.slug, label: project.name, logoUrl: project.logoUrl }));
  }

  private syncSelectedAddableProjectOptions(): void {
    const selected = new Set(this.addProjectsForm.getRawValue().projects);
    const options = this.mergeAddableOptions([...this.selectedAddableProjectOptions(), ...this.addableProjectOptions()]);
    this.selectedAddableProjectOptions.set(options.filter((option) => selected.has(option.value)));
  }

  private mergeAddableOptions(options: AddableProjectOption[]): AddableProjectOption[] {
    const byValue = new Map<string, AddableProjectOption>();
    for (const option of options) {
      byValue.set(option.value, option);
    }
    return [...byValue.values()];
  }

  private emptyProjectsResponse(orgName: string, orgUid: string): OrgLensProjectsResponse {
    return {
      orgSlug:
        orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || orgUid,
      orgName,
      dataUpdatedAt: new Date().toISOString(),
      projects: [],
    };
  }

  private readEmployeesFromUrl(): string[] {
    const raw = this.route.snapshot.queryParamMap.get('employees');
    return raw ? raw.split(',').filter(Boolean) : [];
  }
}
