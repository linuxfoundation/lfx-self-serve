// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  PROJECT_APPLICATION_DEEP_LINK_QUERY_PARAM,
  PROJECT_APPLICATION_FROM_FOUNDATION_COPY,
  PROJECT_APPLICATION_STATE_FILTER_OPTIONS,
} from '@lfx-one/shared/constants';
import type { FilterPillOption, ProjectApplication, ProjectApplicationRow, ProjectApplicationViewMode } from '@lfx-one/shared/interfaces';
import { isUuid, reconcileProjectApplications, toProjectApplicationRow } from '@lfx-one/shared/utils';
import { ProjectApplicationService } from '@services/project-application.service';
import type { TablePageEvent } from 'primeng/table';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, EMPTY, filter, forkJoin, map, of, Subject, switchMap, take } from 'rxjs';

import { ProjectApplicationDrawerComponent } from '../project-application-drawer/project-application-drawer.component';

/**
 * The project-application list (#3037) — the submitter's "Submitted proposals" tab on My Formations
 * (`mode="submitter"`) and the formation team's "Project proposals" queue on the foundation Formations
 * page (`mode="staff"`). Rows open {@link ProjectApplicationDrawerComponent}.
 *
 * query-service lags a successful write, so every write result is recorded in the root
 * `ProjectApplicationService` overlay and applied to each fresh read — a just-withdrawn proposal never
 * flips back to "Submitted" and a just-deleted one never reappears, even across a tab switch that
 * destroys and recreates this panel. Nothing is written to browser storage.
 */
@Component({
  selector: 'lfx-project-applications-panel',
  imports: [
    CardComponent,
    CardTabsBarComponent,
    DatePipe,
    EmptyStateComponent,
    InputTextComponent,
    ProjectApplicationDrawerComponent,
    ReactiveFormsModule,
    TableComponent,
    TagComponent,
  ],
  templateUrl: './project-applications-panel.component.html',
})
export class ProjectApplicationsPanelComponent implements OnInit {
  // === Services ===
  private readonly projectApplicationService = inject(ProjectApplicationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly mode = input<ProjectApplicationViewMode>('submitter');

  // === Template constants ===
  protected readonly stateFilterOptions: FilterPillOption[] = PROJECT_APPLICATION_STATE_FILTER_OPTIONS;
  protected readonly proposeRoute = ['/formations/propose'];
  protected readonly startedFromLabel = PROJECT_APPLICATION_FROM_FOUNDATION_COPY.startedFrom;

  // === Forms ===
  public readonly searchForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  // === Writable Signals ===
  private readonly submitterLoading = signal(true);
  private readonly submitterError = signal(false);
  protected readonly searchTerm = signal('');
  protected readonly stateFilter = signal<string>('all');
  protected readonly first = signal(0);
  protected readonly rows = signal(10);
  protected readonly selectedUid = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  private readonly fetched = signal<ProjectApplication[]>([]);
  private readonly load$ = new Subject<void>();
  private panelRequestedStaffRead = false;

  // === Computed Signals ===
  /** Staff reads live in the root service (shared with the Formations tab's count); submitter reads stay local. */
  protected readonly loading: Signal<boolean> = computed(() =>
    this.mode() === 'staff' ? this.projectApplicationService.staffLoading() : this.submitterLoading()
  );
  protected readonly hasError: Signal<boolean> = computed(() =>
    this.mode() === 'staff' ? this.projectApplicationService.staffError() && !this.projectApplicationService.staffLoading() : this.submitterError()
  );
  protected readonly applications: Signal<ProjectApplicationRow[]> = this.initApplications();
  protected readonly filteredApplications: Signal<ProjectApplicationRow[]> = this.initFilteredApplications();
  /** Names of the foundations proposals started from (#5187), by uid — staff only. A uid that does not resolve is simply absent. */
  protected readonly startedFromNames: Signal<Record<string, string>> = this.initStartedFromNames();
  /** The paginator offset, pulled back onto the last page when a delete or filter leaves it past the end. */
  protected readonly pageFirst: Signal<number> = this.initPageFirst();
  protected readonly selectedApplication: Signal<ProjectApplication | null> = computed(
    () => this.applications().find((application) => application.uid === this.selectedUid()) ?? null
  );
  protected readonly isStaff = computed(() => this.mode() === 'staff');
  protected readonly showEmptyState = computed(() => !this.loading() && !this.hasError() && this.applications().length === 0);
  protected readonly showNoResults = computed(() => !this.loading() && this.applications().length > 0 && this.filteredApplications().length === 0);

  // === Constructor ===
  public constructor() {
    this.searchForm.controls.search.valueChanges.pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.first.set(0);
      this.searchTerm.set(value ?? '');
    });

    // switchMap cancels a superseded read, so an older snapshot can never land after a newer one.
    this.load$
      .pipe(
        switchMap(() => {
          this.submitterLoading.set(true);
          this.submitterError.set(false);
          return this.projectApplicationService.getApplications('submitter').pipe(
            catchError(() => {
              this.submitterError.set(true);
              this.submitterLoading.set(false);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((applications) => {
        this.projectApplicationService.reconcile('submitter', applications);
        this.fetched.set(applications);
        this.submitterLoading.set(false);
      });

    this.initDeepLink();
  }

  // === Lifecycle ===
  public ngOnInit(): void {
    this.load();
  }

  // === Protected Methods ===
  protected onStateFilterChange(state: string): void {
    this.first.set(0);
    this.stateFilter.set(state);
  }

  protected onPage(event: TablePageEvent): void {
    this.first.set(event.first);
    this.rows.set(event.rows);
  }

  protected resetFilters(): void {
    this.searchForm.reset({ search: '' });
    this.first.set(0);
    this.searchTerm.set('');
    this.stateFilter.set('all');
  }

  protected open(application: ProjectApplication): void {
    this.selectedUid.set(application.uid);
    this.drawerVisible.set(true);
  }

  protected onChanged(application: ProjectApplication): void {
    this.projectApplicationService.recordWrite(this.mode(), application);
  }

  /** The caller deleted it, or a write found it already gone (404): either way it must not reappear. */
  protected onDeleted(uid: string): void {
    this.projectApplicationService.recordDeleted(this.mode(), uid);
    // Only close the drawer if it still shows that application — a late 404 for one the user has since
    // navigated away from must not close (and lose edits on) a different, unrelated proposal.
    if (uid === this.selectedUid()) {
      this.selectedUid.set(null);
      this.drawerVisible.set(false);
    }
    // Write the clamp back so a later reload that grows the list can't snap the view to a stale offset.
    this.first.set(this.pageFirst());
  }

  /** A 412: drop the local copy of the application the stale write targeted so the fresh read wins, then reload. */
  protected onStale(uid: string): void {
    this.projectApplicationService.forget(this.mode(), uid);
    this.load(true);
  }

  protected retry(): void {
    this.load(true);
  }

  // === Private Methods ===
  private load(supersede = false): void {
    if (this.isStaff()) {
      this.panelRequestedStaffRead = true;
      this.projectApplicationService.refreshStaff({ supersede });
    } else {
      this.load$.next();
    }
  }

  /**
   * `?application=<uid>` (#5229), staff only, browser only (the SSR renderer would turn the URL change into a
   * redirect that drops the param before the browser can use it). Once this panel's own read has succeeded, open that
   * proposal's drawer a single time. The param is dropped after that first successful read either way, so closing,
   * reloading or sharing the URL never reopens it. A uid that is malformed, unknown or not in the caller's queue
   * opens nothing, silently. A failed read consumes nothing, so a retry can still honour the link.
   */
  private initDeepLink(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const requested$ = this.route.queryParamMap.pipe(
      map((params) => params.get(PROJECT_APPLICATION_DEEP_LINK_QUERY_PARAM)),
      distinctUntilChanged()
    );
    const readLanded$ = toObservable(
      computed(
        () =>
          this.isStaff() &&
          this.panelRequestedStaffRead &&
          !this.loading() &&
          !this.hasError() &&
          this.projectApplicationService.staffFetchedApplications() !== null
      )
    );
    combineLatest([requested$, readLanded$])
      .pipe(
        filter(([uid, landed]) => uid !== null && landed),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(([uid]) => {
        const application = uid !== null && isUuid(uid) ? this.applications().find((row) => row.uid.toLowerCase() === uid.toLowerCase()) : undefined;
        if (application) {
          this.open(application);
        }
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { [PROJECT_APPLICATION_DEEP_LINK_QUERY_PARAM]: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
  }

  // === Private Initializers ===
  private initStartedFromNames(): Signal<Record<string, string>> {
    const uids = computed(() =>
      this.isStaff()
        ? [...new Set(this.applications().flatMap((application) => (application.target_parent_uid ? [application.target_parent_uid] : [])))].sort()
        : []
    );
    return toSignal(
      toObservable(uids).pipe(
        distinctUntilChanged((a, b) => a.join() === b.join()),
        switchMap((list) =>
          list.length === 0
            ? of<Record<string, string>>({})
            : forkJoin(list.map((uid) => this.projectApplicationService.getStartedFrom(uid).pipe(map((project) => [uid, project?.name] as const)))).pipe(
                map((entries) => Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry[1])))
              )
        )
      ),
      { initialValue: {} as Record<string, string> }
    );
  }

  private initApplications(): Signal<ProjectApplicationRow[]> {
    return computed(() => {
      const mode = this.mode();
      const merged =
        mode === 'staff'
          ? (this.projectApplicationService.staffApplications() ?? [])
          : reconcileProjectApplications(this.fetched(), this.projectApplicationService.overlay(mode)(), this.projectApplicationService.deletedUids(mode)());
      return merged.map(toProjectApplicationRow);
    });
  }

  private initFilteredApplications(): Signal<ProjectApplicationRow[]> {
    return computed(() => {
      const term = this.searchTerm().trim().toLowerCase();
      const state = this.stateFilter();
      let rows = this.applications();
      if (state !== 'all') {
        rows = rows.filter((application) => application.state === state);
      }
      if (term) {
        rows = rows.filter((application) =>
          [application.displayName, application.submitter_name, application.submitter_email].some((value) => (value ?? '').toLowerCase().includes(term))
        );
      }
      return rows;
    });
  }

  private initPageFirst(): Signal<number> {
    return computed(() => {
      const total = this.filteredApplications().length;
      const first = this.first();
      if (total === 0) {
        return 0;
      }
      if (first < total) {
        return first;
      }
      const rows = this.rows();
      return Math.floor((total - 1) / rows) * rows;
    });
  }
}
