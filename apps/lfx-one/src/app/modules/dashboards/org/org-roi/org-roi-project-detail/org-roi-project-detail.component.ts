// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import {
  lfxColors,
  ORG_LENS_ROI_DEFAULT_METHOD,
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_KPI_ICON_CLASS,
  ORG_LENS_ROI_METHOD_LABELS,
  ORG_LENS_ROI_NO_VALUE,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod, OrgLensRoiProjectAnnual, OrgLensRoiProjectDetail, OrgLensRoiProjectYearRow, StatCardItem } from '@lfx-one/shared/interfaces';
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiMethodPreferenceService } from '@services/org-lens-roi-method-preference.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import type { ChartData, ChartOptions } from 'chart.js';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, switchMap, tap } from 'rxjs';

/** Pre-fetch sentinel. `null` distinguishes "nothing in hand" from a payload describing no project. */
const EMPTY_DETAIL: { detail: OrgLensRoiProjectDetail | null; annual: OrgLensRoiProjectAnnual | null } = { detail: null, annual: null };

/** One project's ROI, reached from the projects table (LFXV2-2980). */
@Component({
  selector: 'lfx-org-roi-project-detail',
  imports: [ChartComponent, StatCardGridComponent, RouterLink, SkeletonModule],
  templateUrl: './org-roi-project-detail.component.html',
})
export class OrgRoiProjectDetailComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly roiService = inject(OrgLensRoiService);
  private readonly methodPreference = inject(OrgLensRoiMethodPreferenceService);

  protected readonly noValue = ORG_LENS_ROI_NO_VALUE;
  protected readonly explanation = ORG_LENS_ROI_KPI_EXPLANATION;

  /**
   * Honoured, not offered. The estimation method control lives in the portfolio page's assumptions
   * drawer; arriving here on `direct` and being shown `logit` figures would change the basis of the
   * numbers without saying so.
   */
  protected readonly method = signal<OrgLensRoiMethod>(ORG_LENS_ROI_DEFAULT_METHOD);

  protected readonly methodLabel: Signal<string> = computed(() => ORG_LENS_ROI_METHOD_LABELS[this.method()]);

  protected readonly projectSlug: Signal<string> = toSignal(this.activatedRoute.paramMap.pipe(map((params) => params.get('projectSlug') ?? '')), {
    initialValue: '',
  });

  /**
   * No analytics id means no request is ever issued, so without a branch of its own this page would
   * hold its loading skeleton forever. Reachable by deep link — arriving from the portfolio page
   * always has an organization selected, but a bookmarked or shared URL need not.
   */
  protected readonly hasAnalyticsId: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount()?.accountId);

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly forbidden = signal(false);
  /** The 404 path: this organization has no ROI row for the slug. Distinct from a failed read. */
  protected readonly missing = signal(false);

  private readonly payload = this.initPayload();

  private readonly detail: Signal<OrgLensRoiProjectDetail | null> = computed(() => this.payload().detail);
  private readonly annual: Signal<OrgLensRoiProjectAnnual | null> = computed(() => this.payload().annual);

  /**
   * Whether the payload in hand describes **both** the organization now selected and the project
   * now in the URL.
   *
   * The organization half is the check the portfolio page makes on its summary, for the same
   * reason: a request in flight during a switch leaves the previous figures on screen under the new
   * name. The project half matters at least as much here and has no analogue there. This route is
   * navigated project-to-project — from a table row, from the browser's history — and Angular reuses
   * the component instance across that, so the payload keeps the previous project until the next
   * response lands. Checking the organization alone would pass, because it has not changed, and one
   * project's investment and ROI would render under another's name.
   *
   * Both are synchronous signal reads, so they flip in the same change-detection pass as the
   * navigation, unlike the `toObservable`-driven loading flag which settles one effect flush later.
   */
  private readonly payloadMatchesRoute: Signal<boolean> = computed(() => {
    const selected = this.accountContext.selectedAccount()?.accountId ?? '';
    const detail = this.detail();
    if (detail === null || selected === '') return false;
    return detail.orgUid === selected && detail.project.projectSlug === this.projectSlug();
  });

  protected readonly showsFigures: Signal<boolean> = computed(() => !this.forbidden() && !this.failed() && !this.missing() && this.payloadMatchesRoute());

  /** Falls back to the slug rather than the stale payload's name, for the same window. */
  protected readonly projectName: Signal<string> = computed(
    () => (this.payloadMatchesRoute() ? this.detail()?.project.projectName : null) ?? this.projectSlug()
  );

  /**
   * Whether `/org/projects/{slug}` has anything to show.
   *
   * Measured 2026-08-05, 32.4% of ROI organization-project pairs have no Org Lens catalog row, so
   * the link cannot be rendered unconditionally — the spec's original "always resolves" assumption
   * is false and an unconditional link would send a third of viewers to a dead page.
   */
  protected readonly hasOrgLensProject: Signal<boolean> = computed(() => this.detail()?.hasOrgLensProject === true);

  protected readonly orgProjectLink: Signal<string> = computed(() => `/org/projects/${this.detail()?.project.projectSlug ?? this.projectSlug()}`);

  /** Five figures, read from the payload — roi, bcr and profit are defined once in the metric layer. */
  protected readonly cards: Signal<StatCardItem[]> = computed(() => {
    const project = this.detail()?.project;
    return [
      {
        label: 'Investment',
        value: this.money(project?.totalExpenditure),
        subLine: 'Modelled cost',
        icon: 'fa-light fa-hand-holding-dollar',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.totalExpenditure,
      },
      {
        label: 'Return',
        value: this.money(project?.totalReturn),
        icon: 'fa-light fa-arrow-trend-up',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.totalReturn,
      },
      {
        label: 'Net Return',
        value: this.money(project?.profit),
        icon: 'fa-light fa-scale-unbalanced',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.profit,
      },
      {
        label: 'ROI',
        value: this.ratioAsPercent(project?.roi),
        icon: 'fa-light fa-percent',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.roi,
      },
      {
        label: 'Benefit-Cost Ratio',
        value: this.multiple(project?.bcr),
        icon: 'fa-light fa-scale-balanced',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.bcr,
      },
    ];
  });

  /** A loss is a real outcome for 6.45% of production project rows, so it is stated, not implied. */
  protected readonly isLossMaking: Signal<boolean> = computed(() => (this.detail()?.project.profit ?? 0) < 0);

  protected readonly apportioned: Signal<boolean> = computed(() => this.annual()?.apportioned === true);

  /** Drives the constancy disclosure from the contract rather than from a template literal. */
  protected readonly efficiencyConstant: Signal<boolean> = computed(() => this.annual()?.efficiencyConstant === true);

  protected readonly hasYearRows: Signal<boolean> = computed(() => this.yearRows().length > 0);

  // Only the calendar year still in progress is partial. A project whose activity stopped earlier
  // has a complete final year, and marking it "still accruing" would misexplain a real decline.
  private readonly partialYear: Signal<number | null> = computed(() => {
    const lastYear = this.annual()?.rows.at(-1)?.year ?? null;
    return lastYear !== null && lastYear === new Date().getFullYear() ? lastYear : null;
  });

  protected readonly yearRows: Signal<OrgLensRoiProjectYearRow[]> = computed(() => {
    const partial = this.partialYear();
    return (this.annual()?.rows ?? []).map((row) => ({
      year: row.year,
      expenditure: row.expenditure,
      investmentLabel: formatCurrency(row.expenditure),
      returnLabel: formatCurrency(row.totalReturn),
      isPartial: row.year === partial,
    }));
  });

  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    const rows = this.yearRows();
    if (rows.length === 0) return 'Investment by year';
    return `Bar chart of investment by year, ${rows[0].year} to ${rows[rows.length - 1].year}. The same figures follow in a table.`;
  });

  /**
   * Investment only — one series, deliberately.
   *
   * Return runs tens of times investment on these projects, so plotting both on one linear axis
   * flattens investment to the baseline, which is the unresolved scaling problem the portfolio
   * trend and the comparison bar both record. This figure answers "when was the investment made",
   * so a single series sidesteps that rather than inheriting it, and the table beside it carries
   * the per-year return for anyone who wants both.
   */
  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => {
    const rows = this.yearRows();
    return {
      labels: rows.map((row) => `${row.year}`),
      datasets: [
        {
          label: 'Investment',
          data: rows.map((row) => row.expenditure),
          backgroundColor: lfxColors.blue[500],
          borderColor: lfxColors.blue[500],
        },
      ],
    };
  });

  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => ` Investment: ${formatCurrency(ctx.parsed.y as number)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, maxRotation: 0 },
      },
      y: {
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[400], width: 1, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => formatCurrency(v as number) },
        beginAtZero: true,
      },
    },
  };

  public constructor() {
    // Must stay in afterNextRender — restoring the stored method earlier causes a hydration mismatch.
    afterNextRender(() => this.restoreMethod());
  }

  private initPayload(): Signal<{ detail: OrgLensRoiProjectDetail | null; annual: OrgLensRoiProjectAnnual | null }> {
    // A typed triple rather than a delimited string, so nothing has to be parsed back out or cast.
    // The dedup a string key gave for free is restored explicitly: the selected-account object is
    // rewritten in place, so this recomputes on changes that leave every field identical.
    const request$ = toObservable(
      computed(() => ({ orgUid: this.accountContext.selectedAccount()?.accountId ?? '', projectSlug: this.projectSlug(), method: this.method() }))
    ).pipe(
      distinctUntilChanged((previous, next) => previous.orgUid === next.orgUid && previous.projectSlug === next.projectSlug && previous.method === next.method)
    );

    return toSignal(
      request$.pipe(
        filter(({ orgUid, projectSlug }) => !!orgUid && !!projectSlug),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
          this.missing.set(false);
        }),
        switchMap(({ orgUid, projectSlug, method }) =>
          combineLatest({
            detail: this.roiService.getProjectDetail(orgUid, projectSlug, method),
            annual: this.roiService.getProjectAnnual(orgUid, projectSlug, method),
          }).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load ROI project detail', error);
              this.loading.set(false);
              const status = (error as { status?: number })?.status;
              // Three outcomes, kept apart: no grant, no such project for this organization, and
              // everything else. Collapsing the 404 into the error state would tell a viewer to
              // retry a request that cannot succeed.
              if (status === 403) this.forbidden.set(true);
              else if (status === 404) this.missing.set(true);
              else this.failed.set(true);
              return of(EMPTY_DETAIL);
            })
          )
        )
      ),
      { initialValue: EMPTY_DETAIL }
    );
  }

  private restoreMethod(): void {
    const stored = this.methodPreference.read();
    if (stored !== null) this.method.set(stored);
  }

  /**
   * A measure is renderable only if it is actually a finite number. `=== null` is not enough: an
   * absent key is `undefined`, which slips past it and reaches `toFixed()`. These measures are
   * nullable by design, so anything non-numeric renders as the no-value indicator, never as 0.
   */
  private isRenderable(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private money(value: number | null | undefined): string {
    return this.isRenderable(value) ? formatCurrency(value) : ORG_LENS_ROI_NO_VALUE;
  }

  private ratioAsPercent(value: number | null | undefined): string {
    return this.isRenderable(value) ? `${formatPercent(value * 100)}%` : ORG_LENS_ROI_NO_VALUE;
  }

  /** A ratio, not a percentage, so it does not go through the percentage formatter. */
  private multiple(value: number | null | undefined): string {
    return this.isRenderable(value) ? `${value.toFixed(1)}×` : ORG_LENS_ROI_NO_VALUE;
  }
}
