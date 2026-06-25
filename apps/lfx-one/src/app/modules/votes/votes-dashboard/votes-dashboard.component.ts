// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { PollStatus, VOTE_LABEL, VoteResponseStatus } from '@lfx-one/shared';
import { Committee, PaginatedResponse, ProjectContext, Vote, VoteFilterState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, finalize, map, of, switchMap, tap } from 'rxjs';

import { VoteCastDrawerComponent } from '../components/vote-cast-drawer/vote-cast-drawer.component';
import { VoteResultsDrawerComponent } from '../components/vote-results-drawer/vote-results-drawer.component';
import { VotesTableComponent } from '../components/votes-table/votes-table.component';

@Component({
  selector: 'lfx-votes-dashboard',
  imports: [
    LowerCasePipe,
    ButtonComponent,
    VotesTableComponent,
    VoteResultsDrawerComponent,
    VoteCastDrawerComponent,
    RouterLink,
    EmptyStateComponent,
    SkeletonModule,
  ],
  templateUrl: './votes-dashboard.component.html',
  styleUrl: './votes-dashboard.component.scss',
})
export class VotesDashboardComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);
  private readonly committeeService = inject(CommitteeService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL.singular;
  protected readonly voteLabelPlural = VOTE_LABEL.plural;

  // === Subjects ===
  // refresh$ triggers count re-fetch (manual refresh, project change)
  protected readonly refresh$ = new BehaviorSubject<void>(undefined);
  // fetch$ triggers votes list re-fetch (pagination, manual refresh)
  private readonly fetch$ = new BehaviorSubject<void>(undefined);

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly canWrite = this.projectContextService.canWrite;
  protected readonly resultsDrawerVisible = signal<boolean>(false);
  protected readonly castDrawerVisible = signal<boolean>(false);
  protected readonly selectedVoteId = signal<string | null>(null);
  protected readonly rowsPerPage = signal<number>(10);
  protected readonly currentFirst = signal<number>(0);
  protected readonly totalRecords = signal<number>(0);
  protected readonly myVotesLoading = signal<boolean>(true);
  protected readonly foundationFilter = signal<string | null>(null);
  protected readonly projectFilter = signal<string | null>(null);

  // === Lens ===
  protected readonly isMeLens: Signal<boolean> = computed(() => this.lensService.activeLens() === 'me');
  protected readonly personaLoaded = this.personaService.personaLoaded;
  public showFoundationFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
  public showProjectFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasProjectRole() && this.projectOptions().length > 1);

  // === Filter State ===
  protected readonly filters = signal<VoteFilterState>({ search: '', status: null, group: null });

  // === Page Tokens ===
  // Sequential token array: index 0 = token for page 2, index 1 = token for page 3, etc.
  private pageTokens: string[] = [];

  // === Computed Signals ===
  protected readonly project: Signal<ProjectContext | null> = this.initProject();
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly votes: Signal<Vote[]> = this.initVotes();
  protected readonly selectedListVote: Signal<Vote | null> = this.initSelectedListVote();
  protected readonly myVotes: Signal<Vote[]> = this.initMyVotes();
  protected readonly totalCount: Signal<number> = this.initTotalCount();
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initializeFoundationOptions();
  protected readonly projectOptions: Signal<{ label: string; value: string | null }[]> = this.initializeProjectOptions();
  protected readonly filteredMyVotes: Signal<Vote[]> = this.initFilteredMyVotes();
  // True when any server-side filter is active; drives dashboard empty-state vs. table empty-state routing.
  // Trims `search` so whitespace-only input doesn't count as an active filter.
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => {
    const f = this.filters();
    return !!(f.search?.trim() || f.status || f.group);
  });

  // Lens-change pagination reset is independent of the data-fetch pipelines so it fires for every lens emission, not just Me-lens loads.
  // fetch$.next() forces initVotes() to re-run after the reset — field-init order means it would otherwise see stale currentFirst and stop at the page-token guard.
  public constructor() {
    toObservable(this.lensService.activeLens)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pageTokens = [];
        this.currentFirst.set(0);
        this.fetch$.next();
      });
  }

  protected onViewVote(voteId: string): void {
    this.selectedVoteId.set(voteId);

    // Look up the picked vote synchronously — selectedListVote() hasn't re-derived yet.
    const source = this.isMeLens() ? this.myVotes() : this.votes();
    const picked = source.find((v) => v.uid === voteId) ?? null;

    if (picked && this.shouldOpenCastDrawerFor(picked)) {
      this.resultsDrawerVisible.set(false);
      this.castDrawerVisible.set(true);
    } else {
      this.castDrawerVisible.set(false);
      this.resultsDrawerVisible.set(true);
    }
  }

  protected onViewResults(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.castDrawerVisible.set(false);
    this.resultsDrawerVisible.set(true);
  }

  protected onCastFromResults(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.resultsDrawerVisible.set(false);
    this.castDrawerVisible.set(true);
  }

  // Me-lens uses myVotes (refresh$); fetch$ feeds initVotes (non-Me) and would just cause extra churn.
  protected onVoteSubmitted(): void {
    this.refresh$.next();
  }

  protected refreshVotes(): void {
    this.loading.set(true);
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.fetch$.next();
    this.refresh$.next();
  }

  protected onPageChange(event: { first: number; rows: number }): void {
    if (event.rows !== this.rowsPerPage()) {
      this.pageTokens = [];
      this.rowsPerPage.set(event.rows);
      this.currentFirst.set(0);
      this.fetch$.next();
      return;
    }

    this.currentFirst.set(event.first);
    this.fetch$.next();
  }

  protected onFoundationFilterChange(value: string | null): void {
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.foundationFilter.set(value);
    this.projectFilter.set(null);
  }

  protected onProjectFilterChange(value: string | null): void {
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.projectFilter.set(value);
  }

  protected onFiltersChange(state: VoteFilterState): void {
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.filters.set(state);
  }

  private buildFilters(): string[] {
    const queryFilters: string[] = [];
    const { status, group } = this.filters();
    if (status) {
      queryFilters.push(`status:${status}`);
    }
    if (group) {
      queryFilters.push(`committee_name:${group}`);
    }
    return queryFilters;
  }

  // === Private Initializers ===
  private initProject(): Signal<ProjectContext | null> {
    return computed(() => this.projectContextService.activeContext());
  }

  private initSearchQuery(): Signal<string> {
    return computed(() => this.filters().search);
  }

  private initGroupOptions(): Signal<{ label: string; value: string | null }[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, lens$]).pipe(
        switchMap(([project, lens]) => {
          if (lens === 'me' || !project?.uid) {
            return of([]);
          }
          return this.committeeService.getCommitteesByProject(project.uid).pipe(catchError(() => of([])));
        }),
        map((committees: Committee[]) => {
          const options: { label: string; value: string | null }[] = [{ label: 'All Groups', value: null }];
          const sorted = [...committees].sort((a, b) => a.name.localeCompare(b.name));
          for (const committee of sorted) {
            options.push({ label: committee.name, value: committee.name });
          }
          return options;
        })
      ),
      { initialValue: [{ label: 'All Groups', value: null }] }
    );
  }

  private initTotalCount(): Signal<number> {
    const project$ = toObservable(this.project);
    const filters$ = toObservable(this.filters);
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, filters$, this.refresh$, lens$]).pipe(
        switchMap(([project, , , lens]) => {
          if (lens === 'me') {
            return of(0);
          }
          if (!project?.uid) {
            return of(0);
          }
          const searchName = this.searchQuery();
          const queryFilters = this.buildFilters();
          return this.voteService.getVotesCountByProject(project.uid, searchName || undefined, queryFilters.length ? queryFilters : undefined).pipe(
            tap((count) => this.totalRecords.set(count)),
            catchError(() => of(0))
          );
        })
      ),
      { initialValue: 0 }
    );
  }

  private initVotes(): Signal<Vote[]> {
    const project$ = toObservable(this.project);
    const filters$ = toObservable(this.filters);
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, filters$, this.fetch$, lens$]).pipe(
        tap(() => this.loading.set(true)),
        switchMap(([project, , , lens]) => {
          if (lens === 'me' || !project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          const rows = this.rowsPerPage();
          const first = this.currentFirst();
          const pageIndex = first / rows;
          const pageToken = pageIndex > 0 ? this.pageTokens[pageIndex - 1] : undefined;

          if (pageIndex > 0 && !pageToken) {
            this.currentFirst.set(0);
            this.loading.set(false);
            return of([]);
          }

          const searchName = this.searchQuery();
          const queryFilters = this.buildFilters();

          return this.voteService
            .getVotesByProjectPaginated(project.uid, rows, pageToken, searchName || undefined, queryFilters.length ? queryFilters : undefined)
            .pipe(
              tap((response: PaginatedResponse<Vote>) => {
                if (response.page_token) {
                  this.pageTokens[pageIndex] = response.page_token;
                }
                this.loading.set(false);
              }),
              map((response: PaginatedResponse<Vote>) => response.data),
              catchError(() => {
                this.loading.set(false);
                return of([]);
              })
            );
        })
      ),
      { initialValue: [] }
    );
  }

  private initSelectedListVote(): Signal<Vote | null> {
    return computed(() => {
      const id = this.selectedVoteId();
      if (!id) return null;
      const source = this.isMeLens() ? this.myVotes() : this.votes();
      return source.find((v) => v.uid === id) || null;
    });
  }

  private initMyVotes(): Signal<Vote[]> {
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([lens$, this.refresh$]).pipe(
        switchMap(([lens]) => {
          if (lens !== 'me') {
            this.myVotesLoading.set(false);
            return of([] as Vote[]);
          }
          this.myVotesLoading.set(true);
          return this.voteService.getMyVotes().pipe(
            catchError(() => {
              this.myVotesLoading.set(false);
              return of([] as Vote[]);
            }),
            finalize(() => this.myVotesLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const items = this.myVotes();
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
      const items = this.myVotes();
      const foundation = this.foundationFilter();
      const seen = new Map<string, string>();
      for (const item of items) {
        if (!item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
          if (foundation && item.parent_project_uid !== foundation) continue;
          seen.set(item.project_uid, item.project_name || item.project_uid);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Projects', value: null }, ...options];
    });
  }

  private initFilteredMyVotes(): Signal<Vote[]> {
    return computed(() => {
      let filtered = this.myVotes();
      const project = this.projectFilter();
      const foundation = this.foundationFilter();

      if (project) {
        filtered = filtered.filter((v) => v.project_uid === project);
      } else if (foundation) {
        filtered = filtered.filter((v) => v.project_uid === foundation || (v.parent_project_uid === foundation && !v.is_foundation));
      }

      return filtered;
    });
  }

  // Me lens routes all active-awaiting votes to the cast drawer (regardless of poll_type):
  // - GENERIC renders the real ballot form
  // - Advanced types (CONDORCET_IRV, INSTANT_RUNOFF_VOTE, MEEK_STV) render the "Coming soon"
  //   placeholder inside the cast drawer
  // Either way no PCC link is shown in Me lens. Project / Foundation / Organization lenses
  // continue to open the read-only results drawer (existing behaviour) where the PCC link
  // still lives for ops/admin workflows.
  private shouldOpenCastDrawerFor(vote: Vote): boolean {
    return this.isMeLens() && vote.status === PollStatus.ACTIVE && vote.response_status === VoteResponseStatus.AWAITING_RESPONSE;
  }
}
