// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, MyCommittee, ProjectContext, StatCardItem } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { CommitteeTableComponent } from '../components/committee-table/committee-table.component';

@Component({
  selector: 'lfx-committee-dashboard',
  imports: [ButtonComponent, CardComponent, CommitteeTableComponent, SkeletonModule, EmptyStateComponent, StatCardGridComponent],
  templateUrl: './committee-dashboard.component.html',
  styleUrl: './committee-dashboard.component.scss',
})
export class CommitteeDashboardComponent {
  // Inject services
  private readonly projectContextService = inject(ProjectContextService);
  private readonly committeeService = inject(CommitteeService);
  private readonly personaService = inject(PersonaService);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly messageService = inject(MessageService);

  // Use the configurable label constants
  protected readonly committeeLabel = COMMITTEE_LABEL;

  // ── Writable Signals ──────────────────────────────────────────────────────
  public committeesLoading = signal<boolean>(true);
  public myCommitteesLoading = signal<boolean>(true);
  public refresh = signal(0);
  public foundationFilter = signal<string | null>(null);
  public projectFilter = signal<string | null>(null);

  // ── Forms ─────────────────────────────────────────────────────────────────
  public searchForm: FormGroup;
  // ── Computed / Read-only Signals ──────────────────────────────────────────
  public project: Signal<ProjectContext | null>;
  public committees: Signal<Committee[]>;
  public myCommittees: Signal<MyCommittee[]>;
  public filteredMyCommittees: Signal<MyCommittee[]>;
  public myCommitteeUids: Signal<Set<string>>;
  public categories: Signal<{ label: string; value: string | null }[]>;
  public votingStatusOptions: Signal<{ label: string; value: string | null }[]>;
  public filteredCommittees: Signal<Committee[]>;
  public categoryFilter: Signal<string | null>;
  public votingStatusFilter: Signal<string | null>;

  // Foundation and project filter options (separate dropdowns)
  public foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initializeFoundationOptions();
  public projectOptions: Signal<{ label: string; value: string | null }[]> = this.initializeProjectOptions();

  // Lens & permissions
  public readonly isMeLens: Signal<boolean> = computed(() => this.lensService.activeLens() === 'me');
  public readonly isFoundationContext: Signal<boolean> = this.projectContextService.isFoundationContext;
  protected readonly canWrite = this.projectContextService.canWrite;
  public showFoundationFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
  public showProjectFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasProjectRole() && this.projectOptions().length > 1);

  // Statistics
  public totalCommittees: Signal<number>;
  public publicCommittees: Signal<number>;
  public activeVoting: Signal<number>;
  public totalMembers: Signal<number>;

  // Me lens statistics
  public myTotalGroups: Signal<number>;
  public myPublicGroups: Signal<number>;
  public myActiveVoting: Signal<number>;

  // Stat card arrays for the shared <lfx-stat-card-grid> component
  public foundationStatCards: Signal<StatCardItem[]>;
  public myStatCards: Signal<StatCardItem[]>;

  private searchTerm: Signal<string>;

  public constructor() {
    // Initialize project context
    this.project = computed(() => this.projectContextService.activeContext());

    // Initialize data
    this.committees = this.initializeCommittees();
    this.myCommittees = this.initializeMyCommittees();
    this.myCommitteeUids = computed(() => new Set(this.myCommittees().map((c) => c.uid)));

    // Initialize search form
    this.searchForm = this.initializeSearchForm();
    this.searchTerm = this.initializeSearchTerm();
    this.categoryFilter = this.initializeCategoryFilter();
    this.votingStatusFilter = this.initializeVotingStatusFilter();

    // Initialize filters
    this.categories = this.initializeCategories();
    this.votingStatusOptions = this.initializeVotingStatusOptions();
    this.filteredCommittees = this.initializeFilteredCommittees();
    this.filteredMyCommittees = this.initializeFilteredMyCommittees();

    // Initialize statistics
    this.totalCommittees = computed(() => this.committees().length);
    this.publicCommittees = computed(() => this.committees().filter((c) => c.public).length);
    this.activeVoting = computed(() => this.committees().filter((c) => c.enable_voting).length);
    this.totalMembers = computed(() => this.committees().reduce((sum, c) => sum + (c.total_members || 0), 0));

    // Me lens statistics (derived from myCommittees)
    this.myTotalGroups = computed(() => this.myCommittees().length);
    this.myPublicGroups = computed(() => this.myCommittees().filter((c) => c.public).length);
    this.myActiveVoting = computed(() => this.myCommittees().filter((c) => c.enable_voting).length);

    // Stat card arrays consumed by <lfx-stat-card-grid>
    this.foundationStatCards = computed<StatCardItem[]>(() => [
      { value: this.totalCommittees(), label: 'Total Groups', icon: 'fa-light fa-users-rectangle', iconContainerClass: 'bg-gray-200 text-gray-500' },
      { value: this.publicCommittees(), label: 'Public Groups', icon: 'fa-light fa-globe', iconContainerClass: 'bg-blue-100 text-blue-600' },
      { value: this.activeVoting(), label: 'Voting Enabled Groups', icon: 'fa-light fa-check-to-slot', iconContainerClass: 'bg-emerald-100 text-emerald-600' },
    ]);
    this.myStatCards = computed<StatCardItem[]>(() => [
      { value: this.myTotalGroups(), label: 'Total Groups', icon: 'fa-light fa-users-rectangle', iconContainerClass: 'bg-gray-200 text-gray-500' },
      { value: this.myPublicGroups(), label: 'Public Groups', icon: 'fa-light fa-globe', iconContainerClass: 'bg-blue-100 text-blue-600' },
      {
        value: this.myActiveVoting(),
        label: 'Voting Enabled Groups',
        icon: 'fa-light fa-check-to-slot',
        iconContainerClass: 'bg-emerald-100 text-emerald-600',
      },
    ]);
  }

  public openCreateDialog(): void {
    const uid = this.project()?.uid;
    if (!uid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Warning',
        detail: 'Please select a project first',
      });
      return;
    }

    this.router.navigate(['/groups/create']);
  }

  public refreshCommittees(): void {
    this.committeesLoading.set(true);
    this.refresh.update((v) => v + 1);
  }

  public onCommitteeClick(committee: Committee): void {
    this.router.navigate(['/groups', committee.uid], {
      state: { backLabel: this.isMeLens() ? 'My Groups' : 'Groups' },
    });
  }

  public onFoundationFilterChange(value: string | null): void {
    this.foundationFilter.set(value);
    this.projectFilter.set(null);
    this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
  }

  public onProjectFilterChange(value: string | null): void {
    this.projectFilter.set(value);
  }

  private resetScopeFilters(): void {
    this.foundationFilter.set(null);
    this.projectFilter.set(null);
    this.searchForm?.get('foundationFilter')?.setValue(null, { emitEvent: false });
    this.searchForm?.get('projectFilter')?.setValue(null, { emitEvent: false });
  }

  private initializeMyCommittees(): Signal<MyCommittee[]> {
    const project$ = toObservable(this.project);
    const refresh$ = toObservable(this.refresh);
    const isFoundationContext$ = toObservable(this.isFoundationContext);
    const isMeLens$ = toObservable(this.isMeLens);

    // Resolve the active scope for "my committees":
    // - Me lens with no selected context → fetch across all foundations and projects.
    // - Otherwise → scope to the active foundation or project context.
    // Reset per-page filters only when the actual scope changes (mode flip or UID change),
    // not on every refresh button click.
    const scope$ = combineLatest([project$, isFoundationContext$, isMeLens$]).pipe(
      map(([project, isFoundation, isMeLens]) => {
        const uid = project?.uid ?? '';
        if (isMeLens && !uid) {
          return { mode: 'all' as const, uid: '', key: 'all' };
        }
        const mode = isFoundation ? ('foundation' as const) : ('project' as const);
        return { mode, uid, key: `${mode}:${uid}` };
      }),
      distinctUntilChanged((a, b) => a.key === b.key),
      tap(() => this.resetScopeFilters())
    );

    return toSignal(
      combineLatest([scope$, refresh$]).pipe(
        switchMap(([scope]) => {
          if (scope.mode !== 'all' && !scope.uid) {
            this.myCommitteesLoading.set(false);
            return of([] as MyCommittee[]);
          }

          this.myCommitteesLoading.set(true);
          const projectUid = scope.mode === 'project' ? scope.uid : undefined;
          const foundationUid = scope.mode === 'foundation' ? scope.uid : undefined;
          return this.committeeService.getMyCommittees(projectUid, foundationUid).pipe(finalize(() => this.myCommitteesLoading.set(false)));
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl<string>(''),
      category: new FormControl<string | null>(null),
      votingStatus: new FormControl<string | null>(null),
      foundationFilter: new FormControl<string | null>(null),
      projectFilter: new FormControl<string | null>(null),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.searchForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeCategoryFilter(): Signal<string | null> {
    return toSignal(this.searchForm.get('category')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeVotingStatusFilter(): Signal<string | null> {
    return toSignal(this.searchForm.get('votingStatus')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeCommittees(): Signal<Committee[]> {
    const project$ = toObservable(this.project);
    const refresh$ = toObservable(this.refresh);
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, refresh$, lens$]).pipe(
        switchMap(([project, , lens]) => {
          if (lens === 'me' || !project?.uid) {
            this.committeesLoading.set(false);
            return of([]);
          }

          this.committeesLoading.set(true);
          return this.committeeService.getCommitteesByProject(project.uid).pipe(
            catchError((error) => {
              console.error('Failed to load committees:', error);
              return of([]);
            }),
            finalize(() => this.committeesLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeCategories(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const committeesData = this.isMeLens() ? this.myCommittees() : this.committees();

      // Count committees by category, falling back to 'Other' when category is absent
      const categoryCounts = new Map<string, number>();
      committeesData.forEach((committee) => {
        const cat = committee.category || 'Other';
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      });

      // Get unique categories and sort them
      const uniqueCategories = Array.from(categoryCounts.keys()).sort((a, b) => a.localeCompare(b));

      // Create options with counts
      const categoryOptions = uniqueCategories.map((cat) => ({
        label: `${cat} (${categoryCounts.get(cat)})`,
        value: cat,
      }));

      return [{ label: 'All', value: null }, ...categoryOptions];
    });
  }

  private initializeVotingStatusOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const committeesData = this.isMeLens() ? this.myCommittees() : this.committees();

      // Count committees by voting status
      const votingEnabledCount = committeesData.filter((c) => c.enable_voting === true).length;
      const votingDisabledCount = committeesData.filter((c) => c.enable_voting === false).length;

      return [
        { label: 'All Voting Status', value: null },
        { label: `Voting Enabled (${votingEnabledCount})`, value: 'enabled' },
        { label: `Voting Disabled (${votingDisabledCount})`, value: 'disabled' },
      ];
    });
  }

  private initializeFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const items = this.myCommittees();
      const seen = new Map<string, string>();
      for (const item of items) {
        if (item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
          seen.set(item.project_uid, item.project_name || item.project_uid);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Foundations', value: null }, ...options];
    });
  }

  private initializeProjectOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const items = this.myCommittees();
      const foundation = this.foundationFilter();
      const seen = new Map<string, string>();
      for (const item of items) {
        if (!item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
          if (foundation && item.parent_project_uid !== foundation) {
            continue;
          }
          seen.set(item.project_uid, item.project_name || item.project_uid);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Projects', value: null }, ...options];
    });
  }

  private initializeFilteredCommittees(): Signal<Committee[]> {
    return computed(() => {
      let filtered = this.committees();

      // Apply search filter
      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter(
          (committee) =>
            committee.name.toLowerCase().includes(searchTerm) ||
            committee.description?.toLowerCase().includes(searchTerm) ||
            committee.category?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply category filter
      const category = this.categoryFilter();
      if (category) {
        filtered = filtered.filter((committee) => (committee.category || 'Other') === category);
      }

      // Apply voting status filter
      const votingStatus = this.votingStatusFilter();
      if (votingStatus) {
        if (votingStatus === 'enabled') {
          filtered = filtered.filter((committee) => committee.enable_voting === true);
        } else if (votingStatus === 'disabled') {
          filtered = filtered.filter((committee) => committee.enable_voting === false);
        }
      }

      return filtered;
    });
  }

  private initializeFilteredMyCommittees(): Signal<MyCommittee[]> {
    return computed(() => {
      let filtered: MyCommittee[] = this.myCommittees();

      // Apply foundation/project filter (client-side)
      const project = this.projectFilter();
      const foundation = this.foundationFilter();
      if (project) {
        filtered = filtered.filter((c) => c.project_uid === project);
      } else if (foundation) {
        filtered = filtered.filter((c) => c.project_uid === foundation || (c.parent_project_uid === foundation && !c.is_foundation));
      }

      // Apply search filter
      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter(
          (committee) =>
            committee.name.toLowerCase().includes(searchTerm) ||
            committee.display_name?.toLowerCase().includes(searchTerm) ||
            committee.description?.toLowerCase().includes(searchTerm) ||
            committee.category?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply category filter
      const category = this.categoryFilter();
      if (category) {
        filtered = filtered.filter((c) => (c.category || 'Other') === category);
      }

      // Apply voting status filter
      const votingStatus = this.votingStatusFilter();
      if (votingStatus === 'enabled') {
        filtered = filtered.filter((c) => c.enable_voting === true);
      } else if (votingStatus === 'disabled') {
        filtered = filtered.filter((c) => c.enable_voting === false);
      }

      return filtered;
    });
  }
}
