// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL } from '@lfx-one/shared/constants';
import { CommitteeReference, FilterOption, GroupsIOMailingList, GroupsIOService, MyMailingList, ProjectContext } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap, tap } from 'rxjs';

import { MailingListTableComponent } from '../components/mailing-list-table/mailing-list-table.component';

@Component({
  selector: 'lfx-mailing-list-dashboard',
  imports: [ButtonComponent, CardComponent, MailingListTableComponent, ReactiveFormsModule],
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
  public foundationOptions: Signal<{ label: string; value: string }[]> = this.initializeFoundationOptions();
  public projectOptions: Signal<{ label: string; value: string }[]> = this.initializeProjectOptions();

  // Complex computed/toSignal signals
  public readonly project: Signal<ProjectContext | null> = this.initProject();
  public readonly isMaintainer: Signal<boolean> = this.initIsMaintainer();
  public readonly isFoundationContext: Signal<boolean> = this.initIsFoundationContext();
  public readonly canCreateMailingList: Signal<boolean> = this.initCanCreateMailingList();
  public readonly mailingLists: Signal<GroupsIOMailingList[]> = this.initMailingLists();
  public readonly myMailingLists: Signal<MyMailingList[]> = this.initMyMailingLists();
  public readonly committeeOptions: Signal<FilterOption[]> = this.initCommitteeOptions();
  public readonly statusOptions: Signal<FilterOption[]> = this.initStatusOptions();
  public readonly filteredMailingLists: Signal<GroupsIOMailingList[]> = this.initFilteredMailingLists();
  public readonly totalMailingLists: Signal<number> = this.initTotalMailingLists();
  public readonly publicMailingLists: Signal<number> = this.initPublicMailingLists();
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

  private initIsMaintainer(): Signal<boolean> {
    return computed(() => this.personaService.currentPersona() === 'maintainer');
  }

  private initIsFoundationContext(): Signal<boolean> {
    return computed(() => this.projectContextService.isFoundationContext());
  }

  private initCanCreateMailingList(): Signal<boolean> {
    return computed(() => !this.isMeLens() && this.isMaintainer() && !this.isFoundationContext());
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

  private initializeFoundationOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      return projects.filter((p) => p.isFoundation).map((p) => ({ label: p.projectName ?? p.projectSlug, value: p.projectUid }));
    });
  }

  private initializeProjectOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      const foundation = this.foundationFilter();
      let candidates = projects.filter((p) => !p.isFoundation);
      if (foundation) {
        candidates = candidates.filter((p) => p.parentProjectUid === foundation);
      }
      return candidates.map((p) => ({ label: p.projectName ?? p.projectSlug, value: p.projectUid }));
    });
  }

  private initMyMailingLists(): Signal<MyMailingList[]> {
    const lens$ = toObservable(this.lensService.activeLens);
    const projectFilter$ = toObservable(this.projectFilter);
    const foundationFilter$ = toObservable(this.foundationFilter);

    return toSignal(
      combineLatest([lens$, this.refresh, projectFilter$, foundationFilter$]).pipe(
        switchMap(([lens, , projectFilter, foundationFilter]) => {
          if (lens !== 'me') {
            this.myMailingListsLoading.set(false);
            return of([] as MyMailingList[]);
          }
          this.myMailingListsLoading.set(true);
          return this.mailingListService.getMyMailingLists(projectFilter ?? undefined, foundationFilter ?? undefined).pipe(
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
