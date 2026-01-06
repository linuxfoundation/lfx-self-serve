// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL } from '@lfx-one/shared/constants';
import { GroupsIOMailingList, GroupsIOService, MailingListCommittee, ProjectContext } from '@lfx-one/shared/interfaces';
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
  // Inject services
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly mailingListService = inject(MailingListService);
  private readonly personaService = inject(PersonaService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);

  // Use the configurable label constants
  protected readonly mailingListLabel = MAILING_LIST_LABEL.singular;
  protected readonly mailingListLabelPlural = MAILING_LIST_LABEL.plural;

  // Form
  public searchForm: FormGroup;

  // State signals derived from form controls
  public project: Signal<ProjectContext | null>;
  public mailingListsLoading: WritableSignal<boolean>;
  public mailingLists: Signal<GroupsIOMailingList[]>;
  public filteredMailingLists: Signal<GroupsIOMailingList[]>;
  public refresh: BehaviorSubject<void>;

  // Signals derived from form control valueChanges
  private searchTerm: Signal<string>;
  private committeeFilter: Signal<string | null>;
  private statusFilter: Signal<string | null>;

  // Filter options (computed from data)
  public committeeOptions: Signal<{ label: string; value: string | null }[]>;
  public statusOptions: Signal<{ label: string; value: string | null }[]>;

  // Permission signals - key for role-based views
  public isMaintainer: Signal<boolean>;
  public isFoundationContext: Signal<boolean>;
  public canCreateMailingList: Signal<boolean>;

  // Statistics
  public totalMailingLists: Signal<number>;
  public publicMailingLists: Signal<number>;

  // Service availability signals
  public servicesLoaded: WritableSignal<boolean>;
  public availableServices: Signal<GroupsIOService[]>;
  public hasNoServices: Signal<boolean>;

  public constructor() {
    // Initialize project context
    this.project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

    // Permission check - 'maintainer' persona = manage role
    this.isMaintainer = computed(() => this.personaService.currentPersona() === 'maintainer');
    this.isFoundationContext = computed(() => !this.projectContextService.selectedProject() && !!this.projectContextService.selectedFoundation());
    this.canCreateMailingList = computed(() => this.isMaintainer() && !this.isFoundationContext());

    // Initialize state
    this.mailingListsLoading = signal<boolean>(true);
    this.refresh = new BehaviorSubject<void>(undefined);

    // Initialize search form
    this.searchForm = this.initializeSearchForm();

    // Convert form control valueChanges to signals
    this.searchTerm = toSignal(this.searchForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), {
      initialValue: '',
    });
    this.committeeFilter = toSignal(this.searchForm.get('committee')!.valueChanges.pipe(startWith(null)), { initialValue: null });
    this.statusFilter = toSignal(this.searchForm.get('status')!.valueChanges.pipe(startWith(null)), { initialValue: null });

    // Initialize data
    this.mailingLists = this.initializeMailingLists();

    // Initialize filter options (computed from data)
    this.committeeOptions = this.initializeCommitteeOptions();
    this.statusOptions = this.initializeStatusOptions();

    // Initialize filtered data
    this.filteredMailingLists = this.initializeFilteredMailingLists();

    // Statistics
    this.totalMailingLists = computed(() => this.mailingLists().length);
    this.publicMailingLists = computed(() => this.mailingLists().filter((ml) => ml.public).length);

    // Initialize services check
    this.servicesLoaded = signal(false);
    this.availableServices = this.initializeServices();
    this.hasNoServices = computed(() => this.servicesLoaded() && this.availableServices().length === 0);
  }

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

  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl<string>(''),
      committee: new FormControl<string | null>(null),
      status: new FormControl<string | null>(null),
    });
  }

  private initializeMailingLists(): Signal<GroupsIOMailingList[]> {
    // Convert project signal to observable to react to project changes
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

  private initializeCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const mailingListsData = this.mailingLists();

      // Collect unique committees from all mailing lists
      const committeeMap = new Map<string, MailingListCommittee>();
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
      const committeeOptions = sortedCommittees.map((committee) => ({
        label: committee.name || committee.uid,
        value: committee.uid,
      }));

      return [{ label: 'All ' + COMMITTEE_LABEL.plural, value: null }, ...committeeOptions];
    });
  }

  private initializeStatusOptions(): Signal<{ label: string; value: string | null }[]> {
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

  private initializeFilteredMailingLists(): Signal<GroupsIOMailingList[]> {
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

  private initializeServices(): Signal<GroupsIOService[]> {
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
}
