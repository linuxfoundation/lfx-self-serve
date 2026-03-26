// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, MyCommittee, ProjectContext } from '@lfx-one/shared/interfaces';
import { RoleBadgeClassPipe } from '@pipes/role-badge-class.pipe';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';

import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap } from 'rxjs';

import { PlatformIconPipe } from '@app/shared/pipes/platform-icon.pipe';
import { PlatformLabelPipe } from '@app/shared/pipes/platform-label.pipe';
import { CommitteeTableComponent } from '../components/committee-table/committee-table.component';

@Component({
  selector: 'lfx-committee-dashboard',
  imports: [
    DecimalPipe,
    NgClass,
    ButtonComponent,
    CardComponent,
    CommitteeTableComponent,
    RoleBadgeClassPipe,
    PlatformIconPipe,
    PlatformLabelPipe,
    TooltipModule,
  ],
  templateUrl: './committee-dashboard.component.html',
  styleUrl: './committee-dashboard.component.scss',
})
export class CommitteeDashboardComponent {
  // Inject services
  private readonly projectContextService = inject(ProjectContextService);
  private readonly committeeService = inject(CommitteeService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);

  // Use the configurable label constants
  protected readonly committeeLabel = COMMITTEE_LABEL;

  // ── Writable Signals ──────────────────────────────────────────────────────
  public committeesLoading = signal<boolean>(true);
  public myCommitteesLoading = signal<boolean>(true);
  public refresh = signal(0);

  // ── Forms ─────────────────────────────────────────────────────────────────
  public searchForm: FormGroup;

  // ── Computed / Read-only Signals ──────────────────────────────────────────
  public project: Signal<ProjectContext | null>;
  public committees: Signal<Committee[]>;
  public myCommittees: Signal<MyCommittee[]>;
  public myCommitteeUids: Signal<Set<string>>;
  public categories: Signal<{ label: string; value: string | null }[]>;
  public votingStatusOptions: Signal<{ label: string; value: string | null }[]>;
  public filteredCommittees: Signal<Committee[]>;
  public categoryFilter: Signal<string | null>;
  public votingStatusFilter: Signal<string | null>;

  // Permission signals
  public isMaintainer: Signal<boolean>;
  public isBoardMember: Signal<boolean>;
  public isFoundationContext: Signal<boolean>;
  public foundationCreateCommitteeFlag: Signal<boolean>;
  public canCreateGroup: Signal<boolean>;

  // Statistics
  public totalCommittees: Signal<number>;
  public publicCommittees: Signal<number>;
  public activeVoting: Signal<number>;
  public totalMembers: Signal<number>;

  private searchTerm: Signal<string>;

  public constructor() {
    // Initialize project context
    this.project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

    // Initialize permission checks
    this.isMaintainer = computed(() => this.personaService.currentPersona() === 'maintainer');
    this.isBoardMember = computed(() => this.personaService.currentPersona() === 'board-member');
    this.isFoundationContext = computed(() => !this.projectContextService.selectedProject() && !!this.projectContextService.selectedFoundation());
    this.foundationCreateCommitteeFlag = this.featureFlagService.getBooleanFlag('foundation-create-committee', false);
    this.canCreateGroup = computed(() => {
      // Board members cannot manage committees
      if (this.isBoardMember()) {
        return false;
      }
      const isMaintainerAndNotFoundation = this.isMaintainer() && !this.isFoundationContext();
      const hasFeatureFlag = this.foundationCreateCommitteeFlag();
      return isMaintainerAndNotFoundation || hasFeatureFlag;
    });

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

    // Initialize statistics
    this.totalCommittees = computed(() => this.committees().length);
    this.publicCommittees = computed(() => this.committees().filter((c) => c.public).length);
    this.activeVoting = computed(() => this.committees().filter((c) => c.enable_voting).length);
    this.totalMembers = computed(() => this.committees().reduce((sum, c) => sum + (c.total_members || 0), 0));
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
    this.router.navigate(['/groups', committee.uid]);
  }

  private initializeMyCommittees(): Signal<MyCommittee[]> {
    const project$ = toObservable(this.project);
    const refresh$ = toObservable(this.refresh);

    return toSignal(
      combineLatest([project$, refresh$]).pipe(
        switchMap(([project]) => {
          this.myCommitteesLoading.set(true);
          return this.committeeService.getMyCommittees(project?.uid).pipe(
            catchError((error) => {
              console.error('Failed to load my committees:', error);
              this.myCommitteesLoading.set(false);
              return of([] as MyCommittee[]);
            }),
            finalize(() => this.myCommitteesLoading.set(false))
          );
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
    // Convert project signal to observable to react to project changes
    const project$ = toObservable(this.project);
    const refresh$ = toObservable(this.refresh);

    return toSignal(
      combineLatest([project$, refresh$]).pipe(
        switchMap(([project]) => {
          if (!project?.uid) {
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
      const committeesData = this.committees();

      // Count committees by category
      const categoryCounts = new Map<string, number>();
      committeesData.forEach((committee) => {
        if (committee.category) {
          categoryCounts.set(committee.category, (categoryCounts.get(committee.category) || 0) + 1);
        }
      });

      // Get unique categories and sort them
      const uniqueCategories = Array.from(categoryCounts.keys()).sort((a, b) => a.localeCompare(b));

      // Create options with counts
      const categoryOptions = uniqueCategories.map((cat) => ({
        label: `${cat} (${categoryCounts.get(cat)})`,
        value: cat,
      }));

      return [{ label: `All Types`, value: null }, ...categoryOptions];
    });
  }

  private initializeVotingStatusOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const committeesData = this.committees();

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
        filtered = filtered.filter((committee) => committee.category === category);
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
}
