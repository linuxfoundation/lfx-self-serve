// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { VOTE_LABEL } from '@lfx-one/shared';
import { Committee, PaginatedResponse, ProjectContext, Vote, VoteFilterState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { BehaviorSubject, catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';

import { VoteResultsDrawerComponent } from '../components/vote-results-drawer/vote-results-drawer.component';
import { VotesTableComponent } from '../components/votes-table/votes-table.component';

@Component({
  selector: 'lfx-votes-dashboard',
  imports: [LowerCasePipe, CardComponent, ButtonComponent, VotesTableComponent, VoteResultsDrawerComponent, RouterLink],
  templateUrl: './votes-dashboard.component.html',
  styleUrl: './votes-dashboard.component.scss',
})
export class VotesDashboardComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);

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
  protected readonly hasPMOAccess = signal<boolean>(true);
  protected readonly resultsDrawerVisible = signal<boolean>(false);
  protected readonly selectedVoteId = signal<string | null>(null);
  protected readonly rowsPerPage = signal<number>(10);
  protected readonly currentFirst = signal<number>(0);
  protected readonly totalRecords = signal<number>(0);

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
  protected readonly totalCount: Signal<number> = this.initTotalCount();

  protected onViewVote(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.resultsDrawerVisible.set(true);
  }

  protected onViewResults(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.resultsDrawerVisible.set(true);
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

    return toSignal(
      project$.pipe(
        switchMap((project) => {
          if (!project?.uid) {
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

    return toSignal(
      combineLatest([project$, filters$, this.refresh$]).pipe(
        switchMap(([project]) => {
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

    return toSignal(
      combineLatest([project$, filters$, this.fetch$]).pipe(
        tap(() => this.loading.set(true)),
        switchMap(([project]) => {
          if (!project?.uid) {
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
      return this.votes().find((v) => v.uid === id) || null;
    });
  }
}
