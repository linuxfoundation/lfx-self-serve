// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_ORG_CERTIFICATIONS_SORT_FIELD,
  DEFAULT_ORG_CERTIFICATIONS_SORT_ORDER,
  DEFAULT_ORG_TRAININGS_SORT_FIELD,
  DEFAULT_ORG_TRAININGS_SORT_ORDER,
  DEFAULT_ORG_TRAINING_TAB_ID,
  DESCENDING_DEFAULT_ORG_CERTIFICATION_SORT_FIELDS,
  DESCENDING_DEFAULT_ORG_TRAINING_SORT_FIELDS,
  EMPTY_ORG_CERTIFICATIONS_RESPONSE,
  EMPTY_ORG_TRAININGS_RESPONSE,
  ORG_TRAINING_LEVEL_OPTIONS,
  ORG_TRAINING_TABS,
  VALID_ORG_TRAINING_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  OrgCertification,
  OrgCertificationsResponse,
  OrgTraining,
  OrgTrainingsResponse,
  OrgTrainingStats,
  OrgTrainingTabId,
  PageChangeEvent,
  SortChangeEvent,
} from '@lfx-one/shared/interfaces';
import { catchError, debounceTime, finalize, of, switchMap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';

import { CertEmployeesDrawerComponent } from './components/cert-employees-drawer/cert-employees-drawer.component';
import { OrgCertificationsTableComponent } from './components/org-certifications-table/org-certifications-table.component';
import { OrgTrainingsTableComponent } from './components/org-trainings-table/org-trainings-table.component';
import { TrainingEmployeesDrawerComponent } from './components/training-employees-drawer/training-employees-drawer.component';

@Component({
  selector: 'lfx-org-training',
  imports: [
    CardComponent,
    CardTabsBarComponent,
    InputTextComponent,
    SelectComponent,
    OrgCertificationsTableComponent,
    OrgTrainingsTableComponent,
    CertEmployeesDrawerComponent,
    TrainingEmployeesDrawerComponent,
  ],
  templateUrl: './org-training.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgTrainingComponent {
  // ─── Private injections ────────────────────────────────────────────────────
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly trainingService = inject(OrgLensTrainingService);

  // ─── Configuration ─────────────────────────────────────────────────────────
  // Shared constants are readonly; copy into mutable arrays for the component inputs that expect them.
  protected readonly tabs = [...ORG_TRAINING_TABS];
  protected readonly levelOptions = [...ORG_TRAINING_LEVEL_OPTIONS];

  // ─── Forms ─────────────────────────────────────────────────────────────────
  protected readonly filterForm = new FormGroup({
    search: new FormControl(''),
    level: new FormControl<string | null>(null),
  });

  // ─── Writable Signals ──────────────────────────────────────────────────────
  protected readonly statsLoading = signal(false);
  protected readonly statsError = signal(false);

  protected readonly certificationsLoading = signal(false);
  protected readonly certificationsError = signal(false);
  protected readonly certSortField = signal<string>(DEFAULT_ORG_CERTIFICATIONS_SORT_FIELD);
  protected readonly certSortOrder = signal<'ASC' | 'DESC'>(DEFAULT_ORG_CERTIFICATIONS_SORT_ORDER);
  protected readonly certOffset = signal(0);
  protected readonly certPageSize = signal(EMPTY_ORG_CERTIFICATIONS_RESPONSE.pageSize);

  protected readonly trainingsLoading = signal(false);
  protected readonly trainingsError = signal(false);
  protected readonly trainingSortField = signal<string>(DEFAULT_ORG_TRAININGS_SORT_FIELD);
  protected readonly trainingSortOrder = signal<'ASC' | 'DESC'>(DEFAULT_ORG_TRAININGS_SORT_ORDER);
  protected readonly trainingOffset = signal(0);
  protected readonly trainingPageSize = signal(EMPTY_ORG_TRAININGS_RESPONSE.pageSize);

  // Drawer state — separate visibility flags so the certified and in-progress rosters don't collide.
  protected readonly certifiedDrawerVisible = signal(false);
  protected readonly inProgressDrawerVisible = signal(false);
  protected readonly activeCertification = signal<OrgCertification | null>(null);

  protected readonly trainingCompletedDrawerVisible = signal(false);
  protected readonly trainingInProgressDrawerVisible = signal(false);
  protected readonly activeTraining = signal<OrgTraining | null>(null);

  private readonly searchValue = signal('');
  private readonly levelValue = signal<string | null>(null);

  // ─── Computed / toSignal ───────────────────────────────────────────────────
  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly orgUid = computed(() => this.accountContext.selectedAccount()?.uid ?? '');
  protected readonly activeTab: Signal<OrgTrainingTabId> = this.initActiveTab();
  protected readonly trainingStats: Signal<OrgTrainingStats | null> = this.initTrainingStats();
  protected readonly certifications: Signal<OrgCertificationsResponse> = this.initCertifications();
  protected readonly trainings: Signal<OrgTrainingsResponse> = this.initTrainings();
  protected readonly certHasActiveFilters = computed(() => !!this.searchValue() || !!this.levelValue());
  protected readonly trainingHasActiveFilters = computed(() => !!this.searchValue() || !!this.levelValue());

  // ─── Constructor ─────────────────────────────────────────────────────────--
  public constructor() {
    // Filter changes feed the cert fetch and reset pagination to the first page.
    this.filterForm.controls.search.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((value) => {
      this.searchValue.set(value ?? '');
      this.certOffset.set(0);
      this.trainingOffset.set(0);
    });
    this.filterForm.controls.level.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.levelValue.set(value ?? null);
      this.certOffset.set(0);
      this.trainingOffset.set(0);
    });
  }

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onCertPageChange(event: PageChangeEvent): void {
    this.certOffset.set(event.offset);
    this.certPageSize.set(event.pageSize);
  }

  protected onCertSortChange(event: SortChangeEvent): void {
    if (event.field === this.certSortField()) {
      this.certSortOrder.update((order) => (order === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      this.certSortField.set(event.field);
      this.certSortOrder.set(DESCENDING_DEFAULT_ORG_CERTIFICATION_SORT_FIELDS.has(event.field) ? 'DESC' : 'ASC');
    }
    this.certOffset.set(0);
  }

  protected onCertifiedClick(cert: OrgCertification): void {
    this.inProgressDrawerVisible.set(false);
    this.activeCertification.set(cert);
    this.certifiedDrawerVisible.set(true);
  }

  protected onInProgressClick(cert: OrgCertification): void {
    this.certifiedDrawerVisible.set(false);
    this.activeCertification.set(cert);
    this.inProgressDrawerVisible.set(true);
  }

  protected onTrainingPageChange(event: PageChangeEvent): void {
    this.trainingOffset.set(event.offset);
    this.trainingPageSize.set(event.pageSize);
  }

  protected onTrainingSortChange(event: SortChangeEvent): void {
    if (event.field === this.trainingSortField()) {
      this.trainingSortOrder.update((order) => (order === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      this.trainingSortField.set(event.field);
      this.trainingSortOrder.set(DESCENDING_DEFAULT_ORG_TRAINING_SORT_FIELDS.has(event.field) ? 'DESC' : 'ASC');
    }
    this.trainingOffset.set(0);
  }

  protected onTrainingCompletedClick(training: OrgTraining): void {
    this.trainingInProgressDrawerVisible.set(false);
    this.activeTraining.set(training);
    this.trainingCompletedDrawerVisible.set(true);
  }

  protected onTrainingInProgressClick(training: OrgTraining): void {
    this.trainingCompletedDrawerVisible.set(false);
    this.activeTraining.set(training);
    this.trainingInProgressDrawerVisible.set(true);
  }

  protected switchTab(tabId: OrgTrainingTabId): void {
    if (tabId === this.activeTab()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_ORG_TRAINING_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onActiveTabChange(tabId: string): void {
    if (!VALID_ORG_TRAINING_TAB_IDS.has(tabId as OrgTrainingTabId)) {
      return;
    }
    this.switchTab(tabId as OrgTrainingTabId);
  }

  protected onStatCardClick(tabId: OrgTrainingTabId): void {
    this.switchTab(tabId);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initActiveTab(): Signal<OrgTrainingTabId> {
    const queryParamMap = toSignal(this.route.queryParamMap, {
      initialValue: this.route.snapshot.queryParamMap,
    });
    return computed(() => {
      const raw = queryParamMap().get('tab');
      return raw && VALID_ORG_TRAINING_TAB_IDS.has(raw as OrgTrainingTabId) ? (raw as OrgTrainingTabId) : DEFAULT_ORG_TRAINING_TAB_ID;
    });
  }

  private initTrainingStats(): Signal<OrgTrainingStats | null> {
    const orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid ?? null));
    return toSignal(
      orgUid$.pipe(
        switchMap((id) => {
          // No org selected (or context cleared mid-flight): reset state instead of leaving loading stuck.
          if (!id) {
            this.statsLoading.set(false);
            this.statsError.set(false);
            return of(null);
          }

          this.statsLoading.set(true);
          this.statsError.set(false);

          return this.trainingService.getTrainingStats(id).pipe(
            catchError(() => {
              this.statsError.set(true);
              return of(null);
            }),
            // finalize clears loading once — covers success and the recovered error path.
            finalize(() => this.statsLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initCertifications(): Signal<OrgCertificationsResponse> {
    // Rebuild a query object whenever org, filters, sort, or pagination change; toObservable
    // emits the new object and switchMap cancels any in-flight request for the prior query.
    const query$ = toObservable(
      computed(() => ({
        activeTab: this.activeTab(),
        orgUid: this.accountContext.selectedAccount()?.uid ?? null,
        searchQuery: this.searchValue(),
        level: this.levelValue(),
        sortField: this.certSortField(),
        sortOrder: this.certSortOrder(),
        offset: this.certOffset(),
        pageSize: this.certPageSize(),
      }))
    );

    return toSignal(
      query$.pipe(
        switchMap((query) => {
          // Only query Snowflake when the Certifications tab is active and an org is selected —
          // avoids avoidable load when the Trainings tab is showing or no org is resolved yet.
          if (query.activeTab !== 'certifications' || !query.orgUid) {
            this.certificationsLoading.set(false);
            this.certificationsError.set(false);
            return of(EMPTY_ORG_CERTIFICATIONS_RESPONSE);
          }

          this.certificationsLoading.set(true);
          this.certificationsError.set(false);

          return this.trainingService
            .getOrgCertifications(query.orgUid, {
              searchQuery: query.searchQuery || undefined,
              level: query.level,
              sortField: query.sortField,
              sortOrder: query.sortOrder,
              offset: query.offset,
              pageSize: query.pageSize,
            })
            .pipe(
              // Distinguish a real failure from an empty result so the template can show an error state.
              catchError(() => {
                this.certificationsError.set(true);
                return of(EMPTY_ORG_CERTIFICATIONS_RESPONSE);
              }),
              finalize(() => this.certificationsLoading.set(false))
            );
        })
      ),
      { initialValue: EMPTY_ORG_CERTIFICATIONS_RESPONSE }
    );
  }

  private initTrainings(): Signal<OrgTrainingsResponse> {
    const query$ = toObservable(
      computed(() => ({
        activeTab: this.activeTab(),
        orgUid: this.accountContext.selectedAccount()?.uid ?? null,
        searchQuery: this.searchValue(),
        level: this.levelValue(),
        sortField: this.trainingSortField(),
        sortOrder: this.trainingSortOrder(),
        offset: this.trainingOffset(),
        pageSize: this.trainingPageSize(),
      }))
    );

    return toSignal(
      query$.pipe(
        switchMap((query) => {
          if (query.activeTab !== 'trainings' || !query.orgUid) {
            this.trainingsLoading.set(false);
            this.trainingsError.set(false);
            return of(EMPTY_ORG_TRAININGS_RESPONSE);
          }

          this.trainingsLoading.set(true);
          this.trainingsError.set(false);

          return this.trainingService
            .getOrgTrainings(query.orgUid, {
              searchQuery: query.searchQuery || undefined,
              level: query.level,
              sortField: query.sortField,
              sortOrder: query.sortOrder,
              offset: query.offset,
              pageSize: query.pageSize,
            })
            .pipe(
              catchError(() => {
                this.trainingsError.set(true);
                return of(EMPTY_ORG_TRAININGS_RESPONSE);
              }),
              finalize(() => this.trainingsLoading.set(false))
            );
        })
      ),
      { initialValue: EMPTY_ORG_TRAININGS_RESPONSE }
    );
  }
}
