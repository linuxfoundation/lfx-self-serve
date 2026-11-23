// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { ORG_LENS_ROI_VALUE_DRIVERS_COLORS, ORG_LENS_ROI_VALUE_DRIVERS_COPY, ORG_LENS_ROI_VALUE_DRIVERS_LABEL_INSIDE_PCT } from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod, OrgLensRoiValueDriverPositionedBar, OrgLensRoiValueDrivers, OrgLensSectionOutcome } from '@lfx-one/shared/interfaces';
import { buildValueDriverBars, formatSignedPercent, valueDriverAxisBound } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { classifySectionError, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, of, switchMap, tap } from 'rxjs';

/**
 * How the organization's portfolio of projects earns return from each value driver category,
 * relative to a typical organization-project pair. Drawn with CSS rather than a canvas: the geometry is five
 * bars on a shared zero line, which keeps it SSR-safe, exact, and readable by assistive technology.
 */
@Component({
  selector: 'lfx-org-roi-value-drivers',
  imports: [OrgLensEmptyStateComponent, SkeletonModule],
  templateUrl: './org-roi-value-drivers.component.html',
})
export class OrgRoiValueDriversComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly roiService = inject(OrgLensRoiService);

  public readonly method = input.required<OrgLensRoiMethod>();

  protected readonly copy = ORG_LENS_ROI_VALUE_DRIVERS_COPY;
  protected readonly colors = ORG_LENS_ROI_VALUE_DRIVERS_COLORS;

  protected readonly loading = signal(true);
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  private readonly attempt = signal(0);

  protected readonly valueDrivers: Signal<OrgLensRoiValueDrivers | null> = this.initValueDrivers();

  protected readonly orgName: Signal<string> = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

  /** An organization with no decomposition is an answer, not an error, so it gets the empty state. */
  protected readonly emptyState = computed(() => {
    const outcome = this.loadOutcome();
    const hasRows = (this.valueDrivers()?.rows.length ?? 0) > 0;
    return sectionEmptyState(outcome === 'records' && !hasRows ? 'empty' : outcome);
  });

  /** Half-range of the axis, symmetric so the Average line is always the centre. */
  protected readonly axisBound: Signal<number> = computed(() => valueDriverAxisBound(this.valueDrivers()?.rows ?? []));

  protected readonly bars: Signal<OrgLensRoiValueDriverPositionedBar[]> = computed(() => {
    const bound = this.axisBound();
    return buildValueDriverBars(this.valueDrivers()?.rows ?? []).map((bar) => {
      const widthPct = (Math.min(Math.abs(bar.pctDeviation), bound) / bound) * 50;
      const labelInside = widthPct > ORG_LENS_ROI_VALUE_DRIVERS_LABEL_INSIDE_PCT;
      const positive = bar.pctDeviation >= 0;
      // Outside, the label starts at the bar's end and runs away from the zero line; inside, it is
      // anchored to the end and runs back toward it.
      const labelSide = positive === labelInside ? 'right' : 'left';
      const labelOffset = `calc(${labelInside ? 50 - widthPct : 50 + widthPct}% + 6px)`;
      return { ...bar, widthPct, labelInside, labelSide, labelOffset } satisfies OrgLensRoiValueDriverPositionedBar;
    });
  });

  protected readonly ticks: Signal<{ position: number; label: string }[]> = computed(() => {
    const bound = this.axisBound();
    return [-bound, -bound / 2, 0, bound / 2, bound].map((value, index) => ({
      position: index * 25,
      label: value === 0 ? this.copy.axisCenter : formatSignedPercent(value, 0),
    }));
  });

  protected readonly projectCount: Signal<number> = computed(() => this.valueDrivers()?.nProjects ?? 0);

  protected readonly chartSummaryLabel: Signal<string> = computed(
    () =>
      `Diverging bar chart of return from each value driver relative to a typical company-project pair: ${this.bars()
        .map((bar) => `${bar.category} ${bar.label}`)
        .join(', ')}.`
  );

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private initValueDrivers(): Signal<OrgLensRoiValueDrivers | null> {
    // Deduplicated explicitly: the selected-account object is rewritten in place, so the computed
    // re-emits on changes that leave every field identical.
    const request$ = toObservable(
      computed(() => ({ orgUid: this.accountContext.selectedAccount()?.accountId ?? '', method: this.method(), attempt: this.attempt() }))
    ).pipe(distinctUntilChanged((previous, next) => previous.orgUid === next.orgUid && previous.method === next.method && previous.attempt === next.attempt));

    return toSignal(
      request$.pipe(
        filter(({ orgUid }) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.loadOutcome.set('records');
        }),
        switchMap(({ orgUid, method }) =>
          this.roiService.getValueDrivers(orgUid, method).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load ROI value drivers', error);
              this.loading.set(false);
              this.loadOutcome.set(classifySectionError(error));
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }
}
