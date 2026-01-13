// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL } from '@lfx-one/shared/constants';
import { CommitteeReference, FilterOption, GroupsIOMailingList, GroupsIOService, ProjectContext } from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, of, startWith, switchMap, tap } from 'rxjs';

import { MailingListTableComponent } from '../components/mailing-list-table/mailing-list-table.component';

@Component({
  selector: 'lfx-mailing-list-dashboard',
  imports: [ButtonComponent, CardComponent, MailingListTableComponent],
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

  // Complex computed/toSignal signals
  public readonly project: Signal<ProjectContext | null> = this.initProject();
  public readonly isMaintainer: Signal<boolean> = this.initIsMaintainer();
  public readonly isFoundationContext: Signal<boolean> = this.initIsFoundationContext();
  public readonly canCreateMailingList: Signal<boolean> = this.initCanCreateMailingList();
  public readonly mailingLists: Signal<GroupsIOMailingList[]> = this.initMailingLists();
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

  // Private initializer functions
  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl<string>(''),
      committee: new FormControl<string | null>(null),
      status: new FormControl<string | null>(null),
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
    return computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  }

  private initIsMaintainer(): Signal<boolean> {
    return computed(() => this.personaService.currentPersona() === 'maintainer');
  }

  private initIsFoundationContext(): Signal<boolean> {
    return computed(() => !this.projectContextService.selectedProject() && !!this.projectContextService.selectedFoundation());
  }

  private initCanCreateMailingList(): Signal<boolean> {
    return computed(() => this.isMaintainer() && !this.isFoundationContext());
  }

  private initMailingLists(): Signal<GroupsIOMailingList[]> {
    const project$ = toObservable(this.project);

    return toSignal(
      combineLatest([project$, this.refresh]).pipe(
        switchMap(([project]) => {
          if (!project?.uid) {
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
      const mailingListsData = this.mailingLists();

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
      const mailingListsData = this.mailingLists();

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
      let filtered = this.mailingLists();

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

    return toSignal(
      project$.pipe(
        tap(() => this.servicesLoaded.set(false)),
        filter((project): project is NonNullable<typeof project> => project !== null),
        switchMap((project) =>
          this.mailingListService.getServicesByProject(project.uid).pipe(
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
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private initHasNoServices(): Signal<boolean> {
    return computed(() => this.servicesLoaded() && this.availableServices().length === 0);
  }
}
