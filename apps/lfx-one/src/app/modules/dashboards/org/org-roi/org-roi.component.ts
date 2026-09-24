// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ORG_LENS_ROI_DEFAULT_METHOD } from '@lfx-one/shared/constants';
import type { OrgLensRoiCoverage, OrgLensRoiMethod, OrgLensRoiSummary, OrgLensSectionOutcome } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensRoiMethodPreferenceService } from '@services/org-lens-roi-method-preference.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { classifySectionError, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';

import { OrgRoiAnnualTrendComponent } from './components/org-roi-annual-trend/org-roi-annual-trend.component';
import { OrgRoiAssumptionsDrawerComponent } from './components/org-roi-assumptions-drawer/org-roi-assumptions-drawer.component';
import { OrgRoiCategoryDonutComponent } from './components/org-roi-category-donut/org-roi-category-donut.component';
import { OrgRoiEmptyStateComponent } from './components/org-roi-empty-state/org-roi-empty-state.component';
import { OrgRoiKpiCardsComponent } from './components/org-roi-kpi-cards/org-roi-kpi-cards.component';
import { OrgRoiProjectsDonutComponent } from './components/org-roi-projects-donut/org-roi-projects-donut.component';
import { OrgRoiProjectsSectionComponent } from './components/org-roi-projects-section/org-roi-projects-section.component';

const EMPTY_SUMMARY: OrgLensRoiSummary = {
  orgUid: '',
  method: ORG_LENS_ROI_DEFAULT_METHOD,
  hasData: false,
  nProjects: 0,
  totalExpenditure: null,
  totalReturn: null,
  profit: null,
  roi: null,
  bcr: null,
  yearMin: null,
  yearMax: null,
  dateMin: null,
  dateMax: null,
};

const EMPTY_COVERAGE: OrgLensRoiCoverage = { orgUid: '', hasData: false, coverageReason: 'unmapped' };

/** Org Lens ROI Metrics (LFXV2-2980). */
@Component({
  selector: 'lfx-org-roi',
  imports: [
    OrgRoiKpiCardsComponent,
    OrgRoiAnnualTrendComponent,
    OrgRoiCategoryDonutComponent,
    OrgRoiProjectsDonutComponent,
    OrgRoiProjectsSectionComponent,
    OrgRoiAssumptionsDrawerComponent,
    OrgRoiEmptyStateComponent,
    EmptyStateComponent,
    OrgLensEmptyStateComponent,
    SkeletonModule,
  ],
  templateUrl: './org-roi.component.html',
})
export class OrgRoiComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly roiService = inject(OrgLensRoiService);
  private readonly methodPreference = inject(OrgLensRoiMethodPreferenceService);
  protected readonly emptyState = inject(OrgLensEmptyStateService);

  protected readonly method = signal<OrgLensRoiMethod>(ORG_LENS_ROI_DEFAULT_METHOD);
  protected readonly drawerVisible = signal(false);
  protected readonly portfolioLoading = signal(true);
  /**
   * Spec 053 (FR-014/FR-015) — how the last portfolio request ended. `denied` (403 `FORBIDDEN`) and
   * `unverifiable` (503 `ROLE_GRANTS_UNAVAILABLE`) are told apart by the refusal's stated code, so an
   * access check that could not run never reads as a permissions message.
   */
  protected readonly portfolioOutcome = signal<OrgLensSectionOutcome>('records');
  /** The section state the portfolio refusal renders, or null while it has records. */
  protected readonly portfolioEmptyState = computed(() => sectionEmptyState(this.portfolioOutcome()));
  protected readonly portfolioEmptyTestId = computed(() => (this.portfolioOutcome() === 'denied' ? 'org-roi-forbidden' : 'org-roi-error'));
  /** Bumped by Retry so the request key changes without an org or method change. */
  private readonly portfolioAttempt = signal(0);

  // Spec 053 — the page-level state replacing the page, or null when the page renders (FR-016).
  protected readonly pageState = this.emptyState.pageState;
  protected readonly hasPageState = this.emptyState.hasPageState;
  protected readonly correlationId = this.orgRoleGrantsService.correlationId;

  protected readonly loaded: Signal<boolean> = computed(() => this.hasPageState() || (this.orgNavigationService.loaded() && this.emptyState.settled()));

  protected readonly hasCompany: Signal<boolean> = computed(
    () => !!this.accountContext.selectedAccount().uid || !!this.accountContext.selectedAccount().accountId
  );

  protected readonly hasAnalyticsId: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount().accountId);

  private readonly portfolio: Signal<{ summary: OrgLensRoiSummary; coverage: OrgLensRoiCoverage }> = this.initPortfolio();

  protected readonly summary: Signal<OrgLensRoiSummary> = computed(() => this.portfolio().summary);
  protected readonly coverage: Signal<OrgLensRoiCoverage> = computed(() => this.portfolio().coverage);

  protected readonly hasRoiData: Signal<boolean> = computed(() => this.summary().hasData);

  /**
   * The method control has to stay reachable on the empty state, not just alongside figures.
   * Coverage is method-scoped, so a method with no rows renders the empty state — and if the only
   * way to change method lived in the success branch, that state would be unrecoverable without
   * clearing storage, including on a stale method restored from a previous visit.
   */
  protected readonly canChooseMethod: Signal<boolean> = computed(
    () =>
      this.loaded() && !this.hasPageState() && this.hasCompany() && this.hasAnalyticsId() && !this.portfolioLoading() && this.portfolioOutcome() === 'records'
  );

  /**
   * Whether the summary in hand actually describes the organization now selected.
   *
   * `summary()` holds its previous value while a new request is in flight, so during an org switch
   * every measure derived from it belongs to the organization the viewer just navigated away from.
   * Comparing the payload's own `orgUid` to the selected account is a synchronous signal read, so
   * it flips in the same change-detection pass as the switch — unlike the donuts' internal loading
   * flags, which are driven by `toObservable` and therefore only settle on the next effect flush.
   */
  protected readonly summaryMatchesSelectedOrg: Signal<boolean> = computed(() => {
    const selected = this.accountContext.selectedAccount()?.accountId ?? '';
    return selected !== '' && this.summary().orgUid === selected;
  });

  /**
   * True whenever this organization has figures to show — deliberately **without**
   * `portfolioLoading`, unlike the state-branch chain in the template.
   *
   * The chain swaps the whole populated block for a skeleton on every request, including a
   * method-only one. That tore down and remounted the category donut on each method switch,
   * re-issuing a read whose response cannot vary by method — the opposite of what its own comment
   * claimed. Mounting the donuts on this condition instead keeps them alive across a method
   * change, so the category donut's account-keyed request simply never re-emits.
   *
   * An org switch is the case that must NOT survive, and the identity check is what separates the
   * two: the account id changes while the summary still describes the previous organization, so
   * this goes false immediately and the donuts unmount rather than rendering one company's
   * investment under another's page.
   */
  protected readonly showsFigures: Signal<boolean> = computed(
    () =>
      this.loaded() &&
      !this.hasPageState() &&
      this.hasCompany() &&
      this.hasAnalyticsId() &&
      this.portfolioOutcome() === 'records' &&
      this.summaryMatchesSelectedOrg() &&
      this.hasRoiData()
  );

  /**
   * Blank until the summary describes the selected organization. The header sits outside the
   * state-branch chain, so without this it would keep showing the previous organization's date
   * window for the whole of the next request — seconds, on a warehouse read.
   */
  protected readonly windowLabel: Signal<string> = computed(() => {
    if (!this.summaryMatchesSelectedOrg()) return '';
    const { yearMin, yearMax } = this.summary();
    if (yearMin === null || yearMax === null) return '';
    return yearMin === yearMax ? `${yearMin}` : `${yearMin}–${yearMax}`;
  });

  public constructor() {
    // Must stay in afterNextRender — restoring the stored method earlier causes a hydration mismatch.
    afterNextRender(() => this.restoreMethod());
  }

  public setMethod(method: OrgLensRoiMethod): void {
    this.method.set(method);
    this.persistMethod(method);
  }

  /** Retry action of the portfolio refusal: re-issue the same request without a reload. */
  public retryPortfolio(): void {
    this.portfolioAttempt.update((attempt) => attempt + 1);
  }

  private initPortfolio(): Signal<{ summary: OrgLensRoiSummary; coverage: OrgLensRoiCoverage }> {
    const defaultValue = { summary: EMPTY_SUMMARY, coverage: EMPTY_COVERAGE };
    // Keyed by string, not the account object: that object is rewritten in place and would retrigger the fetch.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.method()}|${this.portfolioAttempt()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgLensRoiMethod, string]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.portfolioLoading.set(true);
          this.portfolioOutcome.set('records');
        }),
        switchMap(([orgUid, method]) =>
          combineLatest({
            summary: this.roiService.getSummary(orgUid, method),
            coverage: this.roiService.getCoverage(orgUid, method),
          }).pipe(
            tap(() => this.portfolioLoading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load ROI portfolio summary', error);
              this.portfolioLoading.set(false);
              this.portfolioOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private restoreMethod(): void {
    const stored = this.methodPreference.read();
    if (stored !== null) this.method.set(stored);
  }

  private persistMethod(method: OrgLensRoiMethod): void {
    this.methodPreference.write(method);
  }
}
