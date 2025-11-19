// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, ProjectContext } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap } from 'rxjs';

import { CommitteeTableComponent } from '../components/committee-table/committee-table.component';

@Component({
  selector: 'lfx-committee-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextComponent, SelectComponent, ButtonComponent, CommitteeTableComponent],
  templateUrl: './committee-dashboard.component.html',
  styleUrl: './committee-dashboard.component.scss',
})
export class CommitteeDashboardComponent {
  // Inject services
  private readonly projectContextService = inject(ProjectContextService);
  private readonly committeeService = inject(CommitteeService);
  private readonly personaService = inject(PersonaService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);

  // Use the configurable label constants
  protected readonly committeeLabel = COMMITTEE_LABEL.singular;
  protected readonly committeeLabelPlural = COMMITTEE_LABEL.plural;

  // State signals
  public project: Signal<ProjectContext | null>;
  public searchForm: FormGroup;
  public categoryFilter: WritableSignal<string | null>;
  public votingStatusFilter: WritableSignal<string | null>;
  public committeesLoading: WritableSignal<boolean>;
  public committees: Signal<Committee[]>;
  public categories: Signal<{ label: string; value: string | null }[]>;
  public votingStatusOptions: Signal<{ label: string; value: string | null }[]>;
  public filteredCommittees: Signal<Committee[]>;
  public refresh: BehaviorSubject<void>;
  private searchTerm: Signal<string>;

  // Permission signals
  public isMaintainer: Signal<boolean>;
  public isNonFoundationProjectSelected: Signal<boolean>;
  public canCreateGroup: Signal<boolean>;

  // Statistics calculations
  public totalCommittees: Signal<number>;
  public publicCommittees: Signal<number>;
  public activeVoting: Signal<number>;
  public totalMembers: Signal<number>;

  public constructor() {
    // Initialize project context
    this.project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

    // Initialize permission checks
    this.isMaintainer = computed(() => this.personaService.currentPersona() === 'maintainer');
    this.isNonFoundationProjectSelected = computed(() => this.projectContextService.selectedProject() !== null);
    this.canCreateGroup = computed(() => this.isMaintainer() && this.isNonFoundationProjectSelected());

    // Initialize state
    this.committeesLoading = signal<boolean>(true);
    this.refresh = new BehaviorSubject<void>(undefined);

    // Initialize data
    this.committees = this.initializeCommittees();

    // Initialize search form
    this.searchForm = this.initializeSearchForm();
    this.categoryFilter = signal<string | null>(null);
    this.votingStatusFilter = signal<string | null>(null);
    this.searchTerm = this.initializeSearchTerm();

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

  public onCategoryChange(value: string | null): void {
    this.categoryFilter.set(value);
  }

  public onVotingStatusChange(value: string | null): void {
    this.votingStatusFilter.set(value);
  }

  public onSearch(): void {
    // Trigger search through form control value changes
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
    this.refresh.next();
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

  private initializeCommittees(): Signal<Committee[]> {
    // Convert project signal to observable to react to project changes
    const project$ = toObservable(this.project);

    return toSignal(
      combineLatest([project$, this.refresh]).pipe(
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
