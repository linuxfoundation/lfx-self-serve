// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL } from '@lfx-one/shared/constants';
import { MailingListMemberDeliveryMode } from '@lfx-one/shared/enums';
import {
  CommitteeReference,
  FilterOption,
  GroupsIOMailingList,
  GroupsIOService,
  MyMailingList,
  ProjectContext,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MailingListTableComponent } from '../components/mailing-list-table/mailing-list-table.component';

@Component({
  selector: 'lfx-mailing-list-dashboard',
  imports: [ButtonComponent, CardComponent, MailingListTableComponent, ReactiveFormsModule, EmptyStateComponent, StatCardGridComponent],
  templateUrl: './mailing-list-dashboard.component.html',
  styleUrl: './mailing-list-dashboard.component.scss',
})
export class MailingListDashboardComponent {
  // Private injections
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly mailingListService = inject(MailingListService);
  private readonly personaService = inject(PersonaService);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly messageService = inject(MessageService);

  // Protected constants
  protected readonly mailingListLabel = MAILING_LIST_LABEL.singular;
  protected readonly mailingListLabelPlural = MAILING_LIST_LABEL.plural;

  // Form
  public searchForm: FormGroup = this.initializeSearchForm();

  // Simple WritableSignals
  public mailingListsLoading = signal<boolean>(true);
  public servicesLoaded = signal<boolean>(false);
  public refresh = new BehaviorSubject<void>(undefined);

  // Signals derived from form control valueChanges
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly committeeFilter: Signal<string | null> = this.initCommitteeFilter();
  private readonly statusFilter: Signal<string | null> = this.initStatusFilter();

  // Lens
  public readonly isMeLens: Signal<boolean> = computed(() => this.lensService.activeLens() === 'me');
  public showFoundationFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
  public showProjectFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasProjectRole() && this.projectOptions().length > 1);
  public myMailingListsLoading = signal<boolean>(true);

  // Foundation + Project filter (Me lens only)
  public foundationFilter: WritableSignal<string | null> = signal<string | null>(null);
  public projectFilter: WritableSignal<string | null> = signal<string | null>(null);
  public foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initializeFoundationOptions();
  public projectOptions: Signal<{ label: string; value: string | null }[]> = this.initializeProjectOptions();

  // Complex computed/toSignal signals
  public readonly project: Signal<ProjectContext | null> = this.initProject();
  protected readonly canWrite = this.projectContextService.canWrite;
  public readonly mailingLists: Signal<GroupsIOMailingList[]> = this.initMailingLists();
  public readonly myMailingLists: Signal<MyMailingList[]> = this.initMyMailingLists();
  public readonly committeeOptions: Signal<FilterOption[]> = this.initCommitteeOptions();
  public readonly statusOptions: Signal<FilterOption[]> = this.initStatusOptions();
  public readonly filteredMailingLists: Signal<GroupsIOMailingList[]> = this.initFilteredMailingLists();
  protected readonly isFiltered = computed(
    () => !!this.searchTerm() || !!this.committeeFilter() || !!this.statusFilter() || !!this.foundationFilter() || !!this.projectFilter()
  );
  public readonly totalMailingLists: Signal<number> = this.initTotalMailingLists();
  public readonly publicMailingLists: Signal<number> = this.initPublicMailingLists();
  public readonly totalSubscribers: Signal<number> = this.initTotalSubscribers();
  public readonly myTotalMailingLists: Signal<number> = this.initMyTotalMailingLists();
  public readonly myPublicMailingLists: Signal<number> = this.initMyPublicMailingLists();
  public readonly myOnDigest: Signal<number> = this.initMyOnDigest();
  // Stat card arrays consumed by <lfx-stat-card-grid>
  public readonly foundationStatCards: Signal<StatCardItem[]> = this.initFoundationStatCards();
  public readonly myStatCards: Signal<StatCardItem[]> = this.initMyStatCards();
  public readonly availableServices: Signal<GroupsIOService[]> = this.initServices();
  public readonly hasNoServices: Signal<boolean> = this.initHasNoServices();

  /**
   * Open create mailing list dialog/page
   */
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

    this.router.navigate(['/mailing-lists/create']);
  }

  /**
   * Refresh mailing lists data
   */
  public refreshMailingLists(): void {
    this.mailingListsLoading.set(true);
    this.refresh.next();
  }

  /**
   * Handle mailing list row click - navigate to detail page
   */
  public onMailingListClick(mailingList: GroupsIOMailingList): void {
    this.router.navigate(['/mailing-lists', mailingList.uid]);
  }

  /**
   * Handle foundation filter change
   */
  public onFoundationFilterChange(value: string | null): void {
    this.foundationFilter.set(value);
    // Reset project filter when foundation changes
    this.projectFilter.set(null);
    this.searchForm.get('projectFilter')?.setValue(null);
  }

  /**
   * Handle project filter change
   */
  public onProjectFilterChange(value: string | null): void {
    this.projectFilter.set(value);
  }

  // Private initializer functions
  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl<string>(''),
      committee: new FormControl<string | null>(null),
      status: new FormControl<string | null>(null),
      foundationFilter: new FormControl<string | null>(null),
      projectFilter: new FormControl<string | null>(null),
    });
  }

  private initSearchTerm(): Signal<string> {
    return toSignal(this.searchForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), {
      initialValue: '',
    });
  }

  private initCommitteeFilter(): Signal<string | null> {
    return toSignal(this.searchForm.get('committee')!.valueChanges.pipe(startWith(null)), { initialValue: null });
  }

  private initStatusFilter(): Signal<string | null> {
    return toSignal(this.searchForm.get('status')!.valueChanges.pipe(startWith(null)), { initialValue: null });
  }

  private initProject(): Signal<ProjectContext | null> {
    return computed(() => this.projectContextService.activeContext());
  }

  private initMailingLists(): Signal<GroupsIOMailingList[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, this.refresh, lens$]).pipe(
        switchMap(([project, , lens]) => {
          if (lens === 'me' || !project?.uid) {
            this.mailingListsLoading.set(false);
            return of([]);
          }

          this.mailingListsLoading.set(true);
          return this.mailingListService.getMailingListsByProject(project.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.mailingListsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initCommitteeOptions(): Signal<FilterOption[]> {
    return computed(() => {
      const mailingListsData = this.isMeLens() ? this.myMailingLists() : this.mailingLists();

      // Collect unique committees from all mailing lists
      const committeeMap = new Map<string, CommitteeReference>();
      mailingListsData.forEach((ml) => {
        if (ml.committees?.length) {
          ml.committees.forEach((committee) => {
            if (committee.uid && committee.name) {
              committeeMap.set(committee.uid, committee);
            }
          });
        }
      });

      // Sort by name
      const sortedCommittees = Array.from(committeeMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Create options
      const committeeOptions: FilterOption[] = sortedCommittees.map((committee) => ({
        label: committee.name || committee.uid,
        value: committee.uid,
      }));

      return [{ label: 'All ' + COMMITTEE_LABEL.plural, value: null }, ...committeeOptions];
    });
  }

  private initStatusOptions(): Signal<FilterOption[]> {
    return computed(() => {
      const mailingListsData = this.isMeLens() ? this.myMailingLists() : this.mailingLists();

      // Count mailing lists by visibility status
      const publicCount = mailingListsData.filter((ml) => ml.public).length;
      const privateCount = mailingListsData.filter((ml) => !ml.public).length;

      return [
        { label: 'All Status', value: null },
        { label: `Public (${publicCount})`, value: 'public' },
        { label: `Private (${privateCount})`, value: 'private' },
      ];
    });
  }

  private initFilteredMailingLists(): Signal<GroupsIOMailingList[]> {
    return computed(() => {
      let filtered: GroupsIOMailingList[] = this.isMeLens() ? this.myMailingLists() : this.mailingLists();

      // Apply foundation/project filter (client-side, Me lens only)
      if (this.isMeLens()) {
        const project = this.projectFilter();
        const foundation = this.foundationFilter();
        if (project) {
          filtered = filtered.filter((ml) => ml.project_uid === project);
        } else if (foundation) {
          filtered = filtered.filter((ml) => ml.project_uid === foundation || (ml.parent_project_uid === foundation && !ml.is_foundation));
        }
      }

      // Apply search filter
      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter(
          (mailingList) =>
            mailingList.title.toLowerCase().includes(searchTerm) ||
            mailingList.group_name.toLowerCase().includes(searchTerm) ||
            mailingList.description?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply committee filter
      const committeeUid = this.committeeFilter();
      if (committeeUid) {
        filtered = filtered.filter((mailingList) => mailingList.committees?.some((c) => c.uid === committeeUid));
      }

      // Apply status filter (public/private)
      const status = this.statusFilter();
      if (status) {
        const isPublic = status === 'public';
        filtered = filtered.filter((mailingList) => mailingList.public === isPublic);
      }

      return filtered;
    });
  }

  private initTotalMailingLists(): Signal<number> {
    return computed(() => this.mailingLists().length);
  }

  private initPublicMailingLists(): Signal<number> {
    return computed(() => this.mailingLists().filter((ml) => ml.public).length);
  }

  private initTotalSubscribers(): Signal<number> {
    return computed(() => this.mailingLists().reduce((sum, ml) => sum + (ml.subscriber_count ?? 0), 0));
  }

  private initMyTotalMailingLists(): Signal<number> {
    return computed(() => this.myMailingLists().length);
  }

  private initMyPublicMailingLists(): Signal<number> {
    return computed(() => this.myMailingLists().filter((ml) => ml.public).length);
  }

  private initMyOnDigest(): Signal<number> {
    return computed(() => this.myMailingLists().filter((ml) => ml.my_delivery_mode === MailingListMemberDeliveryMode.DIGEST).length);
  }

  private initFoundationStatCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => [
      { value: this.totalMailingLists(), label: 'Total Mailing Lists', icon: 'fa-light fa-envelope', iconContainerClass: 'bg-gray-200 text-gray-500' },
      { value: this.totalSubscribers(), label: 'Total Subscribers', icon: 'fa-light fa-users', iconContainerClass: 'bg-blue-100 text-blue-600' },
      { value: this.publicMailingLists(), label: 'Public Lists', icon: 'fa-light fa-globe', iconContainerClass: 'bg-emerald-100 text-emerald-600' },
    ]);
  }

  private initMyStatCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => [
      { value: this.myTotalMailingLists(), label: 'Total Mailing Lists', icon: 'fa-light fa-envelope', iconContainerClass: 'bg-gray-200 text-gray-500' },
      { value: this.myOnDigest(), label: 'On Digest', icon: 'fa-light fa-newspaper', iconContainerClass: 'bg-blue-100 text-blue-600' },
      { value: this.myPublicMailingLists(), label: 'Public Lists', icon: 'fa-light fa-globe', iconContainerClass: 'bg-emerald-100 text-emerald-600' },
    ]);
  }

  private initServices(): Signal<GroupsIOService[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, lens$]).pipe(
        tap(() => this.servicesLoaded.set(false)),
        switchMap(([project, lens]) => {
          if (lens === 'me') {
            this.servicesLoaded.set(true);
            return of([]);
          }

          if (!project) {
            this.servicesLoaded.set(true);
            return of([]);
          }

          return this.mailingListService.getServicesByProject(project.uid).pipe(
            switchMap((services) => {
              if (services.length > 0) {
                return of(services);
              }

              // No services found, check parent project for services
              return this.projectService.getProject(project.slug, false).pipe(
                switchMap((fullProject) => {
                  if (!fullProject?.parent_uid) {
                    return of([]);
                  }

                  return this.mailingListService.getServicesByProject(fullProject.parent_uid);
                }),
                catchError(() => of([]))
              );
            }),
            tap(() => this.servicesLoaded.set(true)),
            catchError(() => {
              this.servicesLoaded.set(true);
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initHasNoServices(): Signal<boolean> {
    return computed(() => this.servicesLoaded() && this.availableServices().length === 0);
  }

  private initializeFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const items = this.myMailingLists();
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
      const items = this.myMailingLists();
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

  private initMyMailingLists(): Signal<MyMailingList[]> {
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([lens$, this.refresh]).pipe(
        switchMap(([lens]) => {
          if (lens !== 'me') {
            this.myMailingListsLoading.set(false);
            return of([] as MyMailingList[]);
          }
          this.myMailingListsLoading.set(true);
          return this.mailingListService.getMyMailingLists().pipe(
            catchError(() => {
              this.myMailingListsLoading.set(false);
              return of([] as MyMailingList[]);
            }),
            finalize(() => this.myMailingListsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
