// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_ORG_TRAINING_TAB_ID, ORG_TRAINING_LEVEL_OPTIONS, ORG_TRAINING_TABS, VALID_ORG_TRAINING_TAB_IDS } from '@lfx-one/shared/constants';
import type { OrgTrainingStats, OrgTrainingTabId } from '@lfx-one/shared/interfaces';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';

@Component({
  selector: 'lfx-org-training',
  imports: [CardComponent, CardTabsBarComponent, EmptyStateComponent, InputTextComponent, SelectComponent],
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

  // ─── Computed / toSignal ───────────────────────────────────────────────────
  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly activeTab: Signal<OrgTrainingTabId> = this.initActiveTab();
  protected readonly trainingStats: Signal<OrgTrainingStats | null> = this.initTrainingStats();

  // ─── Protected Methods ─────────────────────────────────────────────────────
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
}
