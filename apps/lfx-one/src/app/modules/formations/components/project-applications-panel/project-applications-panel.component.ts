// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { PROJECT_APPLICATION_STATE_FILTER_OPTIONS } from '@lfx-one/shared/constants';
import type { FilterPillOption, ProjectApplication, ProjectApplicationRow, ProjectApplicationViewMode } from '@lfx-one/shared/interfaces';
import { reconcileProjectApplications, toProjectApplicationRow, upsertProjectApplication } from '@lfx-one/shared/utils';
import { ProjectApplicationService } from '@services/project-application.service';
import type { TablePageEvent } from 'primeng/table';
import { debounceTime } from 'rxjs';

import { ProjectApplicationDrawerComponent } from '../project-application-drawer/project-application-drawer.component';

/**
 * The project-application list (#3037) — the submitter's "Submitted proposals" tab on My Formations
 * (`mode="submitter"`) and the formation team's "Project proposals" queue on the foundation Formations
 * page (`mode="staff"`). Rows open {@link ProjectApplicationDrawerComponent}.
 *
 * query-service lags a successful write, so every write result is kept locally and overlaid on each
 * fresh read (`reconcileProjectApplications`) — a just-withdrawn proposal never flips back to
 * "Submitted" and a just-deleted one never reappears because the index hasn't caught up yet. The
 * overlay is component state only; nothing is written to browser storage.
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

  // === Inputs ===
  public readonly mode = input<ProjectApplicationViewMode>('submitter');

  // === Template constants ===
  protected readonly stateFilterOptions: FilterPillOption[] = PROJECT_APPLICATION_STATE_FILTER_OPTIONS;
  protected readonly proposeRoute = ['/formations/propose'];

  // === Forms ===
  public readonly searchForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  // === Writable Signals ===
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly searchTerm = signal('');
  protected readonly stateFilter = signal<string>('all');
  protected readonly first = signal(0);
  protected readonly selectedUid = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  private readonly fetched = signal<ProjectApplication[]>([]);
  private readonly localWrites = signal<ProjectApplication[]>([]);
  private readonly deletedUids = signal<ReadonlySet<string>>(new Set());

  // === Computed Signals ===
  protected readonly applications: Signal<ProjectApplicationRow[]> = computed(() =>
    reconcileProjectApplications(this.fetched(), this.localWrites(), this.deletedUids()).map(toProjectApplicationRow)
  );
  protected readonly filteredApplications: Signal<ProjectApplicationRow[]> = this.initFilteredApplications();
  protected readonly selectedApplication: Signal<ProjectApplication | null> = computed(
    () => this.applications().find((application) => application.uid === this.selectedUid()) ?? null
  );
  protected readonly isStaff = computed(() => this.mode() === 'staff');
  protected readonly hasActiveFilters = computed(() => this.stateFilter() !== 'all' || !!this.searchTerm().trim());
  protected readonly showEmptyState = computed(() => !this.loading() && !this.hasError() && this.applications().length === 0);
  protected readonly showNoResults = computed(() => !this.loading() && this.applications().length > 0 && this.filteredApplications().length === 0);

  // === Constructor ===
  public constructor() {
    this.searchForm.controls.search.valueChanges.pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.first.set(0);
      this.searchTerm.set(value ?? '');
    });
  }

  // === Lifecycle ===
  public ngOnInit(): void {
    const pending = this.mode() === 'submitter' ? this.projectApplicationService.consumePendingCreated() : null;
    if (pending) {
      this.localWrites.set([pending]);
    }
    this.load();
  }

  // === Protected Methods ===
  protected onStateFilterChange(state: string): void {
    this.first.set(0);
    this.stateFilter.set(state);
  }

  protected onPage(event: TablePageEvent): void {
    this.first.set(event.first);
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
    this.localWrites.update((list) => upsertProjectApplication(list, application));
  }

  protected onDeleted(uid: string): void {
    this.deletedUids.update((set) => new Set([...set, uid]));
    this.localWrites.update((list) => list.filter((application) => application.uid !== uid));
    this.selectedUid.set(null);
  }

  /**
   * A 412/404 means the local copy is out of date. Drop the local overlay for that application so the
   * fresh read wins, then reload; the drawer stays bound to the same UID and shows the latest.
   */
  protected onStale(): void {
    const uid = this.selectedUid();
    if (uid) {
      this.localWrites.update((list) => list.filter((application) => application.uid !== uid));
    }
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  // === Private Initializers ===
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

  // === Private Helpers ===
  private load(): void {
    this.loading.set(true);
    this.hasError.set(false);
    this.projectApplicationService
      .getApplications(this.mode())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (applications) => {
          this.fetched.set(applications);
          this.loading.set(false);
        },
        error: () => {
          this.hasError.set(true);
          this.loading.set(false);
        },
      });
  }
}
