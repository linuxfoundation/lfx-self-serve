// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { VOTE_LABEL } from '@lfx-one/shared';
import { ProjectContext, Vote } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { BehaviorSubject, catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

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
  private readonly projectContextService = inject(ProjectContextService);

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL.singular;
  protected readonly voteLabelPlural = VOTE_LABEL.plural;

  // === Refresh Subject ===
  protected readonly refresh$ = new BehaviorSubject<void>(undefined);

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly hasPMOAccess = signal<boolean>(true);
  protected readonly resultsDrawerVisible = signal<boolean>(false);
  protected readonly selectedVoteId = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly project: Signal<ProjectContext | null> = this.initProject();
  protected readonly votes: Signal<Vote[]> = this.initVotes();
  protected readonly selectedVote: Signal<Vote | null> = this.initSelectedVote();

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
    this.refresh$.next();
  }

  // === Private Initializers ===
  private initProject(): Signal<ProjectContext | null> {
    return computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  }

  private initVotes(): Signal<Vote[]> {
    const project$ = toObservable(this.project);

    return toSignal(
      combineLatest([project$, this.refresh$]).pipe(
        switchMap(([project]) => {
          if (!project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          this.loading.set(true);
          return this.voteService.getVotesByProject(project.uid, 100).pipe(
            catchError((error) => {
              console.error('Failed to load votes:', error);
              return of([]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initSelectedVote(): Signal<Vote | null> {
    return computed(() => {
      const id = this.selectedVoteId();
      if (!id) return null;
      return this.votes().find((v) => v.vote_uid === id) || null;
    });
  }
}
